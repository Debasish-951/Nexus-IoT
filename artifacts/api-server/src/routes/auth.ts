import { Router, type IRouter, type Request, type Response } from "express";
import { eq, or, sql } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { authConfig } from "../lib/auth-config";
import {
  hashPassword, verifyPassword, dummyVerify, isLegacyHash, isPasswordExpired,
  validatePassword, getPasswordPolicy, legacyCredentialMatches,
} from "../lib/password";
import {
  issueAuthToken, consumeAuthToken, lookupAuthToken, revokeAuthTokens,
  buildActivationUrl, buildResetUrl,
} from "../lib/tokens";
import {
  createSessionWithinLimit, SessionLimitError, setSessionCookies, clearSessionCookies,
  revokeSession, revokeAllUserSessions,
} from "../lib/sessions";
import { resolveAccess } from "../lib/rbac";
import { recordSecurityEvent, logSecurityEvent, clientIp } from "../lib/security-log";
import {
  sendEmail, renderPasswordResetEmail, renderPasswordChangedEmail,
  renderAccountLockedEmail, renderActivationEmail,
} from "../lib/email";
import { rateLimit, resetLimiter, recordAuthFailure } from "../middleware/rateLimit";
import { logActivity } from "./activity_log";

const router: IRouter = Router();

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * The payload the SPA needs to render itself: identity plus the *effective*
 * permission set. Computed server-side so the browser copy of the RBAC matrix
 * can never disagree with the one the API enforces.
 */
export function sessionPayload(user: User, csrfToken: string) {
  const access = resolveAccess(user.role, user.accessOverrides);
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    /** Set only while an admin-issued temporary password is in force. */
    passwordExpiresAt: user.passwordExpiresAt?.toISOString() ?? null,
    mfaEnabled: user.mfaEnabled,
    lastLogin: user.lastLogin?.toISOString() ?? null,
    csrfToken,
    permissions: access.permissions,
    modules: access.modules,
    // The SPA needs this to apply the same precedence rule as `authorize`:
    // an explicit per-user module grant wins over the role verb.
    overriddenModules: access.overriddenModules,
    restrictProjects: access.restrictProjects,
    allowedProjects: access.allowedProjects,
    restrictDashboards: access.restrictDashboards,
    allowedDashboards: access.allowedDashboards,
    restrictAnalytics: access.restrictAnalytics,
    allowedAnalytics: access.allowedAnalytics,
    // Ceiling on the scopes this user may put on an API credential. The dialog
    // renders from this; the create route enforces it independently.
    apiScopes: access.apiScopes,
  };
}

/** Uniform 400 for a password that fails policy. */
function policyError(errors: string[]) {
  return {
    error: errors[0],
    code: "password_policy",
    violations: errors,
    policy: getPasswordPolicy(),
  };
}

/**
 * Column updates that activate an `invited` account and leave any other status
 * alone, evaluated by Postgres against the current row. Credential writes run a
 * ~64 MiB scrypt between reading the user and writing, so a status taken from
 * that earlier read can be stale and must never be written back.
 */
export function activateIfInvited() {
  return {
    status: sql<string>`CASE WHEN ${usersTable.status} = 'invited' THEN 'active' ELSE ${usersTable.status} END`,
    activatedAt: sql<Date>`COALESCE(${usersTable.activatedAt}, now())`,
  };
}

async function findUserByIdentifier(identifier: string): Promise<User | undefined> {
  const value = identifier.trim();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(or(
      eq(usersTable.username, value),
      // Email is matched case-insensitively; usernames stay exact, matching
      // the pre-existing behaviour of the unique index.
      sql`lower(${usersTable.email}) = lower(${value})`,
    ));
  return user;
}

// ── POST /auth/login ─────────────────────────────────────────────────────────

/**
 * Login is limited on four dimensions at once.
 *
 * `account` is the one that matters against a distributed attack. Per-IP limits
 * are defeated by renting more IPs — cheap, and the entire point of a botnet.
 * The target USERNAME cannot be rotated, because guessing a specific account's
 * password means sending that account's name every time. So an attacker with a
 * million addresses still gets `AUTH_RL_ACCOUNT_MAX` attempts per window against
 * any one account, and the durable database-backed lockout fires first.
 *
 * The counters are cleared on a successful sign-in (see resetLimiter below), so
 * a user who mistypes twice and then gets it right starts fresh.
 */
const loginLimiter = rateLimit({
  name: "auth:login",
  limits: {
    ip: authConfig.rateLimit.login,
    subnet: {
      max: authConfig.rateLimit.login.max * authConfig.rateLimit.subnetMultiplier,
      windowMs: authConfig.rateLimit.login.windowMs,
    },
    account: authConfig.rateLimit.account,
  },
  accountFrom: (req) => {
    const b = req.body as Record<string, unknown> | undefined;
    const v = b?.username ?? b?.identifier ?? b?.email;
    return typeof v === "string" ? v : null;
  },
  eventType: "login.rate_limited",
  message: "Too many sign-in attempts. Please wait and try again.",
});

/**
 * Login CSRF guard.
 *
 * The CSRF check covers signed-in writes only, and a sign-in has no session yet.
 * Without this, a page on any site could auto-submit a form to /auth/login and
 * sign the victim's browser into the ATTACKER's account. Whatever the victim
 * then entered (notes, uploads, settings) would land where the attacker can read it.
 *
 * Browsers send `Origin` on a cross-site POST. A request with neither `Origin`
 * nor `Referer` is a non-browser client (curl, a script, a test) and is let
 * through. A browser cannot be made to drop both headers on a cross-site form post.
 */
export function loginOriginAllowed(input: {
  origin?: string | null;
  referer?: string | null;
  host?: string | null;
  allowed: readonly string[];
}): boolean {
  const toOrigin = (value: string): string | null => {
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:" ? u.origin.toLowerCase() : null;
    } catch {
      return null;
    }
  };

  let source: string | null;
  if (input.origin) {
    // "null" is what sandboxed frames and some redirects send. It cannot be
    // matched to anything, so it is refused.
    source = input.origin === "null" ? null : toOrigin(input.origin);
  } else if (input.referer) {
    source = toOrigin(input.referer);
  } else {
    return true;
  }
  if (!source) return false;

  const allowed = new Set(input.allowed.map(toOrigin).filter((o): o is string => !!o));
  if (allowed.has(source)) return true;

  // Same host as the request itself: the SPA served by the same nginx. nginx's
  // `$host` drops the port, so the port is compared only when the Host has one.
  const host = (input.host ?? "").trim().toLowerCase();
  if (!host) return false;
  const src = new URL(source);
  return /:\d+$/.test(host) ? src.host === host : src.hostname === host;
}

function loginOriginGuard(req: Request, res: Response, next: () => void): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const referer = typeof req.headers.referer === "string" ? req.headers.referer : undefined;
  if (loginOriginAllowed({
    origin, referer, host: req.headers.host,
    allowed: [...authConfig.corsOrigins, authConfig.publicUrl],
  })) { next(); return; }

  recordSecurityEvent({
    type: "csrf.failed", outcome: "failure", reason: "login_cross_origin",
    detail: { origin: origin ?? null, referer: referer ? "present" : null }, req,
  });
  res.status(403).json({
    error: "Sign-in requests from this site are not accepted.",
    code: "origin_not_allowed",
  });
}

router.post("/auth/login", loginOriginGuard, loginLimiter, async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  // `username` is the historical field name; `identifier` and `email` are
  // accepted too so the field can be renamed in the UI without a break.
  const identifierRaw = body.username ?? body.identifier ?? body.email;
  const password = body.password;
  const rememberMe = body.rememberMe === true;

  if (typeof identifierRaw !== "string" || typeof password !== "string" || !identifierRaw.trim()) {
    res.status(400).json({ error: "Username/email and password are required", code: "invalid_request" });
    return;
  }
  const identifier = identifierRaw.trim();

  // One message for every credential failure — never disclose whether the
  // account exists (OWASP ASVS V2.2.1 / A07).
  const GENERIC = { error: "Invalid username or password", code: "invalid_credentials" };

  const user = await findUserByIdentifier(identifier);

  if (!user) {
    // Equalise timing against the "user exists, wrong password" branch.
    await dummyVerify();
    // Counted towards spray detection. Guesses at accounts that do not exist are
    // the strongest signal of all — a real user does not invent usernames, so a
    // burst of them is enumeration in progress.
    recordAuthFailure(req);
    await logSecurityEvent({ type: "login.failure", outcome: "failure", username: identifier, reason: "unknown_user", req });
    res.status(401).json(GENERIC);
    return;
  }

  // The password is checked BEFORE anything about the account is disclosed.
  // Lockout, suspension, a pending invitation and a pre-upgrade credential each
  // have their own message, and answering with them first told anyone who knew
  // a username what state that account was in. Until the password is proven,
  // every outcome is the same generic 401.
  const legacy = isLegacyHash(user.passwordHash);
  let valid: boolean;
  if (legacy) {
    // A cleartext value never authenticates. It is compared (in constant time,
    // after a full scrypt so the timing matches) only to decide whether this
    // caller may be told the account needs re-activating.
    await dummyVerify();
    valid = legacyCredentialMatches(password, user.passwordHash);
  } else if (!user.passwordHash) {
    // An invited account has no password yet. Without the scrypt it answered
    // measurably faster than an account with one.
    await dummyVerify();
    valid = false;
  } else {
    valid = await verifyPassword(password, user.passwordHash);
  }

  const locked = !!(user.lockedUntil && user.lockedUntil.getTime() > Date.now());

  if (!valid) {
    if (locked || user.status !== "active" || legacy) {
      // Counted towards spray detection and logged, but not towards the account's
      // lockout: a locked account is already locked (re-locking would re-send the
      // lockout email on every guess), and the others cannot sign in anyway.
      recordAuthFailure(req);
      await logSecurityEvent({
        type: "login.failure", outcome: "failure", userId: user.id, username: user.username,
        reason: locked ? "bad_password_while_locked" : legacy ? "bad_password_legacy" : `bad_password_status_${user.status}`,
        req,
      });
    } else {
      await registerFailedLogin(user, req);
    }
    res.status(401).json(GENERIC);
    return;
  }

  if (locked && user.lockedUntil) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    await logSecurityEvent({
      type: "login.blocked", outcome: "failure", userId: user.id, username: user.username,
      reason: "locked", detail: { lockedUntil: user.lockedUntil.toISOString() }, req,
    });
    res.status(423).json({
      error: `Account temporarily locked after repeated failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      code: "account_locked",
      retryAfterMinutes: minutes,
    });
    return;
  }

  if (user.status !== "active") {
    const detail = {
      invited: { code: "activation_pending", message: "Your account has not been activated yet. Check your email for the activation link, or ask your administrator to resend it." },
      suspended: { code: "account_suspended", message: "Your account has been suspended. Contact your administrator." },
      inactive: { code: "account_inactive", message: "Your account is inactive. Contact your administrator." },
    }[user.status] ?? { code: "account_inactive", message: "Your account is not active. Contact your administrator." };

    await logSecurityEvent({
      type: "login.blocked", outcome: "failure", userId: user.id, username: user.username,
      reason: `status_${user.status}`, req,
    });
    res.status(403).json({ error: detail.message, code: detail.code });
    return;
  }

  // A pre-upgrade cleartext value must never authenticate. Reaching here means
  // the caller typed that old password, so they get an actionable message
  // instead of a bare "invalid credentials".
  if (legacy) {
    await logSecurityEvent({
      type: "login.blocked", outcome: "failure", userId: user.id, username: user.username,
      reason: "legacy_credential", req,
    });
    res.status(403).json({
      error: "Your account must be re-activated before you can sign in. Use \"Forgot password?\" or ask your administrator to resend your invitation.",
      code: "credential_upgrade_required",
    });
    return;
  }

  // An admin-issued temporary password that has run out of time. Checked AFTER
  // verifying the password so a wrong guess cannot distinguish "expired" from
  // "wrong" — only someone who actually holds the credential learns it lapsed.
  if (isPasswordExpired(user.passwordExpiresAt)) {
    await logSecurityEvent({
      type: "login.blocked", outcome: "failure", userId: user.id, username: user.username,
      reason: "temporary_password_expired",
      detail: { expiredAt: user.passwordExpiresAt?.toISOString() }, req,
    });
    res.status(403).json({
      error: "This temporary password has expired. Ask your administrator to issue a new one, or use \"Forgot password?\".",
      code: "password_expired",
    });
    return;
  }

  // ── Success ────────────────────────────────────────────────────────────────
  //
  // Clear the rate-limit counters as well as the database failure count. What is
  // being limited is failed guessing; someone who mistypes twice and then signs
  // in correctly has demonstrated they hold the credential and should not spend
  // the rest of the window one attempt from a lockout.
  resetLimiter("auth:login", req, identifier);

  let created;
  try {
    created = await createSessionWithinLimit(user, req, { rememberMe });
  } catch (err) {
    if (!(err instanceof SessionLimitError)) throw err;
    recordSecurityEvent({
      type: "login.blocked", outcome: "failure", userId: user.id, username: user.username,
      reason: "session_limit_reached", detail: { limit: err.limit }, req,
    });
    res.status(403).json({
      error: `This account is already signed in on ${err.limit} device(s), the maximum allowed. Sign out on another device, or ask your administrator to raise the limit.`,
      code: "session_limit_reached",
    });
    return;
  }

  const [refreshed] = await db
    .update(usersTable)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLogin: new Date(),
      lastLoginIp: clientIp(req),
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  setSessionCookies(res, created, { rememberMe });

  recordSecurityEvent({
    type: "login.success", userId: user.id, username: user.username,
    detail: { sessionId: created.session.id, rememberMe }, req,
  });
  void logActivity("user.login", "user", user.id, user.fullName, `role=${user.role}`, req);

  res.json(sessionPayload(refreshed ?? user, created.csrfToken));
});

/**
 * Increment the failure counter and lock the account when it crosses the
 * threshold. The increment is done in SQL so concurrent attempts cannot race
 * each other into losing a count.
 */
async function registerFailedLogin(user: User, req: Request): Promise<void> {
  // Feeds the system-wide failure velocity that spray detection watches. A
  // distributed attack keeps every per-key counter under its ceiling by design;
  // the aggregate is the one thing it cannot hold down.
  recordAuthFailure(req);

  const { threshold, durationMs } = authConfig.lockout;
  const attempts = user.failedLoginAttempts + 1;
  const shouldLock = threshold > 0 && attempts >= threshold;
  const lockedUntil = shouldLock ? new Date(Date.now() + durationMs) : null;

  await db
    .update(usersTable)
    .set({
      failedLoginAttempts: sql`${usersTable.failedLoginAttempts} + 1`,
      ...(shouldLock ? { lockedUntil } : {}),
    })
    .where(eq(usersTable.id, user.id));

  await logSecurityEvent({
    type: "login.failure", outcome: "failure", userId: user.id, username: user.username,
    reason: "bad_password", detail: { attempt: attempts, threshold }, req,
  });

  if (shouldLock && lockedUntil) {
    await logSecurityEvent({
      type: "account.locked", outcome: "failure", userId: user.id, username: user.username,
      reason: "failed_login_threshold",
      detail: { attempts, lockedUntil: lockedUntil.toISOString() }, req,
    });
    // Tell the account holder — a lockout they did not cause is the earliest
    // signal they get that someone is guessing their password.
    void sendEmail(user.email,
      renderAccountLockedEmail({ fullName: user.fullName, until: lockedUntil, ip: clientIp(req) }),
      { userId: user.id, username: user.username, purpose: "account_locked" });
  }
}

// ── POST /auth/logout ────────────────────────────────────────────────────────

router.post("/auth/logout", async (req, res): Promise<void> => {
  if (req.principal) {
    await revokeSession(req.principal.session.id, "logout");
    recordSecurityEvent({
      type: "logout", userId: req.principal.user.id, username: req.principal.user.username, req,
    });
    void logActivity("user.logout", "user", req.principal.user.id, req.principal.user.fullName, null, req);
  }
  clearSessionCookies(res);
  res.sendStatus(204);
});

// ── GET /auth/session ────────────────────────────────────────────────────────

router.get("/auth/session", (req, res): void => {
  if (!req.principal) {
    res.status(401).json({
      error: "Not authenticated",
      code: req.authFailure ?? "authentication_required",
    });
    return;
  }
  res.json(sessionPayload(req.principal.user, req.principal.session.csrfToken));
});

// ── GET /auth/password-policy ────────────────────────────────────────────────

router.get("/auth/password-policy", (_req, res): void => {
  res.json(getPasswordPolicy());
});

// ── Activation ───────────────────────────────────────────────────────────────

/**
 * Activation and password-reset tokens.
 *
 * There is no account dimension here and that is not an oversight: the token IS
 * the identifier, and an attacker guessing tokens supplies a different one every
 * time, so a per-token counter would never see the same key twice. Source-based
 * limiting is the only dimension with any purchase — backed by the tokens being
 * 256-bit random values, single-use, and stored only as a hash.
 */
const tokenLimiter = rateLimit({
  name: "auth:token",
  limits: {
    ip: authConfig.rateLimit.token,
    subnet: {
      max: authConfig.rateLimit.token.max * authConfig.rateLimit.subnetMultiplier,
      windowMs: authConfig.rateLimit.token.windowMs,
    },
  },
  eventType: "ratelimit.tripped",
  message: "Too many attempts. Please request a new link and try again.",
});

/**
 * One-time codes (MFA/OTP).
 *
 * Defined here, ready to mount, but NOT currently attached to a route: the users
 * table carries `mfaEnabled`/`mfaSecret` and no verification endpoint exists yet.
 * Mount it as the first middleware on that route when it is built — a 6-digit
 * code is only 10^6 possibilities, so an unlimited verify endpoint is guessable
 * by volume alone regardless of how good the secret is.
 *
 * The account dimension is the important one and is set as low as the code
 * length demands: rotating IPs must not buy more guesses against one account.
 */
export const otpLimiter = rateLimit({
  name: "auth:otp",
  limits: {
    account: authConfig.rateLimit.otp,
    ip: authConfig.rateLimit.otp,
    subnet: {
      max: authConfig.rateLimit.otp.max * authConfig.rateLimit.subnetMultiplier,
      windowMs: authConfig.rateLimit.otp.windowMs,
    },
  },
  accountFrom: (req) => {
    const b = req.body as Record<string, unknown> | undefined;
    const v = b?.username ?? b?.identifier ?? b?.email ?? b?.userId;
    return typeof v === "string" ? v : null;
  },
  eventType: "ratelimit.tripped",
  message: "Too many verification attempts. Please wait and try again.",
});


const TOKEN_ERRORS: Record<string, { status: number; message: string }> = {
  token_invalid:  { status: 404, message: "This link is not valid. It may have been mistyped or already replaced by a newer one." },
  token_consumed: { status: 410, message: "This link has already been used. If you need to set a new password, use \"Forgot password?\"." },
  token_revoked:  { status: 410, message: "This link has been replaced by a newer one. Please use the most recent email." },
  token_expired:  { status: 410, message: "This link has expired. Ask your administrator to resend your invitation." },
};

function respondTokenError(res: Response, reason: string): void {
  const e = TOKEN_ERRORS[reason] ?? TOKEN_ERRORS.token_invalid;
  res.status(e.status).json({ error: e.message, code: reason });
}

/**
 * Validate an activation link WITHOUT consuming it.
 *
 * Kept separate from the POST deliberately: corporate mail scanners follow
 * links, and a GET that consumed the token would burn every invitation before
 * the human ever clicked it.
 */
router.get("/auth/activation/:token", tokenLimiter, async (req, res): Promise<void> => {
  const found = await lookupAuthToken(req.params.token, "activation");
  if (!found.ok) { respondTokenError(res, found.reason); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, found.userId));
  if (!user) { respondTokenError(res, "token_invalid"); return; }
  if (user.status !== "invited") {
    res.status(409).json({ error: "This account has already been activated. Please sign in.", code: "already_activated" });
    return;
  }

  res.json({
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    expiresAt: found.expiresAt.toISOString(),
    passwordPolicy: getPasswordPolicy(),
  });
});

router.post("/auth/activate", tokenLimiter, async (req, res): Promise<void> => {
  const { token, password } = req.body as Record<string, unknown>;
  if (typeof token !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "token and password are required", code: "invalid_request" });
    return;
  }

  // Validate the token before the password so a bad link fails fast, but
  // consume it only after the password passes policy — otherwise a single
  // typo'd password would burn the invitation.
  const preview = await lookupAuthToken(token, "activation");
  if (!preview.ok) { respondTokenError(res, preview.reason); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, preview.userId));
  if (!user) { respondTokenError(res, "token_invalid"); return; }
  if (user.status !== "invited") {
    res.status(409).json({ error: "This account has already been activated. Please sign in.", code: "already_activated" });
    return;
  }

  const violations = validatePassword(password, user);
  if (violations.length > 0) { res.status(400).json(policyError(violations)); return; }

  const claimed = await consumeAuthToken(token, "activation");
  if (!claimed.ok) { respondTokenError(res, claimed.reason); return; }

  await db.update(usersTable).set({
    passwordHash: await hashPassword(password),
    passwordUpdatedAt: new Date(),
    mustChangePassword: false,
    passwordExpiresAt: null,
    // Not a plain "active": an administrator who suspends the invitation while
    // this request is hashing must not be overruled by it.
    ...activateIfInvited(),
    failedLoginAttempts: 0,
    lockedUntil: null,
  }).where(eq(usersTable.id, user.id));

  await logSecurityEvent({ type: "user.activated", userId: user.id, username: user.username, req });
  void logActivity("user.activated", "user", user.id, user.fullName, `role=${user.role}`, req);

  res.status(204).end();
});

// ── Password reset ───────────────────────────────────────────────────────────

/**
 * Password reset is limited per account as well as per source, for a reason
 * specific to this endpoint: every accepted request sends an EMAIL. Without an
 * account dimension, a distributed caller can have the system mail one victim
 * thousands of reset links — harassment, and a fast route onto a mail provider's
 * blocklist, using nothing but our own sending reputation.
 */
const forgotLimiter = rateLimit({
  name: "auth:forgot",
  limits: {
    ip: authConfig.rateLimit.forgot,
    subnet: {
      max: authConfig.rateLimit.forgot.max * authConfig.rateLimit.subnetMultiplier,
      windowMs: authConfig.rateLimit.forgot.windowMs,
    },
    account: authConfig.rateLimit.forgot,
  },
  accountFrom: (req) => {
    const b = req.body as Record<string, unknown> | undefined;
    const v = b?.identifier ?? b?.email ?? b?.username;
    return typeof v === "string" ? v : null;
  },
  eventType: "ratelimit.tripped",
  message: "Too many password reset requests. Please wait and try again.",
});

/**
 * Always 204, whatever happens.
 *
 * Returning 404 for an unknown address would turn this endpoint into a free
 * account-enumeration oracle. The distinction is recorded in security_events
 * where an administrator can see it, and nowhere the requester can.
 */
router.post("/auth/forgot-password", forgotLimiter, async (req, res): Promise<void> => {
  const raw = (req.body as Record<string, unknown>)?.identifier
    ?? (req.body as Record<string, unknown>)?.email
    ?? (req.body as Record<string, unknown>)?.username;

  if (typeof raw !== "string" || !raw.trim()) {
    res.status(400).json({ error: "An email address or username is required", code: "invalid_request" });
    return;
  }
  const identifier = raw.trim();
  res.status(204).end(); // respond before doing any work — timing carries no signal

  try {
    const user = await findUserByIdentifier(identifier);

    if (!user) {
      recordSecurityEvent({ type: "password_reset.requested", outcome: "failure", username: identifier, reason: "unknown_user", req });
      return;
    }
    if (user.status === "suspended" || user.status === "inactive") {
      recordSecurityEvent({ type: "password_reset.requested", outcome: "failure", userId: user.id, username: user.username, reason: `status_${user.status}`, req });
      return;
    }

    // An un-activated account gets its invitation re-sent rather than a reset
    // link — same outcome for the user, and it keeps the two token types from
    // being interchangeable.
    if (user.status === "invited") {
      const issued = await issueAuthToken(user.id, "activation", { createdIp: clientIp(req) });
      await sendEmail(user.email, renderActivationEmail({
        fullName: user.fullName,
        url: buildActivationUrl(issued.raw),
        expiresAt: issued.expiresAt,
        role: user.role,
        policy: getPasswordPolicy().description,
      }), { userId: user.id, username: user.username, purpose: "activation_resend" });
      recordSecurityEvent({ type: "invitation.resent", userId: user.id, username: user.username, reason: "self_service", req });
      return;
    }

    const issued = await issueAuthToken(user.id, "password_reset", { createdIp: clientIp(req) });
    await sendEmail(user.email, renderPasswordResetEmail({
      fullName: user.fullName,
      url: buildResetUrl(issued.raw),
      expiresAt: issued.expiresAt,
      policy: getPasswordPolicy().description,
      initiatedByAdmin: false,
    }), { userId: user.id, username: user.username, purpose: "password_reset" });

    recordSecurityEvent({ type: "password_reset.requested", userId: user.id, username: user.username, req });
  } catch {
    /* already responded — never surface internals on this endpoint */
  }
});

router.get("/auth/reset/:token", tokenLimiter, async (req, res): Promise<void> => {
  const found = await lookupAuthToken(req.params.token, "password_reset");
  if (!found.ok) { respondTokenError(res, found.reason); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, found.userId));
  if (!user) { respondTokenError(res, "token_invalid"); return; }

  res.json({
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    expiresAt: found.expiresAt.toISOString(),
    passwordPolicy: getPasswordPolicy(),
  });
});

router.post("/auth/reset-password", tokenLimiter, async (req, res): Promise<void> => {
  const { token, password } = req.body as Record<string, unknown>;
  if (typeof token !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "token and password are required", code: "invalid_request" });
    return;
  }

  const preview = await lookupAuthToken(token, "password_reset");
  if (!preview.ok) { respondTokenError(res, preview.reason); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, preview.userId));
  if (!user) { respondTokenError(res, "token_invalid"); return; }

  const violations = validatePassword(password, user);
  if (violations.length > 0) { res.status(400).json(policyError(violations)); return; }

  const claimed = await consumeAuthToken(token, "password_reset");
  if (!claimed.ok) { respondTokenError(res, claimed.reason); return; }

  await db.update(usersTable).set({
    passwordHash: await hashPassword(password),
    passwordUpdatedAt: new Date(),
    mustChangePassword: false,
    passwordExpiresAt: null,
    // A reset is also the documented way out of a lockout.
    failedLoginAttempts: 0,
    lockedUntil: null,
    // If the account was still `invited`, completing a reset activates it.
    // Decided in SQL against the row as it is NOW: `user` was read before the
    // scrypt, and writing its status back could undo a suspension an
    // administrator made in the meantime.
    ...activateIfInvited(),
  }).where(eq(usersTable.id, user.id));

  // Whoever knew the old password (or hijacked a session) is signed out.
  const revoked = await revokeAllUserSessions(user.id, "password_reset");
  await revokeAuthTokens(user.id, "activation");

  await logSecurityEvent({
    type: "password_reset.completed", userId: user.id, username: user.username,
    detail: { sessionsRevoked: revoked }, req,
  });
  void logActivity("user.password_reset", "user", user.id, user.fullName, null, req);

  void sendEmail(user.email,
    renderPasswordChangedEmail({ fullName: user.fullName, when: new Date(), ip: clientIp(req) }),
    { userId: user.id, username: user.username, purpose: "password_changed" });

  res.status(204).end();
});

// ── POST /auth/change-password (self-service, authenticated) ─────────────────

/**
 * Replaces the removed `PATCH /users/:id/change-password`, which took the
 * target user from the URL and checked nothing — any anonymous caller could
 * change any user's password. There is no `:id` here by design: you can only
 * ever change your own.
 *
 * Limited per user (the route needs a session, so the user is always known),
 * with the IP as a backstop. `/auth/*` is skipped by the general API limiter, so
 * without this a stolen session could guess the current password indefinitely,
 * each guess costing the server a 64 MiB scrypt.
 */
const changePasswordLimiter = rateLimit({
  name: "auth:change-password",
  limits: {
    user: authConfig.rateLimit.changePassword,
    ip: { max: authConfig.rateLimit.changePassword.max * 4, windowMs: authConfig.rateLimit.changePassword.windowMs },
  },
  eventType: "ratelimit.tripped",
  message: "Too many password change attempts. Please wait and try again.",
});

router.post("/auth/change-password", changePasswordLimiter, async (req, res): Promise<void> => {
  if (!req.principal) {
    res.status(401).json({ error: "Authentication required", code: "authentication_required" });
    return;
  }

  const { currentPassword, newPassword } = req.body as Record<string, unknown>;
  if (typeof newPassword !== "string") {
    res.status(400).json({ error: "newPassword is required", code: "invalid_request" });
    return;
  }

  const user = req.principal.user;

  // Re-authentication is required for a *voluntary* change — the point is that a
  // hijacked session cannot silently take over the account.
  //
  // A user on an admin-issued temporary password is a different case: signing in
  // with that password is what created this session, minutes ago, and the session
  // can reach nothing but this endpoint. Demanding the same password a second time
  // proves nothing that has not just been proved, so the forced-change flow takes
  // only the new password.
  const forcedChange = user.mustChangePassword;
  if (!forcedChange) {
    if (typeof currentPassword !== "string") {
      res.status(400).json({ error: "currentPassword and newPassword are required", code: "invalid_request" });
      return;
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      await logSecurityEvent({
        type: "password.changed", outcome: "failure", userId: user.id, username: user.username,
        reason: "bad_current_password", req,
      });
      res.status(401).json({ error: "Your current password is incorrect", code: "invalid_credentials" });
      return;
    }
  }

  // Compared against the stored hash rather than the submitted string, so reuse is
  // caught in the forced-change flow too — where the old password is never sent.
  if (await verifyPassword(newPassword, user.passwordHash)) {
    res.status(400).json({
      error: forcedChange
        ? "Your new password must be different from the temporary one"
        : "The new password must be different from your current one",
      code: "password_reused",
    });
    return;
  }

  const violations = validatePassword(newPassword, user);
  if (violations.length > 0) { res.status(400).json(policyError(violations)); return; }

  await db.update(usersTable).set({
    passwordHash: await hashPassword(newPassword),
    passwordUpdatedAt: new Date(),
    // Choosing your own password clears both the forced-change flag and the
    // temporary credential's clock — this is the exit from that state.
    mustChangePassword: false,
    passwordExpiresAt: null,
  }).where(eq(usersTable.id, user.id));

  resetLimiter("auth:change-password", req);

  // Sign out every *other* device; the one you changed it from stays in.
  const revoked = await revokeAllUserSessions(user.id, "password_changed", {
    exceptSessionId: req.principal.session.id,
  });

  await logSecurityEvent({
    type: "password.changed", userId: user.id, username: user.username,
    detail: { sessionsRevoked: revoked }, req,
  });
  void logActivity("user.password_changed", "user", user.id, user.fullName, null, req);

  void sendEmail(user.email,
    renderPasswordChangedEmail({ fullName: user.fullName, when: new Date(), ip: clientIp(req) }),
    { userId: user.id, username: user.username, purpose: "password_changed" });

  res.json({ ok: true, sessionsRevoked: revoked });
});

export default router;
