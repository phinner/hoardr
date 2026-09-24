import { Schema } from "effect";
import type { ViewerState } from "~/shared/archive";
import type { CapturedPost } from "~/shared/capture";
import { HttpUrl } from "~/shared/primitives";
import { decodeViewerState } from "./json";
import { mutationSucceeded, mutationTweetId } from "./mutation";
import {
  isTweetEndpoint,
  isTwitterPage,
  MAX_BODY,
  MAX_REQUEST_BODY,
  viewerChange,
} from "./routes";
import { extractTwitter } from "./twitter";

const Url = HttpUrl.pipe(Schema.check(Schema.isMaxLength(2048)));
const Body = Schema.String.pipe(Schema.check(Schema.isMaxLength(MAX_BODY)));

/* A GET response that may hold posts. */
const ResponseMessage = Schema.Struct({
  source: Schema.Literal("hoardr"),
  kind: Schema.Literal("response"),
  id: Schema.String,
  url: Url,
  body: Body,
  page: Url,
});

/* A POST of one of the account's own actions, with its outcome. */
const MutationMessage = Schema.Struct({
  source: Schema.Literal("hoardr"),
  kind: Schema.Literal("mutation"),
  id: Schema.String,
  url: Url,
  request: Schema.String.pipe(
    Schema.check(Schema.isMaxLength(MAX_REQUEST_BODY)),
  ),
  status: Schema.Int,
  body: Body,
  page: Url,
});

const CaptureMessage = Schema.Union([ResponseMessage, MutationMessage]);
export type CaptureMessage = typeof CaptureMessage.Type;

export const isCaptureMessage = Schema.is(CaptureMessage);

export interface Capture {
  readonly posts: readonly CapturedPost[];
  readonly viewerStates: readonly ViewerState[];
}

const nothing: Capture = { posts: [], viewerStates: [] };

function parseMutation(
  message: typeof MutationMessage.Type,
  observedAt: number,
): Capture {
  const change = viewerChange(message.url);
  const postId = mutationTweetId(message.request);
  if (!change || !postId || !mutationSucceeded(message.status, message.body))
    return nothing;

  const state = decodeViewerState({
    postId,
    liked: null,
    bookmarked: null,
    reposted: null,
    ...change,
    observedAt,
  });
  return state ? { posts: [], viewerStates: [state] } : nothing;
}

/* The sender URL comes from the browser, not the page, so it is what decides
   whether a capture may claim to be from the site. */
export function parseCapture(
  message: CaptureMessage,
  senderUrl: string,
  observedAt: number,
): Capture {
  if (
    !isTwitterPage(senderUrl) ||
    new URL(message.page).origin !== new URL(senderUrl).origin
  )
    return nothing;

  if (message.kind === "mutation") return parseMutation(message, observedAt);

  return isTweetEndpoint(message.url)
    ? extractTwitter(JSON.parse(message.body), observedAt)
    : nothing;
}
