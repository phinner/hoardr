import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/* Timestamps are canonical UTC ISO strings, so they sort as text, except the
   observation bounds on a post, which are the epoch milliseconds the
   extension reports and which ingest merges with min() and max(). The
   engagement counts on a post are those of its latest observation. */

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE credentials (
    id                      TEXT    NOT NULL
      PRIMARY KEY,
    name                    TEXT    NOT NULL,
    kind                    TEXT    NOT NULL
      CHECK(kind IN ('owner', 'agent')),
    secret_hash             TEXT    NOT NULL,
    created_at              TEXT    NOT NULL,
    last_used_at            TEXT,
    revoked_at              TEXT
  ) STRICT`;

  yield* sql`CREATE TABLE posts (
    rowid                   INTEGER NOT NULL
      PRIMARY KEY,
    post_id                 TEXT    NOT NULL
      UNIQUE,
    author_id               TEXT,
    author_handle           TEXT,
    author_name             TEXT,
    url                     TEXT    NOT NULL,
    reply_to_id             TEXT,
    quote_id                TEXT,
    repost_id               TEXT,
    created_at              TEXT,
    edited_at               TEXT,
    likes                   INTEGER,
    reposts                 INTEGER,
    replies                 INTEGER,
    quotes                  INTEGER,
    bookmarks               INTEGER,
    views                   INTEGER,
    source_path             TEXT    NOT NULL,
    first_observed_at       INTEGER NOT NULL,
    last_observed_at        INTEGER NOT NULL
  ) STRICT`;

  yield* sql`CREATE INDEX posts_created
    ON posts(created_at)`;

  yield* sql`CREATE INDEX posts_author_created
    ON posts(author_id, created_at)`;

  yield* sql`CREATE TABLE post_documents (
    rowid                   INTEGER NOT NULL PRIMARY KEY,
    post_id                 TEXT    NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    position                INTEGER NOT NULL,
    type                    TEXT    NOT NULL CHECK(type IN ('text', 'article', 'image')),
    context                 TEXT,
    content                 TEXT,
    url                     TEXT,
    UNIQUE(post_id, type, position),
    CHECK (
      (type = 'text' AND context IS NULL AND content IS NOT NULL AND url IS NULL) OR
      (type = 'article' AND context IS NOT NULL AND url IS NULL) OR
      (type = 'image' AND url IS NOT NULL)
    )
  ) STRICT`;

  yield* sql`CREATE VIRTUAL TABLE posts_fts USING fts5(
    text, author_handle, author_name
  )`;

  /* The account's own state on a post. Each flag carries the time it was
     observed, so the newest observation wins per flag whatever order they
     arrive in. There is no foreign key: a like can arrive before its post. */
  yield* sql`CREATE TABLE viewer_states (
    post_id                 TEXT    NOT NULL
      PRIMARY KEY,
    liked                   INTEGER
      CHECK(liked IN (0, 1)),
    bookmarked              INTEGER
      CHECK(bookmarked IN (0, 1)),
    reposted                INTEGER
      CHECK(reposted IN (0, 1)),
    liked_at                INTEGER,
    bookmarked_at           INTEGER,
    reposted_at             INTEGER,
    CHECK ((liked IS NULL) = (liked_at IS NULL)),
    CHECK ((bookmarked IS NULL) = (bookmarked_at IS NULL)),
    CHECK ((reposted IS NULL) = (reposted_at IS NULL))
  ) STRICT`;
});
