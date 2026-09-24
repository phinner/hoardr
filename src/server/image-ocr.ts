import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Context, Data, Effect, Layer, Queue } from "effect";
import { SqlClient } from "effect/unstable/sql";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { AppConfig } from "./config";
import { type ImageJob, refreshPostIndex } from "./post-documents";

const ALLOWED_HOSTS = new Set([
  "pbs.twimg.com",
  "abs.twimg.com",
  "ton.twimg.com",
]);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ATTEMPTS = 5;

class OcrFailure extends Data.TaggedError("OcrFailure")<{
  readonly message: string;
  readonly terminal: boolean;
}> {}

const failure = (cause: unknown) =>
  cause instanceof OcrFailure
    ? cause
    : new OcrFailure({ message: String(cause), terminal: false });

const allowed = (url: URL) =>
  url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);

const originalImageUrl = (sourceUrl: string) => {
  const url = new URL(sourceUrl);
  const photo = /^\/media\/([\w-]+)\.(jpg|jpeg|png|webp)$/.exec(url.pathname);

  return url.hostname === "pbs.twimg.com" && photo && url.search === ""
    ? new URL(
        `https://pbs.twimg.com/media/${photo[1]}?format=${photo[2]}&name=orig`,
      )
    : url;
};

async function readImageBytes(
  body: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (
      let next = await reader.read();
      !next.done;
      next = await reader.read()
    ) {
      size += next.value.byteLength;
      if (size > MAX_BYTES)
        throw new OcrFailure({
          message: `Image exceeds ${MAX_BYTES} bytes`,
          terminal: true,
        });
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

async function fetchImage(sourceUrl: string): Promise<Buffer> {
  let url = originalImageUrl(sourceUrl);

  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!allowed(url))
      throw new OcrFailure({
        message: `Image location not allowed: ${url.origin}`,
        terminal: true,
      });

    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location)
        throw new OcrFailure({
          message: "Image redirect has no location",
          terminal: true,
        });
      url = new URL(location, url);
      continue;
    }

    if (!response.ok || !response.body)
      throw new OcrFailure({
        message: `Image server answered HTTP ${response.status}`,
        terminal: response.status >= 400 && response.status < 500,
      });

    return readImageBytes(response.body);
  }

  throw new OcrFailure({ message: "Too many image redirects", terminal: true });
}

const normalizeImage = (bytes: Buffer) =>
  sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: 4096,
      height: 4096,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

const makeImageOcr = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const config = yield* AppConfig;
  const queue = yield* Queue.unbounded<ImageJob>();
  const pending = new Set<string>();

  const jobKey = (job: ImageJob) => `${job.postId}\0${job.url}`;

  const enqueue = Effect.fnUntraced(function* (jobs: readonly ImageJob[]) {
    for (const job of jobs) {
      const key = jobKey(job);
      if (pending.has(key)) continue;
      pending.add(key);
      yield* Queue.offer(queue, job);
    }
  });

  const recognize = Effect.fnUntraced(function* (
    job: ImageJob,
    worker: Awaited<ReturnType<typeof createWorker>>,
  ) {
    const bytes = yield* Effect.tryPromise({
      try: () => fetchImage(job.url),
      catch: failure,
    });
    const image = yield* Effect.tryPromise({
      try: () => normalizeImage(bytes),
      catch: (cause) =>
        new OcrFailure({
          message: `Image could not be decoded: ${String(cause)}`,
          terminal: true,
        }),
    });
    const text = yield* Effect.tryPromise({
      try: async () => (await worker.recognize(image)).data.text.trim(),
      catch: failure,
    });

    yield* sql.withTransaction(
      Effect.gen(function* () {
        const updated = yield* sql<{ rowid: number }>`
          UPDATE post_documents
          SET content = ${text}
          WHERE post_id = ${job.postId} AND type = 'image'
            AND url = ${job.url} AND content IS NULL
          RETURNING rowid
        `;
        if (updated.length > 0) yield* refreshPostIndex(job.postId);
      }),
    );
  });

  const processJob = Effect.fnUntraced(function* (
    job: ImageJob,
    worker: Awaited<ReturnType<typeof createWorker>>,
  ) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const succeeded = yield* Effect.matchEffect(recognize(job, worker), {
        onSuccess: () => Effect.succeed(true),
        onFailure: (error) =>
          Effect.gen(function* () {
            if (!(error instanceof OcrFailure))
              return yield* Effect.fail(error);

            if (error.terminal || attempt === MAX_ATTEMPTS - 1) {
              yield* Effect.logWarning(
                `Image OCR failed for ${job.url}: ${error.message}`,
              );
              return true;
            }

            yield* Effect.sleep(`${2 ** attempt} seconds`);
            return false;
          }),
      });
      if (succeeded) return;
    }
  });

  const enqueueUnfinished = Effect.gen(function* () {
    const images = yield* sql<ImageJob>`
      SELECT post_id, url FROM post_documents
      WHERE type = 'image' AND content IS NULL
    `;
    yield* enqueue(images);
  });

  const run = Effect.scoped(
    Effect.gen(function* () {
      const cachePath = join(config.dataDirectory, "ocr");
      yield* Effect.tryPromise({
        try: () => mkdir(cachePath, { recursive: true }),
        catch: failure,
      });
      const worker = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => createWorker("eng", undefined, { cachePath }),
          catch: failure,
        }),
        (created) => Effect.promise(() => created.terminate()),
      );

      yield* enqueueUnfinished;

      yield* Effect.gen(function* () {
        const job = yield* Queue.take(queue);
        yield* processJob(job, worker).pipe(
          Effect.catch((error) => Effect.logWarning("Image OCR failed", error)),
          Effect.ensuring(Effect.sync(() => pending.delete(jobKey(job)))),
        );
      }).pipe(Effect.forever);
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Image OCR worker failed", error).pipe(
        Effect.andThen(Effect.sleep("1 minute")),
      ),
    ),
    Effect.forever,
  );

  return { enqueue, run };
});

export class ImageOcr extends Context.Service<
  ImageOcr,
  Effect.Success<typeof makeImageOcr>
>()("hoardr/ImageOcr") {}

export const ImageOcrLive = Layer.effect(ImageOcr, makeImageOcr);

export const ImageOcrWorkerLive = Layer.effectDiscard(
  Effect.flatMap(ImageOcr, (ocr) => Effect.forkScoped(ocr.run)),
);
