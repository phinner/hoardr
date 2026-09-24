import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HoardrApi } from "~/shared/api";
import { ApiHandlers } from "./api";
import { ArchiveLive } from "./archive";
import { AuthLive, OwnerAuthLive } from "./auth";
import { AppConfig, AppConfigLive } from "./config";
import { DatabaseLive } from "./database";
import { ImageOcrLive, ImageOcrWorkerLive } from "./image-ocr";
import { McpRoutes } from "./mcp";

export const PersistenceLive = DatabaseLive.pipe(
  Layer.provideMerge(AppConfigLive),
);

const ServicesLive = Layer.mergeAll(AuthLive, ArchiveLive, ImageOcrLive).pipe(
  Layer.provideMerge(PersistenceLive),
);

const ApiRoutes = HttpApiBuilder.layer(HoardrApi).pipe(
  Layer.provide(ApiHandlers),
  Layer.provide(OwnerAuthLive),
);

/* Extension pages and MCP clients call from other origins. A bearer header
   is not a CORS credential, so any origin may be allowed. */
const Cors = HttpRouter.cors({
  allowedOrigins: ["*"],
  allowedMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "authorization",
    "content-type",
    "accept",
    "mcp-session-id",
    "mcp-protocol-version",
  ],
  exposedHeaders: ["mcp-session-id"],
});

const HttpLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;

    yield* Effect.logInfo(`Archive data in ${config.dataDirectory}`);

    return HttpRouter.serve(Layer.mergeAll(ApiRoutes, McpRoutes, Cors), {
      disableLogger: true,
    }).pipe(
      Layer.provide(
        NodeHttpServer.layer(createServer, {
          host: config.host,
          port: config.port,
        }),
      ),
    );
  }),
);

export const ServerLive = Layer.merge(HttpLive, ImageOcrWorkerLive).pipe(
  Layer.provide(ServicesLive),
);
