import { at, isObject, list, string } from "./json";
import { MAX_REQUEST_BODY } from "./routes";

const tweetId = /^[1-9][0-9]{0,19}$/;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/* X names the target `tweet_id`, except DeleteRetweet, which names it
   `source_tweet_id`. A form-encoded body carries `variables` as a string. */
export function mutationTweetId(request: string) {
  const payload = parseJson(request);
  const raw = at(payload, "variables");
  const variables = typeof raw === "string" ? parseJson(raw) : raw;

  const id =
    string(at(variables, "tweet_id")) ??
    string(at(variables, "source_tweet_id"));
  return id !== undefined && tweetId.test(id) ? id : null;
}

/* GraphQL reports a refused action, such as liking a deleted post, with a
   2xx status and a top-level `errors` list. */
export function mutationSucceeded(status: number, body: string) {
  if (status < 200 || status >= 300) return false;

  const payload = parseJson(body);
  return isObject(payload) && list(payload.errors).length === 0;
}

interface RequestBody {
  readonly raw?: ReadonlyArray<{ readonly bytes?: ArrayBuffer }>;
  readonly formData?: Readonly<Record<string, readonly string[]>>;
}

/* Firefox hands a request body over as raw byte chunks, or already parsed
   when it was form-encoded. Either becomes the JSON text X would send. */
export function requestBodyText(body: RequestBody | undefined) {
  if (body?.formData)
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(body.formData).map(([key, values]) => [key, values[0]]),
      ),
    );

  const chunks = (body?.raw ?? []).flatMap((part) =>
    part.bytes ? [new Uint8Array(part.bytes)] : [],
  );
  const bytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (bytes === 0 || bytes > MAX_REQUEST_BODY) return null;

  const decoder = new TextDecoder();
  return (
    chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") +
    decoder.decode()
  );
}
