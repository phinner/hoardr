import { mergePost } from "~/extension/archive/merge-post";
import type { ViewerState } from "~/shared/archive";
import type { CapturedPost } from "~/shared/capture";
import {
  at,
  decodePost,
  decodeViewerState,
  isObject,
  isoDate,
  type JsonObject,
  list,
  string,
} from "./json";

/* Modern payloads keep tweet fields at the top level, older ones under
   `legacy`, and some carry both with `legacy` null. */
const flatten = (value: JsonObject): JsonObject =>
  isObject(value.legacy) ? { ...value.legacy, ...value } : value;

/* A quote or repost names its target both as a nested result, possibly
   wrapped for visibility, and as a bare `<kind>_status_id_str`. */
function relatedId(tweet: JsonObject, kind: "quoted" | "retweeted") {
  const result = at(tweet, `${kind}_status_result`, "result");
  const target =
    at(result, "__typename") === "TweetWithVisibilityResults"
      ? at(result, "tweet")
      : result;

  return (
    string(at(target, "rest_id")) ??
    string(at(target, "legacy", "id_str")) ??
    string(tweet[`${kind}_status_id_str`]) ??
    null
  );
}

function author(tweet: JsonObject) {
  const result = at(tweet, "core", "user_results", "result");
  const user = isObject(result) ? flatten(result) : {};
  const id =
    string(user.rest_id) ?? string(user.id_str) ?? string(tweet.user_id_str);
  if (!id) return null;

  return {
    id,
    handle:
      string(user.screen_name) ??
      string(at(user, "core", "screen_name")) ??
      null,
    name: string(user.name) ?? string(at(user, "core", "name")) ?? null,
  };
}

function attachment(media: unknown) {
  if (!isObject(media)) return [];

  if (
    media.type === "video" ||
    media.type === "animated_gif" ||
    media.video_info
  )
    return [];

  const url = string(media.media_url_https) ?? string(media.media_url);

  return url
    ? [
        {
          url,
          alt: string(media.ext_alt_text) ?? string(media.alt_text) ?? null,
        },
      ]
    : [];
}

function attachments(tweet: JsonObject) {
  const extended = list(at(tweet, "extended_entities", "media"));
  const media =
    extended.length > 0 ? extended : list(at(tweet, "entities", "media"));
  return media.slice(0, 100).flatMap(attachment);
}

function article(tweet: JsonObject) {
  const nested = at(tweet, "article", "article_results", "result");
  const value = isObject(nested) ? nested : tweet.article;
  const title = string(at(value, "title"));
  return title ? { title, text: string(at(value, "text")) ?? null } : null;
}

const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : typeof value === "string" && /^\d{1,15}$/.test(value)
      ? Number(value)
      : null;

function metrics(tweet: JsonObject) {
  return {
    likes: count(tweet.favorite_count),
    reposts: count(tweet.retweet_count),
    replies: count(tweet.reply_count),
    quotes: count(tweet.quote_count),
    bookmarks: count(tweet.bookmark_count),
    views: count(at(tweet, "views", "count")),
  };
}

/* Maps each t.co link to what it stands for. Media links map to nothing,
   because the media are attachments already. */
function shortLinks(tweet: JsonObject, note: unknown) {
  const links = new Map<string, string>();
  const urls = [
    ...list(at(tweet, "entities", "urls")),
    ...list(at(note, "entity_set", "urls")),
  ];

  for (const entity of urls) {
    const url = string(at(entity, "url"));
    const expanded = string(at(entity, "expanded_url"));
    if (url && expanded) links.set(url, expanded);
  }

  for (const media of list(at(tweet, "entities", "media"))) {
    const url = string(at(media, "url"));
    if (url) links.set(url, "");
  }

  return links;
}

/* Entity indices mix UTF-16 units and code points, so links are matched by
   their text instead. */
const expandLinks = (text: string, links: Map<string, string>) =>
  text
    .replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/g, (url) => links.get(url) ?? url)
    .trim();

/* Only the legacy `full_text` is HTML-escaped; note tweets are not. */
const unescapeHtml = (text: string) =>
  text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

const linkLabel = (text: string) => text.replace(/[[\]]/g, "\\$&");

function linkCard(title: string, url: string | undefined) {
  return url ? `### [${linkLabel(title)}](${url})` : `### ${title}`;
}

function poll(value: (key: string) => string | undefined) {
  const choices = [1, 2, 3, 4].flatMap((index) => {
    const label = value(`choice${index}_label`);
    if (!label) return [];

    const votes = count(value(`choice${index}_count`));
    return votes === null
      ? [`- ${label}`]
      : [`- ${label} (${votes} ${votes === 1 ? "vote" : "votes"})`];
  });

  return choices.length > 0 ? ["### Poll", ...choices].join("\n") : null;
}

/* Promoted posts carry their link as a JSON document of components; the
   `details` component names the title and the destination. */
function unifiedCard(json: string | undefined) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json ?? "");
  } catch {
    return null;
  }

  const components = at(parsed, "component_objects");
  const details = Object.values(isObject(components) ? components : {}).find(
    (component) => at(component, "type") === "details",
  );

  const title = string(at(details, "data", "title", "content"));
  if (!title) return null;

  const destination = string(at(details, "data", "destination")) ?? "";
  const target = at(
    parsed,
    "destination_objects",
    destination,
    "data",
    "url_data",
  );
  const domain =
    string(at(target, "vanity")) ??
    string(at(details, "data", "subtitle", "content"));

  return [linkCard(title, string(at(target, "url"))), domain && `-# ${domain}`]
    .filter(Boolean)
    .join("\n");
}

/* A card that is only a `rest_id` was not hydrated and says nothing. */
function card(tweet: JsonObject, links: Map<string, string>) {
  const values = new Map<string, unknown>();
  for (const binding of list(at(tweet, "card", "legacy", "binding_values"))) {
    const key = string(at(binding, "key"));
    if (key) values.set(key, at(binding, "value", "string_value"));
  }

  const value = (key: string) => string(values.get(key))?.trim() || undefined;
  const name = string(at(tweet, "card", "legacy", "name")) ?? "";

  if (/^poll\dchoice/.test(name)) return poll(value);
  if (name === "unified_card") return unifiedCard(value("unified_card"));

  const title = value("title");
  if (!title) return null;

  const cardUrl = value("card_url");
  const url = cardUrl ? links.get(cardUrl) || cardUrl : undefined;
  const domain = value("domain") ?? value("vanity_url");

  return [linkCard(title, url), value("description"), domain && `-# ${domain}`]
    .filter(Boolean)
    .join("\n");
}

function body(tweet: JsonObject) {
  const note = at(tweet, "note_tweet", "note_tweet_results", "result");
  const noteText = string(at(note, "text"));
  const legacyText = string(tweet.full_text);
  const text = noteText ?? (legacyText && unescapeHtml(legacyText));
  if (text === undefined) return undefined;

  const links = shortLinks(tweet, note);
  const preview = card(tweet, links);
  const expanded = expandLinks(text, links);

  return preview ? `${expanded}\n\n${preview}`.trim() : expanded;
}

const flag = (value: unknown) => (typeof value === "boolean" ? value : null);

/* A repost mirrors the flags of the post it reposts, which is parsed on its
   own, so only the original carries them. */
function viewer(tweet: JsonObject, postId: string, observedAt: number) {
  if (relatedId(tweet, "retweeted") !== null) return null;

  const state = {
    postId,
    liked: flag(tweet.favorited),
    bookmarked: flag(tweet.bookmarked),
    reposted: flag(tweet.retweeted),
    observedAt,
  };

  const known =
    state.liked !== null ||
    state.bookmarked !== null ||
    state.reposted !== null;
  return known ? decodeViewerState(state) : null;
}

function parseTweet(result: JsonObject) {
  const typename = result.__typename;
  if (typename !== "Tweet" && typename !== undefined) return null;

  const tweet = flatten(result);
  const id = string(tweet.rest_id);
  const text = body(tweet);
  const longform = article(tweet);
  if (!id || (text === undefined && !longform)) return null;

  const post = decodePost({
    id,
    text: text ?? "",
    author: author(tweet),
    createdAt: isoDate(tweet.created_at),
    editedAt: null,
    url: `https://x.com/i/status/${id}`,
    attachments: attachments(tweet),
    replyToId: string(tweet.in_reply_to_status_id_str) ?? null,
    quoteId: relatedId(tweet, "quoted"),
    repostId: relatedId(tweet, "retweeted"),
    article: longform,
    metrics: metrics(tweet),
  });

  return post ? { tweet, post } : null;
}

/* Tweets sit at varying depths inside timeline instructions, modules and
   quote or repost wrappers, so every object is a candidate. */
function* objects(payload: unknown) {
  const stack = [{ value: payload, depth: 0 }];

  for (let visited = 0; visited < 20_000; visited++) {
    const next = stack.pop();
    if (!next) return;

    const { value, depth } = next;
    if (isObject(value)) yield value;
    if (typeof value !== "object" || value === null || depth >= 30) continue;

    for (const child of Object.values(value))
      if (typeof child === "object" && child !== null)
        stack.push({ value: child, depth: depth + 1 });
  }
}

/* One payload can show a post twice; a flag missing from one copy is taken
   from the other. */
const fillViewer = (
  previous: ViewerState,
  incoming: ViewerState,
): ViewerState => ({
  ...incoming,
  liked: incoming.liked ?? previous.liked,
  bookmarked: incoming.bookmarked ?? previous.bookmarked,
  reposted: incoming.reposted ?? previous.reposted,
});

export function extractTwitter(payload: unknown, observedAt: number) {
  const posts = new Map<string, CapturedPost>();
  const viewerStates = new Map<string, ViewerState>();

  for (const candidate of objects(payload)) {
    const parsed = parseTweet(candidate);
    if (!parsed) continue;

    const { post, tweet } = parsed;
    const previous = posts.get(post.id);
    posts.set(post.id, previous ? mergePost(previous, post) : post);

    const state = viewer(tweet, post.id, observedAt);
    const known = viewerStates.get(post.id);
    if (state)
      viewerStates.set(post.id, known ? fillViewer(known, state) : state);
  }

  return {
    posts: [...posts.values()],
    viewerStates: [...viewerStates.values()],
  };
}
