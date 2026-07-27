import type { Request, Response, NextFunction } from "express";
import { authConfig } from "../lib/auth-config";
import { readCsrfCookie, safeEqual } from "../lib/sessions";
import { recordSecurityEvent } from "../lib/security-log";

/**
 * Double-submit cookie CSRF protection.
 *
 * Applies only to cookie-authenticated, state-changing requests:
 *   - Safe methods (GET/HEAD/OPTIONS) are exempt by definition.
 *   - API-key callers are exempt — they authenticate with an explicit header,
 *     which a cross-site page cannot cause a browser to attach, so they are not
 *     confused-deputy targets.
 *
 * The check compares the `is_csrf` cookie against the `X-CSRF-Token` header AND
 * against the token bound to the session row. Binding to the session matters:
 * cookie-vs-header alone can be defeated by an attacker who can write cookies
 * for the domain (e.g. via a subdomain), because they could set both sides.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) { next(); return; }
  if (!req.principal) { next(); return; } // not cookie-authenticated

  const cookieToken = readCsrfCookie(req);
  const headerToken = req.headers[authConfig.session.csrfHeaderName];
  const header = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  const matchesCookie = safeEqual(cookieToken, header);
  const matchesSession = safeEqual(req.principal.session.csrfToken, header);

  if (!matchesCookie || !matchesSession) {
    recordSecurityEvent({
      type: "csrf.failed",
      outcome: "failure",
      userId: req.principal.user.id,
      username: req.principal.user.username,
      reason: !header ? "missing_header" : !matchesCookie ? "cookie_mismatch" : "session_mismatch",
      detail: { method: req.method, path: req.path },
      req,
    });
    res.status(403).json({
      error: "CSRF validation failed",
      code: "csrf_failed",
      hint: `Send the ${authConfig.session.csrfCookieName} cookie value in the ${authConfig.session.csrfHeaderName} header.`,
    });
    return;
  }

  next();
}
