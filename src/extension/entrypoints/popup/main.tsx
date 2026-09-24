import { render } from "@solidjs/web";
import { browser } from "wxt/browser";
import { App } from "~/extension/ui/App";
import { createArchiveState } from "~/extension/ui/archive-state";
import { createServerState } from "~/extension/ui/server-state";
import "~/extension/ui/style.css";

const root = document.getElementById("app");
if (!root) throw new Error("Popup mount element #app is missing");

const defaultServerUrl = "http://127.0.0.1:3000";

/* Built before the JSX: a call inside a prop would become a getter and run
   again on every read. */
render(() => {
  const archive = createArchiveState();
  const server = createServerState();

  return (
    <App
      version={browser.runtime.getManifest().version}
      defaultServerUrl={defaultServerUrl}
      archive={archive}
      server={server}
    />
  );
}, root);
