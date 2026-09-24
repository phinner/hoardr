import { Effect, Schema } from "effect";
import { HttpUrl, Snowflake, UtcIsoDateTime } from "./primitives";

const Author = Schema.Struct({
  id: Snowflake,
  handle: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
});

const Attachment = Schema.Struct({
  url: HttpUrl,
  alt: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
});

/* Counts as seen at one observation; null when the payload omitted one. */
export const Metrics = Schema.Struct({
  likes: Schema.NullOr(Schema.Natural),
  reposts: Schema.NullOr(Schema.Natural),
  replies: Schema.NullOr(Schema.Natural),
  quotes: Schema.NullOr(Schema.Natural),
  bookmarks: Schema.NullOr(Schema.Natural),
  views: Schema.NullOr(Schema.Natural),
});
export type Metrics = typeof Metrics.Type;

export const CapturedPost = Schema.Struct({
  id: Snowflake,
  text: Schema.String,
  author: Schema.NullOr(Author),
  createdAt: Schema.NullOr(UtcIsoDateTime),
  editedAt: Schema.NullOr(UtcIsoDateTime),
  url: HttpUrl,
  attachments: Schema.Array(Attachment),
  replyToId: Schema.NullOr(Snowflake),
  quoteId: Schema.NullOr(Snowflake),
  repostId: Schema.NullOr(Snowflake),
  article: Schema.NullOr(
    Schema.Struct({
      title: Schema.String,
      text: Schema.NullOr(Schema.String),
    }),
  ),
  metrics: Metrics,
});
export type CapturedPost = typeof CapturedPost.Type;
