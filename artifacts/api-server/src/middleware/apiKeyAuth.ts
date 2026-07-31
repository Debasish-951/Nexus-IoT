import { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, apiClientsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { authConfig } from "../lib/auth-config";

declare global {
  namespace Express {
    interface Request {
      apiClient?: typeof apiClientsTable.$inferSelect;
    }
  }
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

/**
 * Where a client secret may travel, in order of preference.
 *
 * A header is the right place for a credential. But plenty of field gateways —
 * Node-RED subflows, PLC HTTP blocks, SCADA bridges — expose a URL field and
 * nothing else, and their operators cannot edit the posting code. Refusing those
 * leaves only one alternative: anonymous ingest. A key in the query string is
 * weaker than a header but far stronger than no key at all, and it keeps every
 * other control (scope, expiry, revocation, per-client attribution, rate limit).
 *
 * The query string is deliberately stripped from the request log in app.ts, so a
 * key sent this way is not written to disk. It can still appear in a reverse
 * proxy's access log, so prefer the header where the client allows it.
 */
function readSecret(req: Request): string | null {
  const authHeader = req.headers["authorization"] as string | undefined;
  const xApiKey    = req.headers["x-api-key"]    as string | undefined;

  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
  if (xApiKey) return xApiKey.trim() || null;

  for (const param of ["key", "apiKey", "api_key"]) {
    const v = req.query?.[param];
    const raw = Array.isArray(v) ? v[0] : v;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
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
  const secret = readSecret(req);
  if (!secret) { next(); return; }

  try {
    const [client] = await db
      .select()
      .from(apiClientsTable)
      .where(eq(apiClientsTable.clientSecret, secret));

    // Only a usable credential counts. An expired or revoked key must fall
    // through to `authorize`'s 401 rather than being treated as authenticated.
    if (client && client.status === "active" && !(client.expiresAt && new Date() > client.expiresAt)) {
      req.apiClient = client;
    }
  } catch {
    /* a lookup failure is simply "no client" — authorize will reject */
  }
  next();
}

// ── Auth middleware factory ────────────────────────────────────────────────────
export function apiKeyAuth(requiredScope?: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const secret = readSecret(req);

    if (!secret) {
      res.status(401).json({
        error: "Authentication required",
        hint: "Provide  Authorization: Bearer <clientSecret>,  X-API-Key: <clientSecret>,  or  ?key=<clientSecret>  on the URL when the client cannot set headers",
      });
      return;
    }

    // Reuse the row attachApiClient already fetched where possible.
    const client = req.apiClient ?? (await db
      .select()
      .from(apiClientsTable)
      .where(eq(apiClientsTable.clientSecret, secret)))[0];

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

    // IP allowlist check (empty list = allow all)
    if (client.allowedIps.length > 0) {
      const remoteIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
        ?? req.socket.remoteAddress
        ?? "";
      const allowed = client.allowedIps.some((ip) => remoteIp === ip || remoteIp.startsWith(ip));
      if (!allowed) {
        res.status(403).json({
          error: "Request IP not in allowlist",
          remoteIp,
          allowedIps: client.allowedIps,
        });
        return;
      }
    }

    // Scope check — empty scopes array = all scopes (super-key)
    if (requiredScope && client.scopes.length > 0) {
      const hasScope = client.scopes.includes("*") || client.scopes.includes(requiredScope);
      if (!hasScope) {
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

    const client = req.apiClient ?? (await db
      .select()
      .from(apiClientsTable)
      .where(eq(apiClientsTable.clientSecret, secret)))[0];

    if (!client || client.status !== "active") { next(); return; }
    if (client.expiresAt && new Date() > client.expiresAt) { next(); return; }

    if (requiredScope && client.scopes.length > 0) {
      const hasScope = client.scopes.includes("*") || client.scopes.includes(requiredScope);
      if (!hasScope) { next(); return; }
    }

    db.update(apiClientsTable)
      .set({ lastUsedAt: new Date(), totalRequests: sql`${apiClientsTable.totalRequests} + 1` })
      .where(eq(apiClientsTable.id, client.id))
      .execute()
      .catch((err) => logger.warn({ err, clientId: client.clientId }, "api client usage update failed"));

    req.apiClient = client;
    next();
  };
}
