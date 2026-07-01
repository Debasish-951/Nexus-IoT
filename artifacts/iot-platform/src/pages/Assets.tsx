import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useListAssets, useListAssetTemplates, useDeleteAsset, getListAssetsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Blocks, Plus, Search, ChevronLeft, ChevronRight, ChevronDown, Filter, ArrowLeft, Trash2, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import {
  Asset, deriveStatus, STATUS_STYLES, siteOf, useAssetHealthMap, HealthBar,
} from "./assetShared";
import CreateAssetWizard from "./CreateAssetWizard";

const PAGE_SIZE = 10;

export default function Assets() {
  const [, navigate] = useLocation();
  const { can } = useCurrentUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteAsset = useDeleteAsset();
  const { data: assets } = useListAssets();
  const { data: templates } = useListAssetTemplates();
  const allAssets = (assets as Asset[] | undefined) ?? [];
  const templateList = (templates as any[] | undefined) ?? [];

  const [search, setSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardParent, setWizardParent] = useState("");      // preset parent for the wizard
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // collapsed tree nodes

  const childrenOf = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of allAssets) if (a.parentId) m[a.parentId] = (m[a.parentId] ?? 0) + 1;
    return m;
  }, [allAssets]);
  const hasKids = (id: string) => (childrenOf[id] ?? 0) > 0;
  const toggle = (id: string) => setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const openAddChild = (parentId: string) => { setWizardParent(parentId); setWizardOpen(true); };

  const isFiltering = search.trim().length > 0 || templateFilter !== "all";

  // Rows: when filtering → flat matches; otherwise → hierarchical (parents then
  // their children indented beneath, depth-first).
  const rows = useMemo<{ asset: Asset; depth: number }[]>(() => {
    if (isFiltering) {
      const q = search.trim().toLowerCase();
      return allAssets
        .filter((a) => {
          if (templateFilter !== "all" && (a.templateId ?? "") !== templateFilter) return false;
          if (!q) return true;
          return a.name.toLowerCase().includes(q) || a.identifier.toLowerCase().includes(q);
        })
        .map((a) => ({ asset: a, depth: 0 }));
    }
    const out: { asset: Asset; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      allAssets
        .filter((a) => (a.parentId ?? null) === parentId)
        .sort((x, y) => x.name.localeCompare(y.name))
        .forEach((a) => { out.push({ asset: a, depth }); if (!collapsed.has(a.id)) walk(a.id, depth + 1); });
    };
    walk(null, 0);
    return out;
  }, [allAssets, search, templateFilter, isFiltering, collapsed]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const healthMap = useAssetHealthMap(pageRows.map((r) => r.asset.id));

  function handleDelete(e: React.MouseEvent, a: Asset) {
    e.stopPropagation();
    if (!confirm(`Delete asset "${a.name}"? This also removes its child assets.`)) return;
    deleteAsset.mutate({ id: a.id }, {
      onSuccess: () => { toast({ title: "Asset deleted" }); qc.invalidateQueries({ queryKey: getListAssetsQueryKey() }); },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  function openEdit(e: React.MouseEvent, a: Asset) { e.stopPropagation(); setEditAsset(a); setEditName(a.name); }
  async function saveEdit() {
    if (!editAsset || !editName.trim()) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/assets/${editAsset.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) { const er = await res.json().catch(() => ({})); toast({ title: "Update failed", description: er.error, variant: "destructive" }); return; }
      toast({ title: "Asset updated" });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      setEditAsset(null);
    } finally { setSavingEdit(false); }
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/asset-management"))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Blocks className="w-5 h-5 text-primary" /> Assets</h1>
          <p className="text-sm text-muted-foreground">View, search and manage all assets</p>
        </div>
        {can("manage_assets") && (
          <Button onClick={() => { setWizardParent(""); setWizardOpen(true); }}><Plus className="w-4 h-4 mr-1.5" /> Create Asset</Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-56 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search assets…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-8 h-9" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={templateFilter} onValueChange={(v) => { setTemplateFilter(v); setPage(0); }}>
            <SelectTrigger className="h-9 w-48 text-sm"><SelectValue placeholder="All templates" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All templates</SelectItem>
              {templateList.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card className="shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-medium">Asset Name</th>
                <th className="text-left px-4 py-2.5 font-medium">Template</th>
                <th className="text-left px-4 py-2.5 font-medium">Site</th>
                <th className="text-left px-4 py-2.5 font-medium">Health</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium">Last Updated</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {!assets ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50"><td colSpan={7} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td></tr>
                ))
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                  <Blocks className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">{allAssets.length === 0 ? "No assets yet" : "No assets match your filters"}</p>
                  {allAssets.length === 0 && can("manage_assets") && (
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => { setWizardParent(""); setWizardOpen(true); }}><Plus className="w-3.5 h-3.5 mr-1" /> Create your first asset</Button>
                  )}
                </td></tr>
              ) : (
                pageRows.map(({ asset: a, depth }) => {
                  const h = healthMap[a.id] ?? null;
                  const status = deriveStatus(a, h);
                  return (
                    <tr key={a.id} onClick={() => navigate(`/assets/${a.id}`)}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer group">
                      <td className="px-4 py-2.5 font-medium">
                        <span className="flex items-center gap-1 group/name" style={{ paddingLeft: depth * 18 }}>
                          {!isFiltering && hasKids(a.id) ? (
                            <button onClick={(e) => { e.stopPropagation(); toggle(a.id); }}
                              className="p-0.5 rounded hover:bg-muted text-muted-foreground shrink-0" title={collapsed.has(a.id) ? "Expand" : "Collapse"}>
                              {collapsed.has(a.id) ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          ) : (
                            <span className="w-[18px] shrink-0 text-center text-muted-foreground/40">{depth > 0 ? "└" : ""}</span>
                          )}
                          <span className="truncate">{a.name}</span>
                          {!isFiltering && can("manage_assets") && (
                            <button onClick={(e) => { e.stopPropagation(); openAddChild(a.id); }}
                              title="Add child asset"
                              className="p-0.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary shrink-0 opacity-0 group-hover/name:opacity-100 transition-opacity">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{a.templateName || "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{siteOf(a, allAssets)}</td>
                      <td className="px-4 py-2.5"><HealthBar pct={h?.freshnessPct ?? null} /></td>
                      <td className="px-4 py-2.5"><span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[status])}>{status}</span></td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.updatedAt ? format(new Date(a.updatedAt), "MM/dd HH:mm") : "—"}</td>
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {can("manage_assets") && (
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button title="Edit asset" onClick={(e) => openEdit(e, a)}
                              className="text-muted-foreground hover:text-primary transition-colors">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button title="Delete asset" onClick={(e) => handleDelete(e, a)}
                              className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {rows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
            <span>{safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, rows.length)} of {rows.length}</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <span className="px-2">{safePage + 1} / {pageCount}</span>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>

      <CreateAssetWizard open={wizardOpen} onOpenChange={setWizardOpen} initialParentId={wizardParent} onCreated={(id) => navigate(`/assets/${id}`)} />

      <Dialog open={!!editAsset} onOpenChange={(v) => { if (!v) setEditAsset(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Asset</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-sm">Asset Name</Label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); }} />
            {editAsset && <p className="text-xs text-muted-foreground">Identifier <code className="font-mono bg-muted px-1 rounded">{editAsset.identifier}</code> can't be changed (it's the device link).</p>}
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
