/**
 * Role ranks, mirroring ROLE_RANK and canGrantRole() in
 * api-server/src/lib/rbac.ts. The server is the control; this only keeps the
 * Users page from offering a role the API would refuse to grant.
 *
 * Keep the numbers in step with the server when a role is added or moved.
 */
const ROLE_RANK: Record<string, number> = {
  super_admin: 100,
  company_admin: 90,
  admin: 80,
  project_manager: 60,
  team_lead: 50,
  developer: 40,
  engineer: 40,
  operator: 20,
  viewer: 10,
};

/** Unknown roles rank as viewer, as normaliseRole() does on the server. */
export function roleRank(role: string | null | undefined): number {
  return (role && ROLE_RANK[role]) || ROLE_RANK.viewer!;
}

/**
 * May `actorRole` grant `roleToGrant`? Strictly lower rank, except that a Super
 * Admin may grant any role — the same rule the API applies.
 */
export function canGrantRole(actorRole: string | null | undefined, roleToGrant: string | null | undefined): boolean {
  const actor = roleRank(actorRole);
  if (actor >= ROLE_RANK.super_admin!) return true;
  return actor > roleRank(roleToGrant);
}
