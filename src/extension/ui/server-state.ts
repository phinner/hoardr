import { createSignal, onCleanup } from "solid-js";
import { browser } from "wxt/browser";
import { api, ServerError } from "~/extension/sync/api";
import {
  type Connection,
  readSetting,
  writeSettings,
} from "~/extension/sync/settings";
import type { SyncResult } from "~/extension/sync/sync";
import {
  type CredentialId,
  type CredentialSummary,
  parseToken,
} from "~/shared/auth";
import { type Harness, mcpUrlFor, normalizeServerUrl } from "~/shared/harness";

/* The token inside a command exists only here, between minting it and the
   operator pasting it; the server keeps a digest, so it cannot be shown
   again. */
interface McpSetup {
  readonly credentialId: CredentialId;
  readonly harness: string;
  readonly command: string;
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const isRejected = (error: unknown) =>
  error instanceof ServerError && error.reason === "unauthorized";

/* Firefox only shows the permission prompt when the request is made
   synchronously inside the click that asked for it. The pattern carries no
   port: a port in a match pattern is not honoured everywhere, and a bare
   host matches every port. */
async function requestAccess(serverUrl: string): Promise<boolean> {
  try {
    const { protocol, hostname } = new URL(serverUrl);
    try {
      return await browser.permissions.request({
        origins: [`${protocol}//${hostname}/*`],
      });
    } catch {
      return false;
    }
  } catch {
    return Promise.resolve(false);
  }
}

async function requestSync(): Promise<SyncResult> {
  try {
    const result: SyncResult | undefined = await browser.runtime.sendMessage({
      type: "sync",
    });
    if (result) return result;
  } catch {}
  return {
    kind: "failed",
    message: "The extension's background worker did not answer.",
  };
}

export function createServerState() {
  const [loaded, setLoaded] = createSignal(false);
  const [connection, setConnection] = createSignal<Connection | null>(null);
  const [credentials, setCredentials] = createSignal<
    readonly CredentialSummary[]
  >([]);
  const [mcpSetup, setMcpSetup] = createSignal<McpSetup | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [refreshError, setRefreshError] = createSignal("");
  const [notice, showNotice] = createSignal("");

  /* Like X's toasts, a notice clears itself; errors stay until the next
     action. */
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const setNotice = (message: string) => {
    clearTimeout(noticeTimer);
    showNotice(message);
    if (message) noticeTimer = setTimeout(() => showNotice(""), 4_000);
  };

  const action = async (run: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    await writeSettings({ connection: null, backoff: null });
    setConnection(null);
    setCredentials([]);
    setMcpSetup(null);
  };

  const refresh = async () => {
    const current = await readSetting("connection");
    setConnection(current);
    setLoaded(true);
    if (!current) return;

    try {
      setCredentials(await api(current, (client) => client.listCredentials()));
      setRefreshError("");
    } catch (failure) {
      /* A connect that finished during this request replaced the token, so
         the failure is about one that is no longer in use. */
      const latest = await readSetting("connection");
      if (latest?.credentialId !== current.credentialId) return;

      if (isRejected(failure)) await forget();
      setRefreshError(describe(failure));
    }
  };

  const report = (result: SyncResult) => {
    if (result.kind === "failed") setError(result.message);
    else if (result.kind === "uploaded")
      setNotice(`Uploaded ${result.count} posts.`);
    else if (result.kind === "idle") setNotice("Everything is synced.");
    else setNotice("No server is connected.");
  };

  const connect = (serverInput: string, tokenInput: string) => {
    setError("");
    const serverUrl = normalizeServerUrl(serverInput);
    if (!serverUrl) return setError("That is not an http or https URL.");
    const parsed = parseToken(tokenInput);
    if (!parsed) return setError("That is not a hoardr token.");

    const granted = requestAccess(serverUrl);
    const token = tokenInput.trim();

    return void action(async () => {
      if (!(await granted))
        throw new Error("Server access was not granted to the extension.");

      const listed = await api({ serverUrl, token }, (client) =>
        client.listCredentials(),
      ).catch((failure: unknown) => {
        throw isRejected(failure)
          ? new Error("The server rejected that token.")
          : failure;
      });

      const credential = listed.find((entry) => entry.id === parsed.id);
      if (!credential) throw new Error("That server does not know this token.");

      const next: Connection = {
        serverUrl,
        token,
        credentialId: credential.id,
        name: credential.name,
        lastSyncAt: null,
      };
      await writeSettings({ connection: next, backoff: null });
      setConnection(next);
      setCredentials(listed);
      setRefreshError("");

      report(await requestSync());
      await refresh();
    });
  };

  const syncNow = () =>
    void action(async () => {
      report(await requestSync());
      await refresh();
    });

  /* Revoking is best effort: a server that is gone for good must not keep
     this browser connected to it. */
  const disconnect = () =>
    void action(async () => {
      const current = connection();
      if (current)
        await api(current, (client) =>
          client.revokeCredential({ params: { id: current.credentialId } }),
        ).catch(() => {});

      await forget();
      setNotice("Disconnected. Local captures were kept.");
    });

  const connectHarness = (harness: Harness) =>
    void action(async () => {
      const current = connection();
      if (!current) return;

      const created = await api(current, (client) =>
        client.createCredential({
          payload: { name: harness.label, kind: "agent" },
        }),
      );
      const command = harness.command(
        mcpUrlFor(current.serverUrl),
        created.token,
      );
      setMcpSetup({
        credentialId: created.credential.id,
        harness: harness.label,
        command,
      });

      try {
        await navigator.clipboard.writeText(command);
        setNotice(`${harness.label} command copied. Run it in a terminal.`);
      } catch {
        setNotice("The clipboard is unavailable; copy the command below.");
      }

      await refresh();
    });

  const revoke = (id: CredentialId) =>
    void action(async () => {
      const current = connection();
      if (!current) return;

      try {
        await api(current, (client) =>
          client.revokeCredential({ params: { id } }),
        );
        setNotice("Credential revoked.");
        if (mcpSetup()?.credentialId === id) setMcpSetup(null);
      } catch (failure) {
        if (!(failure instanceof ServerError && failure.reason === "not-found"))
          throw failure;
        setNotice("That credential was already gone.");
      }

      await refresh();
    });

  const poll = () =>
    void refresh().catch(() =>
      setRefreshError("Could not read extension settings."),
    );
  poll();
  const timer = setInterval(poll, 5_000);
  onCleanup(() => {
    clearInterval(timer);
    clearTimeout(noticeTimer);
  });

  return {
    loaded,
    connection,
    credentials,
    mcpSetup,
    busy,
    error: () => error() || refreshError(),
    notice,
    connect,
    syncNow,
    disconnect,
    connectHarness,
    dismissMcpSetup: () => setMcpSetup(null),
    revoke,
  };
}

export type ServerState = ReturnType<typeof createServerState>;
