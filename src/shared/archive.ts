import { Effect, Schema } from "effect";
import { CapturedPost } from "./capture";
import { HttpUrl, Snowflake } from "./primitives";

/* `sourcePath` is the page the browser was on when the post was observed,
   without query or fragment. Observation times are epoch milliseconds. */
const CapturedObservation = Schema.Struct({
  post: CapturedPost,
  sourcePath: HttpUrl,
  firstObservedAt: Schema.Natural,
  lastObservedAt: Schema.Natural,
});
export type CapturedObservation = typeof CapturedObservation.Type;

/* Whether the logged-in account liked, bookmarked or reposted a post; null
   when unknown. */
export const Viewer = Schema.Struct({
  liked: Schema.NullOr(Schema.Boolean),
  bookmarked: Schema.NullOr(Schema.Boolean),
  reposted: Schema.NullOr(Schema.Boolean),
});
export type Viewer = typeof Viewer.Type;

/* One observation of the account's own state on a post, from a timeline or
   from an action it took. Per flag, the newest observation wins, and a null
   flag says nothing. */
export const ViewerState = Schema.Struct({
  postId: Snowflake,
  ...Viewer.fields,
  observedAt: Schema.Natural,
});
export type ViewerState = typeof ViewerState.Type;

/* Ingest is idempotent per post: sending the same observation twice merges
   it twice, so a batch needs no identity of its own. */
export const IngestBatch = Schema.Struct({
  observations: Schema.Array(CapturedObservation).pipe(
    Schema.check(Schema.isMaxLength(500)),
  ),
  viewerStates: Schema.Array(ViewerState).pipe(
    Schema.check(Schema.isMaxLength(1000)),
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});
export type IngestBatch = typeof IngestBatch.Type;

export const IngestReceipt = Schema.Struct({
  accepted: Schema.Natural,
});
