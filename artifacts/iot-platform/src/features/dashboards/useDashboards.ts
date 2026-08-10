import { useCallback, useEffect, useState } from "react";
import type { Dashboard, ExplorerState, Folder, Widget } from "./types";
// Bare `fetch` cannot mutate this API: the CSRF guard rejects a
// cookie-authenticated POST/PUT/DELETE that arrives without an `x-csrf-token`
// header, and apiFetch is what attaches it. Every write below used raw fetch
// and then swallowed the result with `.catch(() => null)`, so creating,
// renaming, saving and deleting a dashboard all failed silently.
import { apiFetch } from "@/lib/auth-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LS_KEY = "viz_explorer_state";
const LS_TPL = "viz_templates";

export interface DashTemplate { id: string; name: string; widgets: Widget[] }
function loadTemplates(): DashTemplate[] {
  try { const raw = localStorage.getItem(LS_TPL); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
  return [];
}

let uid = 1;
export const newId = (p = "id") => `${p}${Date.now().toString(36)}${uid++}`;

function loadExplorer(): ExplorerState {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
  return { folders: [], assignments: {}, favorites: [], recent: [] };
}
function saveExplorer(s: ExplorerState) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

export function useDashboards() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [explorer, setExplorer] = useState<ExplorerState>(loadExplorer);
  const [templates, setTemplates] = useState<DashTemplate[]>(loadTemplates);
  const persistTemplates = useCallback((next: DashTemplate[]) => { setTemplates(next); localStorage.setItem(LS_TPL, JSON.stringify(next)); }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const rows = await apiFetch(`${BASE}/api/viz-dashboards`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setDashboards((Array.isArray(rows) ? rows : []).map((d: any) => ({
      id: d.id, name: d.name, roleAccess: d.roleAccess,
      widgets: Array.isArray(d.widgets) ? d.widgets : [],
    })));
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const persistExplorer = useCallback((next: ExplorerState) => { setExplorer(next); saveExplorer(next); }, []);

  // ── Dashboard CRUD (server) ──
  const createDashboard = useCallback(async (name: string, folderId: string | null, widgets: Widget[] = []) => {
    const res = await apiFetch(`${BASE}/api/viz-dashboards`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, widgets, roleAccess: ["admin", "engineer", "operator", "viewer"] }),
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const d = await res.json();
    setExplorer((s) => { const n = { ...s, assignments: { ...s.assignments, [d.id]: folderId } }; saveExplorer(n); return n; });
    await refresh();
    return d.id as string;
  }, [refresh]);

  const saveDashboard = useCallback(async (d: Dashboard) => {
    await apiFetch(`${BASE}/api/viz-dashboards/${d.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: d.name, widgets: d.widgets, roleAccess: d.roleAccess ?? ["admin", "engineer", "operator", "viewer"] }),
    }).catch(() => null);
    await refresh();
  }, [refresh]);

  const cloneDashboard = useCallback(async (d: Dashboard, withName?: string) => {
    const folderId = explorer.assignments[d.id] ?? null;
    return createDashboard(withName ?? `${d.name} (copy)`, folderId, d.widgets);
  }, [createDashboard, explorer.assignments]);

  const deleteDashboard = useCallback(async (id: string) => {
    await apiFetch(`${BASE}/api/viz-dashboards/${id}`, { method: "DELETE" }).catch(() => null);
    setExplorer((s) => {
      const assignments = { ...s.assignments }; delete assignments[id];
      const n = { ...s, assignments, favorites: s.favorites.filter((x) => x !== id), recent: s.recent.filter((x) => x !== id) };
      saveExplorer(n); return n;
    });
    await refresh();
  }, [refresh]);

  const renameDashboard = useCallback(async (id: string, name: string) => {
    await apiFetch(`${BASE}/api/viz-dashboards/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
    await refresh();
  }, [refresh]);

  // ── Folders (client-side) ──
  const addFolder = useCallback((name: string, parentId: string | null) => {
    const f: Folder = { id: newId("f"), name, parentId };
    persistExplorer({ ...explorer, folders: [...explorer.folders, f] });
    return f.id;
  }, [explorer, persistExplorer]);
  const renameFolder = useCallback((id: string, name: string) => {
    persistExplorer({ ...explorer, folders: explorer.folders.map((f) => (f.id === id ? { ...f, name } : f)) });
  }, [explorer, persistExplorer]);
  const deleteFolder = useCallback((id: string) => {
    // reparent children folders + dashboards to root
    const assignments = { ...explorer.assignments };
    for (const k in assignments) if (assignments[k] === id) assignments[k] = null;
    persistExplorer({
      ...explorer,
      folders: explorer.folders.filter((f) => f.id !== id).map((f) => (f.parentId === id ? { ...f, parentId: null } : f)),
      assignments,
    });
  }, [explorer, persistExplorer]);
  const moveDashboard = useCallback((dashId: string, folderId: string | null) => {
    persistExplorer({ ...explorer, assignments: { ...explorer.assignments, [dashId]: folderId } });
  }, [explorer, persistExplorer]);
  const moveFolder = useCallback((id: string, parentId: string | null) => {
    if (id === parentId) return;
    persistExplorer({ ...explorer, folders: explorer.folders.map((f) => (f.id === id ? { ...f, parentId } : f)) });
  }, [explorer, persistExplorer]);

  const toggleFavorite = useCallback((id: string) => {
    const fav = explorer.favorites.includes(id) ? explorer.favorites.filter((x) => x !== id) : [...explorer.favorites, id];
    persistExplorer({ ...explorer, favorites: fav });
  }, [explorer, persistExplorer]);
  const markRecent = useCallback((id: string) => {
    persistExplorer({ ...explorer, recent: [id, ...explorer.recent.filter((x) => x !== id)].slice(0, 10) });
  }, [explorer, persistExplorer]);

  // ── Templates (client-side) ──
  const saveAsTemplate = useCallback((name: string, widgets: Widget[]) => {
    persistTemplates([...templates, { id: newId("t"), name, widgets: JSON.parse(JSON.stringify(widgets)) }]);
  }, [templates, persistTemplates]);
  const deleteTemplate = useCallback((id: string) => persistTemplates(templates.filter((t) => t.id !== id)), [templates, persistTemplates]);
  const createFromTemplate = useCallback(async (tplId: string, name: string, folderId: string | null) => {
    const tpl = templates.find((t) => t.id === tplId); if (!tpl) return null;
    // fresh widget ids so instances don't collide
    const widgets = tpl.widgets.map((w) => ({ ...w, id: newId("w") }));
    return createDashboard(name, folderId, widgets);
  }, [templates, createDashboard]);

  return {
    dashboards, loading, explorer, templates, refresh,
    createDashboard, saveDashboard, cloneDashboard, deleteDashboard, renameDashboard,
    addFolder, renameFolder, deleteFolder, moveDashboard, moveFolder, toggleFavorite, markRecent,
    saveAsTemplate, deleteTemplate, createFromTemplate,
  };
}
export type DashboardsApi = ReturnType<typeof useDashboards>;
