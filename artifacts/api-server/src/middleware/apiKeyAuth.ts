import { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, apiClientsTable } from "@workspace/db";

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

// ── Auth middleware factory ────────────────────────────────────────────────────
export function apiKeyAuth(requiredScope?: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers["authorization"] as string | undefined;
    const xApiKey    = req.headers["x-api-key"]    as string | undefined;

    let secret: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      secret = authHeader.slice(7).trim();
    } else if (xApiKey) {
      secret = xApiKey.trim();
    }

    if (!secret) {
      res.status(401).json({
        error: "Authentication required",
        hint: "Provide  Authorization: Bearer <clientSecret>  or  X-API-Key: <clientSecret>",
      });
      return;
    }

    const [client] = await db
      .select()
      .from(apiClientsTable)
      .where(eq(apiClientsTable.clientSecret, secret));

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

    // Track usage (fire-and-forget)
    void db
      .update(apiClientsTable)
      .set({
        lastUsedAt: new Date(),
        totalRequests: sql`${apiClientsTable.totalRequests} + 1`,
      })
      .where(eq(apiClientsTable.id, client.id));

    req.apiClient = client;
    next();
  };
}
