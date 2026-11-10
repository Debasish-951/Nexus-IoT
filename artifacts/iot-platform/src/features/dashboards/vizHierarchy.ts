import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVizNodes, useVizNodeActions, migrateLocalDashboards, type VizNode as StoredNode, type VizNodeAccess } from "./vizStore";

// The Visualization section owns its OWN hierarchy, independent of the asset
// hierarchy in Asset Management. Nodes here are purely organisational containers
// for dashboards — the user is free to model them however they like (site →
// line → machine, by team, by report, anything). Nothing is mirrored from
// /api/assets. Each widget inside a node's dashboard binds to a real asset +
// metric on its own, so data still comes from live telemetry.
//
// The tree now lives on the server (see vizStore.ts). It used to live in this
// browser's localStorage, which is why a dashboard could not be shared, did not
// survive a cache clear, and silently stopped saving at the storage quota. The
// hook's shape is unchanged so its callers did not have to be rewritten.
export interface VizNode {
  id: string;
  name: string;
  parentId: string | null;
  projectId: string | null;
  access: VizNodeAccess;
}

/** With a project id, shows that project's nodes plus unassigned ones. */
export function useVizHierarchy(projectId?: string | null) {
  const { nodes: stored, loading, failed } = useVizNodes();
  const { createNode, renameNode: renameOnServer, deleteNode: deleteOnServer, assignProject, invalidate } = useVizNodeActions();

  // Anything this browser still holds is pushed up once, on first mount, then
  // never again. `ran` guards against React's development double-invoke firing
  // two concurrent imports.
  const ran = useRef(false);
  const [migrationError, setMigrationError] = useState<Error | null>(null);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // Refetch afterwards: the tree may already have loaded empty, and the
    // dashboards just uploaded must appear without a manual reload.
    migrateLocalDashboards()
      .catch((e: Error) => setMigrationError(e))
      .finally(invalidate);
  }, [invalidate]);

  const nodes: VizNode[] = useMemo(
    () => stored
      .filter((n: StoredNode) => !projectId || !n.projectId || n.projectId === projectId)
      .map((n: StoredNode) => ({ id: n.id, name: n.name, parentId: n.parentId, projectId: n.projectId, access: n.access })),
    [stored, projectId],
  );

  // parentId -> children, with "root" holding the top level (shape the shared
  // asset-tree components expect).
  const childrenByParent = useMemo(() => {
    const m: Record<string, VizNode[]> = {};
    for (const n of nodes) {
      const k = n.parentId ?? "root";
      (m[k] ||= []).push(n);
    }
    for (const k in m) m[k].sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [nodes]);

  const subtreeIds = useCallback((rootId: string) => {
    const ids = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop() as string;
      for (const n of nodes) {
        if (n.parentId === id && !ids.has(n.id)) { ids.add(n.id); stack.push(n.id); }
      }
    }
    return ids;
  }, [nodes]);

  // Still returns the new id synchronously — callers select the node they just
  // created — which is why the id is minted client-side rather than by the
  // database.
  const addNode = useCallback(
    (name: string, parentId: string | null): string => createNode(name, parentId, projectId ?? null),
    [createNode, projectId],
  );

  const renameNode = useCallback(
    (id: string, name: string) => renameOnServer(id, name),
    [renameOnServer],
  );

  // Deleting a node removes its whole subtree along with each node's dashboard.
  // The subtree is computed here so callers still get the id set back; the
  // server recomputes it rather than trusting the list, so a stale client cannot
  // delete more than it can see.
  const deleteNode = useCallback((id: string) => {
    const doomed = subtreeIds(id);
    deleteOnServer(id, doomed);
    return doomed;
  }, [deleteOnServer, subtreeIds]);

  return {
    nodes, childrenByParent, subtreeIds, addNode, renameNode, deleteNode, assignProject,
    loading,
    /** The tree could not be loaded — distinct from "there are no nodes yet". */
    failed,
    migrationError,
  };
}
