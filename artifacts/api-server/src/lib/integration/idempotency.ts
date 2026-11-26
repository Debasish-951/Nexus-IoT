import type { Request, Response, NextFunction } from "express";
import { and, eq, lt } from "drizzle-orm";
import { db, apiIdempotencyKeysTable } from "@workspace/db";
import { logger } from "../logger";

/**
 * Idempotency-Key support for /api/v1 writes.
 *
 * A client that retries a write after a timeout sends the same
 * `Idempotency-Key`; the stored answer is replayed instead of acting twice.
 * Keys are per API client and kept 24 hours. Reusing a key for a different
 * request is refused with 422. Without the header the request runs normally.
 */
export async function idempotent(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = req.headers["idempotency-key"];
  const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const client = req.apiClient;
  if (!key || !client) { next(); return; }
  if (key.length > 200) { res.status(400).json({ error: "Idempotency-Key is longer than 200 characters.", code: "idempotency_key_too_long" }); return; }

  const path = req.originalUrl.split("?")[0]!;
  try {
    const [stored] = await db.select().from(apiIdempotencyKeysTable)
      .where(and(eq(apiIdempotencyKeysTable.apiClientId, client.id), eq(apiIdempotencyKeysTable.key, key)));
    if (stored) {
      if (stored.method !== req.method || stored.path !== path) {
        res.status(422).json({ error: "This Idempotency-Key was already used for a different request.", code: "idempotency_key_reused" });
        return;
      }
      res.setHeader("Idempotent-Replayed", "true");
      res.status(stored.statusCode).json(stored.body);
      return;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Idempotency lookup failed; running the request without it");
    next();
    return;
  }

  const original = res.json.bind(res);
  res.json = (body: unknown) => {
    // Server errors are not stored, so a retry after a 5xx gets a real second try.
    if (res.statusCode < 500) {
      void db.insert(apiIdempotencyKeysTable).values({
        apiClientId: client.id, key, method: req.method, path, statusCode: res.statusCode, body: body as object,
      }).onConflictDoNothing().catch(() => {});
    }
    return original(body);
  };
  next();
}

export async function pruneIdempotencyKeys(): Promise<void> {
  await db.delete(apiIdempotencyKeysTable).where(lt(apiIdempotencyKeysTable.createdAt, new Date(Date.now() - 86_400_000)));
}
