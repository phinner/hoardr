import type { CapturedPost, Metrics } from "~/shared/capture";

/* Timelines truncate long tweets and omit article bodies that the detail
   page includes, so the fuller copy wins over whichever was seen last. */
const isRicher = (post: CapturedPost, than: CapturedPost) =>
  post.text.length > than.text.length ||
  Boolean(post.article?.text && !than.article?.text);

/* Counts are snapshots, so the incoming one wins, except where it is missing. */
const latestMetrics = (previous: Metrics, incoming: Metrics): Metrics => ({
  likes: incoming.likes ?? previous.likes,
  reposts: incoming.reposts ?? previous.reposts,
  replies: incoming.replies ?? previous.replies,
  quotes: incoming.quotes ?? previous.quotes,
  bookmarks: incoming.bookmarks ?? previous.bookmarks,
  views: incoming.views ?? previous.views,
});

export function mergePost(
  previous: CapturedPost,
  incoming: CapturedPost,
): CapturedPost {
  const content = isRicher(previous, incoming) ? previous : incoming;

  return {
    ...incoming,
    text: content.text,
    article: content.article ?? incoming.article ?? previous.article,
    metrics: latestMetrics(previous.metrics, incoming.metrics),
    author: incoming.author ?? previous.author,
    createdAt: incoming.createdAt ?? previous.createdAt,
    attachments:
      incoming.attachments.length > 0
        ? incoming.attachments
        : previous.attachments,
    replyToId: incoming.replyToId ?? previous.replyToId,
    quoteId: incoming.quoteId ?? previous.quoteId,
    repostId: incoming.repostId ?? previous.repostId,
  };
}
