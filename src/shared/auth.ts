import { Schema } from "effect";

export const CredentialId = Schema.String.pipe(
  Schema.check(Schema.isUUID(4)),
  Schema.brand("CredentialId"),
);
export type CredentialId = typeof CredentialId.Type;

/* `owner` credentials drive the API: they upload, and mint or revoke other
   credentials. `agent` credentials only open the MCP endpoint. */
const CredentialKind = Schema.Literals(["owner", "agent"]);
export type CredentialKind = typeof CredentialKind.Type;

export const CredentialSummary = Schema.Struct({
  id: CredentialId,
  name: Schema.String,
  kind: CredentialKind,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  revokedAt: Schema.NullOr(Schema.String),
});
export type CredentialSummary = typeof CredentialSummary.Type;

export const CreateCredentialRequest = Schema.Struct({
  name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  kind: CredentialKind,
});

/* The only response that carries a secret. The server stores a digest, so a
   lost token is replaced rather than recovered. */
export const CreateCredentialResponse = Schema.Struct({
  token: Schema.String,
  credential: CredentialSummary,
});

/* A token is `hoardr_<credential id>_<secret>`, so the holder knows which
   credential it is without another request, and the server looks it up by
   primary key before comparing the secret's digest. */
const tokenPattern =
  /^hoardr_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_([A-Za-z0-9_-]{20,})$/;

export const parseToken = (
  token: string,
): { readonly id: CredentialId; readonly secret: string } | null => {
  const match = tokenPattern.exec(token.trim());
  return match?.[1] !== undefined && match[2] !== undefined
    ? { id: match[1] as CredentialId, secret: match[2] }
    : null;
};

export const formatToken = (id: CredentialId, secret: string) =>
  `hoardr_${id}_${secret}`;
