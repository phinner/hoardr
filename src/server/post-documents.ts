import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export interface PostDocument {
  readonly type: "text" | "article" | "image";
  readonly position: number;
  readonly context: string | null;
  readonly content: string | null;
  readonly url: string | null;
}

export interface ImageJob {
  readonly postId: string;
  readonly url: string;
}

export const loadPostDocuments = Effect.fnUntraced(function* (postId: string) {
  const sql = yield* SqlClient.SqlClient;

  return yield* sql<PostDocument>`
    SELECT type, position, context, content, url
    FROM post_documents
    WHERE post_id = ${postId}
    ORDER BY CASE type WHEN 'text' THEN 0 WHEN 'article' THEN 1 ELSE 2 END,
             position
  `;
});

export const refreshPostIndex = Effect.fnUntraced(function* (postId: string) {
  const sql = yield* SqlClient.SqlClient;
  const [post] = yield* sql<{
    rowid: number;
    authorHandle: string | null;
    authorName: string | null;
  }>`
    SELECT rowid, author_handle, author_name
    FROM posts WHERE post_id = ${postId}
  `;
  if (!post) return;

  const [indexed] = yield* sql<{ text: string | null }>`
    SELECT group_concat(searchable, ' ') AS text
    FROM (
      SELECT coalesce(context, '') || ' ' || coalesce(content, '') || ' ' || coalesce(url, '') AS searchable
      FROM post_documents
      WHERE post_id = ${postId}
      ORDER BY CASE type WHEN 'text' THEN 0 WHEN 'article' THEN 1 ELSE 2 END,
               position
    )
  `;
  yield* sql`DELETE FROM posts_fts WHERE rowid = ${post.rowid}`;
  yield* sql`
    INSERT INTO posts_fts(rowid, text, author_handle, author_name)
    VALUES (${post.rowid}, ${indexed?.text ?? ""},
            ${post.authorHandle}, ${post.authorName})
  `;
});
