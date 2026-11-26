import type { Request, Response } from "express";
import { API_SCOPE_ALL, ungrantableScopes, type EffectiveAccess } from "./rbac";
import { recordSecurityEvent } from "./security-log";

/**
 * Scope ceiling on EXISTING API clients (audit 23 Nov 2026, H-1).
 *
 * Creating a key, and adding scopes to one, were already limited to the scopes
 * the caller may grant. Acting on an existing key was not: an Engineer (ceiling
 * `ingest:write`) could rotate an administrator's `*` key and receive its new
 * secret, clear its IP list, or restore it after it was revoked.
 *
 * The rule: a user may change, rotate, restore or delete a key only when every
 * scope on it is one they could grant themselves. A key with no scopes counts as
 * `*`, because apiKeyAuth reads an empty list as "all scopes".
 *
 * Pure, so it can be tested without a database.
 */
export function exceedsScopeCeiling(access: EffectiveAccess, scopes: readonly string[] | null | undefined): boolean {
  if (access.apiScopes.includes(API_SCOPE_ALL)) return false;
  const effective = !scopes || scopes.length === 0 ? [API_SCOPE_ALL] : [...scopes];
  return ungrantableScopes(access, effective).length > 0;
}

/**
 * Refuse, with 404, an action on a key above the caller's grant level.
 *
 * 404 rather than 403, as for keys outside the caller's projects: a distinct
 * answer would confirm the key exists and is an administrator's. The real reason
 * goes to the security log. A machine caller (no principal) is not affected.
 *
 * Returns true when the request has been answered and the caller must stop.
 */
export function refuseIfAboveCeiling(
  req: Request,
  res: Response,
  client: { id: string; scopes: string[] | null } | null | undefined,
): boolean {
  const access = req.principal?.access;
  if (!access || !client) return false;
  if (!exceedsScopeCeiling(access, client.scopes)) return false;

  recordSecurityEvent({
    type: "authz.denied",
    outcome: "failure",
    reason: "api_client_above_scope_ceiling",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    detail: { apiClientId: client.id, path: req.path, method: req.method },
    req,
  });
  res.status(404).json({ error: "API client not found", code: "not_found" });
  return true;
}
