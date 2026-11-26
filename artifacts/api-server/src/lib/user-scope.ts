import type { UserAccessOverrides } from "@workspace/db";
import { resolveAccess, type EffectiveAccess } from "./rbac";

/**
 * Project scope of user administration (audit 23 Nov 2026, M-5).
 *
 * An administrator restricted to some projects could leave that restriction
 * through user management: create an unrestricted user, lift the restriction on
 * an existing one, or issue a temporary password for a user of another project
 * and sign in as them.
 *
 * A project-restricted administrator may act on a user only when that user is
 * also project-restricted and every project of theirs is one of the
 * administrator's projects, both before the change and after it. An unrestricted
 * administrator is not affected.
 *
 * Pure, so it can be tested without a database.
 */
export function userWithinActorProjects(
  actor: EffectiveAccess | undefined,
  targetRole: string | null | undefined,
  targetOverrides: UserAccessOverrides | null | undefined,
): boolean {
  if (!actor?.restrictProjects) return true;
  const target = resolveAccess(targetRole, targetOverrides);
  if (!target.restrictProjects) return false;
  const mine = new Set(actor.allowedProjects);
  return target.allowedProjects.every((p) => mine.has(p));
}

/** Project ids in `ids` that are not root assets (L-21). */
export function unknownProjectIds(ids: readonly string[] | undefined, rootIds: ReadonlySet<string>): string[] {
  return [...new Set(ids ?? [])].filter((id) => !rootIds.has(id));
}

/** Super Admin and Company Admin. */
export const TOP_ADMIN_ROLES = ["super_admin", "company_admin"] as const;
/** Every role that can manage users. */
export const ADMIN_ROLES = ["admin", "company_admin", "super_admin"] as const;

/**
 * Which "last administrator" guards a change to `target` must pass (L-21).
 * `nextRole`/`nextActive` describe the account after the change; null for a delete.
 * The guard on Super Admin / Company Admin matters because only they can create
 * a Company Admin, set login limits or grant dashboards; losing the last one
 * cannot be undone from the application.
 */
export function adminGuardsFor(
  target: { role: string; status: string },
  next: { role: string; active: boolean } | null,
): { admin: boolean; topAdmin: boolean } {
  const isActive = target.status === "active";
  const was = (roles: readonly string[]) => isActive && roles.includes(target.role);
  const still = (roles: readonly string[]) => !!next && next.active && roles.includes(next.role);
  return {
    admin: was(ADMIN_ROLES) && !still(ADMIN_ROLES),
    topAdmin: was(TOP_ADMIN_ROLES) && !still(TOP_ADMIN_ROLES),
  };
}
