import { onUserReset } from "@/lib/user-scoped-state";

/**
 * Signals that the session the SPA holds may be out of date.
 *
 * A 403 with one of these codes means the server sees this user differently
 * from the session payload loaded at sign-in: an admin forced a password change,
 * changed their role or module grants, or took a project away. UserProvider
 * listens and re-reads /auth/session, so the UI catches up without a reload.
 * Codes come from api-server/src/middleware/authorize.ts and lib/project-access.ts.
 */
const STALE_SESSION_CODES = new Set([
  "password_change_required",
  "insufficient_permission",
  "project_forbidden",
]);

type Listener = () => void;
let listener: Listener | null = null;

/** UserProvider registers here; pass null to unregister. */
export function setSessionStaleListener(fn: Listener | null): void {
  listener = fn;
}

/** Report a 403 error code; a code that implies a stale session triggers a refresh. */
export function reportForbidden(code: string | null | undefined): void {
  if (code && STALE_SESSION_CODES.has(code)) listener?.();
}

/**
 * Root assets (projects) deleted from this tab.
 *
 * Lets ProjectGate tell "I just deleted the project I was in" (carry on in
 * another project) from "this project disappeared on me" — access withdrawn or
 * deleted by someone else — which must show "Project unavailable" instead.
 */
const deletedHere = new Set<string>();
onUserReset(() => deletedHere.clear());

export function markProjectDeletedHere(id: string): void {
  deletedHere.add(id);
}

export function wasProjectDeletedHere(id: string | null | undefined): boolean {
  return !!id && deletedHere.has(id);
}
