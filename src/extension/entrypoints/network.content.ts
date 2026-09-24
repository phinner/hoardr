import { defineContentScript } from "wxt/utils/define-content-script";
import { installNetworkCapture } from "~/extension/capture/network";
import { captureMatches } from "~/extension/capture/routes";

export default defineContentScript({
  matches: captureMatches,
  runAt: "document_start",
  exclude: ["firefox"],
  world: "MAIN",
  main() {
    const marker = Symbol.for("hoardr.network");
    if (Reflect.get(window, marker)) return;
    Reflect.set(window, marker, true);

    installNetworkCapture((message) =>
      window.postMessage(message, location.origin),
    );
  },
});
