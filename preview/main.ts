import { Schema } from "effect";
import { upsert } from "~/extension/archive/store";
import { writeSettings } from "~/extension/sync/settings";
import { ViewerState } from "~/shared/archive";
import { CapturedPost } from "~/shared/capture";

const common = {
  author: { id: "80351110224678912", handle: "nelly", name: "Nelly" },
  editedAt: null,
  attachments: [],
  replyToId: null,
  quoteId: null,
  repostId: null,
  article: null,
  metrics: {
    likes: 12,
    reposts: 3,
    replies: 1,
    quotes: 0,
    bookmarks: 4,
    views: 870,
  },
};

const fixtures = [
  {
    ...common,
    id: "1830000000000000001",
    text: "Archiving what you read is underrated.",
    createdAt: "2026-09-21T18:30:00.000Z",
    url: "https://x.com/i/status/1830000000000000001",
  },
  {
    ...common,
    id: "1830000000000000002",
    text: "Especially the threads you swear you will find again.",
    createdAt: "2026-09-21T18:34:00.000Z",
    url: "https://x.com/i/status/1830000000000000002",
    replyToId: "1830000000000000001",
  },
];

if (new URLSearchParams(location.search).has("seed")) {
  const posts = fixtures.map((fixture) =>
    Schema.decodeUnknownSync(CapturedPost)(fixture),
  );
  const viewerStates = posts.map((post, index) =>
    Schema.decodeUnknownSync(ViewerState)({
      postId: post.id,
      liked: true,
      bookmarked: index === 0,
      reposted: false,
      observedAt: Date.now(),
    }),
  );

  await upsert({ posts, viewerStates }, "https://x.com/home");
  await writeSettings({ lastCaptureAt: Date.now() - 5 * 60_000 });
}

await import("~/extension/entrypoints/popup/main");
