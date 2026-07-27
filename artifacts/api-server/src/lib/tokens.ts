import crypto from "node:crypto";
import { and, eq, isNull, gt } from "drizzle-orm";
import { db, authTokensTable, type AuthTokenType } from "@workspace/db";
import { authConfig } from "./auth-config";

/**
 * Secure token generation and redemption for the out-of-band account flows
 * (activation, password reset) and for session cookies.
 *
 * Invariants:
 *   - 32 bytes from the CSPRNG → 256 bits of entropy, base64url encoded.
 *   - Only SHA-256(token) is persisted. Read access to the database does not
 *     yield a usable token. (SHA-256 without a salt is correct here: the input
 *     is already high-entropy, so there is nothing to brute force, and we need
 *     a deterministic value to index on.)
 *   - Single use — `consumedAt` is set inside the same conditional UPDATE that
 *     redeems the token, so two concurrent clicks cannot both succeed.
 */

export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

const TTL_BY_TYPE: Record<AuthTokenType, number> = {
  activation: authConfig.tokens.activationTtlMs,
  password_reset: authConfig.tokens.passwordResetTtlMs,
};

export interface IssuedToken {
  /** Raw token — send it in the email link, never persist or log it. */
  raw: string;
  expiresAt: Date;
}

/**
 * Issue a token, superseding any outstanding token of the same type for the
 * same user. Resending an invitation therefore silently kills the previous
 * link, so a forwarded old email cannot be used after a resend.
 */
export async function issueAuthToken(
  userId: string,
  type: AuthTokenType,
  opts: { createdBy?: string | null; createdIp?: string | null } = {},
): Promise<IssuedToken> {
  await revokeAuthTokens(userId, type);

  const raw = generateToken();
  const expiresAt = new Date(Date.now() + TTL_BY_TYPE[type]);

  await db.insert(authTokensTable).values({
    userId,
    type,
    tokenHash: hashToken(raw),
    expiresAt,
    createdBy: opts.createdBy ?? null,
    createdIp: opts.createdIp ?? null,
  });

  return { raw, expiresAt };
}

/** Invalidate every live token of a type for a user. */
export async function revokeAuthTokens(userId: string, type: AuthTokenType): Promise<void> {
  await db
    .update(authTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(authTokensTable.userId, userId),
      eq(authTokensTable.type, type),
      isNull(authTokensTable.consumedAt),
      isNull(authTokensTable.revokedAt),
    ));
}

export type TokenLookupResult =
  | { ok: true; userId: string; tokenId: string; expiresAt: Date }
  | { ok: false; reason: "token_invalid" | "token_consumed" | "token_revoked" | "token_expired" };

/**
 * Look a token up WITHOUT redeeming it — used by the GET endpoints that render
 * the "set your password" form, so an email-scanner prefetching the link cannot
 * burn the token before the human clicks it.
 */
// `raw` is deliberately `unknown`: it comes straight off req.params/req.body,
// which Express 5 types as `string | string[]`. Narrowing here keeps the guard
// in one place instead of casting at every call site.
export async function lookupAuthToken(raw: unknown, type: AuthTokenType): Promise<TokenLookupResult> {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 128) {
    return { ok: false, reason: "token_invalid" };
  }

  const [row] = await db
    .select()
    .from(authTokensTable)
    .where(and(
      eq(authTokensTable.tokenHash, hashToken(raw)),
      eq(authTokensTable.type, type),
    ));

  if (!row) return { ok: false, reason: "token_invalid" };
  if (row.consumedAt) return { ok: false, reason: "token_consumed" };
  if (row.revokedAt) return { ok: false, reason: "token_revoked" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "token_expired" };

  return { ok: true, userId: row.userId, tokenId: row.id, expiresAt: row.expiresAt };
}

/**
 * Atomically redeem a token. The `consumedAt IS NULL` predicate lives in the
 * UPDATE's WHERE clause, so the database — not application logic — guarantees
 * exactly one winner under concurrency.
 */
export async function consumeAuthToken(raw: unknown, type: AuthTokenType): Promise<TokenLookupResult> {
  const found = await lookupAuthToken(raw, type);
  if (!found.ok) return found;

  const [claimed] = await db
    .update(authTokensTable)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(authTokensTable.id, found.tokenId),
      isNull(authTokensTable.consumedAt),
      isNull(authTokensTable.revokedAt),
      gt(authTokensTable.expiresAt, new Date()),
    ))
    .returning({ id: authTokensTable.id, userId: authTokensTable.userId });

  if (!claimed) return { ok: false, reason: "token_consumed" };
  return { ok: true, userId: claimed.userId, tokenId: claimed.id, expiresAt: found.expiresAt };
}

/** Build the user-facing link for an email. */
export function buildActivationUrl(raw: string): string {
  return `${authConfig.publicUrl}/activate?token=${encodeURIComponent(raw)}`;
}

export function buildResetUrl(raw: string): string {
  return `${authConfig.publicUrl}/reset-password?token=${encodeURIComponent(raw)}`;
}
