import { Context, Effect, Layer, Option, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { Snowflake } from "~/shared/primitives";
import {
  Archive,
  ArchivedPost,
  ArchiveStats,
  SearchInput,
  SearchPage,
} from "./archive";
import { Auth } from "./auth";

class ArchiveUnavailable extends Schema.TaggedError<ArchiveUnavailable>()(
  "ArchiveUnavailable",
  { message: Schema.String },
) {}

const unavailable = Effect.mapError(
  (error: { readonly message: string }) =>
    new ArchiveUnavailable({ message: error.message }),
);

const readOnly = Context.make(Tool.Readonly, true).pipe(
  Context.add(Tool.Destructive, false),
  Context.add(Tool.Idempotent, true),
);

const ArchiveToolkit = Toolkit.make(
  Tool.make("search_posts", {
    description:
      "Find X posts by words, author, date, or your liked, bookmarked and reposted state. Search covers post text, articles, image alt text and OCR. Omit query to browse by date. Use nextOffset to fetch the next page.",
    parameters: SearchInput,
    success: SearchPage,
    failure: ArchiveUnavailable,
    failureMode: "return",
  }).annotateMerge(readOnly),
  Tool.make("get_post", {
    description:
      "Get a post by ID with its text, article and image documents, engagement counts, and your liked, bookmarked and reposted state.",
    parameters: Schema.Struct({ id: Snowflake }),
    success: Schema.Struct({ post: Schema.NullOr(ArchivedPost) }),
    failure: ArchiveUnavailable,
    failureMode: "return",
  }).annotateMerge(readOnly),
  Tool.make("post_stats", {
    description:
      "Count archived posts and posts you liked, bookmarked or reposted.",
    success: ArchiveStats,
    failure: ArchiveUnavailable,
    failureMode: "return",
  }).annotateMerge(readOnly),
);

const ArchiveToolHandlers = ArchiveToolkit.toLayer(
  Effect.gen(function* () {
    const archive = yield* Archive;

    return ArchiveToolkit.of({
      search_posts: (input) => archive.search(input).pipe(unavailable),
      get_post: ({ id }) =>
        archive.getPost(id).pipe(
          Effect.map((post) => ({ post: Option.getOrNull(post) })),
          unavailable,
        ),
      post_stats: () => archive.stats().pipe(unavailable),
    });
  }),
);

const challenge = HttpServerResponse.empty({
  status: 401,
  headers: { "www-authenticate": 'Bearer realm="hoardr"' },
});

/* Any live credential opens the MCP endpoint. A storage failure dies into a
   500 so that an outage does not tell the client its token is bad. */
const BearerAuth = HttpRouter.middleware(
  Effect.gen(function* () {
    const auth = yield* Auth;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const token = /^Bearer\s+(\S+)$/i.exec(
          request.headers.authorization ?? "",
        )?.[1];

        const credential =
          token === undefined
            ? Option.none()
            : yield* auth.verify(token).pipe(Effect.orDie);

        return Option.isSome(credential) ? yield* httpEffect : challenge;
      });
  }),
);

const McpTransport = McpServer.layerHttp({
  name: "hoardr",
  version: "0.1.0",
  description: "Search a private archive of captured Twitter/X posts.",
  instructions:
    "Use search_posts to find posts, get_post to read one, and post_stats for totals. Image documents have a URL, alt text in context, and OCR in content.",
  path: "/mcp",
  protocols: [
    McpProtocol.v2026_07_28,
    McpProtocol.v2025_11_25,
    McpProtocol.v2025_06_18,
    McpProtocol.v2025_03_26,
    McpProtocol.v2024_11_05,
  ],
});

export const McpRoutes = Layer.mergeAll(
  McpTransport,
  McpServer.toolkit(ArchiveToolkit).pipe(Layer.provide(ArchiveToolHandlers)),
).pipe(Layer.provide(BearerAuth.layer));
