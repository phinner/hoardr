import { Effect, Result, type Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";
import { HttpApiClient, type HttpApiError } from "effect/unstable/httpapi";
import { HoardrApi } from "~/shared/api";

const makeClient = (serverUrl: string, token: string) =>
  HttpApiClient.make(HoardrApi, {
    baseUrl: serverUrl,
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.bearerToken(token),
    ),
  });

type Client = Effect.Success<ReturnType<typeof makeClient>>;

type ApiError =
  | HttpApiError.Unauthorized
  | HttpApiError.NotFound
  | HttpClientError.HttpClientError
  | Schema.SchemaError;

/* An empty 401 or 404 reaches the client as a bare status rather than as
   the declared error, so both forms are classified the same way. */
const statusOf = (error: ApiError) =>
  error._tag === "HttpClientError" && "response" in error.reason
    ? error.reason.response.status
    : null;

function describeApiError(error: ApiError, status: number | null) {
  if (error._tag === "Unauthorized" || status === 401)
    return "The server no longer accepts this browser's token. Connect again.";
  if (error._tag === "NotFound") return "That credential no longer exists.";
  if (
    error._tag === "HttpClientError" &&
    error.reason._tag === "TransportError"
  )
    return "Could not reach the hoardr server.";
  if (status !== null && status >= 500)
    return `The hoardr server failed with status ${status}.`;
  if (status !== null && (status < 200 || status >= 300))
    return `The server answered with status ${status}.`;
  return "The server sent an unexpected response.";
}

export class ServerError extends Error {
  readonly reason: "unauthorized" | "not-found" | "failed";

  constructor(error: ApiError) {
    const status = statusOf(error);
    super(describeApiError(error, status));
    this.reason =
      error._tag === "Unauthorized" || status === 401
        ? "unauthorized"
        : error._tag === "NotFound" || status === 404
          ? "not-found"
          : "failed";
  }
}

/* The one bridge from the Effect client to plain async code: it resolves
   with the response or rejects with a ServerError whose message is fit to
   show. */
export async function api<A>(
  server: { readonly serverUrl: string; readonly token: string },
  call: (client: Client) => Effect.Effect<A, ApiError, HttpClient.HttpClient>,
): Promise<A> {
  const result = await Effect.runPromise(
    makeClient(server.serverUrl, server.token).pipe(
      Effect.flatMap(call),
      Effect.result,
      Effect.provide(FetchHttpClient.layer),
    ),
  );

  if (Result.isFailure(result)) throw new ServerError(result.failure);
  return result.success;
}
