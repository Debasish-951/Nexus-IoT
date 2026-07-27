import type { Request } from "express";
import { db, securityEventsTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcast } from "./ws-broadcast";

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
  | "authz.denied" | "csrf.failed" | "email.failed" | "access.updated";

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
 * `x-forwarded-for` is spoofable unless Express is behind a trusted proxy with
 * `trust proxy` set (app.ts does this in production). Treated as best-effort
 * forensic context, never as an authorisation input.
 */
export function clientIp(req?: Request): string | null {
  if (!req) return null;
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof first === "string" && first.trim()) return first.split(",")[0].trim().slice(0, 64);
  return (req.ip ?? req.socket?.remoteAddress ?? null)?.slice(0, 64) ?? null;
}

export function userAgent(req?: Request): string | null {
  const ua = req?.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 512) : null;
}

export async function logSecurityEvent(input: SecurityEventInput): Promise<void> {
  const outcome = input.outcome ?? (input.type.endsWith(".failure") || input.type.endsWith(".denied") ? "failure" : "success");

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

    if (row) {
      // Live-tail in the Security Center, same channel the Activity Log uses.
      broadcast("security_event", { ...row, createdAt: row.createdAt.toISOString() });
    }
  } catch (err) {
    logger.error({ err, securityEvent: input.type }, "failed to persist security event");
  }
}

/** Fire-and-forget helper for hot paths where awaiting the write adds no value. */
export function recordSecurityEvent(input: SecurityEventInput): void {
  void logSecurityEvent(input);
}
