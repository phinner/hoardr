/* Ready-made MCP configuration commands for the harnesses hoardr is used
   with. Codex has no header flag and reads the bearer token from an
   environment variable named in its config, so its snippet exports one. */

export type HarnessId = "claude-code" | "codex" | "opencode";

export interface Harness {
  readonly id: HarnessId;
  readonly label: string;
  readonly command: (mcpUrl: string, token: string) => string;
}

const codexTokenVariable = "HOARDR_MCP_TOKEN";

export const harnesses: ReadonlyArray<Harness> = [
  {
    id: "claude-code",
    label: "Claude Code",
    command: (mcpUrl, token) =>
      `claude mcp add --transport http hoardr ${mcpUrl} --header "Authorization: Bearer ${token}"`,
  },
  {
    id: "codex",
    label: "Codex",
    command: (mcpUrl, token) =>
      [
        `export ${codexTokenVariable}=${token}   # add this to your shell profile`,
        `codex mcp add hoardr --url ${mcpUrl} --bearer-token-env-var ${codexTokenVariable}`,
      ].join("\n"),
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: (mcpUrl, token) =>
      `opencode mcp add hoardr --url ${mcpUrl} --header "Authorization=Bearer ${token}"`,
  },
];

/* The trailing slash makes the path a directory, so relative references like
   "mcp" resolve under a proxy prefix instead of replacing its last segment. */
export function normalizeServerUrl(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin + url.pathname.replace(/\/*$/, "/");
  } catch {
    return null;
  }
}

export const mcpUrlFor = (serverUrl: string) => new URL("mcp", serverUrl).href;
