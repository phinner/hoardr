import solid from "@solidjs/vite-plugin";
import { defineConfig } from "wxt";
import { apiMatches } from "./src/extension/capture/routes";

/* Chrome takes no SVG icons. Firefox gets pixel-snapped SVGs for the small
   sizes, where the master's thin outlines would blur. */
const icons = (browser: string) =>
  browser === "firefox"
    ? {
        16: "icons/16.svg",
        32: "icons/32.svg",
        48: "icons/icon.svg",
        96: "icons/icon.svg",
        128: "icons/icon.svg",
      }
    : {
        16: "icons/16.png",
        32: "icons/32.png",
        48: "icons/48.png",
        96: "icons/96.png",
        128: "icons/128.png",
      };

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "extension/entrypoints",
  manifestVersion: 3,
  imports: false,
  vite: () => ({ plugins: [solid()] }),
  /* The AMO sources zip ignores .gitignore, so the local archive and any
     .env would ship with it. */
  zip: {
    name: "hoardr",
    excludeSources: ["data/**", "build/**", ".env", ".env.*"],
  },
  manifest: ({ browser }) => ({
    name: "hoardr",
    description: "A personal archive of the Twitter/X posts you see.",
    permissions: [
      "storage",
      "alarms",
      ...(browser === "firefox"
        ? ["webRequest", "webRequestBlocking", "webRequestFilterResponse"]
        : []),
    ],
    icons: icons(browser),
    action: {
      default_title: "hoardr",
      default_icon: icons(browser),
      ...(browser === "firefox" ? { default_area: "navbar" } : {}),
    },
    ...(browser === "firefox" ? { host_permissions: apiMatches } : {}),
    optional_host_permissions: ["http://*/*", "https://*/*"],
    ...(browser === "chrome" ? { minimum_chrome_version: "111" } : {}),
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "hoardr@hoardr.local",
              strict_min_version: "128.0",
              data_collection_permissions: {
                required: ["personalCommunications", "websiteActivity"],
              },
            },
          },
        }
      : {}),
  }),
});
