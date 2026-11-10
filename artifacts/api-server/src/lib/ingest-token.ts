import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, apiClientsTable, type ApiClient } from "@workspace/db";
import { hashToken } from "./tokens";
import { encryptSecret, decryptSecret, encryptionEnabled } from "./secret-box";
import { logger } from "./logger";

/**
 * Copy-and-paste ingest URLs.
 *
 * ── The problem this solves ──────────────────────────────────────────────────
 *
 * Making a gateway post telemetry used to require configuring a header, which
 * is a step every integrator gets wrong once and some tools cannot do at all.
 * The whole setup is now: create an endpoint, copy its URL, paste it into the
 * gateway. The credential travels inside the URL.
 *
 * ── Why that is acceptable HERE and nowhere else ─────────────────────────────
 *
 * A credential in a URL is normally a mistake: it lands in proxy access logs,
 * browser history and referrer headers. It is acceptable for this one token
 * because of what the token cannot do:
 *
 *   • `assertUrlTokenAllowed` refuses any client whose scopes are not
 *     ingest-only. A `*` super-key cannot be used through a URL even if someone
 *     pastes one there — the powerful credentials stay header-only and hashed.
 *   • It writes telemetry to one project. It cannot read, export, or administer.
 *   • It is attributable (every post is counted against the client), rate
 *     limited, held to the client's IP allowlist, and revocable in one click.
 *     The limit and allowlist are applied in attachApiClient, because a URL
 *     token never passes through the route-level apiKeyAuth.
 *
 * The remaining exposure — access logs — is a deployment concern, addressed by
 * the nginx rule in docs/operations/vm-deployment-checklist.md.
 *
 * ── Why the token is encrypted rather than hashed ────────────────────────────
 *
 * Client secrets are hashed precisely so nobody can read them back. This token
 * is the opposite requirement: the operator must be able to re-copy the URL
 * months later without rotating anything. That means the value has to be
 * recoverable, so it is encrypted at rest with the same AES-256-GCM key ring
 * that protects webhook tokens and MQTT passwords.
 *
 * If encryption is unavailable, NO token is issued. Storing this in clear would
 * put a working ingest URL in every database backup, which is exactly the
 * outcome the encryption exists to prevent.
 */

/** Where a decrypted token is bound, so ciphertext cannot be moved between columns. */
const AAD_CONTEXT = "api_clients.ingest_token";

/** The only scope an ingest URL may carry. */
export const INGEST_SCOPE = "ingest:write";

export interface IssuedToken {
  /** Plaintext — returned to the caller once and never logged. */
  token: string;
  hash: string;
  encrypted: string;
}

/**
 * Mint a token.
 *
 * 32 bytes from the CSPRNG, base64url. That is 256 bits of entropy in a
 * URL-safe form with no characters a gateway's URL field will mangle — which
 * `randomUUID()` would also satisfy for entropy but not for opacity: a UUID
 * looks like an identifier and invites people to treat it as one.
 */
export function issueIngestToken(): IssuedToken | null {
  if (!encryptionEnabled()) {
    logger.error(
      "Cannot issue an ingest URL token: SECRETS_ENC_KEY is not configured. " +
      "Generate one with  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"  " +
      "and set SECRETS_ENC_KEY_FILE. Refusing to store the token in clear.",
    );
    return null;
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const encrypted = encryptSecret(token, AAD_CONTEXT);
  if (!encrypted) return null;

  return { token, hash: hashToken(token), encrypted };
}

/** Token format check, applied before any database work. */
export function looksLikeIngestToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(value);
}

/**
 * Whether this client may authenticate through a URL at all.
 *
 * The single most important rule in this file. A client is eligible only if its
 * scope list is exactly the ingest scope — not a superset, and explicitly not
 * `*`. Anything broader keeps the header-only, hashed treatment.
 */
export function assertUrlTokenAllowed(client: Pick<ApiClient, "scopes">): boolean {
  const scopes = client.scopes ?? [];
  if (scopes.length === 0) return false;               // empty = all scopes, per apiKeyAuth
  if (scopes.includes("*")) return false;              // super-key: never in a URL
  return scopes.every((s) => s === INGEST_SCOPE);
}

export type TokenRejection =
  | "malformed" | "unknown" | "inactive" | "expired" | "scope_too_broad"
  // Set by attachApiClient after the token resolved: the same IP allowlist and
  // per-client rate limit a header key meets in apiKeyAuth.
  | "ip_not_allowed" | "rate_limited";

export interface TokenResolution {
  client?: ApiClient;
  rejected?: TokenRejection;
}

/**
 * Resolve a URL token to its client, enforcing every condition.
 *
 * Lookup is by SHA-256 of the token, not by the ciphertext: AES-GCM uses a
 * random IV, so the same token encrypts differently every time and cannot be
 * used as a lookup key. The hash is the index; the ciphertext exists purely so
 * the value can be shown again.
 */
export async function resolveIngestToken(raw: string): Promise<TokenResolution> {
  if (!looksLikeIngestToken(raw)) return { rejected: "malformed" };

  const [client] = await db
    .select()
    .from(apiClientsTable)
    .where(eq(apiClientsTable.ingestTokenHash, hashToken(raw)));

  if (!client) return { rejected: "unknown" };
  if (client.status !== "active") return { rejected: "inactive" };
  if (client.expiresAt && new Date() > client.expiresAt) return { rejected: "expired" };
  if (!assertUrlTokenAllowed(client)) return { rejected: "scope_too_broad" };

  return { client };
}

/**
 * Decrypt a stored token so an administrator can copy the URL again.
 *
 * Returns null when the key ring cannot open it — a token encrypted under a key
 * that has since been removed is unreadable, and the honest answer is "rotate
 * it", not a misleading blank.
 */
export function revealIngestToken(client: Pick<ApiClient, "ingestTokenEnc">): string | null {
  if (!client.ingestTokenEnc) return null;
  try {
    return decryptSecret(client.ingestTokenEnc, AAD_CONTEXT);
  } catch (err) {
    logger.warn({ err }, "stored ingest token could not be decrypted");
    return null;
  }
}

/** Build the URL an operator pastes into a gateway. */
export function ingestUrl(baseUrl: string, token: string, mode: "payload" | "batch" = "payload"): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/ingest/e/${token}/${mode}`;
}
