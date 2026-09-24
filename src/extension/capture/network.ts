import type { CaptureMessage } from "./parse";
import {
  isTweetEndpoint,
  isTwitterPage,
  isViewerMutation,
  MAX_BODY,
  MAX_REQUEST_BODY,
  withoutQuery,
} from "./routes";

type Publish = (message: CaptureMessage) => void;

function capture(
  publish: Publish,
  url: string,
  startedOn: string,
  body: string,
) {
  if (!isTweetEndpoint(url) || !isTwitterPage(startedOn)) return;

  publish({
    source: "hoardr",
    kind: "response",
    id: crypto.randomUUID(),
    url: withoutQuery(url),
    body,
    page: startedOn,
  });
}

/* Failed actions are published too; the background decides what counts. */
function captureMutation(
  publish: Publish,
  url: string,
  startedOn: string,
  outcome: { request: string; status: number; body: string },
) {
  if (!isViewerMutation(url) || !isTwitterPage(startedOn)) return;
  if (outcome.request.length > MAX_REQUEST_BODY) return;
  if (outcome.body.length > MAX_BODY) return;

  publish({
    source: "hoardr",
    kind: "mutation",
    id: crypto.randomUUID(),
    url: withoutQuery(url),
    ...outcome,
    page: startedOn,
  });
}

const absolute = (url: string) => {
  try {
    return new URL(url, location.href).href;
  } catch {
    return null;
  }
};

async function readBody(response: Response) {
  const reader = response.clone().body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return body + decoder.decode();

    bytes += chunk.value.byteLength;
    if (bytes > MAX_BODY) {
      void reader.cancel().catch(() => {});
      return null;
    }

    body += decoder.decode(chunk.value, { stream: true });
  }
}

async function observeResponse(
  publish: Publish,
  response: Response,
  startedOn: string,
) {
  if (!response.ok || !isTweetEndpoint(response.url)) return;
  if (!response.headers.get("content-type")?.includes("json")) return;
  if (Number(response.headers.get("content-length")) > MAX_BODY) return;

  const body = await readBody(response);
  if (body !== null) capture(publish, response.url, startedOn, body);
}

async function observeMutation(
  publish: Publish,
  url: string,
  startedOn: string,
  request: Promise<string>,
  response: Response,
) {
  const [requestBody, body] = await Promise.all([request, readBody(response)]);

  captureMutation(publish, url, startedOn, {
    request: requestBody,
    status: response.status,
    body: body ?? "",
  });
}

/* A Request's body can be read only once, so it is cloned before the page's
   fetch consumes it. */
function requestBody(input: unknown, init: RequestInit | undefined) {
  if (typeof init?.body === "string") return Promise.resolve(init.body);
  if (input instanceof Request && init?.body === undefined)
    return input.clone().text();
  return null;
}

function xhrBody(xhr: XMLHttpRequest) {
  if (xhr.responseType === "json") return JSON.stringify(xhr.response);
  if (xhr.responseType === "" || xhr.responseType === "text")
    return xhr.responseText;
  return null;
}

function observeXhr(publish: Publish, xhr: XMLHttpRequest, startedOn: string) {
  if (xhr.status < 200 || xhr.status >= 300) return;
  if (!isTweetEndpoint(xhr.responseURL)) return;
  if (!xhr.getResponseHeader("content-type")?.includes("json")) return;

  const body = xhrBody(xhr);
  if (body !== null && body.length <= MAX_BODY)
    capture(publish, xhr.responseURL, startedOn, body);
}

function wrapFetch(publish: Publish) {
  const original = window.fetch;

  window.fetch = function (this: unknown, ...args) {
    const [input, init] = args;
    const startedOn = withoutQuery(location.href);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    const url = absolute(input instanceof Request ? input.url : String(input));
    const request =
      method === "POST" && url !== null && isViewerMutation(url)
        ? requestBody(input, init)
        : null;

    const result = original.apply(this, args);

    /* X pages its timelines with POST; observeResponse filters by
       operation. */
    void result
      .then((response) => observeResponse(publish, response, startedOn))
      .catch(() => {});

    if (request !== null && url !== null)
      void result
        .then((response) =>
          observeMutation(publish, url, startedOn, request, response),
        )
        .catch(() => {});

    return result;
  };
}

function wrapXhr(publish: Publish) {
  const { open, send } = XMLHttpRequest.prototype;
  const requests = new WeakMap<
    XMLHttpRequest,
    { method: string; url: string | null; startedOn: string }
  >();

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    ...args: unknown[]
  ) {
    requests.set(this, {
      method: String(args[0]).toUpperCase(),
      url: absolute(String(args[1])),
      startedOn: withoutQuery(location.href),
    });
    return Reflect.apply(open, this, args);
  } as typeof open;

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args) {
    const request = requests.get(this);
    const [body] = args;

    if (request)
      this.addEventListener(
        "load",
        () => {
          try {
            observeXhr(publish, this, request.startedOn);
          } catch {}
        },
        { once: true },
      );

    const url = request?.url;
    if (
      request?.method === "POST" &&
      url &&
      isViewerMutation(url) &&
      typeof body === "string"
    )
      this.addEventListener(
        "load",
        () => {
          try {
            captureMutation(publish, url, request.startedOn, {
              request: body,
              status: this.status,
              body: xhrBody(this) ?? "",
            });
          } catch {}
        },
        { once: true },
      );

    return send.apply(this, args);
  };
}

export function installNetworkCapture(publish: Publish) {
  wrapFetch(publish);
  wrapXhr(publish);
}
