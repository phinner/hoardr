import { viewerStatesOf } from "~/extension/archive/merge-viewer";
import { ackPending, takePending } from "~/extension/archive/store";
import { log } from "~/extension/diagnostics/log";
import { api } from "./api";
import { readSetting, readSettings, writeSettings } from "./settings";

export type SyncResult =
  | { readonly kind: "uploaded"; readonly count: number }
  | { readonly kind: "idle" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "disconnected" };

const describe = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

async function recordFailure(message: string, failures: number) {
  const minutes = Math.min(2 ** failures, 60);
  await writeSettings({
    backoff: { failures: failures + 1, retryAt: Date.now() + minutes * 60_000 },
    lastIssue: `Sync failed: ${message} Retrying in ${minutes} min.`,
  });
  return { kind: "failed", message } as const;
}

async function syncOnce(force: boolean): Promise<SyncResult> {
  const { connection, backoff } = await readSettings();
  if (!connection) return { kind: "disconnected" };
  if (!force && backoff && backoff.retryAt > Date.now())
    return { kind: "idle" };

  const pending = await takePending();
  const count = pending.posts.length + pending.viewer.length;
  if (count === 0) return { kind: "idle" };

  try {
    await api(connection, (client) =>
      client.ingest({
        payload: {
          observations: pending.posts.map((entry) => entry.value),
          viewerStates: pending.viewer.flatMap((entry) =>
            viewerStatesOf(entry.value),
          ),
        },
      }),
    );
  } catch (error) {
    return recordFailure(describe(error), backoff?.failures ?? 0);
  }

  await ackPending(pending);

  /* Re-read, because the popup may have disconnected or reconnected while
     the upload was in flight. */
  const current = await readSetting("connection");
  await writeSettings({
    backoff: null,
    lastIssue: null,
    ...(current?.credentialId === connection.credentialId
      ? { connection: { ...current, lastSyncAt: Date.now() } }
      : {}),
  });

  return { kind: "uploaded", count };
}

async function drain(force: boolean): Promise<SyncResult> {
  let uploaded = 0;

  while (true) {
    const result = await syncOnce(force).catch(
      (error: unknown): SyncResult => ({
        kind: "failed",
        message: describe(error),
      }),
    );

    if (result.kind !== "uploaded")
      return uploaded > 0 && result.kind === "idle"
        ? { kind: "uploaded", count: uploaded }
        : result;

    uploaded += result.count;
  }
}

let queue: Promise<unknown> = Promise.resolve();

/* Runs are chained rather than overlapped, so two triggers never upload the
   same pending posts twice. The result never rejects. */
export function syncAll(force: boolean): Promise<SyncResult> {
  const run = queue.then(() => drain(force));
  queue = run;
  void run.then((result) => {
    if (result.kind !== "idle") log("sync.finished", { force, ...result });
  });
  return run;
}
