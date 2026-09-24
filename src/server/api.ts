import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { HoardrApi } from "~/shared/api";
import { Archive } from "./archive";
import { Auth } from "./auth";
import { ImageOcr } from "./image-ocr";

const SystemHandlers = HttpApiBuilder.group(HoardrApi, "system", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
);

const ArchiveHandlers = HttpApiBuilder.group(
  HoardrApi,
  "archive",
  Effect.fn(function* (handlers) {
    const archive = yield* Archive;
    const ocr = yield* ImageOcr;

    return handlers.handle(
      "ingest",
      Effect.fn(function* ({ payload }) {
        const { accepted, imageJobs } = yield* archive
          .ingest(payload)
          .pipe(Effect.orDie);
        yield* ocr.enqueue(imageJobs);
        return { accepted };
      }),
    );
  }),
);

const CredentialHandlers = HttpApiBuilder.group(
  HoardrApi,
  "credentials",
  Effect.fn(function* (handlers) {
    const auth = yield* Auth;

    return handlers.handleAll({
      listCredentials: () => auth.list().pipe(Effect.orDie),
      createCredential: ({ payload }) =>
        auth.create(payload.name, payload.kind).pipe(Effect.orDie),
      revokeCredential: Effect.fn(function* ({ params }) {
        const found = yield* auth.revoke(params.id).pipe(Effect.orDie);

        if (!found) return yield* new HttpApiError.NotFound({});
      }),
    });
  }),
);

export const ApiHandlers = Layer.mergeAll(
  SystemHandlers,
  ArchiveHandlers,
  CredentialHandlers,
);
