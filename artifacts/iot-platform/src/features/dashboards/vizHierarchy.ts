import { useCallback, useMemo, useState } from "react";
import { newId } from "./useDashboards";

// The Visualization section owns its OWN hierarchy, independent of the asset
// hierarchy in Asset Management. Nodes here are purely organisational containers
// for dashboards — the user is free to model them however they like (site →
// line → machine, by team, by report, anything). Nothing is mirrored from
// /api/assets. Each widget inside a node's dashboard binds to a real asset +
// metric on its own, so data still comes from live telemetry.
export interface VizNode {
  id: string;
  name: string;
  parentId: string | null;
}

const HKEY = "wsviz:hierarchy";
const wkey = (nodeId: string) => `wsviz:widgets:${nodeId}`;

function readNodes(): VizNode[] {
  try {
    const raw = localStorage.getItem(HKEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is VizNode => !!n && typeof n.id === "string" && typeof n.name === "string");
  } catch { return []; }
}

function writeNodes(nodes: VizNode[]) {
  try { localStorage.setItem(HKEY, JSON.stringify(nodes)); } catch { /* quota */ }
}

export function useVizHierarchy() {
  const [nodes, setNodes] = useState<VizNode[]>(() => readNodes());

  const persist = useCallback((next: VizNode[]) => {
    setNodes(next);
    writeNodes(next);
  }, []);

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
      const id = stack.pop()!;
      for (const n of nodes) {
        if (n.parentId === id && !ids.has(n.id)) { ids.add(n.id); stack.push(n.id); }
      }
    }
    return ids;
  }, [nodes]);

  const addNode = useCallback((name: string, parentId: string | null): string => {
    const node: VizNode = { id: newId("vn"), name: name.trim() || "Untitled", parentId };
    persist([...readNodes(), node]);
    return node.id;
  }, [persist]);

  const renameNode = useCallback((id: string, name: string) => {
    persist(readNodes().map((n) => (n.id === id ? { ...n, name: name.trim() || n.name } : n)));
  }, [persist]);

  // Deleting a node removes its whole subtree along with each node's dashboard.
  const deleteNode = useCallback((id: string) => {
    const doomed = subtreeIds(id);
    persist(readNodes().filter((n) => !doomed.has(n.id)));
    for (const nid of doomed) {
      try { localStorage.removeItem(wkey(nid)); } catch { /* ignore */ }
    }
    return doomed;
  }, [persist, subtreeIds]);

  return { nodes, childrenByParent, subtreeIds, addNode, renameNode, deleteNode };
}
