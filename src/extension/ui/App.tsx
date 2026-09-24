import { createSignal, For, Show } from "solid-js";
import { harnesses } from "~/shared/harness";
import type { ArchiveState } from "./archive-state";
import { ago, count } from "./format";
import type { ServerState } from "./server-state";

function Stat(props: { value: number | undefined; label: string }) {
  return (
    <span title={String(props.value ?? "")}>
      <strong>{count(props.value)}</strong> {props.label}
    </span>
  );
}

function Capture(props: { state: ArchiveState }) {
  const enabled = () => props.state.settings()?.captureEnabled ?? true;
  const counts = () => props.state.counts();
  const last = () => ago(props.state.settings()?.lastCaptureAt);

  return (
    <section>
      <p class="status">
        <span class={{ dot: true, paused: !enabled() }} />
        {enabled() ? "Capturing as you scroll" : "Capture paused"}
        <Show when={last()}>
          {(time) => <span class="muted">· {time()}</span>}
        </Show>
      </p>
      <p class="stats">
        <Stat value={counts()?.posts} label="Posts" />
        <Stat value={counts()?.liked} label="Liked" />
        <Stat value={counts()?.bookmarked} label="Bookmarked" />
        <Stat value={counts()?.pending} label="Waiting to sync" />
      </p>
      <Show when={!last()}>
        <p class="muted">Nothing yet. Scroll your timeline or open a post.</p>
      </Show>
      <div class="controls">
        <button
          type="button"
          class={enabled() ? "outline" : "primary"}
          disabled={!props.state.settings()}
          onClick={props.state.toggleCapture}
        >
          {enabled() ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          class="outline"
          disabled={props.state.exporting()}
          onClick={props.state.exportJson}
        >
          {props.state.exporting() ? "Exporting…" : "Export JSON"}
        </button>
      </div>
    </section>
  );
}

function Connect(props: { state: ServerState; defaultServerUrl: string }) {
  const [serverUrl, setServerUrl] = createSignal(props.defaultServerUrl);
  const [token, setToken] = createSignal("");

  return (
    <section>
      <h2>Connect to your server</h2>
      <p class="muted">
        Run <code>hoardr token create --name firefox --kind owner</code> and
        paste the token here.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.state.connect(serverUrl(), token());
        }}
      >
        <label class="field">
          <span>Server URL</span>
          <input
            type="url"
            required
            value={serverUrl()}
            onInput={(event) => setServerUrl(event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>Token</span>
          <input
            type="password"
            required
            autocomplete="off"
            value={token()}
            onInput={(event) => setToken(event.currentTarget.value)}
          />
        </label>
        <button
          type="submit"
          class="primary wide"
          disabled={props.state.busy()}
        >
          {props.state.busy() ? "Connecting…" : "Connect"}
        </button>
      </form>
    </section>
  );
}

function Connected(props: { state: ServerState }) {
  const connection = () => props.state.connection();

  return (
    <section>
      <div class="row">
        <Avatar name={connection()?.name ?? "?"} />
        <div class="who">
          <strong>{connection()?.name}</strong>
          <span class="muted url">{connection()?.serverUrl}</span>
        </div>
      </div>
      <p class="muted">
        {ago(connection()?.lastSyncAt)
          ? `Last upload ${ago(connection()?.lastSyncAt)}`
          : "Nothing uploaded yet"}
      </p>
      <div class="controls">
        <button
          type="button"
          class="primary"
          disabled={props.state.busy()}
          onClick={props.state.syncNow}
        >
          Sync now
        </button>
        <button
          type="button"
          class="outline"
          disabled={props.state.busy()}
          onClick={props.state.disconnect}
        >
          Disconnect
        </button>
      </div>
    </section>
  );
}

function Avatar(props: { name: string }) {
  return (
    <span class="avatar" aria-hidden="true">
      {props.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function ConnectAgent(props: { state: ServerState }) {
  return (
    <section>
      <h2>Connect an agent</h2>
      <p class="muted">
        Pick a harness to mint a read-only token and copy its setup command.
      </p>
      <div class="controls">
        <For each={harnesses}>
          {(harness) => (
            <button
              type="button"
              class="outline"
              disabled={props.state.busy()}
              onClick={() => props.state.connectHarness(harness)}
            >
              {harness.label}
            </button>
          )}
        </For>
      </div>
      <Show when={props.state.mcpSetup()}>
        {(setup) => (
          <article>
            <strong>{setup().harness}</strong>
            <p class="muted">
              Run this in a terminal. The token is shown only now; if you lose
              it, revoke the credential below and make another.
            </p>
            <pre class="command">{setup().command}</pre>
            <div class="controls">
              <button
                type="button"
                class="outline"
                onClick={props.state.dismissMcpSetup}
              >
                Hide
              </button>
            </div>
          </article>
        )}
      </Show>
    </section>
  );
}

function Credentials(props: { state: ServerState }) {
  const currentId = () => props.state.connection()?.credentialId;

  return (
    <section>
      <h2>Credentials</h2>
      <ul class="credentials">
        <For each={props.state.credentials()}>
          {(credential) => (
            <li>
              <Avatar name={credential.name} />
              <div class="who">
                <strong>{credential.name}</strong>
                <span class="muted">
                  {credential.id === currentId()
                    ? "this browser"
                    : credential.kind}
                </span>
              </div>
              <Show when={credential.id !== currentId()}>
                <button
                  type="button"
                  class="danger"
                  disabled={props.state.busy() || credential.revokedAt !== null}
                  onClick={() => props.state.revoke(credential.id)}
                >
                  {credential.revokedAt ? "Revoked" : "Revoke"}
                </button>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

/* The glyph of public/icons/32.svg without its tile, so it takes the text
   colour of either theme. */
function Logo() {
  return (
    <svg class="mark" viewBox="7 6 18 20" aria-hidden="true">
      <g fill="none" stroke="currentColor">
        <rect x="8.5" y="6.5" width="3" height="19" />
        <rect x="20.5" y="6.5" width="3" height="19" />
      </g>
      <path d="M12 18.57 20 16.43v-3L12 15.57z" fill="currentColor" />
    </svg>
  );
}

export function App(props: {
  version: string;
  defaultServerUrl: string;
  archive: ArchiveState;
  server: ServerState;
}) {
  return (
    <main class="app">
      <header>
        <h1>
          <Logo />
          hoardr
        </h1>
        <small class="muted">v{props.version}</small>
      </header>
      <Capture state={props.archive} />
      <Show when={props.server.loaded()}>
        <Show
          when={props.server.connection()}
          fallback={
            <Connect
              state={props.server}
              defaultServerUrl={props.defaultServerUrl}
            />
          }
        >
          <Connected state={props.server} />
          <ConnectAgent state={props.server} />
          <Credentials state={props.server} />
        </Show>
      </Show>
      <Show when={props.server.error()}>
        <p role="alert" class="issue">
          {props.server.error()}
        </p>
      </Show>
      <div class="toasts">
        <p role="status" class="toast" hidden={!props.server.notice()}>
          {props.server.notice()}
        </p>
      </div>
      <Show when={props.archive.issue()}>
        <p role="alert" class="issue">
          <span>{props.archive.issue()}</span>
          <button
            type="button"
            class="outline"
            onClick={props.archive.clearIssue}
          >
            Dismiss
          </button>
        </p>
      </Show>
    </main>
  );
}
