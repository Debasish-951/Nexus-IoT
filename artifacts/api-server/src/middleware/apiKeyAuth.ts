import { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, apiClientsTable } from "@workspace/db";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      apiClient?: typeof apiClientsTable.$inferSelect;
    }
  }
}

// ── Per-client in-memory rate limiter ─────────────────────────────────────────
interface RateBucket { count: number; windowStart: number }
const buckets = new Map<string, RateBucket>();
const WINDOW_MS  = 60_000; // 1 minute sliding window
const MAX_RPM    = 120;    // requests per minute per client

function isRateLimited(clientId: string): boolean {
  const now   = Date.now();
  const entry = buckets.get(clientId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    buckets.set(clientId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_RPM;
}

function readSecret(req: Request): string | null {
  const authHeader = req.headers["authorization"] as string | undefined;
  const xApiKey    = req.headers["x-api-key"]    as string | undefined;

  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
  if (xApiKey) return xApiKey.trim() || null;
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
        hint: "Provide  Authorization: Bearer <clientSecret>  or  X-API-Key: <clientSecret>",
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
    if (isRateLimited(client.id)) {
      res.status(429).json({
        error: "Rate limit exceeded",
        limit: `${MAX_RPM} requests per minute`,
        retryAfter: "60",
      });
      res.setHeader("Retry-After", "60");
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
