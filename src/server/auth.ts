import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { CurrentCredential, OwnerAuth } from "~/shared/api";
import {
  CredentialId,
  type CredentialKind,
  CredentialSummary,
  formatToken,
  parseToken,
} from "~/shared/auth";

const LAST_USED_PRECISION_MS = 60_000;

const CredentialRow = Schema.Struct({
  ...CredentialSummary.fields,
  secretHash: Schema.String,
});

const digest = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");

const secretMatches = (secret: string, expectedHash: string) =>
  timingSafeEqual(
    Buffer.from(digest(secret), "hex"),
    Buffer.from(expectedHash, "hex"),
  );

const makeAuth = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: CredentialSummary,
    execute: () => sql`
      SELECT id, name, kind, created_at, last_used_at, revoked_at
      FROM credentials
      ORDER BY created_at
    `,
  });

  const selectOne = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: CredentialRow,
    execute: (id) => sql`
      SELECT id, name, kind, secret_hash, created_at, last_used_at, revoked_at
      FROM credentials
      WHERE id = ${id}
    `,
  });

  const create = Effect.fn("Auth.create")(function* (
    name: string,
    kind: CredentialKind,
  ) {
    const secret = randomBytes(32).toString("base64url");
    const credential: CredentialSummary = {
      id: CredentialId.make(randomUUID()),
      name,
      kind,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };

    yield* sql`INSERT INTO credentials ${sql.insert({
      id: credential.id,
      name: credential.name,
      kind,
      secretHash: digest(secret),
      createdAt: credential.createdAt,
    })}`;

    return { token: formatToken(credential.id, secret), credential };
  });

  const list = Effect.fn("Auth.list")(() => selectAll(undefined));

  const revoke = Effect.fn("Auth.revoke")(function* (id: string) {
    const rows = yield* sql`
      UPDATE credentials
      SET revoked_at = coalesce(revoked_at, ${new Date().toISOString()})
      WHERE id = ${id}
      RETURNING id
    `;

    return rows.length > 0;
  });

  const verify = Effect.fn("Auth.verify")(function* (token: string) {
    const parsed = parseToken(token);
    if (parsed === null) return Option.none<CredentialSummary>();

    const row = yield* selectOne(parsed.id);

    if (
      Option.isNone(row) ||
      row.value.revokedAt !== null ||
      !secretMatches(parsed.secret, row.value.secretHash)
    ) {
      return Option.none<CredentialSummary>();
    }

    const { secretHash: _, ...credential } = row.value;
    const now = new Date();
    const lastUsed = Date.parse(credential.lastUsedAt ?? "");

    if (
      Number.isNaN(lastUsed) ||
      now.getTime() - lastUsed >= LAST_USED_PRECISION_MS
    ) {
      const lastUsedAt = now.toISOString();

      yield* sql`UPDATE credentials SET last_used_at = ${lastUsedAt} WHERE id = ${credential.id}`;

      return Option.some({ ...credential, lastUsedAt });
    }

    return Option.some(credential);
  });

  return { create, list, revoke, verify };
});

export class Auth extends Context.Service<
  Auth,
  Effect.Success<typeof makeAuth>
>()("hoardr/Auth") {}

export const AuthLive = Layer.effect(Auth, makeAuth);

/* A storage failure while checking a token is the server's fault, so it
   dies into a 500 rather than masquerading as a bad token. */
export const OwnerAuthLive = Layer.effect(
  OwnerAuth,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return {
      bearer: (httpEffect, { credential }) =>
        Effect.gen(function* () {
          const found = yield* auth
            .verify(Redacted.value(credential))
            .pipe(Effect.orDie);

          if (Option.isNone(found) || found.value.kind !== "owner") {
            return yield* new HttpApiError.Unauthorized({});
          }

          return yield* Effect.provideService(
            httpEffect,
            CurrentCredential,
            found.value,
          );
        }),
    };
  }),
);
