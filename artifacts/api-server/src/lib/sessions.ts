import crypto from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, ne, isNull, gt, lt, inArray, sql } from "drizzle-orm";
import { db, sessionsTable, usersTable, type Session } from "@workspace/db";
import { authConfig } from "./auth-config";
import { generateToken, hashToken } from "./tokens";
import { clientIp, userAgent } from "./security-log";
import { isTopAdminRole } from "./rbac";
import { closeSockets } from "./ws-broadcast";

/**
 * Server-side session lifecycle.
 *
 * The cookie holds an opaque 256-bit token; the database holds its SHA-256.
 * A DB read therefore cannot be replayed into a live session, and revocation
 * ("sign out everywhere", suspend a user, reset a password) is a single UPDATE.
 */

const { cookieName, csrfCookieName } = authConfig.session;

export interface CreatedSession {
  session: Session;
  /** Raw cookie value — set it on the response, never persist or log it. */
  rawToken: string;
  csrfToken: string;
}

/** This user already has as many live sessions as they are allowed. */
export class SessionLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Session limit of ${limit} reached`);
  }
}

/**
 * Create a session unless the user is at their limit of simultaneous logins.
 *
 * The user row is locked so two logins arriving together cannot both pass the
 * count. Super Admins and Company Admins are exempt: a limit could lock the only
 * person able to fix it out of the platform.
 *
 * A browser closed without signing out still counts until its session reaches
 * the idle timeout. An administrator can end it sooner from the Security Center.
 */
export async function createSessionWithinLimit(
  user: { id: string; role: string; maxSessions: number },
  req: Request,
  opts: { rememberMe?: boolean } = {},
): Promise<CreatedSession> {
  return db.transaction(async (tx) => {
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, user.id)).for("update");

    if (!isTopAdminRole(user.role)) {
      const now = new Date();
      const [{ live }] = await tx
        .select({ live: sql<number>`count(*)::int` })
        .from(sessionsTable)
        .where(and(
          eq(sessionsTable.userId, user.id),
          isNull(sessionsTable.revokedAt),
          gt(sessionsTable.expiresAt, now),
          gt(sessionsTable.absoluteExpiresAt, now),
        ));
      if (live >= user.maxSessions) throw new SessionLimitError(user.maxSessions);
    }

    return createSession(user.id, req, opts, tx);
  });
}

export async function createSession(
  userId: string,
  req: Request,
  opts: { rememberMe?: boolean } = {},
  executor: Pick<typeof db, "insert"> = db,
): Promise<CreatedSession> {
  const rawToken = generateToken();
  const csrfToken = generateToken();
  const now = Date.now();

  // "Remember me" extends the absolute ceiling, not the idle timeout — an
  // unattended browser still locks out after the idle window.
  const absoluteTtl = opts.rememberMe
    ? authConfig.session.rememberMeTtlMs
    : authConfig.session.absoluteTtlMs;
  const absoluteExpiresAt = new Date(now + absoluteTtl);
  const expiresAt = new Date(Math.min(now + authConfig.session.idleTtlMs, absoluteExpiresAt.getTime()));

  const [session] = await executor.insert(sessionsTable).values({
    userId,
    tokenHash: hashToken(rawToken),
    csrfToken,
    ip: clientIp(req),
    userAgent: userAgent(req),
    expiresAt,
    absoluteExpiresAt,
  }).returning();

  return { session, rawToken, csrfToken };
}

export type SessionLookup =
  | { ok: true; session: Session }
  | { ok: false; reason: "no_session" | "session_invalid" | "session_expired" | "session_revoked" };

export async function lookupSession(rawToken: string | undefined): Promise<SessionLookup> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 128) {
    return { ok: false, reason: "no_session" };
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.tokenHash, hashToken(rawToken)));

  if (!session) return { ok: false, reason: "session_invalid" };
  if (session.revokedAt) return { ok: false, reason: "session_revoked" };

  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
    return { ok: false, reason: "session_expired" };
  }

  return { ok: true, session };
}

/**
 * Slide the idle window forward, capped by the absolute ceiling.
 *
 * Throttled to one write per minute per session: without this, every request
 * on a busy dashboard would issue an UPDATE, and the row would become a
 * write-contention hotspot for no security benefit.
 */
export async function touchSession(session: Session): Promise<Session> {
  const now = Date.now();
  if (now - session.lastSeenAt.getTime() < 60_000) return session;

  const expiresAt = new Date(Math.min(now + authConfig.session.idleTtlMs, session.absoluteExpiresAt.getTime()));
  const [updated] = await db
    .update(sessionsTable)
    .set({ lastSeenAt: new Date(now), expiresAt })
    .where(eq(sessionsTable.id, session.id))
    .returning();

  return updated ?? session;
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.revokedAt)));
  closeSockets({ sessionId }, reason);
}

/**
 * Revoke every live session for a user. Called on password reset/change, admin
 * revocation, and any status change that should end access immediately.
 */
export async function revokeAllUserSessions(
  userId: string,
  reason: string,
  opts: { exceptSessionId?: string } = {},
): Promise<number> {
  // The exclusion is part of the WHERE clause, not a revoke-then-restore.
  // Restoring afterwards would leave the caller's own session briefly invalid,
  // which can 401 a request they have in flight while changing their password.
  const revoked = await db
    .update(sessionsTable)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(
      eq(sessionsTable.userId, userId),
      isNull(sessionsTable.revokedAt),
      ...(opts.exceptSessionId ? [ne(sessionsTable.id, opts.exceptSessionId)] : []),
    ))
    .returning({ id: sessionsTable.id });

  // Live connections opened with those sessions end now too.
  closeSockets({ userId, exceptSessionId: opts.exceptSessionId }, reason);
  return revoked.length;
}

export async function listActiveSessions(userIds?: string[]) {
  const live = and(
    isNull(sessionsTable.revokedAt),
    gt(sessionsTable.expiresAt, new Date()),
  );
  return db
    .select({
      id: sessionsTable.id,
      userId: sessionsTable.userId,
      username: usersTable.username,
      fullName: usersTable.fullName,
      ip: sessionsTable.ip,
      userAgent: sessionsTable.userAgent,
      createdAt: sessionsTable.createdAt,
      lastSeenAt: sessionsTable.lastSeenAt,
      expiresAt: sessionsTable.expiresAt,
    })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(userIds?.length ? and(live, inArray(sessionsTable.userId, userIds)) : live)
    .orderBy(sessionsTable.lastSeenAt);
}

/**
 * Housekeeping — drop rows that can never authenticate again.
 * Kept for 7 days past their absolute expiry so recent sessions stay visible
 * in the Security Center for incident review.
 */
export async function pruneExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const deleted = await db
    .delete(sessionsTable)
    .where(lt(sessionsTable.absoluteExpiresAt, cutoff))
    .returning({ id: sessionsTable.id });
  return deleted.length;
}

// ── Cookies ──────────────────────────────────────────────────────────────────

/**
 * Cookie options for the session and CSRF cookies.
 *
 * Only a "Remember me" sign-in gets a `maxAge`. Without one the browser treats
 * the cookie as a session cookie and drops it when it closes, so a shared or
 * kiosk computer does not hand the next person a signed-in tab. Before this
 * every sign-in carried the full 12-hour lifetime on disk. The server-side
 * idle and absolute expiry apply either way.
 *
 * The cookie keeps its `is_session` name. A `__Host-` prefix would be better in
 * production, but renaming the cookie would sign every user out at deploy, and
 * the WebSocket handshake and the SPA read the current names.
 */
export function sessionCookieOptions(persistent: boolean, maxAgeMs: number) {
  return {
    path: "/",
    sameSite: authConfig.session.sameSite,
    secure: authConfig.session.secure,
    ...(persistent ? { maxAge: Math.max(0, maxAgeMs) } : {}),
  } as const;
}

export function setSessionCookies(
  res: Response,
  created: CreatedSession,
  opts: { rememberMe?: boolean } = {},
): void {
  const maxAge = created.session.absoluteExpiresAt.getTime() - Date.now();
  const base = sessionCookieOptions(opts.rememberMe === true, maxAge);

  // Session token: HttpOnly, so XSS cannot exfiltrate it.
  res.cookie(cookieName, created.rawToken, { ...base, httpOnly: true });

  // CSRF token: deliberately readable by JS — the SPA must echo it back in the
  // X-CSRF-Token header. That is the whole point of the double-submit pattern:
  // a cross-site attacker can cause the cookie to be *sent* but cannot *read*
  // it to construct the matching header.
  res.cookie(csrfCookieName, created.csrfToken, { ...base, httpOnly: false });
}

export function clearSessionCookies(res: Response): void {
  const opts = { path: "/", sameSite: authConfig.session.sameSite, secure: authConfig.session.secure } as const;
  res.clearCookie(cookieName, { ...opts, httpOnly: true });
  res.clearCookie(csrfCookieName, { ...opts, httpOnly: false });
}

export function readSessionCookie(req: Request): string | undefined {
  return (req as Request & { cookies?: Record<string, string> }).cookies?.[cookieName];
}

export function readCsrfCookie(req: Request): string | undefined {
  return (req as Request & { cookies?: Record<string, string> }).cookies?.[csrfCookieName];
}

/** Constant-time string compare that tolerates length mismatch. */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
