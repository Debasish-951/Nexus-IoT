import type { Request } from "express";
import { lt, sql } from "drizzle-orm";
import { db, securityEventsTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcast } from "./ws-broadcast";
import { clientAddress } from "./client-ip";

/**
 * Security event recorder.
 *
 * Complements — does not replace — `logActivity()` in routes/activity_log.ts.
 * That one records business actions for the Activity Log page; this one records
 * authentication and authorisation facts with the source IP and user agent, for
 * the Security Center.
 *
 * Never throws: an audit write failing must not take down a login.
 */

export type SecurityEventType =
  | "login.success" | "login.failure" | "login.blocked" | "login.rate_limited"
  | "logout" | "session.expired" | "session.revoked"
  | "account.locked" | "account.unlocked" | "account.status_changed"
  | "user.invited" | "user.activated" | "invitation.resent"
  | "password_reset.requested" | "password_reset.completed" | "password.changed"
  | "authz.denied" | "csrf.failed" | "email.failed" | "access.updated"
  // `event_type` is a text column and the Security Center falls back to showing
  // the raw name, so adding a type needs no migration and no frontend change.
  | "ratelimit.tripped" | "auth.spray_detected" | "input.rejected"
  // A presented API key or ingest URL that did not authenticate.
  | "apikey.invalid"
  // Changes to a machine credential. These are privilege changes as much as a
  // role change is, and were previously only in the Activity Log.
  | "api_client.created" | "api_client.updated" | "api_client.secret_rotated"
  | "api_client.revoked" | "api_client.restored" | "api_client.deleted";

export interface SecurityEventInput {
  type: SecurityEventType;
  userId?: string | null;
  username?: string | null;
  outcome?: "success" | "failure";
  reason?: string | null;
  detail?: Record<string, unknown> | null;
  req?: Request;
}

/**
 * Client IP.
 *
 * This used to read `x-forwarded-for` directly, which meant the value recorded
 * here — and, more seriously, the value the per-IP login limiter keyed on — was
 * whatever the caller chose to send. Resolution now goes through
 * `clientAddress`, which uses only what Express will vouch for under the
 * configured `trust proxy` setting. See lib/client-ip.ts for the deployment
 * requirement that creates.
 */
export function clientIp(req?: Request): string | null {
  if (!req) return null;
  const ip = clientAddress(req);
  return ip === "unknown" ? null : ip;
}

export function userAgent(req?: Request): string | null {
  const ua = req?.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 512) : null;
}

// ── Flood coalescing ────────────────────────────────────────────────────────
//
// A misbehaving integration wrote 7,546 identical `ratelimit.tripped` rows in
// one hour and pushed the real events out of every default view. Retention does
// not help with that: the flood and the investigation both happen inside the
// same hour, so a 30- or 90-day policy keeps every one of those rows.
//
// The fix is to stop writing them. For the event types below, the first
// occurrence of a given (type, reason, ip, username) is written normally and
// repeats inside the window only increment a counter, flushed onto that same row
// as `detail.occurrences`. One row per minute per distinct cause, carrying the
// true count — strictly more informative than 7,546 rows nobody can read.
//
// Deliberately NOT applied to `login.*`: those are the forensic core, and they
// are already bounded by the five-attempt lockout, so there is no flood to
// suppress and every individual row matters.
const COALESCED_TYPES = new Set<SecurityEventType>([
  "ratelimit.tripped",
  "authz.denied",
  "csrf.failed",
  "input.rejected",
  // A gateway left running with a revoked key retries forever; one row a minute
  // with a count is the useful record of that.
  "apikey.invalid",
]);

const COALESCE_WINDOW_MS = Number(process.env.SECURITY_EVENT_COALESCE_MS ?? 60_000);
const COALESCE_FLUSH_MS = 15_000;
/** Bounds memory if the key itself is attacker-controlled (e.g. rotating IPs). */
const MAX_COALESCE_KEYS = 5_000;

interface Burst {
  rowId: string;
  count: number;
  flushed: number;
  windowStart: number;
  lastAt: number;
}
const bursts = new Map<string, Burst>();

function burstKey(input: SecurityEventInput, ip: string | null): string {
  return `${input.type}|${input.reason ?? ""}|${ip ?? ""}|${input.username ?? ""}`;
}

/** Write accumulated counts back onto the row that opened each window. */
async function flushBursts(): Promise<void> {
  const now = Date.now();
  for (const [key, burst] of bursts) {
    if (burst.count > burst.flushed) {
      try {
        await db.update(securityEventsTable)
          .set({
            detail: sql`COALESCE(${securityEventsTable.detail}, '{}'::jsonb) || ${JSON.stringify({
              occurrences: burst.count,
              lastAt: new Date(burst.lastAt).toISOString(),
              coalesced: true,
            })}::jsonb`,
          })
          .where(sql`${securityEventsTable.id} = ${burst.rowId}`);
        burst.flushed = burst.count;
      } catch (err) {
        logger.error({ err }, "failed to flush coalesced security event count");
      }
    }
    if (now - burst.windowStart >= COALESCE_WINDOW_MS) bursts.delete(key);
  }
}

const flushTimer = setInterval(() => { void flushBursts(); }, COALESCE_FLUSH_MS);
// Never keep the process alive just to flush an audit counter.
flushTimer.unref?.();

/**
 * Delete security events past their retention window.
 *
 * Called from the hourly maintenance job in index.ts. Two passes: age first,
 * then an absolute row cap, so a burst that somehow survives coalescing still
 * cannot grow the table without bound.
 */
export async function pruneSecurityEvents(): Promise<number> {
  const days = Number(process.env.SECURITY_EVENT_RETENTION_DAYS ?? 90);
  const maxRows = Number(process.env.SECURITY_EVENT_MAX_ROWS ?? 500_000);
  let removed = 0;

  if (Number.isFinite(days) && days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const aged = await db.delete(securityEventsTable)
      .where(lt(securityEventsTable.createdAt, cutoff))
      .returning({ id: securityEventsTable.id });
    removed += aged.length;
  }

  if (Number.isFinite(maxRows) && maxRows > 0) {
    // Keep the newest `maxRows`, drop anything older than that boundary.
    const overflow = await db.execute<{ n: number }>(sql`
      WITH boundary AS (
        SELECT created_at FROM security_events
        ORDER BY created_at DESC OFFSET ${maxRows} LIMIT 1
      )
      DELETE FROM security_events
      WHERE created_at < (SELECT created_at FROM boundary)
      RETURNING 1 AS n
    `);
    removed += overflow.rows.length;
  }

  if (removed > 0) logger.info({ removed, days, maxRows }, "pruned security events");
  return removed;
}

type SecurityListener = (type: string, username: string | null) => void;
const listeners: SecurityListener[] = [];
/** Called after each stored event (the audit log uses it for repeated failed sign-ins). */
export function onSecurityEvent(fn: SecurityListener): void { listeners.push(fn); }

export async function logSecurityEvent(input: SecurityEventInput): Promise<void> {
  const outcome = input.outcome ?? (input.type.endsWith(".failure") || input.type.endsWith(".denied") ? "failure" : "success");

  // Repeat of an in-flight burst → count it in memory and return. No DB write,
  // no WebSocket broadcast: 1,200 events/minute fanned out to every open
  // Security Center tab is its own denial of service.
  if (COALESCED_TYPES.has(input.type)) {
    const key = burstKey(input, clientIp(input.req));
    const existing = bursts.get(key);
    if (existing && Date.now() - existing.windowStart < COALESCE_WINDOW_MS) {
      existing.count++;
      existing.lastAt = Date.now();
      return;
    }
  }

  try {
    const [row] = await db.insert(securityEventsTable).values({
      userId: input.userId ?? null,
      username: input.username?.slice(0, 256) ?? null,
      eventType: input.type,
      outcome,
      reason: input.reason?.slice(0, 256) ?? null,
      ip: clientIp(input.req),
      userAgent: userAgent(input.req),
      detail: input.detail ?? null,
    }).returning();

    // Surface failures in the server log too, so they show up in whatever the
    // deployment already ships logs to without needing a DB query.
    if (outcome === "failure") {
      logger.warn({
        securityEvent: input.type,
        username: input.username,
        reason: input.reason,
        ip: row?.ip,
      }, `security: ${input.type}`);
    }

    // This row opens a coalescing window: further copies of the same cause fold
    // into it rather than inserting again.
    if (row && COALESCED_TYPES.has(input.type)) {
      if (bursts.size >= MAX_COALESCE_KEYS) {
        // Evict the stalest window rather than growing without bound. Its count
        // was flushed on the last tick, so nothing is lost beyond the tail.
        let oldestKey: string | null = null;
        let oldestAt = Infinity;
        for (const [k, b] of bursts) if (b.windowStart < oldestAt) { oldestAt = b.windowStart; oldestKey = k; }
        if (oldestKey) bursts.delete(oldestKey);
      }
      const now = Date.now();
      bursts.set(burstKey(input, row.ip), {
        rowId: row.id, count: 1, flushed: 1, windowStart: now, lastAt: now,
      });
    }

    if (row) {
      // Live-tail in the Security Center, same channel the Activity Log uses.
      broadcast("security_event", { ...row, createdAt: row.createdAt.toISOString() });
    }
    for (const fn of listeners) { try { fn(input.type, input.username ?? null); } catch { /* a listener must not break logging */ } }
  } catch (err) {
    logger.error({ err, securityEvent: input.type }, "failed to persist security event");
  }
}

/** Fire-and-forget helper for hot paths where awaiting the write adds no value. */
export function recordSecurityEvent(input: SecurityEventInput): void {
  void logSecurityEvent(input);
}
