/**
 * Counts ingest requests and MQTT messages that were refused or failed, per
 * hour, source, route, status and error code, for the Data health tab.
 *
 * Counted in memory and written every 30 seconds in one statement, so a device
 * that keeps sending bad data cannot turn every failed request into a database
 * write. Only the error text is kept (shortened), never the payload. Rows older
 * than 30 days are deleted by the hourly retention run.
 */
import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

interface Entry { hour: Date; source: string; route: string; status: number; code: string; count: number; lastAt: Date; lastMessage: string | null; lastClient: string | null }

const pending = new Map<string, Entry>();
const MAX_KEYS = 500;

function hourOf(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);
}

/** Record one refused or failed ingest. */
export function recordIngestRejection(r: { source: "http" | "mqtt"; route: string; status: number; code?: string | null; message?: string | null; client?: string | null }): void {
  const now = new Date();
  const hour = hourOf(now);
  const code = (r.code || (r.status >= 500 ? "server_error" : "rejected")).slice(0, 80);
  const key = `${hour.getTime()}|${r.source}|${r.route}|${r.status}|${code}`;
  const e = pending.get(key);
  const message = r.message ? String(r.message).slice(0, 300) : null;
  if (e) {
    e.count++; e.lastAt = now; e.lastMessage = message ?? e.lastMessage; e.lastClient = r.client ?? e.lastClient;
    return;
  }
  if (pending.size >= MAX_KEYS) return; // a flood of distinct codes; the next flush makes room
  pending.set(key, { hour, source: r.source, route: r.route.slice(0, 80), status: r.status, code, count: 1, lastAt: now, lastMessage: message, lastClient: r.client ?? null });
}

/** Write the counted entries. Returns how many keys were written. */
export async function flushIngestRejections(): Promise<number> {
  if (pending.size === 0) return 0;
  const batch = [...pending.values()];
  pending.clear();
  const values: unknown[] = [];
  const rows = batch.map((e, i) => {
    values.push(e.hour, e.source, e.route, e.status, e.code, e.count, e.lastAt, e.lastMessage, e.lastClient);
    const b = i * 9;
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
  });
  try {
    await pool.query(`
      INSERT INTO ingest_rejections (hour, source, route, status, code, count, last_at, last_message, last_client)
      VALUES ${rows.join(", ")}
      ON CONFLICT (hour, source, route, status, code) DO UPDATE
        SET count = ingest_rejections.count + EXCLUDED.count, last_at = EXCLUDED.last_at,
            last_message = COALESCE(EXCLUDED.last_message, ingest_rejections.last_message),
            last_client = COALESCE(EXCLUDED.last_client, ingest_rejections.last_client)`, values);
  } catch (err) {
    logger.warn({ err }, "Could not record ingest rejections");
  }
  return batch.length;
}

/** "/ingest/e/abc/payload" -> "payload" (tokens and client ids are never stored). */
export function ingestRouteName(path: string): string {
  const last = path.replace(/\/+$/, "").split("/").pop() ?? "";
  return /^[a-z-]{2,30}$/.test(last) ? last : "other";
}

/**
 * Express middleware for the ingest routes: when the response status is 400 or
 * higher, count it with the `code` and `error` of the JSON body.
 */
export function ingestRejectionRecorder(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/ingest/")) { next(); return; }
  let body: unknown;
  const json = res.json.bind(res);
  res.json = ((b: unknown) => { body = b; return json(b); }) as Response["json"];
  res.on("finish", () => {
    if (res.statusCode < 400) return;
    const b = (body && typeof body === "object" ? body : {}) as { code?: unknown; error?: unknown };
    recordIngestRejection({
      source: "http",
      route: ingestRouteName(req.path),
      status: res.statusCode,
      code: typeof b.code === "string" ? b.code : null,
      message: typeof b.error === "string" ? b.error : null,
      client: req.apiClient?.name ?? null,
    });
  });
  next();
}

export function startIngestRejectionFlush(): void {
  setInterval(() => { void flushIngestRejections(); }, 30_000).unref?.();
}
