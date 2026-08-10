import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { SecurityEventsQuery } from "../schemas/common";
import { and, count, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, securityEventsTable, sessionsTable, usersTable, LOGIN_EVENT_TYPES } from "@workspace/db";
import { rbacCatalog } from "../lib/rbac";
import { listActiveSessions, revokeSession, revokeAllUserSessions } from "../lib/sessions";
import { recordSecurityEvent } from "../lib/security-log";
import { logActivity } from "./activity_log";
import { getPasswordPolicy } from "../lib/password";
import { authConfig } from "../lib/auth-config";

/**
 * Security Center API — the read side of the audit story, plus session control.
 *
 * Guarded as a whole by the `manage_security` permission (see ROUTE_RULES),
 * except the RBAC catalogue, which any authenticated user may read because the
 * SPA needs it to render its own permission-aware UI.
 */
const router: IRouter = Router();

// ── RBAC catalogue ───────────────────────────────────────────────────────────

/**
 * Single source of truth for roles, verbs, and the module matrix. The SPA reads
 * this instead of keeping its own copy, which is what stopped the frontend and
 * backend permission models drifting apart.
 */
router.get("/security/rbac-catalog", (_req, res): void => {
  res.json({ ...rbacCatalog(), passwordPolicy: getPasswordPolicy() });
});

// ── Security event stream ────────────────────────────────────────────────────

function parseWindow(value: unknown): Date | undefined {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return undefined;
  return new Date(Date.now() - Math.min(days, 365) * 86_400_000);
}

async function queryEvents(req: Request, restrictTo?: readonly string[]) {
  // Every field below is already type-checked, bounded and range-checked by
  // `validate({ query: SecurityEventsQuery })` on the routes, so the repeated
  // `typeof x === "string"` guards that used to be here are gone: an absent
  // field is `undefined` and anything present is known-good.
  const q = req.query as z.infer<typeof SecurityEventsQuery>;
  const { limit = 100, offset = 0 } = q;

  const typeFilter = q.eventType ? [q.eventType] : restrictTo;
  const since = q.days ? new Date(Date.now() - q.days * 86_400_000) : undefined;

  const conditions = [
    ...(typeFilter ? [inArray(securityEventsTable.eventType, [...typeFilter])] : []),
    ...(q.outcome  ? [eq(securityEventsTable.outcome, q.outcome)]   : []),
    ...(q.userId   ? [eq(securityEventsTable.userId, q.userId)]     : []),
    ...(q.username ? [eq(securityEventsTable.username, q.username)] : []),
    ...(since ? [gte(securityEventsTable.createdAt, since)] : []),
  ];
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [entries, [{ total }]] = await Promise.all([
    db.select().from(securityEventsTable).where(where)
      .orderBy(desc(securityEventsTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(securityEventsTable).where(where),
  ]);

  return { entries, total, limit, offset };
}

router.get("/security/events", validate({ query: SecurityEventsQuery }), async (req, res): Promise<void> => {
  res.json(await queryEvents(req));
});

/**
 * Login history is the same table filtered to the authentication event types —
 * see the schema comment on security_events for why these are not two tables.
 */
router.get("/security/login-history", validate({ query: SecurityEventsQuery }), async (req, res): Promise<void> => {
  res.json(await queryEvents(req, LOGIN_EVENT_TYPES));
});

/** Headline counters for the Security Center dashboard. */
router.get("/security/summary", async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 24 * 3_600_000);

  const [byType, [{ activeSessions }], [{ lockedAccounts }], [{ pendingInvitations }]] = await Promise.all([
    db.select({
      eventType: securityEventsTable.eventType,
      outcome: securityEventsTable.outcome,
      total: count(),
    })
      .from(securityEventsTable)
      .where(gte(securityEventsTable.createdAt, since))
      .groupBy(securityEventsTable.eventType, securityEventsTable.outcome),
    db.select({ activeSessions: sql<number>`count(*)::int` })
      .from(sessionsTable)
      .where(and(isNull(sessionsTable.revokedAt), gt(sessionsTable.expiresAt, new Date()))),
    db.select({ lockedAccounts: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(sql`${usersTable.lockedUntil} IS NOT NULL AND ${usersTable.lockedUntil} > now()`),
    db.select({ pendingInvitations: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(eq(usersTable.status, "invited")),
  ]);

  const tally = (type: string, outcome?: string) =>
    byType.filter((r) => r.eventType === type && (!outcome || r.outcome === outcome))
      .reduce((sum, r) => sum + Number(r.total), 0);

  res.json({
    windowHours: 24,
    loginSuccess: tally("login.success"),
    loginFailure: tally("login.failure"),
    loginBlocked: tally("login.blocked") + tally("login.rate_limited"),
    authzDenied: tally("authz.denied"),
    activeSessions,
    lockedAccounts,
    pendingInvitations,
    byType,
    config: {
      // Surfaced so an admin can confirm the deployed policy without shell access.
      lockoutThreshold: authConfig.lockout.threshold,
      lockoutMinutes: Math.round(authConfig.lockout.durationMs / 60_000),
      sessionIdleMinutes: Math.round(authConfig.session.idleTtlMs / 60_000),
      sessionAbsoluteHours: Math.round(authConfig.session.absoluteTtlMs / 3_600_000),
      activationTtlHours: Math.round(authConfig.tokens.activationTtlMs / 3_600_000),
      passwordResetTtlMinutes: Math.round(authConfig.tokens.passwordResetTtlMs / 60_000),
      emailTransport: authConfig.email.transport,
      enforcementEnabled: authConfig.enforce,
    },
  });
});

// ── Sessions ─────────────────────────────────────────────────────────────────

router.get("/security/sessions", async (req, res): Promise<void> => {
  const userId = typeof req.query.userId === "string" ? [req.query.userId] : undefined;
  const sessions = await listActiveSessions(userId);
  res.json(sessions.map((s) => ({
    ...s,
    isCurrent: s.id === req.principal?.session.id,
  })));
});

router.delete("/security/sessions/:id", async (req, res): Promise<void> => {
  await revokeSession(req.params.id, "admin_revoked");
  recordSecurityEvent({
    type: "session.revoked", outcome: "failure",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    reason: "admin_revoked", detail: { sessionId: req.params.id }, req,
  });
  void logActivity("session.revoked", "security", req.params.id, null, "revoked by administrator", req);
  res.sendStatus(204);
});

/** "Sign out everywhere" for one user. */
router.delete("/security/users/:id/sessions", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const revoked = await revokeAllUserSessions(user.id, "admin_revoked");
  recordSecurityEvent({
    type: "session.revoked", outcome: "failure", userId: user.id, username: user.username,
    reason: "admin_revoked_all", detail: { count: revoked, by: req.principal?.user.username }, req,
  });
  void logActivity("session.revoked_all", "security", user.id, user.fullName, `${revoked} session(s)`, req);

  res.json({ ok: true, revoked });
});

export default router;
