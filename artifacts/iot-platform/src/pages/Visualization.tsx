import { useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, LayoutDashboard, FolderPlus, ChevronLeft, ChevronRight } from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { AssetVizPanel } from "@/features/dashboards/AssetVizPanel";
import { AssetTreeProvider, type DashboardActions } from "@/components/asset-tree/AssetTreeContext";
import { AssetTree } from "@/components/asset-tree/AssetTree";
import { newId } from "@/features/dashboards/useDashboards";
import { useVizHierarchy, type VizNode } from "@/features/dashboards/vizHierarchy";
import type { Asset } from "@/pages/assetShared";

// ── Per-node dashboard storage helpers (localStorage) ──
const WKEY = (id: string) => `wsviz:widgets:${id}`;
const DASH_CLIP = "wsviz:dashboard-clipboard";
const BOOKMARKS_KEY = "wsviz:bookmarks";
const TEMPLATES_KEY = "viz_templates";
interface DashTemplate { id: string; name: string; widgets: any[]; }
function readTemplates(): DashTemplate[] {
  try { const r = localStorage.getItem(TEMPLATES_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
function readWidgets(id: string): any[] { try { const r = localStorage.getItem(WKEY(id)); return r ? JSON.parse(r) : []; } catch { return []; } }
function writeWidgets(id: string, widgets: any[]) { try { localStorage.setItem(WKEY(id), JSON.stringify(widgets)); } catch { /* quota */ } }
function withFreshIds(widgets: any[]): any[] { return widgets.map((w) => ({ ...w, id: newId("w") })); }
function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

// Visualization owns its OWN hierarchy — it is NOT a mirror of the asset tree in
// Asset Management. The user builds whatever structure suits their reporting, and
// each node holds one dashboard (stored per node in localStorage). Widgets inside
// a dashboard bind to real assets + metrics individually, which is where asset
// attributes come into play (see WidgetConfigPanel).
export default function Visualization() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const viz = useVizHierarchy();
  const [selId, setSelId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // empty = all collapsed
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    try { const r = localStorage.getItem(BOOKMARKS_KEY); return new Set(r ? JSON.parse(r) : []); } catch { return new Set(); }
  });
  const [futuristicIds, setFuturisticIds] = useState<Set<string>>(new Set());
  const [dashReloadNonce, setDashReloadNonce] = useState(0);
  // State, not a ref: the portal target must trigger a re-render once the node
  // exists, or AssetVizPanel would read `null` on the only render that mattered.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);

  // Collapsible hierarchy pane. Driven through the panel's own imperative handle
  // rather than by unmounting it, so its width — and any drag-resize the user did —
  // is restored on expand instead of snapping back to the default.
  const treePanelRef = useRef<ImperativePanelHandle>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  function toggleTree() {
    const panel = treePanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand(); else panel.collapse();
  }
  const importInputRef = useRef<HTMLInputElement>(null);
  const importTargetRef = useRef<string | null>(null);

  // Create / rename node dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [renameNode, setRenameNode] = useState<VizNode | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const allParentIds = useMemo(
    () => Object.keys(viz.childrenByParent).filter((k) => k !== "root"),
    [viz.childrenByParent],
  );
  const expandAll = () => setExpanded(new Set(allParentIds));
  const collapseAll = () => setExpanded(new Set());

  const bumpReload = () => setDashReloadNonce((n) => n + 1);

  // The shared tree components are typed against Asset; viz nodes only ever use
  // id/name/parentId, so present them in that shape.
  const childrenByParent = useMemo(() => {
    const out: Record<string, Asset[]> = {};
    for (const [k, list] of Object.entries(viz.childrenByParent)) {
      out[k] = list.map((n) => ({
        id: n.id, name: n.name, identifier: "", parentId: n.parentId,
        childCount: 0, attributeCount: 0, updatedAt: "",
      })) as Asset[];
    }
    return out;
  }, [viz.childrenByParent]);

  // ── Node CRUD ──
  function openCreate(parentId: string | null) { setCreateParent(parentId); setCreateName(""); setCreateOpen(true); }
  function submitCreate() {
    const name = createName.trim();
    if (!name) return;
    const id = viz.addNode(name, createParent);
    if (createParent) setExpanded((p) => new Set(p).add(createParent));
    setSelId(id);
    setCreateOpen(false);
    toast({ title: "Created", description: `"${name}" added to the Visualization hierarchy.` });
  }
  function openRename(a: Asset) {
    const node = viz.nodes.find((n) => n.id === a.id);
    if (!node) return;
    setRenameNode(node); setRenameValue(node.name);
  }
  function submitRename() {
    if (!renameNode || !renameValue.trim()) return;
    viz.renameNode(renameNode.id, renameValue);
    setRenameNode(null);
    toast({ title: "Renamed" });
  }
  function handleDeleteNode(a: Asset) {
    if (!confirm(`Delete "${a.name}" and its child nodes? Their dashboards will be removed too.`)) return;
    const removed = viz.deleteNode(a.id);
    if (selId && removed.has(selId)) setSelId(null);
    toast({ title: "Deleted", description: `"${a.name}" removed.` });
  }

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
        if (selId === target) bumpReload();
        toast({ title: "Dashboard imported", description: `${widgets.length} widget(s) loaded from file.` });
      } catch {
        toast({ title: "Import failed", description: "That file isn't a valid dashboard JSON.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  }

  const dashboardActions: DashboardActions = {
    edit: (a) => setSelId(a.id),
    clone: (a) => {
      const widgets = readWidgets(a.id);
      if (!widgets.length) { toast({ title: "Nothing to clone", description: `"${a.name}" has no dashboard widgets yet.` }); return; }
      try { localStorage.setItem(DASH_CLIP, JSON.stringify({ kind: "single", name: a.name, widgets })); } catch { /* quota */ }
      toast({ title: "Dashboard copied", description: "Select a target node, then right-click → Import Dashboard to paste it." });
    },
    cloneWithChildren: (a) => {
      const items = [...viz.subtreeIds(a.id)].map((id) => ({ assetId: id, widgets: readWidgets(id) })).filter((x) => x.widgets.length);
      if (!items.length) { toast({ title: "Nothing to clone", description: `"${a.name}" and its children have no dashboards yet.` }); return; }
      try { localStorage.setItem(DASH_CLIP, JSON.stringify({ kind: "subtree", name: a.name, items })); } catch { /* quota */ }
      toast({ title: "Dashboards copied", description: `${items.length} dashboard(s) copied. Right-click any node → Import Dashboard to restore them.` });
    },
    createTemplate: (a) => {
      const widgets = readWidgets(a.id);
      if (!widgets.length) { toast({ title: "Nothing to save", description: `"${a.name}" has no dashboard widgets yet.` }); return; }
      const name = window.prompt("Template name", `${a.name} template`);
      if (!name || !name.trim()) return;
      try {
        const tpls = readTemplates();
        tpls.push({ id: newId("tpl"), name: name.trim(), widgets });
        localStorage.setItem(TEMPLATES_KEY, JSON.stringify(tpls));
        toast({ title: "Template created", description: `"${name.trim()}" saved with ${widgets.length} widget(s).` });
      } catch { toast({ title: "Could not save template", variant: "destructive" }); }
    },
    remove: (a) => {
      if (!confirm(`Delete the dashboard for "${a.name}"? All of its widgets will be removed.`)) return;
      try { localStorage.removeItem(WKEY(a.id)); } catch { /* ignore */ }
      if (selId === a.id) bumpReload();
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
        if (selId === a.id) bumpReload();
        toast({ title: "Dashboard pasted", description: `Cloned dashboard applied to "${a.name}".` });
        return;
      }
      if (clip?.kind === "subtree" && Array.isArray(clip.items)) {
        for (const item of clip.items) writeWidgets(item.assetId, withFreshIds(item.widgets));
        bumpReload();
        toast({ title: "Dashboards restored", description: `${clip.items.length} dashboard(s) applied to their original nodes.` });
        return;
      }
      importTargetRef.current = a.id;
      importInputRef.current?.click();
    },
    exportDashboard: (a) => {
      const widgets = readWidgets(a.id);
      downloadJson({ version: 1, node: a.name, widgets }, `${a.name.replace(/[^\w.-]+/g, "_")}-dashboard.json`);
      toast({ title: "Dashboard exported", description: `${widgets.length} widget(s) downloaded as JSON.` });
    },
    futuristic: (a) => {
      setSelId(a.id);
      const wasOn = futuristicIds.has(a.id);
      setFuturisticIds((prev) => { const next = new Set(prev); if (wasOn) next.delete(a.id); else next.add(a.id); return next; });
      toast({ title: wasOn ? "Futuristic mode off" : "Futuristic mode on", description: a.name });
    },
  };

  const treeControls = (
    <div className="border-b border-border">
      <div className="flex items-center justify-end gap-2 px-3 py-2">
        <Button size="sm" className="h-7 px-2 text-xs whitespace-nowrap" onClick={() => openCreate(null)} title="Create a top-level dashboard">
          <FolderPlus className="w-3.5 h-3.5 mr-1" /> Create Dashboard
        </Button>
      </div>
      <div className="flex items-center gap-3 px-3 pb-2 text-xs">
        <button onClick={expandAll} className="text-muted-foreground hover:text-foreground">Expand all</button>
        <button onClick={collapseAll} className="text-muted-foreground hover:text-foreground">Collapse all</button>
      </div>
    </div>
  );

  // This hierarchy is fully user-owned: create/rename/delete are all wired to the
  // local viz store. `onAssignTemplate` is omitted — these are not assets.
  const assetTreeCtx = {
    childrenByParent,
    selectedId: selId,
    setSelectedId: setSelId,
    isExpanded: (id: string) => expanded.has(id),
    toggle: (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    visibleIds: null,
    canManage: true,
    onAddChild: (parentId: string) => openCreate(parentId),
    onAddRoot: () => openCreate(null),
    onRename: openRename,
    onDelete: handleDeleteNode,
    dashboard: dashboardActions,
  };
  const selectedNode = selId ? viz.nodes.find((n) => n.id === selId) ?? null : null;

  return (
    <div className="p-3 h-full flex flex-col gap-2">
      {/* One row for everything: Back, the page title, and the selected dashboard's
          own toolbar — which AssetVizPanel portals into the slot below rather than
          spending a second full-width strip on it. */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        {/* Back = one level up within THIS section, not browser history (which
            could be any page the user happened to arrive from). */}
        <button onClick={() => navigate("/data-explorer")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground shrink-0">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <LayoutDashboard className="w-4 h-4 text-primary" />
          <h1 className="text-base font-bold">Visualization</h1>
        </div>
        <div ref={setToolbarSlot} className="flex flex-1 items-center gap-2 min-w-0 flex-wrap" />
      </div>

      <Card className="flex-1 min-h-0 overflow-hidden shadow-sm">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel
            ref={treePanelRef}
            defaultSize={14} minSize={11} maxSize={22}
            collapsible collapsedSize={0}
            onCollapse={() => setTreeCollapsed(true)}
            onExpand={() => setTreeCollapsed(false)}
          >
            {/* The scroll container is nested so the collapse tab below stays pinned
                to the pane edge instead of scrolling away with the tree. */}
            <div className="relative h-full">
              <div className="h-full border-r border-border overflow-auto">
                {treeControls}
                <AssetTreeProvider value={assetTreeCtx}>
                  <AssetTree emptyMessage='No nodes yet — click "New" to start building your hierarchy.' />
                </AssetTreeProvider>
              </div>
              {/* Hidden while collapsed: at zero width this would sit on top of the
                  expand tab in the pane next door. */}
              {!treeCollapsed && (
                <button
                  onClick={toggleTree}
                  title="Hide the hierarchy panel"
                  aria-label="Hide the hierarchy panel"
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex h-7 w-4 items-center justify-center rounded-l border border-r-0 border-border bg-card text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={86}>
            <div className="relative h-full">
              <AssetVizPanel
                nodeId={selId}
                nodeName={selectedNode?.name}
                reloadKey={dashReloadNonce}
                futuristic={selId ? futuristicIds.has(selId) : false}
                toolbarTarget={toolbarSlot}
              />
              {/* Only reachable route back once the pane has no width of its own. */}
              {treeCollapsed && (
                <button
                  onClick={toggleTree}
                  title="Show the hierarchy panel"
                  aria-label="Show the hierarchy panel"
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-20 flex h-7 w-4 items-center justify-center rounded-r border border-l-0 border-border bg-card text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Card>

      <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />

      {/* Create node */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FolderPlus className="w-4 h-4 text-primary" /> Create Dashboard</DialogTitle>
            <DialogDescription>
              {createParent
                ? <>Nested under <strong>{viz.nodes.find((n) => n.id === createParent)?.name ?? "the selected node"}</strong>. Each entry in the hierarchy holds its own dashboard.</>
                : "Adds a top-level entry to your Visualization hierarchy. Each entry holds its own dashboard."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label className="text-sm">Name <span className="text-destructive">*</span></Label>
            <Input value={createName} onChange={(e) => setCreateName(e.target.value)} autoFocus
              placeholder="e.g. Plant 1, Line A, Compressor Room"
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={!createName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename node */}
      <Dialog open={!!renameNode} onOpenChange={(v) => { if (!v) setRenameNode(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rename Node</DialogTitle></DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label className="text-sm">Name</Label>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") submitRename(); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameNode(null)}>Cancel</Button>
            <Button onClick={submitRename} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
