export const captureMatches = [
  "https://x.com/*",
  "https://www.x.com/*",
  "https://twitter.com/*",
  "https://www.twitter.com/*",
];

/* Where the site's JSON responses come from: the pages themselves plus the
   separate API hosts. */
export const apiMatches = [
  ...captureMatches,
  "https://api.x.com/*",
  "https://api.twitter.com/*",
];

export const MAX_BODY = 2 * 1024 * 1024;

export const MAX_REQUEST_BODY = 64 * 1024;

const pageHosts = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
]);

const apiHosts = new Set([...pageHosts, "api.x.com", "api.twitter.com"]);

const operations = new Set([
  "HomeTimeline",
  "HomeLatestTimeline",
  "TweetDetail",
  "TweetResultByRestId",
  "UserTweets",
  "UserTweetsAndReplies",
  "UserMedia",
  "SearchTimeline",
  "Likes",
  "Bookmarks",
  "ListLatestTweetsTimeline",
  "ListLatestTweets",
  "CommunityTweetsTimeline",
  "CommunityMediaTimeline",
]);

/* The account's own actions, and the flag each one sets. */
const viewerMutations = {
  FavoriteTweet: { liked: true },
  UnfavoriteTweet: { liked: false },
  CreateBookmark: { bookmarked: true },
  DeleteBookmark: { bookmarked: false },
  CreateRetweet: { reposted: true },
  DeleteRetweet: { reposted: false },
} as const;

export type ViewerChange =
  (typeof viewerMutations)[keyof typeof viewerMutations];

const parse = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
};

export function isTwitterPage(url: string) {
  const parsed = parse(url);
  return parsed !== null && pageHosts.has(parsed.hostname);
}

function operationOf(url: string) {
  const parsed = parse(url);
  if (!parsed || !apiHosts.has(parsed.hostname)) return undefined;

  return /^\/(?:i\/api\/)?graphql\/[^/]+\/([^/]+)$/.exec(parsed.pathname)?.[1];
}

export function isTweetEndpoint(url: string) {
  const operation = operationOf(url);
  return operation !== undefined && operations.has(operation);
}

export function viewerChange(url: string): ViewerChange | null {
  const operation = operationOf(url);
  return operation !== undefined && Object.hasOwn(viewerMutations, operation)
    ? viewerMutations[operation as keyof typeof viewerMutations]
    : null;
}

export const isViewerMutation = (url: string) => viewerChange(url) !== null;

export function withoutQuery(url: string) {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname;
}
