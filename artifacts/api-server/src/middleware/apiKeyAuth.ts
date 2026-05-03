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
        hint: "Provide Authorization: Bearer <clientSecret>  or  X-API-Key: <clientSecret>",
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

    if (client.status !== "active") {
      res.status(403).json({ error: "API client is inactive" });
      return;
    }

    // Scope check — empty scopes array means "all scopes" (super-key)
    if (requiredScope && client.scopes.length > 0) {
      const hasScope =
        client.scopes.includes("*") ||
        client.scopes.includes(requiredScope);
      if (!hasScope) {
        res.status(403).json({
          error: `Insufficient scope. Required: ${requiredScope}`,
          clientScopes: client.scopes,
        });
        return;
      }
    }

    // Track usage (fire-and-forget — non-blocking)
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
