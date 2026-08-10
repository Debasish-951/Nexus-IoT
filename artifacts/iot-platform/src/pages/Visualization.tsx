import { useState, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, LayoutDashboard, FolderPlus, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { AssetVizPanel } from "@/features/dashboards/AssetVizPanel";
import { AssetTreeProvider, type DashboardActions } from "@/components/asset-tree/AssetTreeContext";
import { AssetTree } from "@/components/asset-tree/AssetTree";
import { newId } from "@/features/dashboards/useDashboards";
import { useVizHierarchy, type VizNode } from "@/features/dashboards/vizHierarchy";
import { useVizNodes, useVizNodeActions } from "@/features/dashboards/vizStore";
import type { Asset } from "@/pages/assetShared";
import { validateName, LIMITS } from "@/lib/validation";

// Dashboards themselves now live on the server (see features/dashboards/vizStore.ts).
// What stays here is genuinely local: the copy/paste clipboard, this person's
// bookmarks, and the template list.
const DASH_CLIP = "wsviz:dashboard-clipboard";
const BOOKMARKS_KEY = "wsviz:bookmarks";
const TEMPLATES_KEY = "viz_templates";
interface DashTemplate { id: string; name: string; widgets: any[]; }
function readTemplates(): DashTemplate[] {
  try { const r = localStorage.getItem(TEMPLATES_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
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

  // Dashboards come from the same server-backed cache the hierarchy does, so a
  // read here is synchronous against already-loaded data — which is what lets
  // the right-click actions below keep their original shape.
  const { nodes: vizRows } = useVizNodes();
  const { saveWidgets } = useVizNodeActions();
  const readWidgets = useCallback(
    (id: string): any[] => {
      const w = vizRows.find((n) => n.id === id)?.widgets;
      return Array.isArray(w) ? w : [];
    },
    [vizRows],
  );
  // Fire-and-report, not fire-and-forget: a clone or import that fails to reach
  // the server has to say so, or the user believes work was saved that was not.
  const writeWidgets = useCallback(
    (id: string, widgets: any[]) => {
      saveWidgets(id, widgets).catch((e: Error) => {
        toast({ title: "Could not save dashboard", description: e.message || "The server rejected the change.", variant: "destructive" });
      });
    },
    [saveWidgets, toast],
  );

  const [selId, setSelId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // empty = all collapsed
  const [search, setSearch] = useState("");
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
  const [createIssue, setCreateIssue] = useState<string | null>(null);
  const [renameNode, setRenameNode] = useState<VizNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameIssue, setRenameIssue] = useState<string | null>(null);

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

  // Search: a match keeps its whole ancestor chain visible, otherwise a dashboard
  // nested three levels down would have nothing left to render it under. Same
  // rule the Asset Hub tree uses.
  //
  // `!vis.has(p)` both stops the walk once an ancestor is already accounted for
  // and makes it terminate — parentId carries no foreign key, so a cycle in the
  // data is possible and would otherwise hang the page.
  const visibleIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const byId = new Map(viz.nodes.map((n) => [n.id, n]));
    const vis = new Set<string>();
    for (const n of viz.nodes) {
      if (!n.name.toLowerCase().includes(q)) continue;
      vis.add(n.id);
      let p = n.parentId ?? null;
      while (p && !vis.has(p)) { vis.add(p); p = byId.get(p)?.parentId ?? null; }
    }
    return vis;
  }, [viz.nodes, search]);
  const filtering = visibleIds !== null;
  // While filtering, every surviving branch is open — a match hidden inside a
  // collapsed parent is a match the user cannot see.
  const isExpanded = useCallback(
    (id: string) => (filtering ? true : expanded.has(id)),
    [filtering, expanded],
  );

  // ── Node CRUD ──
  function openCreate(parentId: string | null) {
    setCreateParent(parentId); setCreateName(""); setCreateIssue(null); setCreateOpen(true);
  }
  function submitCreate() {
    // Mirrors the server rule. Without this the only feedback for a name the
    // API will reject is the button doing nothing, because the old guard was
    // `if (!name) return` — silent for every reason other than empty.
    const issue = validateName(createName);
    if (issue) { setCreateIssue(issue); return; }
    const name = createName.trim();
    const id = viz.addNode(name, createParent);
    if (createParent) setExpanded((p) => new Set(p).add(createParent));
    setSelId(id);
    setCreateOpen(false);
    toast({ title: "Created", description: `"${name}" added to the Visualization hierarchy.` });
  }
  function openRename(a: Asset) {
    const node = viz.nodes.find((n) => n.id === a.id);
    if (!node) return;
    setRenameNode(node); setRenameValue(node.name); setRenameIssue(null);
  }
  function submitRename() {
    if (!renameNode) return;
    const issue = validateName(renameValue);
    if (issue) { setRenameIssue(issue); return; }
    viz.renameNode(renameNode.id, renameValue.trim());
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
      // Clears the node's dashboard; the node itself stays. An empty widget list
      // IS the delete, so it goes through the same save path and reports the same
      // failures as any other write.
      writeWidgets(a.id, []);
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
    <div className="border-b border-border shrink-0">
      {/* Wraps rather than squeezing: this pane can be dragged down to ~11% of the
          window, where the search field would otherwise be crushed to its icon. */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <Button size="sm" className="h-7 px-2 text-xs whitespace-nowrap shrink-0" onClick={() => openCreate(null)} title="Create a top-level dashboard">
          <FolderPlus className="w-3.5 h-3.5 mr-1" /> Create Dashboard
        </Button>
        <div className="relative flex-1 min-w-[110px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dashboards…"
            aria-label="Search dashboards"
            className="pl-7 h-7 text-xs"
          />
        </div>
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
    isExpanded,
    toggle: (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    visibleIds,
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
              {/* The controls sit OUTSIDE the scroll box. Inside it they added their
                  own height on top of the tree's `h-full` empty state, so the pane
                  overflowed by exactly the toolbar height and showed a scrollbar
                  even with nothing to scroll. */}
              <div className="h-full flex flex-col border-r border-border">
                {treeControls}
                <div className="flex-1 min-h-0 overflow-auto">
                  {/* AssetTree's own empty state keys off the unfiltered roots, so a
                      search that matches nothing would render a blank pane. */}
                  {filtering && visibleIds!.size === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 text-center">
                      <Search className="w-8 h-8 mb-2 opacity-20" />
                      <p className="text-sm">No dashboards match “{search.trim()}”.</p>
                    </div>
                  ) : (
                    <AssetTreeProvider value={assetTreeCtx}>
                      <AssetTree emptyMessage='No dashboards yet — click "Create Dashboard" to start building your hierarchy.' />
                    </AssetTreeProvider>
                  )}
                </div>
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
            <Input value={createName} maxLength={LIMITS.name} autoFocus
              onChange={(e) => { setCreateName(e.target.value); if (createIssue) setCreateIssue(null); }}
              aria-invalid={!!createIssue}
              placeholder="e.g. Plant 1, Line A, Compressor Room"
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); }} />
            {createIssue && <p className="text-xs text-destructive">{createIssue}</p>}
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
            <Input value={renameValue} maxLength={LIMITS.name} autoFocus
              onChange={(e) => { setRenameValue(e.target.value); if (renameIssue) setRenameIssue(null); }}
              aria-invalid={!!renameIssue}
              onKeyDown={(e) => { if (e.key === "Enter") submitRename(); }} />
            {renameIssue && <p className="text-xs text-destructive">{renameIssue}</p>}
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
