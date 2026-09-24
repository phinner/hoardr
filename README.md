# hoardr

Hoardr collects the X content you consume for your agent.

Allowing you to obtain useful information from posts and comments you saw.

> ![Warning]
>
> Still WIP and has no pruning mechanism yet. But it only collects text so it's fine :)

## Get started

Requires Node 24 and pnpm 12.

```sh
pnpm install
pnpm dev:server
```

The server runs at `http://127.0.0.1:3000` and stores data in `./data` by
default. In another terminal, create an owner token and start the extension:

```sh
pnpm hoardr token create --name browser --kind owner
pnpm dev:firefox # or pnpm dev:chrome
```

Open the extension popup, enter the server URL and token, then reload your X
tabs. The popup's **Sync now** button uploads anything still pending.

## Connect an agent

Use **Connect an agent** in the popup, or print a setup command from the CLI:

```sh
pnpm hoardr token create --name laptop --harness claude-code
```

The CLI also supports `codex` and `opencode`. Agent tokens can access MCP at
`/mcp`; owner tokens can also use the API. Tokens are shown only when created.

## Develop and build

```sh
pnpm preview       # popup in a browser tab; add ?seed for sample posts
pnpm check         # format, lint, and type checks
pnpm build         # extension builds and server CLI
pnpm zip           # extension release archives
```

The preview connects directly to `http://127.0.0.1:3000`. Open the URL Vite
prints. After `pnpm build`, load `.output/chrome-mv3` as an unpacked Chrome
extension or `.output/firefox-mv3/manifest.json` through Firefox's
`about:debugging`.

## Server configuration

| Variable          | Default     | Purpose            |
|-------------------|-------------|--------------------|
| `HOST`            | `127.0.0.1` | Listen address     |
| `PORT`            | `3000`      | Listen port        |
| `HOARDR_DATA_DIR` | `./data`    | Database directory |

Run `pnpm hoardr --help` for the server and token commands. The CLI also lets
you list and revoke tokens.
