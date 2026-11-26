import { Request, Response, NextFunction } from "express";
import { BlockList, isIP } from "node:net";
import { eq, sql, isNotNull } from "drizzle-orm";
import { db, apiClientsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { authConfig } from "../lib/auth-config";
import { clientAddress } from "../lib/client-ip";
import { recordSecurityEvent } from "../lib/security-log";
import { findClientBySecret, trackApiRequest } from "../lib/integration/client-auth";

declare global {
  namespace Express {
    interface Request {
      apiClient?: typeof apiClientsTable.$inferSelect;
      /**
       * Set when the caller authenticated with a copy-and-paste ingest URL
       * rather than a header. Route guards check this so a URL token is usable
       * on ingest and nowhere else — see lib/ingest-token.ts.
       */
      viaIngestUrlToken?: boolean;
      /** Why a URL token was refused, for the 401 body. */
      ingestTokenFailure?: import("../lib/ingest-token").TokenRejection;
    }
  }
}

/**
 * Pull the token out of `/ingest/e/<token>/<action>`.
 *
 * Read from the path directly rather than `req.params`, because this runs as
 * application-level middleware where the route has not been matched yet and
 * `params` is still empty.
 */
function ingestUrlToken(path: string): string | null {
  const m = /^\/ingest\/e\/([A-Za-z0-9_-]{40,64})\/(payload|batch|validate)\/?$/.exec(path);
  return m ? m[1] : null;
}

// ── Per-client in-memory rate limiter ─────────────────────────────────────────
//
// The ceiling was a hardcoded 120 requests/minute — 2 per second. That is below
// what a single ordinary telemetry gateway produces: the first real Node-RED flow
// connected to this platform measured 118/min, i.e. 98% of the cap, on ONE
// project. Every additional project would have sat equally close to its own
// ceiling, and going over does not throttle — it returns 429 and the reading is
// gone unless the gateway happens to retry. So the default is now both higher and
// operator-tunable, per `authConfig.apiKey.rateLimitRpm`
// (env: INGEST_RATE_LIMIT_RPM).
//
// Still counted PER CLIENT, which is what makes one-key-per-project the right
// pattern: each project gets its own independent budget and cannot starve another.
interface RateBucket { count: number; windowStart: number }
const buckets = new Map<string, RateBucket>();
const WINDOW_MS = 60_000; // 1 minute fixed window

function isRateLimited(clientId: string, maxRpm: number): boolean {
  // 0 disables the limit entirely — an explicit operator choice, e.g. while
  // load-testing, rather than something reachable by accident.
  if (maxRpm <= 0) return false;
  const now   = Date.now();
  const entry = buckets.get(clientId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    buckets.set(clientId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > maxRpm;
}

// ── IP allowlist ──────────────────────────────────────────────────────────────
//
// The allowlist used to compare the first raw X-Forwarded-For value with each
// entry by string prefix. All three parts were wrong: the header is whatever the
// caller sends, so anyone reaching port 8080 directly chose their own address;
// "10.0.0.1" admitted "10.0.0.10" through "10.0.0.199"; and an empty entry was a
// prefix of every address, so it allowed everyone while looking like a rule.
//
// Now: the address is the one Express vouches for under TRUST_PROXY
// (clientAddress), and each entry is an exact address or a CIDR block, matched
// with Node's own BlockList so IPv4, IPv6 and IPv4-mapped IPv6 behave alike.

export interface AllowlistEntry {
  address: string;
  prefix: number;
  family: "ipv4" | "ipv6";
}

/** Parse one allowlist entry: an address, or address/prefix. Null when invalid. */
export function parseAllowlistEntry(raw: unknown): AllowlistEntry | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase();
  if (!text || text.length > 64) return null;
  const parts = text.split("/");
  if (parts.length > 2) return null;
  let address = parts[0]!;
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4) address = address.slice(7);
  const version = isIP(address);
  if (version === 0) return null;
  const max = version === 4 ? 32 : 128;
  let prefix = max;
  if (parts.length === 2) {
    if (!/^\d{1,3}$/.test(parts[1]!)) return null;
    prefix = Number(parts[1]);
    // A /0 admits every address, which is what an empty list already means. As
    // an entry it would read like a restriction while being none.
    if (prefix < 1 || prefix > max) return null;
  }
  return { address, prefix, family: version === 4 ? "ipv4" : "ipv6" };
}

/**
 * Validate a submitted allowlist. Returns the cleaned list, or the entries that
 * are not valid so the caller can be told which ones to fix.
 */
export function normaliseAllowlist(input: unknown): { ok: true; entries: string[] } | { ok: false; invalid: string[] } {
  if (!Array.isArray(input)) return { ok: true, entries: [] };
  const entries: string[] = [];
  const invalid: string[] = [];
  for (const item of input) {
    if (!parseAllowlistEntry(item)) { invalid.push(String(item).slice(0, 64)); continue; }
    const cleaned = (item as string).trim();
    if (!entries.includes(cleaned)) entries.push(cleaned);
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, entries };
}

/**
 * Whether `ip` is admitted by `entries`. An entry that does not parse matches
 * nothing, so a list holding only legacy prefix-style entries admits nobody:
 * the failure is a visible 403, not an unintended open door.
 */
export function ipAllowed(ip: string, entries: readonly string[]): boolean {
  let address = ip.trim().toLowerCase();
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4) address = address.slice(7);
  const version = isIP(address);
  if (version === 0) return false;
  const list = new BlockList();
  for (const raw of entries) {
    const entry = parseAllowlistEntry(raw);
    if (entry) list.addSubnet(entry.address, entry.prefix, entry.family);
  }
  return list.check(address, version === 4 ? "ipv4" : "ipv6");
}

/** True when the client has an allowlist and this request's address is not on it. */
function blockedByAllowlist(req: Request, client: typeof apiClientsTable.$inferSelect): boolean {
  if (client.allowedIps.length === 0) return false;
  if (ipAllowed(clientAddress(req), client.allowedIps)) return false;
  recordSecurityEvent({
    type: "authz.denied",
    outcome: "failure",
    reason: "api_key_ip_not_allowed",
    detail: { method: req.method, path: req.path, apiClientId: client.id, clientId: client.clientId },
    req,
  });
  return true;
}

/**
 * Record a presented credential that did not authenticate. Coalesced in
 * security-log, so a gateway retrying a revoked key every second produces one
 * row a minute with a count, not thousands. The secret itself is never recorded.
 */
function recordInvalidKey(req: Request, reason: string, client?: { id: string; clientId: string } | null): void {
  recordSecurityEvent({
    type: "apikey.invalid",
    outcome: "failure",
    reason,
    detail: { method: req.method, path: req.path, apiClientId: client?.id ?? null, clientId: client?.clientId ?? null },
    req,
  });
}

/**
 * Warn once per legacy client at startup. Those rows still hold their secret
 * in plaintext, which `findClientBySecret` accepts until the migration runs. The
 * operator runs it, not the server: hashing makes the secret unreadable on the
 * API Clients page, and the team should be told first.
 */
export async function warnLegacyPlaintextSecrets(): Promise<number> {
  const rows = await db
    .select({ id: apiClientsTable.id, name: apiClientsTable.name, clientId: apiClientsTable.clientId })
    .from(apiClientsTable)
    .where(isNotNull(apiClientsTable.clientSecret));
  for (const row of rows) {
    logger.warn(
      { apiClientId: row.id, clientId: row.clientId, name: row.name },
      "API client still has a legacy plaintext secret in the database. Run " +
      "`pnpm --filter @workspace/db run hash-api-secrets` to store it as a hash; the key itself keeps working.",
    );
  }
  return rows.length;
}

/**
 * Match a presented secret against a stored credential.
 *
 * Hash first, plaintext second: everything issued now stores only
 * SHA-256(secret), so read access to the database no longer yields a working
 * key. The plaintext arm exists solely for credentials issued before that
 * change and disappears once
 * `pnpm --filter @workspace/db run hash-api-secrets` has run — it nulls the
 * legacy column, and a null never matches.
 *
 * Unsalted SHA-256 is correct here rather than the scrypt used for passwords:
 * the secret is a randomUUID, so there is no low-entropy input to protect, and
 * the lookup must be a deterministic indexed equality.
 */
// Lookup moved to findClientBySecret (lib/integration/client-auth.ts), which keeps
// both arms above and adds the rotation grace period and OAuth access tokens.

/**
 * Where a client secret may travel, in order of preference.
 *
 * A header is the right place for a credential, and is the only place accepted
 * by default.
 *
 * The query string (`?key=…`) is OFF unless `API_KEY_ALLOW_QUERY_PARAM=true`.
 * This application's own log strips query strings (see the pino serializer in
 * app.ts), but nginx's default `access_log` writes the full request line — so a
 * key sent that way ends up in cleartext on disk, in log rotation, and in
 * backups. That is a credential leak the application cannot prevent on its own,
 * which is why it is no longer on by default.
 *
 * It stays available because some field gateways expose only a URL field and
 * their operators cannot change the posting code; for those, a key in the query
 * string still beats anonymous ingest, and keeps scope, expiry, revocation,
 * per-client attribution and rate limiting.
 */
function readSecret(req: Request): string | null {
  const authHeader = req.headers["authorization"] as string | undefined;
  const xApiKey    = req.headers["x-api-key"]    as string | undefined;

  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
  if (xApiKey) return xApiKey.trim() || null;

  for (const param of ["key", "apiKey", "api_key"]) {
    const v = req.query?.[param];
    const raw = Array.isArray(v) ? v[0] : v;
    if (typeof raw === "string" && raw.trim()) {
      if (!authConfig.allowApiKeyInQuery) {
        // Logged rather than silently ignored: without this, a gateway that
        // worked yesterday starts returning 401 and nothing says why.
        warnQueryKeyRejected();
        return null;
      }
      return raw.trim();
    }
  }
  return null;
}

let lastQueryKeyWarning = 0;
function warnQueryKeyRejected(): void {
  const now = Date.now();
  if (now - lastQueryKeyWarning < 60_000) return;
  lastQueryKeyWarning = now;
  logger.warn(
    "An API key was sent in the query string and ignored. Send it as " +
    "'X-API-Key: <secret>' or 'Authorization: Bearer <secret>'. If a device cannot " +
    "set headers, set API_KEY_ALLOW_QUERY_PARAM=true — and strip the parameter in nginx, " +
    "or the key is written to the access log in cleartext.",
  );
}

/**
 * Resolve an API key onto the request WITHOUT enforcing anything.
 *
 * Mounted globally in app.ts ahead of `authorize`, because route authorisation
 * needs to know a machine caller is present before the route-level
 * `apiKeyAuth(scope)` runs — otherwise every existing /export integration would
 * be rejected with 401 before reaching its own guard.
 *
 * Deliberately does not touch the usage counters: `apiKeyAuth` does that, and
 * counting here as well would double every request.
 */
export async function attachApiClient(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // A copy-and-paste ingest URL carries its credential in the path. Resolved
  // here so `authorize` sees an authenticated machine caller, exactly as it
  // would for a header. `resolveIngestToken` is what enforces that the client
  // is ingest-scoped — a `*` super-key pasted into this position is refused.
  const urlToken = ingestUrlToken(req.path);
  if (urlToken) {
    try {
      const { resolveIngestToken } = await import("../lib/ingest-token");
      const { client, rejected } = await resolveIngestToken(urlToken);
      if (!client) {
        req.ingestTokenFailure = rejected;
        recordInvalidKey(req, `ingest_url_${rejected ?? "unknown"}`);
      } else if (blockedByAllowlist(req, client)) {
        // A URL token never reaches apiKeyAuth, so the allowlist and the per-client
        // limit are applied here. Without this, a leaked ingest URL worked from any
        // address and was limited only by the flood guard.
        req.ingestTokenFailure = "ip_not_allowed";
      } else if (isRateLimited(client.id, authConfig.apiKey.rateLimitRpm)) {
        req.ingestTokenFailure = "rate_limited";
        logger.warn(
          { clientId: client.clientId, name: client.name, maxRpm: authConfig.apiKey.rateLimitRpm },
          "api client rate limited (ingest URL) — ingest data may have been dropped",
        );
      } else {
        req.apiClient = client;
        req.viaIngestUrlToken = true;
        trackApiRequest(req, _res, client);
      }
    } catch (err) {
      logger.error({ err }, "ingest URL token lookup failed");
    }
    next();
    return;
  }

  const secret = readSecret(req);
  if (!secret) { next(); return; }

  try {
    // Current secret, previous secret within its rotation grace period, or an
    // OAuth access token — see lib/integration/client-auth.ts.
    const client = await findClientBySecret(secret);

    // Only a usable credential counts. An expired or revoked key must fall
    // through to `authorize`'s 401 rather than being treated as authenticated.
    if (client && client.status === "active" && !(client.expiresAt && new Date() > client.expiresAt)) {
      req.apiClient = client;
      trackApiRequest(req, _res, client);
    } else {
      recordInvalidKey(req, !client ? "unknown_key" : client.status !== "active" ? `key_${client.status}` : "key_expired", client);
    }
  } catch {
    /* a lookup failure is simply "no client" — authorize will reject */
  }
  next();
}

/**
 * Whether a client's scopes cover `required`.
 *
 * An empty list has always meant "every scope" (the legacy super-key). That
 * stays the default so existing keys keep working; set
 * API_KEY_EMPTY_SCOPES_DENY=true to make an empty list grant nothing.
 */
export function scopeAllows(scopes: readonly string[], required: string): boolean {
  if (scopes.length === 0) return process.env.API_KEY_EMPTY_SCOPES_DENY !== "true";
  return scopes.includes("*") || scopes.includes(required);
}

// ── Auth middleware factory ────────────────────────────────────────────────────
export function apiKeyAuth(requiredScope?: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const secret = readSecret(req);

    if (!secret) {
      res.status(401).json({
        error: "Authentication required",
        hint: "Provide  Authorization: Bearer <clientSecret>  or  X-API-Key: <clientSecret>. A key in the query string is ignored unless API_KEY_ALLOW_QUERY_PARAM=true.",
      });
      return;
    }

    // Reuse the row attachApiClient already fetched where possible.
    const client = req.apiClient ?? await findClientBySecret(secret);

    if (!client) {
      res.status(401).json({ error: "Invalid API credentials" });
      return;
    }

    // Status check
    if (client.status !== "active") {
      const msg = client.status === "revoked" ? "API token has been revoked" : "API client is inactive";
      res.status(403).json({ error: msg });
      return;
    }

    // Expiry check
    if (client.expiresAt && new Date() > client.expiresAt) {
      res.status(401).json({
        error: "API token has expired",
        expiredAt: client.expiresAt.toISOString(),
        hint: "Rotate the token in Security → API Clients to get a new one",
      });
      return;
    }

    // IP allowlist check (empty list = allow all). The list itself is not sent
    // back: it would tell a caller holding a stolen key which addresses to use.
    if (blockedByAllowlist(req, client)) {
      res.status(403).json({
        error: "Request IP not in allowlist",
        code: "ip_not_allowed",
        remoteIp: clientAddress(req),
      });
      return;
    }

    // Scope check — empty scopes array = all scopes (super-key), unless
    // API_KEY_EMPTY_SCOPES_DENY=true retires that legacy meaning.
    if (requiredScope && !scopeAllows(client.scopes, requiredScope)) {
      {
        res.status(403).json({
          error: `Insufficient scope. Required: ${requiredScope}`,
          clientScopes: client.scopes,
        });
        return;
      }
    }

    // Rate limit
    const maxRpm = authConfig.apiKey.rateLimitRpm;
    if (isRateLimited(client.id, maxRpm)) {
      // Headers must be set BEFORE the response is sent. `.json()` ends the
      // response, so the old `setHeader` call after it threw
      // ERR_HTTP_HEADERS_SENT — an uncaught exception that crashed the entire
      // process, taking down every client's connection, not just the one that
      // got rate-limited. This is why the server kept dying under load.
      res.setHeader("Retry-After", "60");
      res.status(429).json({
        error: "Rate limit exceeded",
        limit: `${maxRpm} requests per minute`,
        retryAfter: "60",
      });
      // Logged as a warning because a rejected ingest post is silently LOST data
      // unless the gateway retries — it needs to be findable after the fact, not
      // just visible to whoever was watching at the time.
      logger.warn(
        { clientId: client.clientId, name: client.name, maxRpm },
        "api client rate limited — ingest data may have been dropped",
      );
      return;
    }

    // Track usage (fire-and-forget).
    //
    // `.execute()` is required: a Drizzle query builder is a lazy thenable, so
    // `void db.update(...)` builds the statement and never sends it. That is why
    // totalRequests/lastUsedAt sat at zero — the counters looked implemented but
    // no UPDATE was ever issued.
    db.update(apiClientsTable)
      .set({
        lastUsedAt: new Date(),
        totalRequests: sql`${apiClientsTable.totalRequests} + 1`,
      })
      .where(eq(apiClientsTable.id, client.id))
      .execute()
      .catch((err) => logger.warn({ err, clientId: client.clientId }, "api client usage update failed"));

    req.apiClient = client;
    next();
  };
}

// ── Optional auth — validates token if present, allows unauthenticated requests ─
export function optionalApiKeyAuth(requiredScope?: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const secret = readSecret(req);
    if (!secret) { next(); return; }

    const client = req.apiClient ?? await findClientBySecret(secret);

    if (!client || client.status !== "active") { next(); return; }
    if (client.expiresAt && new Date() > client.expiresAt) { next(); return; }

    if (requiredScope && !scopeAllows(client.scopes, requiredScope)) { next(); return; }

    db.update(apiClientsTable)
      .set({ lastUsedAt: new Date(), totalRequests: sql`${apiClientsTable.totalRequests} + 1` })
      .where(eq(apiClientsTable.id, client.id))
      .execute()
      .catch((err) => logger.warn({ err, clientId: client.clientId }, "api client usage update failed"));

    req.apiClient = client;
    next();
  };
}
