import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import type { CaptureMessage } from "~/extension/capture/parse";
import { captureMatches } from "~/extension/capture/routes";

/* The background validates the message fully; this only keeps unrelated
   page messages from waking it. */
function isCapture(data: unknown): data is CaptureMessage {
  if (typeof data !== "object" || data === null) return false;

  const message = data as Record<string, unknown>;
  return (
    message.source === "hoardr" &&
    typeof message.kind === "string" &&
    typeof message.id === "string" &&
    typeof message.url === "string" &&
    typeof message.body === "string" &&
    typeof message.page === "string"
  );
}

export default defineContentScript({
  matches: captureMatches,
  runAt: "document_start",
  exclude: ["firefox"],
  main(ctx) {
    ctx.addEventListener(window, "message", (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (!isCapture(event.data) || ctx.isInvalid) return;

      browser.runtime.sendMessage(event.data).catch(() => {});
    });
  },
});
