import { browser } from "wxt/browser";
import { log } from "~/extension/diagnostics/log";
import { requestBodyText } from "./mutation";
import type { CaptureMessage } from "./parse";
import {
  apiMatches,
  isTweetEndpoint,
  isTwitterPage,
  isViewerMutation,
  MAX_BODY,
  operationOf,
  withoutQuery,
} from "./routes";

/* Firefox's stream filter and `documentUrl` are missing from the Chrome-shaped
   typings WXT ships, so the two extras are declared here. */
interface StreamFilter {
  ondata: ((event: { data: ArrayBuffer }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  readonly error?: string;
  write(data: ArrayBuffer): void;
  disconnect(): void;
}

interface FirefoxRequest {
  readonly requestId: string;
  readonly url: string;
  readonly method: string;
  readonly tabId: number;
  readonly statusCode: number;
  readonly responseHeaders?: ReadonlyArray<{ name: string; value?: string }>;
  readonly requestBody?: Parameters<typeof requestBodyText>[0];
  readonly documentUrl?: string;
}

const filterFor = (requestId: string) =>
  (
    browser.webRequest as unknown as {
      filterResponseData(id: string): StreamFilter;
    }
  ).filterResponseData(requestId);

const isJson = (details: FirefoxRequest) =>
  details.responseHeaders?.some(
    (header) =>
      header.name.toLowerCase() === "content-type" &&
      header.value?.includes("json"),
  ) ?? false;

export type StreamPublish = (
  message: CaptureMessage,
  documentUrl: string,
) => void;

type Message = (body: string, page: string) => CaptureMessage;

function observe(
  details: FirefoxRequest,
  message: Message,
  publish: StreamPublish,
) {
  const operation = operationOf(details.url);
  const documentUrl = details.documentUrl;
  if (!documentUrl || !isTwitterPage(documentUrl)) {
    log("stream.skipped", {
      operation,
      reason: "not-a-twitter-page",
      documentUrl,
    });
    return;
  }

  const filter = filterFor(details.requestId);
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;

  filter.ondata = (event) => {
    filter.write(event.data);
    bytes += event.data.byteLength;
    if (bytes <= MAX_BODY) chunks.push(event.data);
  };

  filter.onstop = () => {
    filter.disconnect();
    if (bytes > MAX_BODY) {
      log("stream.skipped", { operation, reason: "too-large", bytes });
      return;
    }

    const body = new TextDecoder().decode(
      new Blob(chunks).size === bytes
        ? concat(chunks, bytes)
        : new Uint8Array(),
    );
    if (!body.startsWith("{") && !body.startsWith("[")) {
      log("stream.skipped", { operation, reason: "not-json", bytes });
      return;
    }

    log("stream.read", { operation, bytes });
    publish(message(body, withoutQuery(documentUrl)), documentUrl);
  };

  filter.onerror = () => {
    log("stream.failed", { operation, error: filter.error });
    filter.disconnect();
  };
}

function concat(chunks: ArrayBuffer[], bytes: number) {
  const out = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return out;
}

const response =
  (details: FirefoxRequest): Message =>
  (body, page) => ({
    source: "hoardr",
    kind: "response",
    id: details.requestId,
    url: withoutQuery(details.url),
    body,
    page,
  });

const mutation =
  (details: FirefoxRequest, request: string): Message =>
  (body, page) => ({
    source: "hoardr",
    kind: "mutation",
    id: details.requestId,
    url: withoutQuery(details.url),
    request,
    status: details.statusCode,
    body,
    page,
  });

const filter = { urls: apiMatches, types: ["xmlhttprequest" as const] };

/* Firefox only. The filter runs in the extension process, so the page sees
   no wrapped fetch and no messages. An action's request body is only
   readable before it is sent, so it waits here for the response. */
export function installStreamCapture(publish: StreamPublish) {
  const requestBodies = new Map<string, string>();

  browser.webRequest.onBeforeRequest.addListener(
    (raw) => {
      const details = raw as unknown as FirefoxRequest;
      if (
        details.method === "POST" &&
        details.tabId >= 0 &&
        isViewerMutation(details.url)
      ) {
        const body = requestBodyText(details.requestBody);
        if (body !== null) requestBodies.set(details.requestId, body);
      }
      return undefined;
    },
    filter,
    ["requestBody"],
  );

  browser.webRequest.onErrorOccurred.addListener(
    (details) => void requestBodies.delete(details.requestId),
    filter,
  );

  browser.webRequest.onHeadersReceived.addListener(
    (raw) => {
      const details = raw as unknown as FirefoxRequest;
      const request = requestBodies.get(details.requestId);
      requestBodies.delete(details.requestId);

      /* Every GraphQL call is logged, so a renamed operation shows up as a
         request that was seen but never read. */
      const operation = operationOf(details.url);
      if (operation !== undefined)
        log("stream.request", {
          operation,
          method: details.method,
          status: details.statusCode,
          json: isJson(details),
          tweetEndpoint: isTweetEndpoint(details.url),
          tabId: details.tabId,
        });

      if (
        details.tabId < 0 ||
        details.statusCode < 200 ||
        details.statusCode >= 300 ||
        !isJson(details)
      )
        return undefined;

      /* X pages its timelines with POST, so the operation decides, not the
         method. */
      if (isTweetEndpoint(details.url))
        observe(details, response(details), publish);

      if (details.method === "POST" && request !== undefined)
        observe(details, mutation(details, request), publish);

      return undefined;
    },
    filter,
    ["blocking", "responseHeaders"],
  );
}
