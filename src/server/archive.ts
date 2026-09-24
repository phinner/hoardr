import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  type CapturedObservation,
  type IngestBatch,
  Viewer,
  type ViewerState,
} from "~/shared/archive";
import { CapturedPost, Metrics } from "~/shared/capture";
import { Snowflake } from "~/shared/primitives";
import {
  type ImageJob,
  loadPostDocuments,
  type PostDocument,
  refreshPostIndex,
} from "./post-documents";

const DateInput = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), {
      message: "Expected a date such as 2026-01-31 or 2026-01-31T12:00:00Z",
    }),
  ),
);

export const SearchInput = Schema.Struct({
  query: Schema.optionalKey(Schema.String).annotate({
    description: "Words to find; a post must contain all of them",
  }),
  authorId: Schema.optionalKey(Snowflake),
  after: Schema.optionalKey(DateInput).annotate({
    description: "Only posts created at or after this date",
  }),
  before: Schema.optionalKey(DateInput).annotate({
    description: "Only posts created before this date",
  }),
  liked: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "true: only posts you liked; false: only posts not known to be liked",
  }),
  bookmarked: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "true: only posts you bookmarked; false: only posts not known to be bookmarked",
  }),
  reposted: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "true: only posts you reposted; false: only posts not known to be reposted",
  }),
  sort: Schema.Literals(["relevance", "newest", "oldest"])
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed("relevance")))
    .annotate({ description: "Defaults to relevance" }),
  limit: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
    Schema.withDecodingDefaultKey(Effect.succeed(25)),
  ).annotate({ description: "Defaults to 25" }),
  offset: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    Schema.withDecodingDefaultKey(Effect.succeed(0)),
  ),
});

const Document = Schema.Struct({
  type: Schema.Literals(["text", "article", "image"]),
  context: Schema.NullOr(Schema.String),
  content: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
});

export const SearchPage = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      author: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
          handle: Schema.NullOr(Schema.String),
          name: Schema.NullOr(Schema.String),
        }),
      ),
      documents: Schema.Array(Document),
      excerpt: Schema.String,
      url: Schema.String,
      createdAt: Schema.NullOr(Schema.String),
      metrics: Metrics,
      viewer: Viewer,
    }),
  ),
  nextOffset: Schema.NullOr(Schema.Number),
});

const {
  attachments: _attachments,
  text: _text,
  article: _article,
  ...postFields
} = CapturedPost.fields;

export const ArchivedPost = Schema.Struct({
  ...postFields,
  documents: Schema.Array(Document),
  viewer: Viewer,
});

export const ArchiveStats = Schema.Struct({
  posts: Schema.Number,
  liked: Schema.Number,
  bookmarked: Schema.Number,
  reposted: Schema.Number,
});

interface PostRow {
  readonly rowid: number;
  readonly postId: string;
  readonly authorId: string | null;
  readonly authorHandle: string | null;
  readonly authorName: string | null;
  readonly url: string;
  readonly replyToId: string | null;
  readonly quoteId: string | null;
  readonly repostId: string | null;
  readonly createdAt: string | null;
  readonly editedAt: string | null;
  readonly likes: number | null;
  readonly reposts: number | null;
  readonly replies: number | null;
  readonly quotes: number | null;
  readonly bookmarks: number | null;
  readonly views: number | null;
  readonly liked: number | null;
  readonly bookmarked: number | null;
  readonly reposted: number | null;
}

const postColumns = ({ post, ...observation }: CapturedObservation) => ({
  postId: post.id,
  authorId: post.author?.id ?? null,
  authorHandle: post.author?.handle ?? null,
  authorName: post.author?.name ?? null,
  url: post.url,
  replyToId: post.replyToId,
  quoteId: post.quoteId,
  repostId: post.repostId,
  createdAt: post.createdAt,
  editedAt: post.editedAt,
  ...post.metrics,
  sourcePath: observation.sourcePath,
  firstObservedAt: observation.firstObservedAt,
  lastObservedAt: observation.lastObservedAt,
});

const bit = (flag: boolean | null) => (flag === null ? null : Number(flag));

const viewerColumns = (state: ViewerState) => {
  const at = (flag: boolean | null) =>
    flag === null ? null : state.observedAt;

  return {
    postId: state.postId,
    liked: bit(state.liked),
    bookmarked: bit(state.bookmarked),
    reposted: bit(state.reposted),
    likedAt: at(state.liked),
    bookmarkedAt: at(state.bookmarked),
    repostedAt: at(state.reposted),
  };
};

const flagOf = (value: number | null) => (value === null ? null : value === 1);

const viewerOf = (row: PostRow): Viewer => ({
  liked: flagOf(row.liked),
  bookmarked: flagOf(row.bookmarked),
  reposted: flagOf(row.reposted),
});

const authorOf = (row: PostRow) =>
  row.authorId === null
    ? null
    : { id: row.authorId, handle: row.authorHandle, name: row.authorName };

const metricsOf = (row: PostRow): Metrics => ({
  likes: row.likes,
  reposts: row.reposts,
  replies: row.replies,
  quotes: row.quotes,
  bookmarks: row.bookmarks,
  views: row.views,
});

/* Every word is quoted, so FTS5 operators typed by a user stay literal. */
const ftsQuery = (query: string | undefined) => {
  const words = (query ?? "").split(/\s+/).filter((word) => word !== "");

  return words.length === 0
    ? null
    : words.map((word) => `"${word.replaceAll('"', '""')}"`).join(" AND ");
};

const EXCERPT_LENGTH = 200;

const excerptOf = (text: string) => {
  if (text.length <= EXCERPT_LENGTH) return text;

  const last = text.charCodeAt(EXCERPT_LENGTH - 1);
  const end =
    last >= 0xd800 && last <= 0xdbff ? EXCERPT_LENGTH - 1 : EXCERPT_LENGTH;

  return `${text.slice(0, end)}…`;
};

const documentsOf = (documents: readonly PostDocument[]) =>
  documents.map(({ type, context, content, url }) => ({
    type,
    context,
    content,
    url,
  }));

const makeArchive = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const storeDocuments = Effect.fnUntraced(function* (
    post: CapturedObservation["post"],
    currentRevision: boolean,
    oldImages: readonly PostDocument[],
  ) {
    if (currentRevision) {
      yield* sql`
        INSERT INTO post_documents(post_id, type, position, context, content)
        VALUES (${post.id}, 'text', 0, NULL, ${post.text})
        ON CONFLICT(post_id, type, position)
        DO UPDATE SET content = excluded.content
      `;

      if (post.article) {
        yield* sql`
          INSERT INTO post_documents(post_id, type, position, context, content)
          VALUES (${post.id}, 'article', 0, ${post.article.title}, ${post.article.text})
          ON CONFLICT(post_id, type, position)
          DO UPDATE SET context = excluded.context, content = excluded.content
        `;
      }
    }

    if (currentRevision && post.attachments.length > 0) {
      yield* sql`
        DELETE FROM post_documents
        WHERE post_id = ${post.id} AND type = 'image'
      `;

      const seen = new Set<string>();
      for (const [position, attachment] of post.attachments.entries()) {
        const url = new URL(attachment.url).href;
        if (seen.has(url)) continue;
        seen.add(url);

        const old = oldImages.find((image) => image.url === url);
        yield* sql`
          INSERT INTO post_documents(post_id, type, position, context, content, url)
          VALUES (${post.id}, 'image', ${position},
                  ${attachment.alt ?? old?.context ?? null}, ${old?.content ?? null}, ${url})
        `;
      }
    }

    yield* refreshPostIndex(post.id).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
    );

    const images = yield* sql<{ url: string }>`
      SELECT url FROM post_documents
      WHERE post_id = ${post.id} AND type = 'image' AND content IS NULL
      ORDER BY position
    `;

    return images.map(
      (image): ImageJob => ({ postId: post.id, url: image.url }),
    );
  });

  /* An observation of an older revision refreshes the observation bounds and
     fills gaps, but never overwrites the text of a newer one. Counts follow
     the later observation, and a missing count never erases a known one. */
  const storeObservation = Effect.fnUntraced(function* (
    observation: CapturedObservation,
  ) {
    const { post } = observation;
    const [previous] = yield* sql<{ editedAt: string | null }>`
      SELECT edited_at
      FROM posts WHERE post_id = ${post.id}
    `;

    const currentRevision =
      previous === undefined ||
      previous.editedAt === null ||
      (post.editedAt !== null && post.editedAt >= previous.editedAt);
    const oldDocuments = previous
      ? yield* loadPostDocuments(post.id).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
        )
      : [];
    const oldImages = oldDocuments.filter(
      (document) => document.type === "image",
    );

    yield* sql`
      INSERT INTO posts ${sql.insert(postColumns(observation))}
      ON CONFLICT (post_id) DO UPDATE SET
        author_id         = coalesce(excluded.author_id, posts.author_id),
        author_handle     = coalesce(excluded.author_handle, posts.author_handle),
        author_name       = coalesce(excluded.author_name, posts.author_name),
        url               = excluded.url,
        reply_to_id       = coalesce(excluded.reply_to_id, posts.reply_to_id),
        quote_id          = coalesce(excluded.quote_id, posts.quote_id),
        repost_id         = coalesce(excluded.repost_id, posts.repost_id),
        created_at        = coalesce(excluded.created_at, posts.created_at),
        edited_at         = iif(posts.edited_at IS NULL OR excluded.edited_at >= posts.edited_at,
                                excluded.edited_at, posts.edited_at),
        source_path       = iif(excluded.last_observed_at >= posts.last_observed_at,
                                excluded.source_path, posts.source_path),
        likes             = iif(excluded.last_observed_at >= posts.last_observed_at,
                                coalesce(excluded.likes, posts.likes),
                                coalesce(posts.likes, excluded.likes)),
        reposts           = iif(excluded.last_observed_at >= posts.last_observed_at,
                                coalesce(excluded.reposts, posts.reposts),
                                coalesce(posts.reposts, excluded.reposts)),
        replies           = iif(excluded.last_observed_at >= posts.last_observed_at,
                                coalesce(excluded.replies, posts.replies),
                                coalesce(posts.replies, excluded.replies)),
        quotes            = iif(excluded.last_observed_at >= posts.last_observed_at,
                                coalesce(excluded.quotes, posts.quotes),
                                coalesce(posts.quotes, excluded.quotes)),
        bookmarks         = iif(excluded.last_observed_at >= posts.last_observed_at,
                                coalesce(excluded.bookmarks, posts.bookmarks),
                                coalesce(posts.bookmarks, excluded.bookmarks)),
        views             = iif(excluded.last_observed_at >= posts.last_observed_at,
                                coalesce(excluded.views, posts.views),
                                coalesce(posts.views, excluded.views)),
        first_observed_at = min(posts.first_observed_at, excluded.first_observed_at),
        last_observed_at  = max(posts.last_observed_at, excluded.last_observed_at)
    `;

    return yield* storeDocuments(post, currentRevision, oldImages);
  });

  /* Per flag, the newer observation wins, ties going to the incoming one.
     A null flag has a null time, which compares as false and keeps the
     stored value. */
  const storeViewerState = (state: ViewerState) => sql`
    INSERT INTO viewer_states ${sql.insert(viewerColumns(state))}
    ON CONFLICT (post_id) DO UPDATE SET
      liked         = iif(excluded.liked_at >= coalesce(viewer_states.liked_at, 0),
                          excluded.liked, viewer_states.liked),
      liked_at      = iif(excluded.liked_at >= coalesce(viewer_states.liked_at, 0),
                          excluded.liked_at, viewer_states.liked_at),
      bookmarked    = iif(excluded.bookmarked_at >= coalesce(viewer_states.bookmarked_at, 0),
                          excluded.bookmarked, viewer_states.bookmarked),
      bookmarked_at = iif(excluded.bookmarked_at >= coalesce(viewer_states.bookmarked_at, 0),
                          excluded.bookmarked_at, viewer_states.bookmarked_at),
      reposted      = iif(excluded.reposted_at >= coalesce(viewer_states.reposted_at, 0),
                          excluded.reposted, viewer_states.reposted),
      reposted_at   = iif(excluded.reposted_at >= coalesce(viewer_states.reposted_at, 0),
                          excluded.reposted_at, viewer_states.reposted_at)
  `;

  const ingest = Effect.fn("Archive.ingest")((batch: IngestBatch) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const imageJobs: ImageJob[] = [];

        for (const observation of batch.observations) {
          imageJobs.push(...(yield* storeObservation(observation)));
        }

        for (const state of batch.viewerStates) {
          yield* storeViewerState(state);
        }

        return { accepted: batch.observations.length, imageJobs };
      }),
    ),
  );

  const filters = (input: typeof SearchInput.Type, match: string | null) =>
    [
      match === null ? null : sql`posts_fts MATCH ${match}`,
      input.authorId === undefined
        ? null
        : sql`p.author_id = ${input.authorId}`,
      input.after === undefined
        ? null
        : sql`p.created_at >= ${new Date(input.after).toISOString()}`,
      input.before === undefined
        ? null
        : sql`p.created_at < ${new Date(input.before).toISOString()}`,
      input.liked === undefined
        ? null
        : sql`coalesce(v.liked, 0) = ${Number(input.liked)}`,
      input.bookmarked === undefined
        ? null
        : sql`coalesce(v.bookmarked, 0) = ${Number(input.bookmarked)}`,
      input.reposted === undefined
        ? null
        : sql`coalesce(v.reposted, 0) = ${Number(input.reposted)}`,
    ].filter((condition) => condition !== null);

  const search = Effect.fn("Archive.search")(function* (
    input: typeof SearchInput.Type,
  ) {
    const match = ftsQuery(input.query);

    const order =
      input.sort === "oldest"
        ? sql`p.created_at ASC, p.rowid ASC`
        : input.sort === "relevance" && match !== null
          ? sql`bm25(posts_fts)`
          : sql`p.created_at DESC, p.rowid DESC`;

    const rows = yield* sql<PostRow & { readonly excerpt: string | null }>`
      SELECT p.*, v.liked, v.bookmarked, v.reposted, ${
        match === null
          ? sql`NULL`
          : sql`snippet(posts_fts, -1, '**', '**', '…', 32)`
      } AS excerpt
      FROM posts_fts JOIN posts p ON p.rowid = posts_fts.rowid
      LEFT JOIN viewer_states v ON v.post_id = p.post_id
      WHERE ${sql.and(filters(input, match))}
      ORDER BY ${order}
      LIMIT ${input.limit + 1} OFFSET ${input.offset}
    `;

    const page = rows.slice(0, input.limit);
    const documents =
      page.length === 0
        ? []
        : yield* sql<PostDocument & { postId: string }>`
            SELECT post_id, type, position, context, content, url
            FROM post_documents
            WHERE post_id IN ${sql.in(page.map((row) => row.postId))}
            ORDER BY CASE type WHEN 'text' THEN 0 WHEN 'article' THEN 1 ELSE 2 END,
                     position
          `;

    return {
      items: page.map((row) => {
        const ownDocuments = documents.filter(
          (document) => document.postId === row.postId,
        );
        const source = ownDocuments.find(
          (document) => document.type === "text",
        );

        return {
          id: row.postId,
          author: authorOf(row),
          documents: documentsOf(ownDocuments),
          excerpt: row.excerpt ?? excerptOf(source?.content ?? ""),
          url: row.url,
          createdAt: row.createdAt,
          metrics: metricsOf(row),
          viewer: viewerOf(row),
        };
      }),
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
    };
  });

  const getPost = Effect.fn("Archive.getPost")(function* (id: string) {
    const [row] = yield* sql<PostRow>`
      SELECT p.*, v.liked, v.bookmarked, v.reposted
      FROM posts p
      LEFT JOIN viewer_states v ON v.post_id = p.post_id
      WHERE p.post_id = ${id}
    `;
    if (row === undefined) return Option.none<typeof ArchivedPost.Type>();
    const documents = yield* loadPostDocuments(id).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
    );

    const post = yield* Schema.decodeUnknownEffect(ArchivedPost)({
      id: row.postId,
      author: authorOf(row),
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      url: row.url,
      replyToId: row.replyToId,
      quoteId: row.quoteId,
      repostId: row.repostId,
      documents: documentsOf(documents),
      metrics: metricsOf(row),
      viewer: viewerOf(row),
    });

    return Option.some(post);
  });

  const stats = Effect.fn("Archive.stats")(function* () {
    const [posts] = yield* sql<{ count: number }>`
      SELECT count(*) AS count FROM posts
    `;
    const [viewer] = yield* sql<{
      liked: number;
      bookmarked: number;
      reposted: number;
    }>`
      SELECT coalesce(sum(liked), 0)      AS liked,
             coalesce(sum(bookmarked), 0) AS bookmarked,
             coalesce(sum(reposted), 0)   AS reposted
      FROM viewer_states
    `;
    return {
      posts: posts?.count ?? 0,
      liked: viewer?.liked ?? 0,
      bookmarked: viewer?.bookmarked ?? 0,
      reposted: viewer?.reposted ?? 0,
    };
  });

  return { ingest, search, getPost, stats };
});

export class Archive extends Context.Service<
  Archive,
  Effect.Success<typeof makeArchive>
>()("hoardr/Archive") {}

export const ArchiveLive = Layer.effect(Archive, makeArchive);
