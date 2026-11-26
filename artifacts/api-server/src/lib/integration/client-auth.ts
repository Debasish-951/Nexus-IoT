import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, gt, or, lt } from "drizzle-orm";
import { db, apiClientsTable, apiAccessTokensTable, apiRequestLogTable } from "@workspace/db";
import { hashToken } from "../tokens";
import { clientAddress } from "../client-ip";
import { logger } from "../logger";

type ApiClient = typeof apiClientsTable.$inferSelect;

/**
 * Credential lookup for machine callers.
 *
 * Three forms are accepted, checked in this order:
 *   1. An OAuth access token (prefix `nxat_`), issued by POST /api/oauth/token.
 *      Only these touch api_access_tokens, so ordinary keys pay nothing extra.
 *   2. The client's current secret (hash, or the legacy plaintext column).
 *   3. The client's previous secret, while its rotation grace period lasts.
 *
 * Form 2 is the original behaviour, unchanged. Forms 1 and 3 only match rows
 * that have opted in (a token was issued, or a rotation with a grace period).
 */

export const ACCESS_TOKEN_PREFIX = "nxat_";
export const ACCESS_TOKEN_TTL_SEC = Math.min(86_400, Math.max(300, Number(process.env.OAUTH_TOKEN_TTL_SEC ?? 3600) || 3600));

export function secretCondition(secret: string) {
  const h = hashToken(secret);
  return or(
    eq(apiClientsTable.clientSecretHash, h),
    eq(apiClientsTable.clientSecret, secret),
    and(eq(apiClientsTable.previousSecretHash, h), gt(apiClientsTable.previousSecretExpiresAt, new Date())),
  );
}

let tokenTableWarned = false;

export async function findClientBySecret(secret: string): Promise<ApiClient | undefined> {
  if (secret.startsWith(ACCESS_TOKEN_PREFIX)) {
    try {
      const [row] = await db.select({ client: apiClientsTable })
        .from(apiAccessTokensTable)
        .innerJoin(apiClientsTable, eq(apiClientsTable.id, apiAccessTokensTable.apiClientId))
        .where(and(eq(apiAccessTokensTable.tokenHash, hashToken(secret)), gt(apiAccessTokensTable.expiresAt, new Date())));
      return row?.client;
    } catch (err) {
      if (!tokenTableWarned) { tokenTableWarned = true; logger.warn({ err: (err as Error).message }, "OAuth token lookup failed; are the integration tables pushed?"); }
      return undefined;
    }
  }
  const [client] = await db.select().from(apiClientsTable).where(secretCondition(secret));
  return client;
}

/** Issue a short-lived access token for a client that already proved its secret. */
export async function issueAccessToken(client: ApiClient): Promise<{ token: string; expiresIn: number }> {
  const token = ACCESS_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  await db.insert(apiAccessTokensTable).values({
    apiClientId: client.id, tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000),
  });
  return { token, expiresIn: ACCESS_TOKEN_TTL_SEC };
}

/** Revoke every live token of a client (on rotate, revoke or delete). */
export async function revokeAccessTokens(apiClientId: string): Promise<void> {
  try { await db.delete(apiAccessTokensTable).where(eq(apiAccessTokensTable.apiClientId, apiClientId)); } catch { /* table missing: nothing to revoke */ }
}

// ── Per-client request log ───────────────────────────────────────────────────
//
// Buffered in memory and written in bulk every few seconds, so a gateway posting
// twice a second adds one INSERT per flush, not one per reading. A crash loses at
// most one flush of log rows, never telemetry.

interface LogRow { apiClientId: string; method: string; path: string; statusCode: number; durationMs: number; ip: string | null; ts: Date }
const buffer: LogRow[] = [];
const MAX_BUFFER = 5_000;
const tracked = new WeakSet<Request>();
let flushTimer: NodeJS.Timeout | null = null;
let flushWarned = 0;

/** Strip ids, tokens and query strings so the path groups well and leaks nothing. */
export function normalisePath(path: string): string {
  return path.split("?")[0]!
    .replace(/\/ingest\/e\/[^/]+/, "/ingest/e/:token")
    .replace(/\/ingest\/k\/[^/]+/, "/ingest/k/:clientId")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .slice(0, 200);
}

export function trackApiRequest(req: Request, res: Response, client: { id: string }): void {
  if (tracked.has(req)) return;
  tracked.add(req);
  const started = Date.now();
  res.on("finish", () => {
    if (buffer.length >= MAX_BUFFER) return;
    buffer.push({
      apiClientId: client.id, method: req.method, path: normalisePath(req.originalUrl.replace(/^\/api/, "")),
      statusCode: res.statusCode, durationMs: Date.now() - started, ip: clientAddress(req) || null, ts: new Date(),
    });
  });
}

export async function flushRequestLog(): Promise<void> {
  if (buffer.length === 0) return;
  const rows = buffer.splice(0, buffer.length);
  try {
    for (let i = 0; i < rows.length; i += 1000) await db.insert(apiRequestLogTable).values(rows.slice(i, i + 1000));
  } catch (err) {
    if (Date.now() - flushWarned > 300_000) {
      flushWarned = Date.now();
      logger.warn({ err: (err as Error).message, dropped: rows.length }, "API request log not written; are the integration tables pushed?");
    }
  }
}

export function startRequestLogFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushRequestLog(); }, 5_000);
  flushTimer.unref();
}

export async function pruneApiLogs(days = Number(process.env.API_REQUEST_LOG_RETENTION_DAYS ?? 30)): Promise<void> {
  const cutoff = new Date(Date.now() - Math.max(1, days) * 86_400_000);
  await db.delete(apiRequestLogTable).where(lt(apiRequestLogTable.ts, cutoff));
  await db.delete(apiAccessTokensTable).where(lt(apiAccessTokensTable.expiresAt, new Date()));
}
