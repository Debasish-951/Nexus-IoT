import { useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, LayoutDashboard, Blocks } from "lucide-react";
import { useListAssets } from "@workspace/api-client-react";
import { AssetVizPanel } from "@/features/dashboards/AssetVizPanel";
import { AssetTreeProvider, type DashboardActions } from "@/components/asset-tree/AssetTreeContext";
import { AssetTree } from "@/components/asset-tree/AssetTree";
import { newId } from "@/features/dashboards/useDashboards";
import type { Asset } from "@/pages/assetShared";

// ── Per-asset dashboard storage helpers (localStorage; same key AssetVizPanel uses) ──
const WKEY = (id: string) => `wsviz:widgets:${id}`;
const DASH_CLIP = "wsviz:dashboard-clipboard";
const BOOKMARKS_KEY = "wsviz:bookmarks";
function readWidgets(id: string): any[] { try { const r = localStorage.getItem(WKEY(id)); return r ? JSON.parse(r) : []; } catch { return []; } }
function writeWidgets(id: string, widgets: any[]) { try { localStorage.setItem(WKEY(id), JSON.stringify(widgets)); } catch { /* quota */ } }
function withFreshIds(widgets: any[]): any[] { return widgets.map((w) => ({ ...w, id: newId("w") })); }
function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

// Visualization is a READ-ONLY consumer of the asset hierarchy. The hierarchy
// itself is owned by the Asset section (Asset Template → Asset → Visualization);
// this page never creates, renames, or deletes assets — it only selects an
// existing asset and builds its dashboard. Dashboards/widgets are stored per
// asset in localStorage (wsviz:widgets:*) and are the only thing this page writes.
export default function Visualization() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: assetsData } = useListAssets();
  const allAssets = (assetsData as Asset[] | undefined) ?? [];
  const [assetSelId, setAssetSelId] = useState<string | null>(null);
  const [assetExpanded, setAssetExpanded] = useState<Set<string>>(new Set()); // empty = all collapsed (default)
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    try { const r = localStorage.getItem(BOOKMARKS_KEY); return new Set(r ? JSON.parse(r) : []); } catch { return new Set(); }
  });
  const [futuristicIds, setFuturisticIds] = useState<Set<string>>(new Set());
  const [dashReloadNonce, setDashReloadNonce] = useState(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importTargetRef = useRef<string | null>(null);
  const assetChildren = useMemo(() => {
    const m: Record<string, Asset[]> = {};
    for (const a of allAssets) { const k = a.parentId ?? "root"; (m[k] ||= []).push(a); }
    for (const k in m) m[k].sort((x, y) => x.name.localeCompare(y.name));
    return m;
  }, [allAssets]);
  const allParentIds = useMemo(() => Object.keys(assetChildren).filter((k) => k !== "root"), [assetChildren]);
  const expandAllAssets = () => setAssetExpanded(new Set(allParentIds));
  const collapseAllAssets = () => setAssetExpanded(new Set());

  function subtreeIdsOf(rootId: string) {
    const ids = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const child of assetChildren[id] ?? []) {
        if (ids.has(child.id)) continue;
        ids.add(child.id);
        stack.push(child.id);
      }
    }
    return ids;
  }

  // ── Dashboard right-click actions (operate on per-asset localStorage widgets) ──
  const bumpReload = () => setDashReloadNonce((n) => n + 1);

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const target = importTargetRef.current;
    e.target.value = "";
    if (!file || !target) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const widgets = Array.isArray(parsed) ? parsed : parsed?.widgets;
        if (!Array.isArray(widgets)) throw new Error("invalid");
        writeWidgets(target, withFreshIds(widgets));
        if (assetSelId === target) bumpReload();
        toast({ title: "Dashboard imported", description: `${widgets.length} widget(s) loaded from file.` });
      } catch {
        toast({ title: "Import failed", description: "That file isn't a valid dashboard JSON.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  }

  const dashboardActions: DashboardActions = {
    edit: (a) => setAssetSelId(a.id),
    clone: (a) => {
      const widgets = readWidgets(a.id);
      if (!widgets.length) { toast({ title: "Nothing to clone", description: `"${a.name}" has no dashboard widgets yet.` }); return; }
      try { localStorage.setItem(DASH_CLIP, JSON.stringify({ kind: "single", name: a.name, widgets })); } catch { /* quota */ }
      toast({ title: "Dashboard copied", description: "Select a target asset, then right-click → Import Dashboard to paste it." });
    },
    cloneWithChildren: (a) => {
      const items = [...subtreeIdsOf(a.id)].map((id) => ({ assetId: id, widgets: readWidgets(id) })).filter((x) => x.widgets.length);
      if (!items.length) { toast({ title: "Nothing to clone", description: `"${a.name}" and its children have no dashboards yet.` }); return; }
      try { localStorage.setItem(DASH_CLIP, JSON.stringify({ kind: "subtree", name: a.name, items })); } catch { /* quota */ }
      toast({ title: "Dashboards copied", description: `${items.length} dashboard(s) copied. Right-click any asset → Import Dashboard to restore them.` });
    },
    createTemplate: (a) => {
      const widgets = readWidgets(a.id);
      if (!widgets.length) { toast({ title: "Nothing to save", description: `"${a.name}" has no dashboard widgets yet.` }); return; }
      const name = window.prompt("Template name", `${a.name} template`);
      if (!name || !name.trim()) return;
      try {
        const raw = localStorage.getItem("viz_templates"); const tpls = raw ? JSON.parse(raw) : [];
        tpls.push({ id: newId("tpl"), name: name.trim(), widgets });
        localStorage.setItem("viz_templates", JSON.stringify(tpls));
        toast({ title: "Template created", description: `"${name.trim()}" saved with ${widgets.length} widget(s).` });
      } catch { toast({ title: "Could not save template", variant: "destructive" }); }
    },
    remove: (a) => {
      if (!confirm(`Delete the dashboard for "${a.name}"? All of its widgets will be removed.`)) return;
      try { localStorage.removeItem(WKEY(a.id)); } catch { /* ignore */ }
      if (assetSelId === a.id) bumpReload();
      toast({ title: "Dashboard deleted", description: `"${a.name}" dashboard cleared.` });
    },
    toggleBookmark: (a) => {
      const wasBookmarked = bookmarks.has(a.id);
      setBookmarks((prev) => {
        const next = new Set(prev);
        if (wasBookmarked) next.delete(a.id); else next.add(a.id);
        try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...next])); } catch { /* quota */ }
        return next;
      });
      toast({ title: wasBookmarked ? "Bookmark removed" : "Bookmarked", description: a.name });
    },
    isBookmarked: (id) => bookmarks.has(id),
    importDashboard: (a) => {
      let clip: any = null;
      try { const r = localStorage.getItem(DASH_CLIP); clip = r ? JSON.parse(r) : null; } catch { clip = null; }
      if (clip?.kind === "single" && Array.isArray(clip.widgets)) {
        writeWidgets(a.id, withFreshIds(clip.widgets));
        if (assetSelId === a.id) bumpReload();
        toast({ title: "Dashboard pasted", description: `Cloned dashboard applied to "${a.name}".` });
        return;
      }
      if (clip?.kind === "subtree" && Array.isArray(clip.items)) {
        for (const item of clip.items) writeWidgets(item.assetId, withFreshIds(item.widgets));
        bumpReload();
        toast({ title: "Dashboards restored", description: `${clip.items.length} dashboard(s) applied to their original assets.` });
        return;
      }
      importTargetRef.current = a.id;
      importInputRef.current?.click();
    },
    exportDashboard: (a) => {
      const widgets = readWidgets(a.id);
      downloadJson({ version: 1, asset: a.name, widgets }, `${a.name.replace(/[^\w.-]+/g, "_")}-dashboard.json`);
      toast({ title: "Dashboard exported", description: `${widgets.length} widget(s) downloaded as JSON.` });
    },
    futuristic: (a) => {
      setAssetSelId(a.id);
      const wasOn = futuristicIds.has(a.id);
      setFuturisticIds((prev) => { const next = new Set(prev); if (wasOn) next.delete(a.id); else next.add(a.id); return next; });
      toast({ title: wasOn ? "Futuristic mode off" : "Futuristic mode on", description: a.name });
    },
  };

  const treeControls = (
    <div className="border-b border-border">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs font-semibold text-primary">Asset Hierarchy</span>
        <button
          onClick={() => navigate("/assets")}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
          title="Assets are created and organized in the Asset section — Visualization only reads them"
        >
          <Blocks className="w-3.5 h-3.5" /> Manage assets
        </button>
      </div>
      <div className="flex items-center gap-3 px-3 pb-2 text-xs">
        <button onClick={expandAllAssets} className="text-muted-foreground hover:text-foreground">Expand all</button>
        <button onClick={collapseAllAssets} className="text-muted-foreground hover:text-foreground">Collapse all</button>
      </div>
    </div>
  );

  // Read-only tree: canManage:false hides all asset create/rename/delete controls
  // and the mutation handlers are intentionally omitted. Only dashboard actions
  // (per-asset, localStorage) are wired up.
  const assetTreeCtx = {
    childrenByParent: assetChildren,
    selectedId: assetSelId,
    setSelectedId: setAssetSelId,
    isExpanded: (id: string) => assetExpanded.has(id),
    toggle: (id: string) => setAssetExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    visibleIds: null,
    canManage: false,
    onAssignTemplate: (a: Asset) => navigate(`/assets/${a.id}`),
    dashboard: dashboardActions,
  };
  const selectedAsset = assetSelId ? allAssets.find((a) => a.id === assetSelId) ?? null : null;

  return (
    <div className="p-4 h-full flex flex-col gap-3">
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/data-explorer"))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-1.5">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Visualization</h1>
        </div>
      </div>

      <Card className="flex-1 min-h-0 overflow-hidden shadow-sm">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={26} minSize={18} maxSize={40}>
            <div className="h-full border-r border-border overflow-auto">
              {treeControls}
              <AssetTreeProvider value={assetTreeCtx}>
                <AssetTree loading={!assetsData} />
              </AssetTreeProvider>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={74}>
            <AssetVizPanel
              assetId={assetSelId}
              assetName={selectedAsset?.name}
              assets={allAssets}
              reloadKey={dashReloadNonce}
              futuristic={assetSelId ? futuristicIds.has(assetSelId) : false}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </Card>

      <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
    </div>
  );
}
