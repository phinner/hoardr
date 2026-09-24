import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Capture } from "~/extension/capture/parse";
import type { CapturedObservation } from "~/shared/archive";
import { mergePost } from "./merge-post";
import {
  mergeViewer,
  sameViewer,
  type ViewerFlag,
  type ViewerRecord,
  viewerStatesOf,
} from "./merge-viewer";

interface HoardrDB extends DBSchema {
  posts: { key: string; value: CapturedObservation };
  pending: { key: string; value: { readonly seq: number } };
  viewer: {
    key: string;
    value: ViewerRecord;
    indexes: { active: ViewerFlag };
  };
  viewerPending: { key: string; value: { readonly seq: number } };
}

export interface Taken<A> {
  readonly key: string;
  readonly seq: number;
  readonly value: A;
}

export interface PendingUpload {
  readonly posts: readonly Taken<CapturedObservation>[];
  readonly viewer: readonly Taken<ViewerRecord>[];
}

let database: Promise<IDBPDatabase<HoardrDB>> | undefined;

/* Earlier versions held shapes the server no longer accepts, so an upgrade
   starts over rather than migrating them. */
const open = () => {
  database ??= openDB<HoardrDB>("hoardr", 6, {
    upgrade(db) {
      for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
      db.createObjectStore("posts", { keyPath: "post.id" });
      db.createObjectStore("pending");
      db.createObjectStore("viewer", { keyPath: "postId" }).createIndex(
        "active",
        "active",
        { multiEntry: true },
      );
      db.createObjectStore("viewerPending");
    },
    terminated() {
      database = undefined;
    },
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });

  return database;
};

let lastSeq = 0;
const nextSeq = () => {
  lastSeq = Math.max(lastSeq + 1, Date.now());
  return lastSeq;
};

const stableJson = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left < right ? -1 : 1,
          ),
        )
      : item,
  );

/* Returns how many posts or viewer states changed; only those are queued
   for upload, so scrolling past the same posts again does not resend them. */
export async function upsert(capture: Capture, page: string) {
  const db = await open();
  const tx = db.transaction(
    ["posts", "pending", "viewer", "viewerPending"],
    "readwrite",
  );
  const now = Date.now();
  let changed = 0;

  for (const post of capture.posts) {
    const key = post.id;
    const existing = await tx.objectStore("posts").get(key);
    const merged = existing ? mergePost(existing.post, post) : post;

    await tx.objectStore("posts").put({
      post: merged,
      sourcePath: existing?.sourcePath ?? page,
      firstObservedAt: existing?.firstObservedAt ?? now,
      lastObservedAt: now,
    });

    if (!existing || stableJson(existing.post) !== stableJson(merged)) {
      await tx.objectStore("pending").put({ seq: nextSeq() }, key);
      changed++;
    }
  }

  /* A flag seen again with the same value refreshes its time locally but
     is not resent on its own. */
  for (const state of capture.viewerStates) {
    const key = state.postId;
    const existing = await tx.objectStore("viewer").get(key);
    const merged = mergeViewer(existing, state);

    await tx.objectStore("viewer").put(merged);

    if (!existing || !sameViewer(existing, merged)) {
      await tx.objectStore("viewerPending").put({ seq: nextSeq() }, key);
      changed++;
    }
  }

  await tx.done;
  return changed;
}

type PendingPair = ["posts", "pending"] | ["viewer", "viewerPending"];

async function take<Pair extends PendingPair>(
  [records, queue]: Pair,
  limit: number,
): Promise<Taken<HoardrDB[Pair[0]]["value"]>[]> {
  const db = await open();
  const tx = db.transaction([records, queue]);
  const pending = tx.objectStore(queue);

  const [keys, entries] = await Promise.all([
    pending.getAllKeys(null, limit),
    pending.getAll(null, limit),
  ]);
  const values = await Promise.all(
    keys.map((key) => tx.objectStore(records).get(key)),
  );
  await tx.done;

  return keys.flatMap((key, index) => {
    const value = values[index];
    const entry = entries[index];
    return value && entry ? [{ key, seq: entry.seq, value }] : [];
  });
}

/* Each viewer record becomes at most three states, which keeps a batch
   within the server's limit of 1000. */
export async function takePending(): Promise<PendingUpload> {
  const [posts, viewer] = await Promise.all([
    take(["posts", "pending"], 200),
    take(["viewer", "viewerPending"], 300),
  ]);
  return { posts, viewer };
}

/* A record captured again while its upload was in flight has a new sequence
   number and stays queued. */
export async function ackPending(taken: PendingUpload) {
  const db = await open();
  const tx = db.transaction(["pending", "viewerPending"], "readwrite");

  const queues = [
    [tx.objectStore("pending"), taken.posts],
    [tx.objectStore("viewerPending"), taken.viewer],
  ] as const;

  for (const [queue, entries] of queues)
    for (const { key, seq } of entries) {
      const current = await queue.get(key);
      if (current?.seq === seq) await queue.delete(key);
    }

  await tx.done;
}

export async function summary() {
  const db = await open();
  const [posts, pendingPosts, pendingViewer, liked, bookmarked] =
    await Promise.all([
      db.count("posts"),
      db.getAllKeys("pending"),
      db.getAllKeys("viewerPending"),
      db.countFromIndex("viewer", "active", "liked"),
      db.countFromIndex("viewer", "active", "bookmarked"),
    ]);

  const pending = new Set([...pendingPosts, ...pendingViewer]).size;
  return { posts, pending, liked, bookmarked };
}

export async function exportArchive() {
  const db = await open();
  const exportedAt = JSON.stringify(new Date().toISOString());
  const chunks: BlobPart[] = [
    `{"format":"hoardr","version":4,"exportedAt":${exportedAt},"records":[`,
  ];

  let separator = "";
  let cursor = await db.transaction("posts").store.openCursor();
  while (cursor) {
    chunks.push(separator, JSON.stringify(cursor.value));
    separator = ",";
    cursor = await cursor.continue();
  }

  chunks.push(`],"viewerStates":[`);

  separator = "";
  let viewer = await db.transaction("viewer").store.openCursor();
  while (viewer) {
    for (const state of viewerStatesOf(viewer.value)) {
      chunks.push(separator, JSON.stringify(state));
      separator = ",";
    }
    viewer = await viewer.continue();
  }

  chunks.push("]}");
  return new Blob(chunks, { type: "application/json" });
}
