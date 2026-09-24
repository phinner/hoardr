import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
} from "effect/unstable/httpapi";
import { IngestBatch, IngestReceipt } from "./archive";
import {
  CreateCredentialRequest,
  CreateCredentialResponse,
  CredentialId,
  CredentialSummary,
} from "./auth";

const Health = Schema.Struct({ status: Schema.Literal("ok") });

/* The credential behind the bearer token of the current request. */
export class CurrentCredential extends Context.Service<
  CurrentCredential,
  CredentialSummary
>()("hoardr/CurrentCredential") {}

/* Every `/v1` route needs a live owner token. The server implements this
   once; the client sends the token through `HttpClientRequest.bearerToken`. */
export class OwnerAuth extends HttpApiMiddleware.Service<
  OwnerAuth,
  { provides: CurrentCredential }
>()("hoardr/OwnerAuth", {
  error: HttpApiError.Unauthorized,
  security: { bearer: HttpApiSecurity.bearer },
}) {}

class SystemApi extends HttpApiGroup.make("system", {
  topLevel: true,
}).add(HttpApiEndpoint.get("health", "/health", { success: Health })) {}

class ArchiveApi extends HttpApiGroup.make("archive", {
  topLevel: true,
})
  .add(
    HttpApiEndpoint.post("ingest", "/v1/archive/batches", {
      payload: IngestBatch,
      success: IngestReceipt,
    }),
  )
  .middleware(OwnerAuth) {}

class CredentialsApi extends HttpApiGroup.make("credentials", {
  topLevel: true,
})
  .add(
    HttpApiEndpoint.get("listCredentials", "/v1/credentials", {
      success: Schema.Array(CredentialSummary),
    }),
  )
  .add(
    HttpApiEndpoint.post("createCredential", "/v1/credentials", {
      payload: CreateCredentialRequest,
      success: CreateCredentialResponse,
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeCredential", "/v1/credentials/:id", {
      params: { id: CredentialId },
      error: HttpApiError.NotFound,
    }),
  )
  .middleware(OwnerAuth) {}

export class HoardrApi extends HttpApi.make("hoardr")
  .add(SystemApi)
  .add(ArchiveApi)
  .add(CredentialsApi) {}
