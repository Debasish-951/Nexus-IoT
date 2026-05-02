import { useState, useRef } from "react";
import {
  useListAssets,
  useListAssetAttributes,
  useCreateAsset,
  useDeleteAsset,
  useListAssetTemplates,
  getListAssetsQueryKey,
  getListAssetAttributesQueryKey,
  useCreateAssetAttribute,
  useDeleteAttribute,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronRight, ChevronDown, Blocks, Plus, Trash2, Edit2,
  Search, Download, FileSpreadsheet, Braces, LayoutTemplate,
  CheckCircle2, AlertTriangle, Info, Folder, FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Asset {
  id: string; name: string; identifier: string;
  parentId?: string | null; templateId?: string | null;
  templateName?: string | null; childCount: number;
  attributeCount: number; updatedAt: string;
}
interface AttrDef {
  name: string; type: string; dataType: string;
  value?: string; tagName?: string; uom?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function AttributeType({ type }: { type: string }) {
  const colors: Record<string, string> = {
    static:  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    dynamic: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    metric:  "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  };
  return <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", colors[type] ?? "bg-muted text-muted-foreground")}>{type}</span>;
}

// ── Asset tree node with inline "Add child" ───────────────────────────────────
function AssetTreeNode({ asset, allAssets, selectedId, onSelect, onAddChild, depth }: {
  asset: Asset; allAssets: Asset[]; selectedId: string | null;
  onSelect: (a: Asset) => void; onAddChild: (parentId: string) => void; depth: number;
}) {
  const children = allAssets.filter((a) => a.parentId === asset.id);
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = children.length > 0;
  const isSelected = selectedId === asset.id;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 py-1 px-1 rounded cursor-pointer text-sm transition-colors",
          isSelected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60"
        )}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        onClick={() => onSelect(asset)}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); setExpanded((o) => !o); }} className="shrink-0 p-0.5">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : <span className="w-4 shrink-0" />}

        {/* Icon: folder for groups, block for leaf */}
        {hasChildren || asset.childCount > 0
          ? expanded
            ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500/80" />
            : <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500/80" />
          : <Blocks className="w-3.5 h-3.5 shrink-0 text-primary/60" />
        }

        <span className="truncate flex-1 text-xs">{asset.name}</span>

        {/* Inline add-child button */}
        <button
          title="Add child asset"
          onClick={(e) => { e.stopPropagation(); onAddChild(asset.id); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all shrink-0"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {expanded && children.map((child) => (
        <AssetTreeNode key={child.id} asset={child} allAssets={allAssets}
          selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCsv(text: string): AttrDef[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const results: AttrDef[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.every((c) => !c)) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ""; });
    results.push({
      name:     row.name     || `Attr ${i}`,
      type:     row.type     || "static",
      dataType: row.datatype || row["data_type"] || "text",
      value:    row.value    || undefined,
      tagName:  row.tagname  || row["tag_name"] || row.tag || undefined,
      uom:      row.uom      || row.unit || undefined,
    });
  }
  return results;
}

const CSV_EXAMPLE = `name,type,dataType,tagName,uom
Temperature,dynamic,double,sensorgrow.temperature,°C
Vibration RMS X,dynamic,double,sensorgrow.vibration_rms_velocity_x,mm/s
Sensor Serial,static,text,sensorgrow.sensor_serial,`;

const JSON_EXAMPLE = JSON.stringify([
  { name: "Temperature", type: "dynamic", dataType: "double", tagName: "sensorgrow.temperature", uom: "°C" },
  { name: "Sensor Serial", type: "static", dataType: "text", tagName: "sensorgrow.sensor_serial" },
], null, 2);

// ── Main component ────────────────────────────────────────────────────────────
export default function Assets() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch]                 = useState("");
  const [selectedAsset, setSelectedAsset]   = useState<Asset | null>(null);
  const [addAssetOpen, setAddAssetOpen]     = useState(false);
  const [addAssetParentId, setAddAssetParentId] = useState<string | null>(null);
  const [addAttrOpen, setAddAttrOpen]       = useState(false);
  const [importOpen, setImportOpen]         = useState(false);
  const [importTab, setImportTab]           = useState<"template" | "csv" | "json">("template");

  const [csvText, setCsvText]               = useState("");
  const [jsonText, setJsonText]             = useState("");
  const [previewRows, setPreviewRows]       = useState<AttrDef[]>([]);
  const [parseError, setParseError]         = useState<string | null>(null);
  const [importing, setImporting]           = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const { data: assets }     = useListAssets();
  const { data: attributes } = useListAssetAttributes(selectedAsset?.id ?? "", {
    query: { enabled: !!selectedAsset?.id, queryKey: getListAssetAttributesQueryKey(selectedAsset?.id ?? "") },
  });
  const { data: templates } = useListAssetTemplates();

  const createAsset = useCreateAsset();
  const deleteAsset = useDeleteAsset();
  const createAttr  = useCreateAssetAttribute();
  const deleteAttr  = useDeleteAttribute();

  const assetForm = useForm({ defaultValues: { name: "", identifier: "", parentId: "" } });
  const attrForm  = useForm({ defaultValues: { name: "", type: "static", dataType: "text", value: "", tagName: "", uom: "" } });

  const allAssets    = (assets     as Asset[] | undefined) ?? [];
  const templateList = (templates  as any[]   | undefined) ?? [];
  const rootAssets   = allAssets.filter((a) => !a.parentId);
  const attrList     = (attributes as any[] | undefined) ?? [];

  const filteredSearch = search
    ? allAssets.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()) || a.identifier.toLowerCase().includes(search.toLowerCase()))
    : [];

  // Build indented label for parent selector
  function buildParentLabel(asset: Asset, depth = 0): string {
    return `${"  ".repeat(depth)}${asset.name}`;
  }
  function flattenTree(roots: Asset[], all: Asset[], depth = 0): Array<{ asset: Asset; depth: number }> {
    const result: Array<{ asset: Asset; depth: number }> = [];
    for (const a of roots) {
      result.push({ asset: a, depth });
      const children = all.filter((c) => c.parentId === a.id);
      result.push(...flattenTree(children, all, depth + 1));
    }
    return result;
  }
  const treeFlat = flattenTree(rootAssets, allAssets);

  // ── Open Add Asset dialog, optionally pre-fill parent ─────────────────────
  function openAddAsset(parentId: string | null = null) {
    setAddAssetParentId(parentId);
    assetForm.reset({ name: "", identifier: "", parentId: parentId ?? "" });
    setAddAssetOpen(true);
  }

  // ── Auto-generate identifier from name ────────────────────────────────────
  function handleNameChange(name: string) {
    assetForm.setValue("name", name);
    const current = assetForm.getValues("identifier");
    if (!current || current === assetForm.getValues("name").toLowerCase().replace(/\s+/g, "_")) {
      assetForm.setValue("identifier", name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
    }
  }

  // ── Parse preview ─────────────────────────────────────────────────────────
  function handleParse() {
    setParseError(null);
    setPreviewRows([]);
    try {
      if (importTab === "csv") {
        const rows = parseCsv(csvText);
        if (rows.length === 0) { setParseError("No data rows found. Check the CSV format."); return; }
        setPreviewRows(rows);
      } else if (importTab === "json") {
        const parsed = JSON.parse(jsonText);
        setPreviewRows(Array.isArray(parsed) ? parsed : [parsed]);
      }
    } catch (e: any) {
      setParseError(e.message);
    }
  }

  // ── Bulk import ───────────────────────────────────────────────────────────
  async function handleBulkImport() {
    if (!selectedAsset || previewRows.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/assets/${selectedAsset.id}/attributes/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: previewRows }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Import failed", description: data.error, variant: "destructive" }); return; }
      const desc = data.skipped > 0
        ? `${data.created} created · ${data.skipped} skipped (already exist): ${(data.skippedItems ?? []).join(", ")}`
        : `${data.created} attribute(s) created`;
      toast({ title: "Import complete", description: desc });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      setImportOpen(false);
      setPreviewRows([]); setCsvText(""); setJsonText("");
    } finally {
      setImporting(false);
    }
  }

  // ── Apply template ────────────────────────────────────────────────────────
  async function handleApplyTemplate() {
    if (!selectedAsset) return;
    const tid = selectedTemplateId || selectedAsset.templateId || "";
    if (!tid) { toast({ title: "Please select a template", variant: "destructive" }); return; }
    setApplyingTemplate(true);
    try {
      const res = await fetch(`/api/assets/${selectedAsset.id}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: tid }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Failed", description: data.error, variant: "destructive" }); return; }
      let desc = `${data.created} attribute(s) created`;
      if (data.skipped > 0) desc += ` · ${data.skipped} skipped (already exist): ${(data.skippedItems ?? []).join(", ")}`;
      toast({ title: `Template "${data.templateName}" applied`, description: desc });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      setImportOpen(false);
      setSelectedTemplateId("");
    } finally {
      setApplyingTemplate(false);
    }
  }

  // ── Export CSV ────────────────────────────────────────────────────────────
  function handleExportCsv() {
    if (attrList.length === 0) return;
    const header = "name,type,dataType,value,tagName,uom";
    const rows = attrList.map((a: any) =>
      [a.name, a.type, a.dataType,
        a.value != null ? String(typeof a.value === "object" ? JSON.stringify(a.value) : a.value) : "",
        a.tagName ?? "", a.uom ?? ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${selectedAsset?.identifier ?? "attributes"}_attributes.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // ── Add asset ─────────────────────────────────────────────────────────────
  function onAddAsset(data: { name: string; identifier: string; parentId?: string }) {
    createAsset.mutate(
      { data: { name: data.name, identifier: data.identifier, parentId: data.parentId || null } },
      {
        onSuccess: (created: any) => {
          toast({ title: "Asset created", description: data.parentId ? `Added under ${allAssets.find((a) => a.id === data.parentId)?.name ?? "parent"}` : "Added at root level" });
          qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
          setAddAssetOpen(false);
          assetForm.reset();
        },
      }
    );
  }

  function onAddAttr(data: { name: string; type: string; dataType: string; value?: string; tagName?: string; uom?: string }) {
    if (!selectedAsset) return;
    createAttr.mutate(
      { id: selectedAsset.id, data: { name: data.name, type: data.type as any, dataType: data.dataType as any, value: data.value || null, tagName: data.tagName || null, uom: data.uom || null } },
      {
        onSuccess: () => {
          toast({ title: "Attribute added" });
          qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) });
          setAddAttrOpen(false); attrForm.reset();
        },
      }
    );
  }

  function closeImport() {
    setImportOpen(false);
    setPreviewRows([]); setParseError(null); setCsvText(""); setJsonText("");
    setSelectedTemplateId("");
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Asset tree ─────────────────────────────────────────────────── */}
      <div className="w-64 border-r border-border flex flex-col shrink-0 bg-card">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search assets…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-1.5 space-y-0.5">
            {!assets ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full rounded" />)
            ) : search ? (
              filteredSearch.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No assets match</p>
              ) : (
                filteredSearch.map((a) => (
                  <div key={a.id} onClick={() => setSelectedAsset(a)}
                    className={cn("flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-xs transition-colors",
                      selectedAsset?.id === a.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60")}>
                    <Blocks className="w-3.5 h-3.5 shrink-0 text-primary/60" />
                    <span className="truncate">{a.name}</span>
                  </div>
                ))
              )
            ) : rootAssets.length === 0 ? (
              <div className="px-3 py-8 text-center text-muted-foreground">
                <Blocks className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-xs">No assets yet</p>
                <Button size="sm" variant="outline" className="mt-2 text-xs h-7" onClick={() => openAddAsset(null)}>
                  <Plus className="w-3 h-3 mr-1" /> Add first asset
                </Button>
              </div>
            ) : (
              rootAssets.map((a) => (
                <AssetTreeNode key={a.id} asset={a} allAssets={allAssets}
                  selectedId={selectedAsset?.id ?? null}
                  onSelect={setSelectedAsset}
                  onAddChild={(pid) => openAddAsset(pid)}
                  depth={0}
                />
              ))
            )}
          </div>
        </ScrollArea>

        <div className="p-2 border-t border-border">
          <Button size="sm" variant="outline" className="w-full text-xs h-7" onClick={() => openAddAsset(null)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Root Asset
          </Button>
        </div>
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedAsset ? (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-sm truncate">{selectedAsset.name}</h2>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{selectedAsset.identifier}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedAsset.templateName && (
                  <Badge variant="secondary" className="text-xs">{selectedAsset.templateName}</Badge>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openAddAsset(selectedAsset.id)}>
                  <Plus className="w-3 h-3 mr-1" /> Add Child
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 text-xs"
                  onClick={() => deleteAsset.mutate({ id: selectedAsset.id }, {
                    onSuccess: () => { toast({ title: "Asset deleted" }); qc.invalidateQueries({ queryKey: getListAssetsQueryKey() }); setSelectedAsset(null); }
                  })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <Tabs defaultValue="attributes" className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 pt-2 border-b border-border bg-card">
                <TabsList className="h-8">
                  <TabsTrigger value="attributes" className="text-xs h-7">Attributes</TabsTrigger>
                  <TabsTrigger value="table" className="text-xs h-7">Table</TabsTrigger>
                  <TabsTrigger value="media" className="text-xs h-7">Media</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="attributes" className="flex-1 overflow-auto m-0">
                {/* Toolbar */}
                <div className="p-3 flex items-center gap-2 border-b border-border bg-muted/30 flex-wrap">
                  <Button size="sm" className="h-7 text-xs" onClick={() => setAddAttrOpen(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add
                  </Button>
                  <div className="h-5 w-px bg-border" />
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => { setImportTab("template"); setImportOpen(true); setPreviewRows([]); }}>
                    <LayoutTemplate className="w-3.5 h-3.5 mr-1" /> Apply Template
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => { setImportTab("csv"); setImportOpen(true); setPreviewRows([]); setCsvText(""); }}>
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Import CSV
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => { setImportTab("json"); setImportOpen(true); setPreviewRows([]); setJsonText(""); }}>
                    <Braces className="w-3.5 h-3.5 mr-1" /> Import JSON
                  </Button>
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                    onClick={handleExportCsv} disabled={attrList.length === 0}>
                    <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
                  </Button>
                  <span className="text-xs text-muted-foreground">{attrList.length} attribute{attrList.length !== 1 ? "s" : ""}</span>
                </div>

                {/* Attribute table */}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 sticky top-0 z-10">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-8"></th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Value</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tag Name</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">UoM</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Quality</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Timestamp</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {!attributes ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td colSpan={9} className="px-3 py-2"><Skeleton className="h-3 w-full" /></td>
                        </tr>
                      ))
                    ) : attrList.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-12 text-center">
                          <div className="flex flex-col items-center gap-3 text-muted-foreground">
                            <Blocks className="w-8 h-8 opacity-20" />
                            <p className="text-sm">No attributes yet</p>
                            <p className="text-xs opacity-60 max-w-xs">
                              Apply a template to stamp all attribute definitions in one click, or add attributes one by one.
                            </p>
                            <Button size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => { setImportTab("template"); setImportOpen(true); }}>
                              <LayoutTemplate className="w-3.5 h-3.5 mr-1" /> Apply Template
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      attrList.map((attr: any) => (
                        <tr key={attr.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                          <td className="px-3 py-2">
                            <button className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100">
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </td>
                          <td className="px-3 py-2"><AttributeType type={attr.type} /></td>
                          <td className="px-3 py-2 font-medium">{attr.name}</td>
                          <td className="px-3 py-2 font-mono">
                            {attr.value != null
                              ? String(typeof attr.value === "object" ? JSON.stringify(attr.value) : attr.value)
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground font-mono">
                            {attr.tagName ?? <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2">{attr.uom ?? <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-3 py-2">
                            {attr.quality
                              ? <span className={cn("text-xs", attr.quality === "good" ? "text-green-600" : "text-yellow-600")}>{attr.quality}</span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {attr.timestamp ? format(new Date(attr.timestamp), "MM/dd HH:mm:ss") : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            <button className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                              onClick={() => deleteAttr.mutate({ id: attr.id }, {
                                onSuccess: () => { toast({ title: "Attribute deleted" }); qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) }); }
                              })}>
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TabsContent>

              <TabsContent value="table" className="flex-1 flex items-center justify-center m-0">
                <p className="text-sm text-muted-foreground">Table view — coming soon</p>
              </TabsContent>
              <TabsContent value="media" className="flex-1 flex items-center justify-center m-0">
                <p className="text-sm text-muted-foreground">Media view — coming soon</p>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Blocks className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">Select an asset to view its attributes</p>
              <p className="text-xs mt-1 opacity-60">Hover a tree node and click + to add a child asset</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Add Asset Dialog ──────────────────────────────────────────────── */}
      <Dialog open={addAssetOpen} onOpenChange={(v) => { if (!v) { setAddAssetOpen(false); assetForm.reset(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Asset</DialogTitle>
            <DialogDescription>
              {addAssetParentId
                ? `Adding a child under "${allAssets.find((a) => a.id === addAssetParentId)?.name ?? "selected asset"}"`
                : "Adding a new root-level asset (e.g. a plant, site, or facility)"}
            </DialogDescription>
          </DialogHeader>
          <Form {...assetForm}>
            <form onSubmit={assetForm.handleSubmit(onAddAsset)} className="space-y-4">
              <FormField control={assetForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Fan, Compressor, Plant 2"
                      {...field}
                      onChange={(e) => handleNameChange(e.target.value)} />
                  </FormControl>
                </FormItem>
              )} />

              <FormField control={assetForm.control} name="identifier" render={({ field }) => (
                <FormItem>
                  <FormLabel>Identifier *</FormLabel>
                  <FormControl>
                    <Input placeholder="unique_key (auto-filled from name)" className="font-mono" {...field} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Used as the tag name prefix — e.g. <code className="bg-muted px-1 rounded">fan_de</code> → tags like <code className="bg-muted px-1 rounded">fan_de.temperature</code>
                  </FormDescription>
                </FormItem>
              )} />

              {/* Parent selector — only shown when creating a root asset (allows re-parenting) */}
              {!addAssetParentId && (
                <FormField control={assetForm.control} name="parentId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parent Asset <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <Select value={field.value || "__root__"} onValueChange={(v) => field.onChange(v === "__root__" ? "" : v)}>
                      <FormControl><SelectTrigger><SelectValue placeholder="None (root level)" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="__root__">None (root level)</SelectItem>
                        {treeFlat.map(({ asset, depth }) => (
                          <SelectItem key={asset.id} value={asset.id}>
                            {"  ".repeat(depth)}{depth > 0 ? "└ " : ""}{asset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">Place this asset under an existing node in the hierarchy</FormDescription>
                  </FormItem>
                )} />
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setAddAssetOpen(false); assetForm.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createAsset.isPending}>Add Asset</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Add Attribute Dialog ─────────────────────────────────────────── */}
      <Dialog open={addAttrOpen} onOpenChange={setAddAttrOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Attribute</DialogTitle></DialogHeader>
          <Form {...attrForm}>
            <form onSubmit={attrForm.handleSubmit(onAddAttr)} className="space-y-4">
              <FormField control={attrForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="e.g. Temperature" {...field} /></FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={attrForm.control} name="type" render={({ field }) => (
                  <FormItem><FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="static">Static</SelectItem>
                        <SelectItem value="dynamic">Dynamic</SelectItem>
                        <SelectItem value="metric">Metric</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={attrForm.control} name="dataType" render={({ field }) => (
                  <FormItem><FormLabel>Data Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="double">Double</SelectItem>
                        <SelectItem value="boolean">Boolean</SelectItem>
                        <SelectItem value="timestamp">Timestamp</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={attrForm.control} name="tagName" render={({ field }) => (
                  <FormItem><FormLabel>Tag Name</FormLabel>
                    <FormControl><Input placeholder="device.metric_key" className="font-mono text-xs" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={attrForm.control} name="uom" render={({ field }) => (
                  <FormItem><FormLabel>UoM</FormLabel><FormControl><Input placeholder="°C, mm/s, V" {...field} /></FormControl></FormItem>
                )} />
              </div>
              <FormField control={attrForm.control} name="value" render={({ field }) => (
                <FormItem><FormLabel>Value <span className="text-muted-foreground font-normal">(optional, for static)</span></FormLabel>
                  <FormControl><Input placeholder="e.g. S125010T1TA10" {...field} /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setAddAttrOpen(false); attrForm.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createAttr.isPending}>Add Attribute</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Apply Template / Import Dialog ──────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(v) => { if (!v) closeImport(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Attributes to "{selectedAsset?.name}"</DialogTitle>
            <DialogDescription>
              Three ways to bulk-add attributes. Duplicates (same name or tag) are automatically skipped.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={importTab} onValueChange={(v) => { setImportTab(v as any); setPreviewRows([]); setParseError(null); }}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="template" className="text-xs gap-1.5">
                <LayoutTemplate className="w-3 h-3" /> Apply Template
              </TabsTrigger>
              <TabsTrigger value="csv" className="text-xs gap-1.5">
                <FileSpreadsheet className="w-3 h-3" /> CSV
              </TabsTrigger>
              <TabsTrigger value="json" className="text-xs gap-1.5">
                <Braces className="w-3 h-3" /> JSON Array
              </TabsTrigger>
            </TabsList>

            {/* ── Apply Template tab ────────────────────────────────────── */}
            <TabsContent value="template" className="space-y-3 mt-3">
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-3 space-y-1.5 text-xs">
                <p className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" /> How Apply Template works
                </p>
                <ul className="text-blue-700 dark:text-blue-400 space-y-1">
                  <li>• You define the attribute schema once in <strong>Asset Templates</strong> (by pasting a Node-RED payload)</li>
                  <li>• Here you stamp that schema onto this asset — it copies every attribute definition in bulk</li>
                  <li>• Tag names are resolved automatically: template key <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">temperature</code> → <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">{selectedAsset?.identifier ?? "asset"}.temperature</code></li>
                  <li>• If an attribute already exists on this asset it is <strong>skipped</strong>, not duplicated</li>
                </ul>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Select Template</label>
                <Select value={selectedTemplateId || selectedAsset?.templateId || ""}
                  onValueChange={setSelectedTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templateList.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} <span className="text-muted-foreground ml-1">({t.attributeCount} attrs)</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {templateList.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No templates yet — go to Asset Templates, paste a device payload, and save.
                  </p>
                )}
              </div>

              {/* Preview of what will be added */}
              {(() => {
                const tid = selectedTemplateId || selectedAsset?.templateId || "";
                const tmpl = templateList.find((t: any) => t.id === tid);
                const defs: any[] = tmpl?.attributeDefinitions ?? [];
                if (!tmpl || defs.length === 0) return null;
                return (
                  <div className="rounded border border-border overflow-hidden">
                    <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                      Preview — {defs.length} attribute{defs.length !== 1 ? "s" : ""} will be created
                      (tag prefix: <code className="font-mono">{selectedAsset?.identifier ?? "asset"}.</code>)
                    </div>
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border/50 bg-muted/30">
                            <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Name</th>
                            <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Type</th>
                            <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Resolved Tag Name</th>
                            <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">UoM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {defs.map((d: any, i: number) => (
                            <tr key={i} className="border-b border-border/50 last:border-0">
                              <td className="px-3 py-1.5 font-medium">{d.name}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{d.type}</td>
                              <td className="px-3 py-1.5 font-mono text-muted-foreground">
                                {d.tagName ? `${selectedAsset?.identifier ?? "asset"}.${d.tagName}` : "—"}
                              </td>
                              <td className="px-3 py-1.5">{d.uom || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>Cancel</Button>
                <Button onClick={handleApplyTemplate} disabled={applyingTemplate || (!selectedTemplateId && !selectedAsset?.templateId)}>
                  {applyingTemplate ? "Applying…" : "Apply Template"}
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* ── CSV tab ────────────────────────────────────────────────── */}
            <TabsContent value="csv" className="space-y-3 mt-3">
              <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground">When to use CSV import</p>
                <p>Use this if you want to add attributes that are <em>specific to this asset only</em> and don't belong in a shared template — e.g. one-off calibration values, asset-specific serial numbers, or a spreadsheet someone sent you.</p>
                <p>Columns: <code className="bg-muted px-1 rounded">name</code>, <code className="bg-muted px-1 rounded">type</code>, <code className="bg-muted px-1 rounded">dataType</code>, <code className="bg-muted px-1 rounded">tagName</code>, <code className="bg-muted px-1 rounded">uom</code></p>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">CSV</label>
                <button className="text-xs text-primary hover:underline" onClick={() => setCsvText(CSV_EXAMPLE)}>Load example</button>
              </div>
              <Textarea value={csvText} onChange={(e) => { setCsvText(e.target.value); setPreviewRows([]); setParseError(null); }}
                placeholder={"name,type,dataType,tagName,uom\nTemperature,dynamic,double,sensorgrow.temperature,°C"}
                className="font-mono text-xs h-36 resize-none" />
              {parseError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{parseError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!csvText.trim()}>Preview</Button>
              {previewRows.length > 0 && <ImportPreviewTable rows={previewRows} />}
              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>Cancel</Button>
                <Button onClick={handleBulkImport} disabled={importing || previewRows.length === 0}>
                  {importing ? "Importing…" : `Import ${previewRows.length} attribute${previewRows.length !== 1 ? "s" : ""}`}
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* ── JSON tab ──────────────────────────────────────────────── */}
            <TabsContent value="json" className="space-y-3 mt-3">
              <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground">When to use JSON import</p>
                <p>Same use case as CSV but in JSON array format. Useful if you already have attribute data in a JSON file or API response.</p>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">JSON Array</label>
                <button className="text-xs text-primary hover:underline" onClick={() => setJsonText(JSON_EXAMPLE)}>Load example</button>
              </div>
              <Textarea value={jsonText} onChange={(e) => { setJsonText(e.target.value); setPreviewRows([]); setParseError(null); }}
                placeholder={'[\n  {"name":"Temperature","type":"dynamic","dataType":"double","tagName":"sensorgrow.temperature","uom":"°C"}\n]'}
                className="font-mono text-xs h-36 resize-none" />
              {parseError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{parseError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!jsonText.trim()}>Preview</Button>
              {previewRows.length > 0 && <ImportPreviewTable rows={previewRows} />}
              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>Cancel</Button>
                <Button onClick={handleBulkImport} disabled={importing || previewRows.length === 0}>
                  {importing ? "Importing…" : `Import ${previewRows.length} attribute${previewRows.length !== 1 ? "s" : ""}`}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Simple read-only preview table ────────────────────────────────────────────
function ImportPreviewTable({ rows }: { rows: AttrDef[] }) {
  return (
    <div className="rounded border border-border overflow-hidden">
      <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
        {rows.length} row{rows.length !== 1 ? "s" : ""} parsed — review before importing
      </div>
      <div className="max-h-48 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Data Type</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Tag Name</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">UoM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-1.5 font-medium">{r.name}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.type}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.dataType}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.tagName || "—"}</td>
                <td className="px-3 py-1.5">{r.uom || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
