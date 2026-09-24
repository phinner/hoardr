import { Schema } from "effect";
import { ViewerState } from "~/shared/archive";
import { CapturedPost } from "~/shared/capture";

export type JsonObject = Record<string, unknown>;

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const string = (value: unknown) =>
  typeof value === "string" ? value : undefined;

export const list = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

export const at = (value: unknown, ...path: string[]) =>
  path.reduce<unknown>(
    (current, key) => (isObject(current) ? current[key] : undefined),
    value,
  );

export function isoDate(value: unknown) {
  const milliseconds = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

const decoder =
  <A>(schema: Schema.Codec<A, unknown>) =>
  (candidate: unknown) => {
    const decoded = Schema.decodeUnknownOption(schema)(candidate);
    return decoded._tag === "Some" ? decoded.value : null;
  };

/* Parsers read fields loosely; these are the one place a capture is checked
   against the wire contract, and whatever fails it is dropped. */
export const decodePost = decoder(CapturedPost);
export const decodeViewerState = decoder(ViewerState);
