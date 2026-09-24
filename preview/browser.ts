/* The five `wxt/browser` calls the popup makes, over `localStorage`. There
   is no background worker, so a sync request runs the real sync in-page. */

const prefix = "hoardr:";

type Keys = string | readonly string[] | null | undefined;

const names = (keys: Keys) =>
  keys == null
    ? Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
    : typeof keys === "string"
      ? [keys]
      : keys;

export const browser = {
  storage: {
    local: {
      async get(keys?: Keys) {
        const entries = names(keys).flatMap((key) => {
          const stored = localStorage.getItem(prefix + key);
          return stored === null ? [] : [[key, JSON.parse(stored)]];
        });
        return Object.fromEntries(entries);
      },
      async set(values: Record<string, unknown>) {
        for (const [key, value] of Object.entries(values))
          localStorage.setItem(prefix + key, JSON.stringify(value));
      },
      async remove(keys: string | readonly string[]) {
        for (const key of names(keys)) localStorage.removeItem(prefix + key);
      },
    },
  },
  permissions: {
    request: async (_permissions: unknown) => true,
  },
  runtime: {
    getManifest: () => ({ version: import.meta.env.HOARDR_VERSION }),
    async sendMessage(message: unknown) {
      const { syncAll } = await import("~/extension/sync/sync");
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "sync"
      )
        return syncAll(true);
      return null;
    },
  },
};
