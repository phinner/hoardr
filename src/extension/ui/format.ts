const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const count = (value: number | undefined) =>
  value === undefined ? "…" : compact.format(value);

/* X's timestamps: "now", "5m", "3h", "2d", then a short date. */
export function ago(at: number | null | undefined) {
  if (!at) return null;

  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;

  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
