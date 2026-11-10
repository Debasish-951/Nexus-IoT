import { eq } from "drizzle-orm";
import { db, vizNodesTable, vizNodeSharesTable } from "@workspace/db";
import type { Principal } from "../middleware/principal";
import { hasModuleAccess, isTopAdminRole } from "./rbac";

/**
 * Who may do what to a Visualization dashboard.
 *
 * Each user owns the dashboards they create. A Super Admin or Company Admin can
 * reach every dashboard, and only they can grant access to someone else's.
 *
 * Owning a dashboard, or being granted access to one, also covers every dashboard
 * nested under it, so a shared tree does not need a grant per node.
 *
 * Owners are still bound by their Visualization module grants. An explicit grant
 * on a dashboard is not: it is a top administrator's specific decision about that
 * dashboard, so a Viewer can be given write access to one dashboard without
 * receiving write access to the whole module.
 */
export interface VizNodeAccess {
  read: boolean;
  write: boolean;
  delete: boolean;
  /** This user owns this exact node, rather than inheriting access from a parent. */
  owner: boolean;
}

interface NodeRef {
  id: string;
  parentId: string | null;
  ownerId: string | null;
}

interface Grant {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export const NO_ACCESS: VizNodeAccess = { read: false, write: false, delete: false, owner: false };

export function isSuperAdmin(principal: Principal | undefined): boolean {
  return isTopAdminRole(principal?.user.role);
}

/** The pure decision, separated from the queries that feed it. */
export function resolveVizAccess(
  principal: Principal,
  nodes: NodeRef[],
  grants: Map<string, Grant>,
): Map<string, VizNodeAccess> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const userId = principal.user.id;
  const superAdmin = isSuperAdmin(principal);
  const moduleWrite = hasModuleAccess(principal.access, "visualization", "write");
  const moduleDelete = hasModuleAccess(principal.access, "visualization", "delete");

  const result = new Map<string, VizNodeAccess>();
  for (const node of nodes) {
    const access: VizNodeAccess = { ...NO_ACCESS, owner: node.ownerId === userId };
    if (superAdmin) {
      result.set(node.id, { read: true, write: true, delete: true, owner: access.owner });
      continue;
    }

    // `seen` is the cycle guard: parentId carries no foreign key, so a corrupted
    // chain must not spin here.
    const seen = new Set<string>();
    let current: NodeRef | undefined = node;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.ownerId === userId) {
        access.read = true;
        access.write ||= moduleWrite;
        access.delete ||= moduleDelete;
      }
      const grant = grants.get(current.id);
      if (grant) {
        access.read ||= grant.canRead;
        access.write ||= grant.canWrite;
        access.delete ||= grant.canDelete;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    result.set(node.id, access);
  }
  return result;
}

/** Access to every node for this user. Trees here are small, so all rows are read. */
export async function loadVizAccess(principal: Principal): Promise<Map<string, VizNodeAccess>> {
  const [nodes, rows] = await Promise.all([
    db.select({ id: vizNodesTable.id, parentId: vizNodesTable.parentId, ownerId: vizNodesTable.ownerId }).from(vizNodesTable),
    db.select().from(vizNodeSharesTable).where(eq(vizNodeSharesTable.userId, principal.user.id)),
  ]);
  return resolveVizAccess(principal, nodes, new Map(rows.map((r) => [r.nodeId, r])));
}
