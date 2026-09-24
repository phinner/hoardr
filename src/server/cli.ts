#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer, Option } from "effect";
import { Argument, CliError, Command, Flag } from "effect/unstable/cli";
import { CreateCredentialRequest } from "~/shared/auth";
import { harnesses, mcpUrlFor, normalizeServerUrl } from "~/shared/harness";
import { PersistenceLive, ServerLive } from "./app";
import { Auth, AuthLive } from "./auth";
import { AppConfig } from "./config";

const AuthCliLive = AuthLive.pipe(Layer.provideMerge(PersistenceLive));

/* Diagnostics go to stderr so stdout stays a token or JSON document. */
const announceDataDirectory = Effect.flatMap(AppConfig, (config) =>
  Console.error(`hoardr data directory: ${config.dataDirectory}`),
);

const printJson = (value: unknown) =>
  Console.log(JSON.stringify(value, undefined, 2));

const json = Flag.Boolean("json").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Print one JSON document to stdout"),
);

const serveServer = Layer.launch(ServerLive);

const serve = Command.make("serve", {}, () => serveServer).pipe(
  Command.withDescription(
    "Start the HTTP API, MCP endpoint and image OCR worker. Configured by HOST, PORT and HOARDR_DATA_DIR.",
  ),
);

const create = Command.make(
  "create",
  {
    name: Flag.String("name").pipe(
      Flag.withSchema(CreateCredentialRequest.fields.name),
      Flag.withDescription("Who or what will hold the token"),
    ),
    kind: Flag.Literals("kind", ["owner", "agent"]).pipe(
      Flag.withDefault("agent"),
      Flag.withDescription(
        "owner drives the API (the extension); agent only opens /mcp",
      ),
    ),
    harness: Flag.ChoiceWithValue(
      "harness",
      harnesses.map((harness) => [harness.id, harness] as const),
    ).pipe(
      Flag.optional,
      Flag.withDescription("Print the command that adds hoardr to a harness"),
    ),
    url: Flag.String("url").pipe(
      Flag.filterMap(
        (input) => Option.fromNullishOr(normalizeServerUrl(input)),
        () => "an http or https URL",
      ),
      Flag.withDefault("http://127.0.0.1:3000/"),
      Flag.withDescription("Server URL the harness connects to"),
    ),
    json,
  },
  (flags) =>
    Effect.gen(function* () {
      yield* announceDataDirectory;

      const auth = yield* Auth;
      const created = yield* auth.create(flags.name, flags.kind);
      const command = Option.map(flags.harness, (harness) =>
        harness.command(mcpUrlFor(flags.url), created.token),
      );

      if (flags.json) {
        return yield* printJson({
          ...created,
          command: Option.getOrNull(command),
        });
      }

      yield* Console.error(
        `Created ${flags.kind} credential ${created.credential.id}. The token is shown once.`,
      );
      yield* Console.log(Option.getOrElse(command, () => created.token));
    }).pipe(Effect.provide(AuthCliLive)),
).pipe(
  Command.withDescription("Create a credential and print its token."),
  Command.withExamples([
    {
      command: "hoardr token create --name firefox --kind owner",
      description: "Token for the browser extension",
    },
    {
      command: "hoardr token create --name laptop --harness claude-code",
      description: "Print a ready `claude mcp add` command",
    },
  ]),
);

const list = Command.make("list", { json }, (flags) =>
  Effect.gen(function* () {
    yield* announceDataDirectory;

    const credentials = yield* (yield* Auth).list();

    if (flags.json) return yield* printJson(credentials);

    const rows = credentials.map((credential) =>
      [
        credential.id,
        credential.name.replaceAll(/\s+/g, " "),
        credential.kind,
        credential.revokedAt === null ? "active" : "revoked",
        credential.lastUsedAt ?? "never",
      ].join("\t"),
    );

    yield* Console.log(
      ["ID\tNAME\tKIND\tSTATUS\tLAST USED", ...rows].join("\n"),
    );
  }).pipe(Effect.provide(AuthCliLive)),
).pipe(Command.withDescription("List credentials. Secrets are never shown."));

const revoke = Command.make(
  "revoke",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("Credential ID from `hoardr token list`"),
    ),
    json,
  },
  (flags) =>
    Effect.gen(function* () {
      yield* announceDataDirectory;

      const revoked = yield* (yield* Auth).revoke(flags.id);

      if (flags.json) return yield* printJson({ id: flags.id, revoked });

      if (!revoked) {
        return yield* new CliError.UserError({
          cause: flags.id,
          userMessage: `No credential ${flags.id}. See hoardr token list.`,
        });
      }

      yield* Console.log(`Revoked credential ${flags.id}.`);
    }).pipe(Effect.provide(AuthCliLive)),
).pipe(Command.withDescription("Revoke a credential by ID."));

const token = Command.make("token").pipe(
  Command.withDescription("Create, list and revoke credentials."),
  Command.withSubcommands([create, list, revoke]),
);

const hoardr = Command.make("hoardr", {}, () => serveServer).pipe(
  Command.withDescription(
    "Archive captured Twitter/X posts and serve them to agents. Without a command, runs serve.",
  ),
  Command.withSubcommands([serve, token]),
);

Command.run(hoardr, { version: "0.1.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
