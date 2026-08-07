import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useListAssets, useDeleteAsset, getListAssetsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { Blocks, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { Asset } from "./assetShared";
import CreateAssetWizard from "./CreateAssetWizard";
import { AssetTreeProvider } from "@/components/asset-tree/AssetTreeContext";
import { AssetTree } from "@/components/asset-tree/AssetTree";
import { TreeToolbar } from "@/components/asset-tree/TreeToolbar";
import AssetDetails from "./AssetDetails";
import { MousePointerClick } from "lucide-react";
import { apiFetch } from "@/lib/auth-api";

export default function Assets() {
  const [, navigate] = useLocation();
  const { can } = useCurrentUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteAsset = useDeleteAsset();
  const { data: assets } = useListAssets();
  const allAssets = (assets as Asset[] | undefined) ?? [];
  const canManage = can("manage_assets");

  const [search, setSearch] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardParent, setWizardParent] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());  // empty = all collapsed (default)
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Collapsible hierarchy pane — same mechanism as Visualization's tree panel:
  // driven through the panel's own imperative handle rather than unmounting it,
  // so its width (and any drag-resize) is restored on expand instead of
  // snapping back to the default.
  const treePanelRef = useRef<ImperativePanelHandle>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  function toggleTree() {
    const panel = treePanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand(); else panel.collapse();
  }

  // Group children by parent once (memoized) — supports large/deep trees.
  const childrenByParent = useMemo(() => {
    const m: Record<string, Asset[]> = {};
    for (const a of allAssets) {
      const k = a.parentId ?? "root";
      (m[k] ||= []).push(a);
    }
    for (const k in m) m[k].sort((x, y) => x.name.localeCompare(y.name));
    return m;
  }, [allAssets]);

  // Search filter: show matches + their ancestors (so the path stays visible),
  // and force-expand while filtering.
  const visibleIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const byId = new Map(allAssets.map((a) => [a.id, a]));
    const vis = new Set<string>();
    for (const a of allAssets) {
      if (!(a.name.toLowerCase().includes(q) || (a.identifier ?? "").toLowerCase().includes(q))) continue;
      vis.add(a.id);
      let p = a.parentId ?? null;
      while (p) { vis.add(p); p = byId.get(p)?.parentId ?? null; }
    }
    return vis;
  }, [allAssets, search]);

  const filtering = visibleIds !== null;
  const isExpanded = useCallback(
    (id: string) => (filtering ? true : expanded.has(id)),
    [filtering, expanded],
  );
  const toggle = useCallback(
    (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    [],
  );
  const openAddChild = (parentId: string) => { setWizardParent(parentId); setWizardOpen(true); };

  function handleDelete(a: Asset) {
    if (!confirm(`Delete asset "${a.name}"? This also removes its child assets.`)) return;
    deleteAsset.mutate({ id: a.id }, {
      onSuccess: () => { toast({ title: "Asset deleted" }); if (selectedId === a.id) setSelectedId(null); qc.invalidateQueries({ queryKey: getListAssetsQueryKey() }); },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [editName, setEditName] = useState("");
  const [editIdentifier, setEditIdentifier] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Registered device ids, for binding a device to this asset. Assets are created
  // device-less, so this dialog is where the Device ID link is made or changed.
  const [seenDevices, setSeenDevices] = useState<{ deviceId: string }[]>([]);
  useEffect(() => {
    if (!editAsset) return;
    apiFetch("/api/ingest/seen-devices")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setSeenDevices(Array.isArray(d) ? d : []))
      .catch(() => setSeenDevices([]));
  }, [editAsset]);
  // A device is taken if some OTHER asset already uses it as its identifier.
  const takenByOther = useMemo(
    () => new Set(allAssets.filter((a) => a.id !== editAsset?.id).map((a) => a.identifier).filter(Boolean)),
    [allAssets, editAsset],
  );

  function openEdit(a: Asset) { setEditAsset(a); setEditName(a.name); setEditIdentifier(a.identifier ?? ""); }
  async function saveEdit() {
    if (!editAsset || !editName.trim()) return;
    setSavingEdit(true);
    try {
      const res = await apiFetch(`/api/assets/${editAsset.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), identifier: editIdentifier }),
      });
      if (!res.ok) { const er = await res.json().catch(() => ({})); toast({ title: "Update failed", description: er.error, variant: "destructive" }); return; }
      toast({ title: "Asset updated" });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      setEditAsset(null);
    } finally { setSavingEdit(false); }
  }

  const selectedAsset = selectedId ? allAssets.find((a) => a.id === selectedId) ?? null : null;

  const ctx = {
    childrenByParent, selectedId, setSelectedId, isExpanded, toggle, visibleIds, canManage,
    onAddChild: openAddChild,
    onRename: openEdit,
    onDelete: handleDelete,
    onAssignTemplate: (a: Asset) => navigate(`/assets/${a.id}`),
  };

  return (
    <div className="p-6 space-y-3 h-full flex flex-col">
      <button onClick={() => navigate("/asset-management")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground shrink-0">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="shrink-0">
        <h1 className="text-xl font-bold flex items-center gap-2"><Blocks className="w-5 h-5 text-primary" /> Assets</h1>
        <p className="text-sm text-muted-foreground">Browse the asset hierarchy — select a node to see its details.</p>
      </div>

      <Card className="flex-1 min-h-0 overflow-hidden shadow-sm">
        <AssetTreeProvider value={ctx}>
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel
              ref={treePanelRef}
              // Sizes are percentages of the card, so a narrow viewport turned
              // the old 11% floor into a pane too thin to hold its own toolbar:
              // the search field collapsed to its icon and the buttons clipped.
              // The floor is now wide enough to keep the tree readable at any
              // window size, and the default opens at the width the panel is
              // actually usable at rather than the narrowest it tolerates.
              // Collapsing to zero still works — that is `collapsedSize`, which
              // bypasses `minSize`, and is why there is no CSS min-width here.
              defaultSize={20} minSize={17} maxSize={32}
              collapsible collapsedSize={0}
              onCollapse={() => setTreeCollapsed(true)}
              onExpand={() => setTreeCollapsed(false)}
            >
              {/* The scroll container is nested so the collapse tab below stays pinned
                  to the pane edge instead of scrolling away with the tree. */}
              <div className="relative h-full">
                <div className="flex flex-col h-full border-r border-border">
                  <TreeToolbar
                    query={search} setQuery={setSearch}
                    onAdd={() => { setWizardParent(""); setWizardOpen(true); }}
                    canManage={canManage}
                  />
                  {/* independent scroll for the hierarchy */}
                  <div className="flex-1 overflow-auto">
                    <AssetTree loading={!assets} />
                  </div>
                  <div className="px-3 py-1.5 border-t border-border text-[11px] text-muted-foreground shrink-0">{allAssets.length} asset{allAssets.length !== 1 ? "s" : ""}</div>
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
            <ResizablePanel defaultSize={80}>
              {/* Full asset details inline — no separate page. */}
              <div className="relative h-full">
                <div className="h-full overflow-auto">
                  {selectedAsset ? (
                    <AssetDetails assetId={selectedAsset.id} embedded />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                      <MousePointerClick className="w-10 h-10 mb-3 opacity-20" />
                      <p className="text-sm">Select an asset from the tree to view its full details.</p>
                    </div>
                  )}
                </div>
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
        </AssetTreeProvider>
      </Card>

      <CreateAssetWizard open={wizardOpen} onOpenChange={setWizardOpen} initialParentId={wizardParent} onCreated={(id) => { setSelectedId(id); }} />

      <Dialog open={!!editAsset} onOpenChange={(v) => { if (!v) setEditAsset(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Asset</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Asset Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); }} />
            </div>
            {/* Read-only: the Device ID is declared on the asset template and stamped on
                when the template is applied, so there is one place it can be wrong
                instead of two that can disagree. */}
            <div className="space-y-1.5">
              <Label className="text-sm">Device ID</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
                <span className={editIdentifier ? "font-mono" : "text-muted-foreground"}>
                  {editIdentifier || "— none (grouping asset) —"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Comes from the asset template. Set it on the template (Asset Templates → your
                template → Device ID); applying the template binds this asset to that payload.
              </p>
              {/* Applying a template never clears a binding, so unbinding needs an explicit
                  action — otherwise a mis-bound asset could not be corrected from the UI. */}
              {editIdentifier && (
                <button onClick={() => setEditIdentifier("")}
                  className="text-xs text-muted-foreground underline hover:text-destructive">
                  Unbind this device
                </button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAsset(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit || !editName.trim()}>{savingEdit ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
