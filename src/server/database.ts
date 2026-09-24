import { mkdir } from "node:fs/promises";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, String as EffectString, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { AppConfig } from "./config";
import InitialMigration from "./migrations/1_initial";

const initialize = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`PRAGMA foreign_keys = ON`;

  yield* SqliteMigrator.run({
    loader: SqliteMigrator.fromRecord({
      "1_initial": InitialMigration,
    }),
  });
});

export const DatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;

    yield* Effect.promise(() =>
      mkdir(config.dataDirectory, { recursive: true }),
    );

    return Layer.effectDiscard(initialize).pipe(
      Layer.provideMerge(
        SqliteClient.layer({
          filename: config.databasePath,
          transformQueryNames: EffectString.camelToSnake,
          transformResultNames: EffectString.snakeToCamel,
        }),
      ),
    );
  }),
);
