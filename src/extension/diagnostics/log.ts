import { browser } from "wxt/browser";
import { summary } from "~/extension/archive/store";
import { apiMatches } from "~/extension/capture/routes";
import { readSettings } from "~/extension/sync/settings";

const KEY = "diagnostics";
const LIMIT = 500;

type Detail = Record<string, unknown>;

interface LogEntry extends Detail {
  readonly at: string;
  readonly event: string;
}

let buffer: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let writing: Promise<void> = Promise.resolve();

/* Only the background writes, and it batches, so the read-modify-write of
   the stored list never races with itself. */
function flush() {
  timer = undefined;
  const entries = buffer;
  buffer = [];

  writing = writing
    .then(async () => {
      const stored = await browser.storage.local.get(KEY);
      const previous = Array.isArray(stored[KEY]) ? stored[KEY] : [];
      await browser.storage.local.set({
        [KEY]: [...previous, ...entries].slice(-LIMIT),
      });
    })
    .catch(() => {});
}

export function log(event: string, detail: Detail = {}) {
  console.debug("[hoardr]", event, detail);
  buffer.push({ at: new Date().toISOString(), event, ...detail });
  if (timer === undefined) timer = setTimeout(flush, 500);
}

export const errorDetail = (error: unknown) =>
  error instanceof Error
    ? { error: error.message, stack: error.stack }
    : { error: String(error) };

export const hasApiAccess = () =>
  browser.permissions.contains({ origins: apiMatches });

/* Everything an agent needs to tell a broken capture from a paused one,
   minus the token. */
export async function exportDiagnostics() {
  const [stored, settings, counts, permissions, apiAccess] = await Promise.all([
    browser.storage.local.get(KEY),
    readSettings(),
    summary().catch((error: unknown) => errorDetail(error)),
    browser.permissions.getAll(),
    hasApiAccess(),
  ]);

  const { connection, ...rest } = settings;
  const report = {
    format: "hoardr-diagnostics",
    exportedAt: new Date().toISOString(),
    version: browser.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    settings: {
      ...rest,
      connection: connection && {
        serverUrl: connection.serverUrl,
        name: connection.name,
        lastSyncAt: connection.lastSyncAt,
      },
    },
    counts,
    permissions,
    apiAccess,
    entries: Array.isArray(stored[KEY]) ? stored[KEY] : [],
  };

  return new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
}
