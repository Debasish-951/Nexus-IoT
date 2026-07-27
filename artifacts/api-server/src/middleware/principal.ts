import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type Session, type User } from "@workspace/db";
import { resolveAccess, type EffectiveAccess } from "../lib/rbac";
import {
  lookupSession, touchSession, revokeSession, readSessionCookie, clearSessionCookies,
} from "../lib/sessions";
import { recordSecurityEvent } from "../lib/security-log";

/**
 * Resolves the caller's identity for every /api request.
 *
 * A request is authenticated by EITHER a session cookie (human) or an API key
 * (machine, handled by the pre-existing apiKeyAuth middleware on the routes
 * that use it). Both resolve to `req.principal`, so downstream authorisation
 * code never has to care which credential was used.
 *
 * This middleware never rejects — it only populates. `authorize()` makes the
 * allow/deny decision, so there is exactly one place where access is granted.
 */

export interface Principal {
  kind: "user";
  user: User;
  session: Session;
  access: EffectiveAccess;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      /** Why authentication did not produce a principal — surfaced in the 401. */
      authFailure?: "no_session" | "session_invalid" | "session_expired" | "session_revoked" | "account_inactive";
    }
  }
}

export async function attachPrincipal(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = readSessionCookie(req);
  if (!raw) { next(); return; }

  const found = await lookupSession(raw);
  if (!found.ok) {
    req.authFailure = found.reason === "no_session" ? "no_session" : found.reason;
    // Stale cookie: clear it so the browser stops sending it and the SPA can
    // tell "logged out" apart from "server unreachable".
    if (found.reason !== "no_session") clearSessionCookies(res);
    if (found.reason === "session_expired") {
      recordSecurityEvent({ type: "session.expired", outcome: "failure", reason: "idle_or_absolute_timeout", req });
    }
    next();
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, found.session.userId));

  // The account changed underneath a live session — suspended, deleted, or
  // locked. Kill the session now rather than waiting for it to expire.
  if (!user || user.status !== "active" || (user.lockedUntil && user.lockedUntil.getTime() > Date.now())) {
    await revokeSession(found.session.id, user ? `status_${user.status}` : "user_deleted");
    clearSessionCookies(res);
    req.authFailure = "account_inactive";
    recordSecurityEvent({
      type: "session.revoked",
      outcome: "failure",
      userId: user?.id ?? null,
      username: user?.username ?? null,
      reason: user ? `account_${user.status}` : "user_deleted",
      req,
    });
    next();
    return;
  }

  const session = await touchSession(found.session);

  req.principal = {
    kind: "user",
    user,
    session,
    access: resolveAccess(user.role, user.accessOverrides),
  };

  // Identity now comes from the session, not from client-supplied headers.
  // Overwriting them here means `logActivity()` — which reads X-Actor-* — is
  // automatically fed the authenticated actor, so all ~40 existing call sites
  // get a trustworthy audit trail with no change to any of them.
  req.headers["x-actor-name"] = user.fullName;
  req.headers["x-actor-role"] = user.role;
  req.headers["x-actor-username"] = user.username;

  next();
}

/**
 * Strip client-supplied actor headers from unauthenticated requests.
 *
 * Without this, `curl -H 'X-Actor-Role: admin'` still forges Activity Log
 * entries on the routes that remain public (ingest, health).
 */
export function stripForgedActorHeaders(req: Request, _res: Response, next: NextFunction): void {
  if (!req.principal) {
    delete req.headers["x-actor-name"];
    delete req.headers["x-actor-role"];
    delete req.headers["x-actor-username"];
  }
  next();
}
