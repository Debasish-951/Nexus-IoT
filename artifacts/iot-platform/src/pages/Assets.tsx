import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useListAssets, useDeleteAsset, getListAssetsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Blocks, ArrowLeft } from "lucide-react";
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

  const allParentIds = useMemo(
    () => allAssets.filter((a) => (childrenByParent[a.id]?.length ?? 0) > 0).map((a) => a.id),
    [allAssets, childrenByParent],
  );

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
  const expandAll = () => setExpanded(new Set(allParentIds));
  const collapseAll = () => setExpanded(new Set());

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
            <ResizablePanel defaultSize={28} minSize={18} maxSize={45}>
              <div className="flex flex-col h-full border-r border-border">
                <TreeToolbar
                  query={search} setQuery={setSearch}
                  onExpandAll={expandAll} onCollapseAll={collapseAll}
                  onAdd={() => { setWizardParent(""); setWizardOpen(true); }}
                  canManage={canManage}
                />
                {/* independent scroll for the hierarchy */}
                <div className="flex-1 overflow-auto">
                  <AssetTree loading={!assets} />
                </div>
                <div className="px-3 py-1.5 border-t border-border text-[11px] text-muted-foreground shrink-0">{allAssets.length} asset{allAssets.length !== 1 ? "s" : ""}</div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={72}>
              {/* Full asset details inline — no separate page. */}
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
