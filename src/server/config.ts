import { join, resolve } from "node:path";
import { Config, Context, Effect, Layer } from "effect";

interface AppConfigShape {
  readonly host: string;
  readonly port: number;
  readonly dataDirectory: string;
  readonly databasePath: string;
}

const rawConfig = Config.all({
  host: Config.NonEmptyString("HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.Port("PORT").pipe(Config.withDefault(3000)),
  dataDirectory: Config.NonEmptyString("HOARDR_DATA_DIR").pipe(
    Config.withDefault("./data"),
  ),
});

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()(
  "hoardr/AppConfig",
) {}

/* The data directory is resolved once, so a relative default depends on the
   working directory at startup; the CLI prints the result for that reason. */
export const AppConfigLive = Layer.effect(
  AppConfig,
  Effect.map(rawConfig, ({ dataDirectory, ...rest }) => {
    const root = resolve(dataDirectory);

    return {
      ...rest,
      dataDirectory: root,
      databasePath: join(root, "hoardr.db"),
    };
  }),
);
