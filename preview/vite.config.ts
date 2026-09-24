import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

const path = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));
const { version } = JSON.parse(readFileSync(path("../package.json"), "utf8"));

export default defineConfig({
  root: path("."),
  publicDir: path("../public"),
  plugins: [solid()],
  define: { "import.meta.env.HOARDR_VERSION": JSON.stringify(version) },
  resolve: {
    alias: [
      { find: /^wxt\/browser$/, replacement: path("./browser.ts") },
      { find: /^~\//, replacement: `${path("../src")}/` },
    ],
  },
});
