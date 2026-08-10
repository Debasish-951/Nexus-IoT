import { useCallback } from "react";
import { describeApiError, formatApiError } from "@/lib/validation";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/auth-api";

/**
 * Server-backed storage for the Visualization hierarchy and each node's
 * dashboard.
 *
 * This replaces the `wsviz:hierarchy` / `wsviz:widgets:<id>` localStorage keys.
 * Those made a dashboard invisible to colleagues, disposable with a cache clear,
 * absent from every backup, and — the reason this was urgent — silently
 * unsaveable once the browser's ~5MB quota filled, because each write swallowed
 * its own QuotaExceededError.
 *
 * Every call goes through `apiFetch`, never bare `fetch`: the API's CSRF guard
 * rejects a cookie-authenticated POST/PUT/DELETE that arrives without the
 * `x-csrf-token` header, and apiFetch is what attaches it.
 */

export interface VizNode {
  id: string;
  name: string;
  parentId: string | null;
  widgets: any[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["viz-nodes"] as const;

/** Client-minted so the tree can update optimistically before the POST lands. */
export function newNodeId(): string {
  return `vn-${crypto.randomUUID()}`;
}

async function readJson(res: Response): Promise<any> {
  if (!res.ok) {
    // Carries the server's correlation id through to whatever shows the error,
    // so a user reporting a failed save can quote a reference that finds the
    // exact log entry — the server deliberately tells them nothing else.
    throw new Error(formatApiError(await describeApiError(res)));
  }
  return res.json();
}

async function fetchNodes(): Promise<VizNode[]> {
  const res = await apiFetch(`${BASE}/api/viz-nodes`);
  const rows = await readJson(res);
  return Array.isArray(rows) ? rows : [];
}

/**
 * The hierarchy, shared by every component that shows it.
 *
 * `staleTime: 0` on purpose. Two people editing the same tree is now possible —
 * that is the point of moving off localStorage — so a refocus should pick up
 * their changes rather than serve a cached tree that no longer matches.
 */
export function useVizNodes() {
  const q = useQuery({ queryKey: KEY, queryFn: fetchNodes, staleTime: 0 });
  return {
    nodes: q.data ?? [],
    loading: q.isLoading,
    /** True when the list could not be read — callers must not treat it as "empty". */
    failed: q.isError,
    error: q.error as Error | null,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────
//
// Written against the query cache directly rather than as useMutation hooks:
// callers are existing imperative handlers (`addNode(name, parent)` returning an
// id synchronously), and keeping those signatures is what lets the pages using
// them stay unchanged.

function patchCache(qc: QueryClient, fn: (prev: VizNode[]) => VizNode[]) {
  qc.setQueryData<VizNode[]>(KEY, (prev) => fn(prev ?? []));
}

export function useVizNodeActions() {
  const qc = useQueryClient();
  const invalidate = useCallback(() => { void qc.invalidateQueries({ queryKey: KEY }); }, [qc]);

  /** Optimistic: the node appears at once, then the server confirms it. */
  const createNode = useCallback((name: string, parentId: string | null): string => {
    const id = newNodeId();
    const node: VizNode = { id, name: name.trim() || "Untitled", parentId, widgets: [] };
    patchCache(qc, (prev) => [...prev, node]);
    apiFetch(`${BASE}/api/viz-nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: node.name, parentId }),
    })
      .then(readJson)
      // Refetch either way: on success to pick up server-side normalisation, on
      // failure to drop the optimistic node rather than leave a phantom the user
      // can click into and lose work in.
      .finally(invalidate);
    return id;
  }, [qc, invalidate]);

  const renameNode = useCallback((id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    patchCache(qc, (prev) => prev.map((n) => (n.id === id ? { ...n, name: clean } : n)));
    apiFetch(`${BASE}/api/viz-nodes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: clean }),
    }).then(readJson).finally(invalidate);
  }, [qc, invalidate]);

  const deleteNode = useCallback((id: string, subtree: Set<string>) => {
    patchCache(qc, (prev) => prev.filter((n) => !subtree.has(n.id)));
    apiFetch(`${BASE}/api/viz-nodes/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(readJson).finally(invalidate);
  }, [qc, invalidate]);

  /**
   * Save a node's dashboard.
   *
   * Returns a promise and rejects on failure, unlike everything above — the
   * canvas has an explicit Save button with a dirty indicator, so a failed save
   * has somewhere to be reported. Silently dropping this one is the exact
   * failure mode being fixed.
   */
  const saveWidgets = useCallback(async (id: string, widgets: any[]): Promise<void> => {
    const res = await apiFetch(`${BASE}/api/viz-nodes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgets }),
    });
    await readJson(res);
    patchCache(qc, (prev) => prev.map((n) => (n.id === id ? { ...n, widgets } : n)));
  }, [qc]);

  return { createNode, renameNode, deleteNode, saveWidgets, invalidate };
}

// ── One-time migration out of localStorage ───────────────────────────────────

const MIGRATED_FLAG = "wsviz:migrated-to-server";
const LS_HIERARCHY = "wsviz:hierarchy";
const lsWidgetKey = (nodeId: string) => `wsviz:widgets:${nodeId}`;

/**
 * Ship whatever this browser still holds to the server, once.
 *
 * Deliberately non-destructive: the localStorage keys are left in place after a
 * successful import. If something goes wrong server-side the user's dashboards
 * are still sitting in their browser, recoverable — deleting them the moment the
 * POST returns 200 would make a partial import unrecoverable. The flag stops it
 * running twice.
 *
 * The server skips ids it already has, so two colleagues migrating a tree that
 * was copied between their machines cannot overwrite each other.
 */
export async function migrateLocalDashboards(): Promise<number> {
  if (window.localStorage.getItem(MIGRATED_FLAG)) return 0;

  let localNodes: { id: string; name: string; parentId: string | null }[] = [];
  try {
    const raw = window.localStorage.getItem(LS_HIERARCHY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      localNodes = parsed.filter((n: any) => n && typeof n.id === "string" && typeof n.name === "string");
    }
  } catch { /* unreadable local data is nothing to migrate */ }

  if (localNodes.length === 0) {
    window.localStorage.setItem(MIGRATED_FLAG, "1");
    return 0;
  }

  const payload = localNodes.map((n) => {
    let widgets: any[] = [];
    try {
      const raw = window.localStorage.getItem(lsWidgetKey(n.id));
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) widgets = parsed;
    } catch { /* a node with unreadable widgets still migrates as an empty one */ }
    return { id: n.id, name: n.name, parentId: n.parentId ?? null, widgets };
  });

  const res = await apiFetch(`${BASE}/api/viz-nodes/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes: payload }),
  });
  const out = await readJson(res);
  // Only flagged once the server has confirmed. A failed import throws before
  // this line, so the next page load tries again.
  window.localStorage.setItem(MIGRATED_FLAG, "1");
  return Number(out?.imported) || 0;
}
