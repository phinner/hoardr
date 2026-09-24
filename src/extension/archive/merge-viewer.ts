import type { ViewerState } from "~/shared/archive";

const viewerFlags = ["liked", "bookmarked", "reposted"] as const;
export type ViewerFlag = (typeof viewerFlags)[number];

interface Observed {
  readonly value: boolean;
  readonly at: number;
}

/* `active` lists the flags that are true, so they can be counted through a
   multi-entry index; IndexedDB cannot index booleans. */
export type ViewerRecord = {
  readonly postId: ViewerState["postId"];
  readonly active: readonly ViewerFlag[];
} & { readonly [Flag in ViewerFlag]: Observed | null };

/* Per flag, the newer observation wins and a null one says nothing. */
export function mergeViewer(
  record: ViewerRecord | undefined,
  state: ViewerState,
): ViewerRecord {
  const pick = (flag: ViewerFlag) => {
    const known = record?.[flag] ?? null;
    const value = state[flag];

    return value !== null && (known === null || state.observedAt >= known.at)
      ? { value, at: state.observedAt }
      : known;
  };

  const liked = pick("liked");
  const bookmarked = pick("bookmarked");
  const reposted = pick("reposted");
  const flags = { liked, bookmarked, reposted };

  return {
    postId: state.postId,
    ...flags,
    active: viewerFlags.filter((flag) => flags[flag]?.value === true),
  };
}

export const sameViewer = (left: ViewerRecord, right: ViewerRecord) =>
  viewerFlags.every((flag) => left[flag]?.value === right[flag]?.value);

/* Flags observed at different times go out as separate states, so the server
   weighs each against its own timestamp. */
export function viewerStatesOf(record: ViewerRecord): ViewerState[] {
  const byTime = new Map<number, ViewerState>();

  for (const flag of viewerFlags) {
    const observed = record[flag];
    if (observed === null) continue;

    const state = byTime.get(observed.at) ?? {
      postId: record.postId,
      liked: null,
      bookmarked: null,
      reposted: null,
      observedAt: observed.at,
    };
    byTime.set(observed.at, { ...state, [flag]: observed.value });
  }

  return [...byTime.values()];
}
