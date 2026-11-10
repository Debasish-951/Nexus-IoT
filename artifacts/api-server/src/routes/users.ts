import { Router, type IRouter, type Request, type Response } from "express";
import { respondInvalid } from "../lib/respond";
import { eq, sql, and, isNull, gt, desc } from "drizzle-orm";
import { db, usersTable, authTokensTable, type User } from "@workspace/db";
import {
  CreateUserBody,
  UpdateUserBody,
  GetUserParams,
  UpdateUserParams,
  DeleteUserParams,
} from "@workspace/api-zod";
import { logActivity } from "./activity_log";
import { isTopAdminRole,
  isRole, resolveAccess, sanitiseAccessOverrides, ROLES,
  canActOnRole, canGrantRole, SELF_ROLE_CHANGE_MESSAGE,
} from "../lib/rbac";
import { getPasswordPolicy, generateTemporaryPassword, hashPassword } from "../lib/password";
import { issueAuthToken, revokeAuthTokens, buildActivationUrl, buildResetUrl } from "../lib/tokens";
import { revokeAllUserSessions } from "../lib/sessions";
import { logSecurityEvent, recordSecurityEvent, clientIp } from "../lib/security-log";
import { closeSockets } from "../lib/ws-broadcast";
import { activateIfInvited } from "./auth";
import {
  sendEmail, renderActivationEmail, renderPasswordResetEmail,
} from "../lib/email";

const router: IRouter = Router();

/**
 * Never let a hash, an MFA secret, or a token leave the API — even to an admin.
 * Adds the onboarding/lockout fields the Users console now displays.
 */
function sanitizeUser(user: User) {
  const { passwordHash: _pw, mfaSecret: _mfa, ...safe } = user;
  return {
    ...safe,
    /** Derived, not stored: an invited user with no live token is stuck. */
    isLocked: !!(user.lockedUntil && user.lockedUntil.getTime() > Date.now()),
    hasPassword: !!user.passwordHash,
  };
}

/** Which invited users still have a usable activation link. */
async function pendingInvitationMap(userIds: string[]): Promise<Map<string, Date>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: authTokensTable.userId, expiresAt: authTokensTable.expiresAt })
    .from(authTokensTable)
    .where(and(
      eq(authTokensTable.type, "activation"),
      isNull(authTokensTable.consumedAt),
      isNull(authTokensTable.revokedAt),
      gt(authTokensTable.expiresAt, new Date()),
    ))
    .orderBy(desc(authTokensTable.expiresAt));
  return new Map(rows.map((r) => [r.userId, r.expiresAt]));
}


/**
 * Object-level guard for user administration.
 *
 * `manage_users` says the caller may use this console at all. It says nothing
 * about WHICH users, and that is the gap this closes: without it a customer
 * admin could edit, promote or delete an admin, or mint a new super admin.
 *
 * Returns true when the request has been answered and the caller must stop.
 */
export function refuseIfOutranked(req: Request, res: Response, target: Pick<User, "id" | "role">): boolean {
  const actorRole = req.principal?.user.role;
  if (canActOnRole(actorRole, target.role)) return false;

  // Deliberately the same 403 whether the target outranks the caller or does not
  // exist at their level — enumerating who the admins are is itself useful to an
  // attacker. The real reason is recorded in the security log.
  recordSecurityEvent({
    type: "authz.denied",
    outcome: "failure",
    reason: "outranked_target",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    detail: { targetUserId: target.id, targetRole: target.role, actorRole },
    req,
  });
  res.status(403).json({
    error: "You do not have permission to manage this account.",
    code: "insufficient_rank",
  });
  return true;
}

/** Did a PUT change the address? Compared case-insensitively, as login does. */
export function emailChanged(before: string | null | undefined, next: unknown): boolean {
  if (typeof next !== "string") return false;
  return next.trim().toLowerCase() !== (before ?? "").trim().toLowerCase();
}

function actorId(req: Request): string | null {
  return req.principal?.user.id ?? null;
}

/** Guard against an admin locking the platform out of itself. */
async function isLastActiveAdmin(userId: string): Promise<boolean> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(and(
      sql`${usersTable.role} IN ('admin','company_admin','super_admin')`,
      eq(usersTable.status, "active"),
      sql`${usersTable.id} <> ${userId}`,
    ));
  return count === 0;
}

// ── List / read ──────────────────────────────────────────────────────────────

router.get("/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.fullName);
  const pending = await pendingInvitationMap(users.map((u) => u.id));

  res.json(users.map((u) => ({
    ...sanitizeUser(u),
    invitationExpiresAt: pending.get(u.id)?.toISOString() ?? null,
    invitationExpired: u.status === "invited" && !pending.has(u.id),
  })));
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  res.json(sanitizeUser(user));
});

// ── Create — the invitation step of the onboarding workflow ──────────────────

/**
 * Step 3 of the onboarding workflow: an administrator, having approved an
 * out-of-band access request, provisions the account.
 *
 * Changed from the previous implementation:
 *   - No `password` field. The admin never knows or chooses the user's
 *     password, so it cannot be shared over chat, reused, or left as a default.
 *     A `password` in the body is ignored rather than rejected, so an older
 *     client degrades into the invitation flow instead of breaking.
 *   - The account is created `invited`, with `password_hash` NULL. It cannot
 *     authenticate until the user completes activation.
 *   - Module/dashboard/analytics grants can be supplied at creation time and
 *     are stored on the row (previously they lived in the admin's localStorage).
 */
router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }

  const username = parsed.data.username.trim();
  const email = parsed.data.email.trim().toLowerCase();
  const fullName = parsed.data.fullName.trim();
  const role = parsed.data.role;

  if (!isRole(role)) {
    res.status(400).json({ error: `Unknown role "${role}"`, code: "invalid_role", allowed: ROLES });
    return;
  }
  // Without this, `manage_users` was enough to create a super admin — the role
  // list was checked for EXISTENCE and never for whether the caller may hand it
  // out. An admin could bootstrap themselves a platform-wide account.
  if (!canGrantRole(req.principal?.user.role, role)) {
    recordSecurityEvent({
      type: "authz.denied", outcome: "failure", reason: "role_escalation_attempt",
      userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null,
      detail: { attemptedRole: role, actorRole: req.principal?.user.role }, req,
    });
    res.status(403).json({
      error: "You cannot create a user with a role equal to or above your own.",
      code: "role_above_actor",
    });
    return;
  }
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
    res.status(400).json({
      error: "Username must be 3–64 characters and contain only letters, numbers, dot, underscore, or hyphen",
      code: "invalid_username",
    });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    res.status(400).json({ error: "A valid email address is required", code: "invalid_email" });
    return;
  }

  // Explicit conflict checks so the admin gets a field-specific message rather
  // than a raw unique-constraint error.
  const [clash] = await db
    .select({ username: usersTable.username, email: usersTable.email })
    .from(usersTable)
    .where(sql`${usersTable.username} = ${username} OR lower(${usersTable.email}) = ${email}`);
  if (clash) {
    const field = clash.username === username ? "username" : "email";
    res.status(409).json({ error: `That ${field} is already registered`, code: `${field}_taken`, field });
    return;
  }

  const accessOverrides = sanitiseAccessOverrides((req.body as Record<string, unknown>).accessOverrides);

  const [user] = await db.insert(usersTable).values({
    username,
    email,
    fullName,
    role,
    status: "invited",
    passwordHash: null,
    invitedAt: new Date(),
    invitedBy: actorId(req),
    accessOverrides,
  }).returning();

  const issued = await issueAuthToken(user.id, "activation", {
    createdBy: actorId(req),
    createdIp: clientIp(req),
  });

  await logSecurityEvent({
    type: "user.invited", userId: user.id, username: user.username,
    detail: { role, invitedBy: req.principal?.user.username ?? "system", expiresAt: issued.expiresAt.toISOString() },
    req,
  });
  void logActivity("user.invited", "user", user.id, user.fullName, `role=${user.role}`, req);

  // Mail failure must not fail provisioning — the admin can resend.
  const emailed = await sendEmail(user.email, renderActivationEmail({
    fullName: user.fullName,
    url: buildActivationUrl(issued.raw),
    expiresAt: issued.expiresAt,
    invitedBy: req.principal?.user.fullName ?? null,
    role: user.role,
    policy: getPasswordPolicy().description,
  }), { userId: user.id, username: user.username, purpose: "activation" });

  res.status(201).json({
    ...sanitizeUser(user),
    invitationExpiresAt: issued.expiresAt.toISOString(),
    invitationEmailSent: emailed,
  });
});

// ── Update ───────────────────────────────────────────────────────────────────

router.put("/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, existing)) return;

  const updateData: Record<string, unknown> = {};
  if (parsed.data.email !== undefined) updateData.email = parsed.data.email.trim().toLowerCase();
  if (parsed.data.fullName !== undefined) updateData.fullName = parsed.data.fullName.trim();

  if (parsed.data.role !== undefined) {
    if (!isRole(parsed.data.role)) {
      res.status(400).json({ error: `Unknown role "${parsed.data.role}"`, code: "invalid_role", allowed: ROLES });
      return;
    }
    // Self-promotion. Rank alone never catches this: the comparison is against
    // the role you already hold, so it always succeeds against yourself.
    if (existing.id === req.principal?.user.id && parsed.data.role !== existing.role) {
      res.status(403).json({ error: SELF_ROLE_CHANGE_MESSAGE, code: "self_role_change" });
      return;
    }
    if (!canGrantRole(req.principal?.user.role, parsed.data.role)) {
      recordSecurityEvent({
        type: "authz.denied", outcome: "failure", reason: "role_escalation_attempt",
        userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null,
        detail: { targetUserId: existing.id, attemptedRole: parsed.data.role, actorRole: req.principal?.user.role }, req,
      });
      res.status(403).json({
        error: "You cannot assign a role equal to or above your own.",
        code: "role_above_actor",
      });
      return;
    }
    // Demoting the last admin would leave nobody able to manage users.
    const losingAdmin = ["admin", "company_admin", "super_admin"].includes(existing.role)
      && !["admin", "company_admin", "super_admin"].includes(parsed.data.role);
    if (losingAdmin && await isLastActiveAdmin(existing.id)) {
      res.status(409).json({
        error: "This is the last active administrator. Promote another user first.",
        code: "last_admin",
      });
      return;
    }
    updateData.role = parsed.data.role;
  }

  if (parsed.data.status !== undefined) {
    const next = parsed.data.status;
    if (!["invited", "active", "suspended", "inactive"].includes(next)) {
      res.status(400).json({ error: `Unknown status "${next}"`, code: "invalid_status" });
      return;
    }
    // Activating from the console is not a way around the activation flow:
    // an account with no password stays `invited` until the user sets one.
    if (next === "active" && !existing.passwordHash) {
      res.status(409).json({
        error: "This user has not activated their account yet. Resend the invitation instead.",
        code: "activation_pending",
      });
      return;
    }
    if (next !== "active" && ["admin", "company_admin", "super_admin"].includes(existing.role) && await isLastActiveAdmin(existing.id)) {
      res.status(409).json({
        error: "This is the last active administrator. Promote another user first.",
        code: "last_admin",
      });
      return;
    }
    updateData.status = next;
  }

  if ((req.body as Record<string, unknown>).accessOverrides !== undefined) {
    updateData.accessOverrides = sanitiseAccessOverrides((req.body as Record<string, unknown>).accessOverrides);
  }

  const [user] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, params.data.id)).returning();

  // A reset or activation link already mailed to the OLD address must stop
  // working: the address was changed because it is wrong, or no longer the
  // user's, and whoever reads that mailbox could otherwise still set the password.
  if (emailChanged(existing.email, updateData.email)) {
    await revokeAuthTokens(user.id, "password_reset");
    await revokeAuthTokens(user.id, "activation");
    recordSecurityEvent({
      type: "account.status_changed", userId: user.id, username: user.username,
      reason: "email_changed",
      detail: { by: req.principal?.user.username, linksRevoked: true }, req,
    });
  }

  // A status change that removes access must take effect immediately, not at
  // the end of the target's current session.
  if (updateData.status && updateData.status !== "active") {
    const revoked = await revokeAllUserSessions(user.id, "status_changed");
    recordSecurityEvent({
      type: "account.status_changed", userId: user.id, username: user.username,
      outcome: "failure", reason: `set_${updateData.status}`,
      detail: { by: req.principal?.user.username, sessionsRevoked: revoked }, req,
    });
  } else if (updateData.status || updateData.role) {
    recordSecurityEvent({
      type: "account.status_changed", userId: user.id, username: user.username,
      reason: updateData.role ? "role_changed" : `set_${updateData.status}`,
      detail: { by: req.principal?.user.username, role: user.role, status: user.status }, req,
    });
  }

  // The same audit row PUT /users/:id/access writes. Overrides arriving through
  // this route (the Users form sends them) were applied with only an Activity Log
  // entry, so a grant made here never reached the Security Center.
  if (updateData.accessOverrides) {
    recordSecurityEvent({
      type: "access.updated", userId: user.id, username: user.username,
      detail: { by: req.principal?.user.username, overrides: updateData.accessOverrides, via: "PUT /users/:id" }, req,
    });
  }

  // A new role or access setting applies to live connections at once: they are
  // closed, and the client reconnects with the new access.
  if (updateData.role || updateData.accessOverrides) closeSockets({ userId: user.id }, "access_changed");

  const changed = Object.keys(updateData).join(",");
  void logActivity("user.updated", "user", user.id, user.fullName, `fields=${changed}`, req);

  res.json(sanitizeUser(user));
});

// ── Access overrides (replaces localStorage["iot_access_v3"]) ────────────────

router.get("/users/:id/access", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  res.json({
    userId: user.id,
    role: user.role,
    overrides: user.accessOverrides ?? {},
    /** Role defaults + overrides, i.e. what the API will actually enforce. */
    effective: resolveAccess(user.role, user.accessOverrides),
  });
});

router.put("/users/:id/access", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, user)) return;

  // Overrides can GRANT as well as remove — `resolveAccess` replaces the role
  // default rather than intersecting with it. Editing your own overrides was
  // therefore a way to award yourself permissions your role does not carry,
  // which is the same escalation as changing your role, one level down.
  if (user.id === req.principal?.user.id) {
    res.status(403).json({
      error: "You cannot change your own permissions. Ask another administrator to make this change.",
      code: "self_access_change",
    });
    return;
  }

  const overrides = sanitiseAccessOverrides((req.body as Record<string, unknown>)?.overrides ?? req.body);

  // Removing your own manage_users grant would leave the console unreachable.
  if (user.id === req.principal?.user.id) {
    const next = resolveAccess(user.role, overrides);
    if (!next.permissions.includes("manage_users") || next.modules.users === false) {
      res.status(409).json({
        error: "You cannot remove your own access to User Management.",
        code: "self_lockout",
      });
      return;
    }
  }

  const [updated] = await db
    .update(usersTable)
    .set({ accessOverrides: overrides })
    .where(eq(usersTable.id, user.id))
    .returning();

  recordSecurityEvent({
    type: "access.updated", userId: user.id, username: user.username,
    detail: { by: req.principal?.user.username, overrides }, req,
  });
  closeSockets({ userId: user.id }, "access_changed");
  void logActivity("user.access_updated", "user", user.id, user.fullName,
    `modules=${Object.keys(overrides.modules ?? {}).length} overridden`, req);

  res.json({
    userId: updated.id,
    overrides: updated.accessOverrides,
    effective: resolveAccess(updated.role, updated.accessOverrides),
  });
});

// ── Invitation / credential admin actions ────────────────────────────────────

router.post("/users/:id/resend-invitation", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, user)) return;
  if (user.status !== "invited") {
    res.status(409).json({
      error: "This account is already activated. Send a password reset instead.",
      code: "already_activated",
    });
    return;
  }

  // issueAuthToken revokes the previous token, so a forwarded old link dies here.
  const issued = await issueAuthToken(user.id, "activation", {
    createdBy: actorId(req),
    createdIp: clientIp(req),
  });

  const emailed = await sendEmail(user.email, renderActivationEmail({
    fullName: user.fullName,
    url: buildActivationUrl(issued.raw),
    expiresAt: issued.expiresAt,
    invitedBy: req.principal?.user.fullName ?? null,
    role: user.role,
    policy: getPasswordPolicy().description,
  }), { userId: user.id, username: user.username, purpose: "activation_resend" });

  await logSecurityEvent({
    type: "invitation.resent", userId: user.id, username: user.username,
    detail: { by: req.principal?.user.username, expiresAt: issued.expiresAt.toISOString() }, req,
  });
  void logActivity("user.invitation_resent", "user", user.id, user.fullName, null, req);

  res.json({ ok: true, invitationExpiresAt: issued.expiresAt.toISOString(), emailSent: emailed });
});

router.post("/users/:id/revoke-invitation", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, user)) return;

  await revokeAuthTokens(user.id, "activation");
  recordSecurityEvent({
    type: "invitation.resent", outcome: "failure", userId: user.id, username: user.username,
    reason: "revoked", detail: { by: req.principal?.user.username }, req,
  });
  void logActivity("user.invitation_revoked", "user", user.id, user.fullName, null, req);

  res.json({ ok: true });
});

/**
 * Admin-triggered password reset.
 *
 * Deliberately email-mediated: the administrator starts the reset but never
 * sees or sets the resulting password, so there is no window in which a second
 * person knows a live credential.
 */
router.post("/users/:id/send-password-reset", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, user)) return;
  if (user.status === "invited") {
    res.status(409).json({
      error: "This user has not activated their account. Resend the invitation instead.",
      code: "activation_pending",
    });
    return;
  }

  const issued = await issueAuthToken(user.id, "password_reset", {
    createdBy: actorId(req),
    createdIp: clientIp(req),
  });

  const emailed = await sendEmail(user.email, renderPasswordResetEmail({
    fullName: user.fullName,
    url: buildResetUrl(issued.raw),
    expiresAt: issued.expiresAt,
    policy: getPasswordPolicy().description,
    initiatedByAdmin: true,
  }), { userId: user.id, username: user.username, purpose: "password_reset_admin" });

  await logSecurityEvent({
    type: "password_reset.requested", userId: user.id, username: user.username,
    reason: "admin_initiated", detail: { by: req.principal?.user.username }, req,
  });
  void logActivity("user.password_reset_sent", "user", user.id, user.fullName, null, req);

  res.json({ ok: true, expiresAt: issued.expiresAt.toISOString(), emailSent: emailed });
});

/**
 * Issue a temporary password.
 *
 * The alternative to the activation/reset link, for when an administrator needs
 * to read a credential to someone directly. Weaker than a link — it is a
 * password, so it can be written down, forwarded, and reused — and therefore
 * deliberately constrained:
 *
 *   - short-lived (default 15 minutes, capped at 24 hours),
 *   - `mustChangePassword` is set, so the session it produces can reach nothing
 *     except /auth/change-password (enforced in middleware/authorize.ts),
 *   - every existing session for the user is revoked,
 *   - the cleartext is returned EXACTLY ONCE and never stored or logged.
 */
router.post("/users/:id/temporary-password", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, user)) return;

  const requested = Number((req.body as Record<string, unknown>)?.expiresInMinutes ?? 15);
  const minutes = Number.isFinite(requested)
    ? Math.min(Math.max(Math.round(requested), 1), 24 * 60)
    : 15;

  const temporary = generateTemporaryPassword();
  const expiresAt = new Date(Date.now() + minutes * 60_000);

  await db.update(usersTable).set({
    passwordHash: await hashPassword(temporary),
    passwordUpdatedAt: new Date(),
    mustChangePassword: true,
    passwordExpiresAt: expiresAt,
    // A temporary password also activates an invited account and clears any
    // lockout — it is a deliberate administrative reset of the credential.
    // Decided in SQL on the current row, not from `user`, which was read before
    // the scrypt and could write back a status changed in the meantime.
    ...activateIfInvited(),
    failedLoginAttempts: 0,
    lockedUntil: null,
  }).where(eq(usersTable.id, user.id));

  // Whatever the old credential was, it is gone — so are its sessions.
  const revoked = await revokeAllUserSessions(user.id, "temporary_password_issued");
  await revokeAuthTokens(user.id, "activation");
  await revokeAuthTokens(user.id, "password_reset");

  await logSecurityEvent({
    type: "password.changed", userId: user.id, username: user.username,
    reason: "temporary_password_issued",
    detail: {
      by: req.principal?.user.username,
      expiresAt: expiresAt.toISOString(),
      minutes,
      sessionsRevoked: revoked,
    },
    req,
  });
  void logActivity("user.temporary_password_issued", "user", user.id, user.fullName,
    `expires in ${minutes}m`, req);

  res.json({
    // Shown once in the admin's browser. Not persisted, not logged, not emailed.
    temporaryPassword: temporary,
    username: user.username,
    email: user.email,
    expiresAt: expiresAt.toISOString(),
    expiresInMinutes: minutes,
    mustChangePassword: true,
  });
});

router.post("/users/:id/unlock", async (req, res): Promise<void> => {
  // Rank is checked BEFORE the write, as in require-password-change.
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, target)) return;

  const [user] = await db
    .update(usersTable)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(usersTable.id, target.id))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  await logSecurityEvent({
    type: "account.unlocked", userId: user.id, username: user.username,
    detail: { by: req.principal?.user.username }, req,
  });
  void logActivity("user.unlocked", "user", user.id, user.fullName, null, req);

  res.json(sanitizeUser(user));
});

/** Simultaneous logins allowed for one user. Super Admin or Company Admin only. */
router.put("/users/:id/session-limit", async (req, res): Promise<void> => {
  if (!isTopAdminRole(req.principal?.user.role)) {
    recordSecurityEvent({
      type: "authz.denied", outcome: "failure", reason: "session_limit_not_top_admin",
      userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null,
      detail: { targetUserId: req.params.id }, req,
    });
    res.status(403).json({ error: "Only a Super Admin or Company Admin can change the login limit.", code: "top_admin_required" });
    return;
  }
  const limit = (req.body as { maxSessions?: unknown } | undefined)?.maxSessions;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    res.status(400).json({ error: "The login limit must be a whole number from 1 to 20.", code: "invalid_session_limit" });
    return;
  }
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, target)) return;

  const [user] = await db.update(usersTable).set({ maxSessions: limit }).where(eq(usersTable.id, target.id)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  await logSecurityEvent({
    type: "access.updated", userId: user.id, username: user.username,
    detail: { by: req.principal?.user.username, maxSessions: limit }, req,
  });
  void logActivity("user.session_limit_changed", "user", user.id, user.fullName, `limit=${limit}`, req);
  res.json(sanitizeUser(user));
});

/** Force a rotation at next login without disclosing or setting a password. */
router.post("/users/:id/require-password-change", async (req, res): Promise<void> => {
  // Rank is checked BEFORE the write. Checking afterwards answered 403 while the
  // change had already been saved, so a lower admin could lock out a Super Admin.
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, target)) return;

  const [user] = await db
    .update(usersTable)
    .set({ mustChangePassword: true })
    .where(eq(usersTable.id, target.id))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Forcing a change is usually the response to a suspected compromise. The flag
  // alone left every existing session alive, and a session in the forced-change
  // state may set a new password WITHOUT the current one (see
  // /auth/change-password): whoever held a stolen session could finish the
  // "rotation" themselves and keep the account. Every session is ended, so the
  // change happens after a fresh sign-in with the real password. The
  // administrator's own session survives if they flagged themselves.
  const revoked = await revokeAllUserSessions(user.id, "password_change_required", {
    exceptSessionId: user.id === req.principal?.user.id ? req.principal.session.id : undefined,
  });
  recordSecurityEvent({
    type: "session.revoked", userId: user.id, username: user.username,
    reason: "password_change_required",
    detail: { by: req.principal?.user.username, sessionsRevoked: revoked }, req,
  });

  void logActivity("user.password_change_required", "user", user.id, user.fullName, null, req);
  res.json(sanitizeUser(user));
});

// ── Delete ───────────────────────────────────────────────────────────────────

router.delete("/users/:id", async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  if (params.data.id === req.principal?.user.id) {
    res.status(409).json({ error: "You cannot delete your own account.", code: "self_delete" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (refuseIfOutranked(req, res, target)) return;

  if (["admin", "company_admin", "super_admin"].includes(target.role) && await isLastActiveAdmin(target.id)) {
    res.status(409).json({
      error: "This is the last active administrator. Promote another user first.",
      code: "last_admin",
    });
    return;
  }

  // Sessions and auth_tokens cascade on the FK; security_events deliberately
  // do not (user_id → NULL) so the forensic trail survives the deletion.
  const [user] = await db.delete(usersTable).where(eq(usersTable.id, params.data.id)).returning();

  recordSecurityEvent({
    type: "account.status_changed", userId: null, username: user.username,
    outcome: "failure", reason: "deleted",
    detail: { by: req.principal?.user.username, role: user.role }, req,
  });
  void logActivity("user.deleted", "user", user.id, user.fullName, `role=${user.role}`, req);

  res.sendStatus(204);
});

export default router;
