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
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronRight, ChevronDown, Blocks, Plus, Trash2, Edit2,
  Search, Download, Upload, FileSpreadsheet, Braces, LayoutTemplate,
  CheckCircle2, XCircle, AlertTriangle,
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

interface PreviewRow extends AttrDef { _status?: "ok" | "error"; _error?: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function AttributeType({ type }: { type: string }) {
  const colors: Record<string, string> = {
    static: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    dynamic: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    metric: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  };
  return <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", colors[type] ?? "bg-muted text-muted-foreground")}>{type}</span>;
}

function AssetTreeNode({ asset, allAssets, selectedId, onSelect, depth }: {
  asset: Asset; allAssets: Asset[]; selectedId: string | null; onSelect: (a: Asset) => void; depth: number;
}) {
  const children = allAssets.filter((a) => a.parentId === asset.id);
  const [expanded, setExpanded] = useState(depth < 2);
  return (
    <div>
      <div
        className={cn("flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm transition-colors",
          selectedId === asset.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60")}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onSelect(asset)}
      >
        {children.length > 0 ? (
          <button onClick={(e) => { e.stopPropagation(); setExpanded((o) => !o); }} className="shrink-0">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : <span className="w-3.5" />}
        <Blocks className="w-3.5 h-3.5 shrink-0 text-primary/70" />
        <span className="truncate">{asset.name}</span>
      </div>
      {expanded && children.map((child) => (
        <AssetTreeNode key={child.id} asset={child} allAssets={allAssets}
          selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── Simple CSV parser ─────────────────────────────────────────────────────────
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

const CSV_TEMPLATE = `name,type,dataType,value,tagName,uom
Temperature,dynamic,double,,sensorgrow.temperature,°C
Vibration RMS X,dynamic,double,,sensorgrow.vibration_rms_velocity_x,mm/s
Sensor Serial,static,text,S125010T1TA10,sensorgrow.sensor_serial,
Run Hours,dynamic,double,,sensorgrow.runhours,h`;

const JSON_TEMPLATE = JSON.stringify([
  { name: "Temperature", type: "dynamic", dataType: "double", tagName: "sensorgrow.temperature", uom: "°C" },
  { name: "Vibration RMS X", type: "dynamic", dataType: "double", tagName: "sensorgrow.vibration_rms_velocity_x", uom: "mm/s" },
  { name: "Sensor Serial", type: "static", dataType: "text", value: "S125010T1TA10", tagName: "sensorgrow.sensor_serial" },
], null, 2);

// ── Main component ────────────────────────────────────────────────────────────
export default function Assets() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [addAttrOpen, setAddAttrOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<"csv" | "json" | "template">("csv");
  const [csvText, setCsvText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
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

  const allAssets   = (assets     as Asset[] | undefined) ?? [];
  const templateList= (templates  as any[]   | undefined) ?? [];
  const rootAssets  = allAssets.filter((a) => !a.parentId);
  const filteredSearch = search ? allAssets.filter((a) => a.name.toLowerCase().includes(search.toLowerCase())) : [];
  const attrList = (attributes as any[] | undefined) ?? [];

  // ── Parse CSV preview ──────────────────────────────────────────────────────
  function handleParseCsv() {
    try {
      const rows = parseCsv(csvText);
      if (rows.length === 0) { setParseError("No data rows found. Check the CSV format."); return; }
      setPreviewRows(rows.map((r) => ({ ...r, _status: "ok" as const })));
      setParseError(null);
    } catch (e: any) {
      setParseError(e.message);
    }
  }

  // ── Parse JSON preview ─────────────────────────────────────────────────────
  function handleParseJson() {
    try {
      const parsed = JSON.parse(jsonText);
      const arr: AttrDef[] = Array.isArray(parsed) ? parsed : [parsed];
      setPreviewRows(arr.map((r) => ({ ...r, _status: "ok" as const })));
      setParseError(null);
    } catch (e: any) {
      setParseError(`JSON parse error: ${e.message}`);
    }
  }

  // ── Bulk import via API ────────────────────────────────────────────────────
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
      toast({ title: `Imported ${data.created} attribute(s)`, description: data.skipped > 0 ? `${data.skipped} skipped` : undefined });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      setImportOpen(false);
      setPreviewRows([]);
      setCsvText(""); setJsonText("");
    } finally {
      setImporting(false);
    }
  }

  // ── Apply template ─────────────────────────────────────────────────────────
  async function handleApplyTemplate() {
    if (!selectedAsset) return;
    const tid = selectedTemplateId || selectedAsset.templateId || "";
    if (!tid) { toast({ title: "No template selected", variant: "destructive" }); return; }
    setApplyingTemplate(true);
    try {
      const res = await fetch(`/api/assets/${selectedAsset.id}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: tid }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Failed", description: data.error, variant: "destructive" }); return; }
      toast({ title: `Applied template "${data.templateName}"`, description: `${data.created} attribute(s) created` });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      setImportOpen(false);
      setSelectedTemplateId("");
    } finally {
      setApplyingTemplate(false);
    }
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────
  function handleExportCsv() {
    if (attrList.length === 0) return;
    const header = "name,type,dataType,value,tagName,uom,quality,timestamp";
    const rows = attrList.map((a: any) =>
      [a.name, a.type, a.dataType,
        a.value != null ? String(typeof a.value === "object" ? JSON.stringify(a.value) : a.value) : "",
        a.tagName ?? "", a.uom ?? "", a.quality ?? "",
        a.timestamp ? new Date(a.timestamp).toISOString() : ""]
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

  // ── Add asset ──────────────────────────────────────────────────────────────
  function onAddAsset(data: { name: string; identifier: string; parentId?: string }) {
    createAsset.mutate(
      { data: { name: data.name, identifier: data.identifier, parentId: data.parentId || null } },
      { onSuccess: () => { toast({ title: "Asset created" }); qc.invalidateQueries({ queryKey: getListAssetsQueryKey() }); setAddAssetOpen(false); assetForm.reset(); } }
    );
  }

  function onAddAttr(data: { name: string; type: string; dataType: string; value?: string; tagName?: string; uom?: string }) {
    if (!selectedAsset) return;
    createAttr.mutate(
      { id: selectedAsset.id, data: { name: data.name, type: data.type as any, dataType: data.dataType as any, value: data.value || null, tagName: data.tagName || null, uom: data.uom || null } },
      { onSuccess: () => { toast({ title: "Attribute added" }); qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) }); setAddAttrOpen(false); attrForm.reset(); } }
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Asset tree ─────────────────────────────────────────────────── */}
      <div className="w-64 border-r border-border flex flex-col shrink-0 bg-card">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search assets..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1.5 space-y-0.5">
            {!assets ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full rounded" />)
            ) : search ? (
              filteredSearch.map((a) => (
                <div key={a.id} onClick={() => setSelectedAsset(a)}
                  className={cn("flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm transition-colors",
                    selectedAsset?.id === a.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60")}>
                  <Blocks className="w-3.5 h-3.5 text-primary/70" />
                  <span className="truncate">{a.name}</span>
                </div>
              ))
            ) : (
              rootAssets.map((a) => (
                <AssetTreeNode key={a.id} asset={a} allAssets={allAssets}
                  selectedId={selectedAsset?.id ?? null} onSelect={setSelectedAsset} depth={0} />
              ))
            )}
          </div>
        </ScrollArea>
        <div className="p-2 border-t border-border">
          <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setAddAssetOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Asset
          </Button>
        </div>
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedAsset ? (
          <>
            <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-sm">{selectedAsset.name}</h2>
                <p className="text-xs text-muted-foreground font-mono">{selectedAsset.identifier}</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedAsset.templateName && <Badge variant="secondary" className="text-xs">{selectedAsset.templateName}</Badge>}
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
                  <TabsTrigger value="attributes" className="text-xs h-7">Attribute</TabsTrigger>
                  <TabsTrigger value="table" className="text-xs h-7">Table</TabsTrigger>
                  <TabsTrigger value="media" className="text-xs h-7">Media</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="attributes" className="flex-1 overflow-auto m-0">
                {/* ── Toolbar ── */}
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
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={handleExportCsv} disabled={attrList.length === 0}>
                    <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
                  </Button>
                  <span className="text-xs text-muted-foreground">{attrList.length} attribute{attrList.length !== 1 ? "s" : ""}</span>
                </div>

                {/* ── Attribute table ── */}
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
                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="outline" className="h-7 text-xs"
                                onClick={() => { setImportTab("template"); setImportOpen(true); }}>
                                <LayoutTemplate className="w-3.5 h-3.5 mr-1" /> Apply Template
                              </Button>
                              <span className="text-xs text-muted-foreground">or</span>
                              <Button size="sm" variant="outline" className="h-7 text-xs"
                                onClick={() => { setImportTab("csv"); setImportOpen(true); }}>
                                <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Import CSV
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      attrList.map((attr: any) => (
                        <tr key={attr.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2">
                            <button className="text-muted-foreground hover:text-primary"><Edit2 className="w-3 h-3" /></button>
                          </td>
                          <td className="px-3 py-2"><AttributeType type={attr.type} /></td>
                          <td className="px-3 py-2 font-medium">{attr.name}</td>
                          <td className="px-3 py-2 font-mono">
                            {attr.value != null ? String(typeof attr.value === "object" ? JSON.stringify(attr.value) : attr.value) : <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{attr.tagName ?? <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-3 py-2">{attr.uom ?? <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-3 py-2">
                            {attr.quality ? <span className={cn("text-xs", attr.quality === "good" ? "text-green-600" : "text-yellow-600")}>{attr.quality}</span> : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {attr.timestamp ? format(new Date(attr.timestamp), "MM/dd HH:mm:ss") : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            <button className="text-muted-foreground hover:text-destructive transition-colors"
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
              <Blocks className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an asset to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Add Asset Dialog ────────────────────────────────────────────── */}
      <Dialog open={addAssetOpen} onOpenChange={setAddAssetOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Asset</DialogTitle></DialogHeader>
          <Form {...assetForm}>
            <form onSubmit={assetForm.handleSubmit(onAddAsset)} className="space-y-4">
              <FormField control={assetForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="Asset name" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={assetForm.control} name="identifier" render={({ field }) => (
                <FormItem><FormLabel>Identifier *</FormLabel><FormControl><Input placeholder="unique_identifier" {...field} /></FormControl></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddAssetOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createAsset.isPending}>Add</Button>
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
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="Attribute name" {...field} /></FormControl></FormItem>
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
                        <SelectItem value="text">text</SelectItem>
                        <SelectItem value="number">number</SelectItem>
                        <SelectItem value="double">double</SelectItem>
                        <SelectItem value="boolean">boolean</SelectItem>
                        <SelectItem value="timestamp">timestamp</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <FormField control={attrForm.control} name="value" render={({ field }) => (
                <FormItem><FormLabel>Value</FormLabel><FormControl><Input placeholder="Value" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={attrForm.control} name="tagName" render={({ field }) => (
                <FormItem><FormLabel>Tag Name</FormLabel><FormControl><Input placeholder="device.metric_key" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={attrForm.control} name="uom" render={({ field }) => (
                <FormItem><FormLabel>UoM</FormLabel><FormControl><Input placeholder="e.g. kWh, °C, bar" {...field} /></FormControl></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddAttrOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createAttr.isPending}>Add</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Import / Apply Template Dialog ─────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(v) => { setImportOpen(v); if (!v) { setPreviewRows([]); setParseError(null); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bulk Attribute Import</DialogTitle>
            <DialogDescription>
              Import attributes in bulk for <strong>{selectedAsset?.name}</strong>
            </DialogDescription>
          </DialogHeader>

          <Tabs value={importTab} onValueChange={(v) => { setImportTab(v as any); setPreviewRows([]); setParseError(null); }}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="template" className="text-xs">
                <LayoutTemplate className="w-3.5 h-3.5 mr-1.5" /> Apply Template
              </TabsTrigger>
              <TabsTrigger value="csv" className="text-xs">
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" /> Import CSV
              </TabsTrigger>
              <TabsTrigger value="json" className="text-xs">
                <Braces className="w-3.5 h-3.5 mr-1.5" /> Import JSON
              </TabsTrigger>
            </TabsList>

            {/* ── Template tab ── */}
            <TabsContent value="template" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Select an asset template to automatically create all its defined attributes on this asset.
                The asset's device identifier (<code className="bg-muted px-1 rounded text-xs">{selectedAsset?.identifier}</code>) will be prepended to each tag name.
              </p>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Template</label>
                <Select value={selectedTemplateId || selectedAsset?.templateId || ""} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templateList.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="font-medium">{t.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">({t.attributeCount} attribute{t.attributeCount !== 1 ? "s" : ""})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {templateList.length > 0 && (selectedTemplateId || selectedAsset?.templateId) && (() => {
                const tid = selectedTemplateId || selectedAsset?.templateId;
                const tmpl = templateList.find((t: any) => t.id === tid) as any;
                const defs: any[] = tmpl?.attributeDefinitions ?? [];
                return defs.length > 0 ? (
                  <div className="rounded-md border border-border overflow-hidden">
                    <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                      {defs.length} attribute definition{defs.length !== 1 ? "s" : ""} will be created
                    </div>
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-border/50">
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Name</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Type</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Tag Name (resolved)</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">UoM</th>
                        </tr></thead>
                        <tbody>
                          {defs.map((d: any, i: number) => (
                            <tr key={i} className="border-b border-border/50 last:border-0">
                              <td className="px-3 py-1.5 font-medium">{d.name}</td>
                              <td className="px-3 py-1.5"><AttributeType type={d.type} /></td>
                              <td className="px-3 py-1.5 font-mono text-muted-foreground">
                                {selectedAsset?.identifier}.{d.tagName}
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground">{d.uom || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : <p className="text-xs text-muted-foreground">This template has no attribute definitions yet. Edit the template in Asset Templates to add them.</p>;
              })()}
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
                <Button onClick={handleApplyTemplate} disabled={applyingTemplate || (!selectedTemplateId && !selectedAsset?.templateId)}>
                  <LayoutTemplate className="w-3.5 h-3.5 mr-1.5" />
                  {applyingTemplate ? "Applying…" : "Apply Template"}
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* ── CSV tab ── */}
            <TabsContent value="csv" className="space-y-3 mt-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">CSV Data</label>
                  <div className="flex items-center gap-2">
                    <button className="text-xs text-primary hover:underline" onClick={() => setCsvText(CSV_TEMPLATE)}>Load example</button>
                    <span className="text-muted-foreground/40">·</span>
                    <button className="text-xs text-primary hover:underline" onClick={() => fileRef.current?.click()}>
                      <Upload className="w-3 h-3 inline mr-0.5" /> Upload file
                    </button>
                    <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => setCsvText(ev.target?.result as string ?? "");
                        reader.readAsText(file);
                        e.target.value = "";
                      }} />
                  </div>
                </div>
                <Textarea
                  value={csvText}
                  onChange={(e) => { setCsvText(e.target.value); setPreviewRows([]); setParseError(null); }}
                  placeholder={"name,type,dataType,value,tagName,uom\nTemperature,dynamic,double,,sensorgrow.temperature,°C"}
                  className="font-mono text-xs h-36 resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Columns: <code className="bg-muted px-1 rounded">name</code> (required), <code className="bg-muted px-1 rounded">type</code>, <code className="bg-muted px-1 rounded">dataType</code>, <code className="bg-muted px-1 rounded">value</code>, <code className="bg-muted px-1 rounded">tagName</code>, <code className="bg-muted px-1 rounded">uom</code>
                </p>
              </div>
              {parseError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{parseError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParseCsv} disabled={!csvText.trim()}>
                Preview import
              </Button>
              {previewRows.length > 0 && <ImportPreview rows={previewRows} identifier={selectedAsset?.identifier ?? ""} />}
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
                <Button onClick={handleBulkImport} disabled={importing || previewRows.length === 0}>
                  {importing ? "Importing…" : `Import ${previewRows.length} attribute${previewRows.length !== 1 ? "s" : ""}`}
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* ── JSON tab ── */}
            <TabsContent value="json" className="space-y-3 mt-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">JSON Array</label>
                  <button className="text-xs text-primary hover:underline" onClick={() => setJsonText(JSON_TEMPLATE)}>Load example</button>
                </div>
                <Textarea
                  value={jsonText}
                  onChange={(e) => { setJsonText(e.target.value); setPreviewRows([]); setParseError(null); }}
                  placeholder={'[\n  { "name": "Temperature", "type": "dynamic", "dataType": "double", "tagName": "device.temperature", "uom": "°C" }\n]'}
                  className="font-mono text-xs h-48 resize-none"
                />
              </div>
              {parseError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{parseError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParseJson} disabled={!jsonText.trim()}>
                Preview import
              </Button>
              {previewRows.length > 0 && <ImportPreview rows={previewRows} identifier={selectedAsset?.identifier ?? ""} />}
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
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

// ── Import preview table ──────────────────────────────────────────────────────
function ImportPreview({ rows, identifier }: { rows: PreviewRow[]; identifier: string }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
        {rows.length} row{rows.length !== 1 ? "s" : ""} ready to import
      </div>
      <div className="max-h-52 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Data Type</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Value</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Tag Name</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">UoM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-1.5 font-medium">{r.name}</td>
                <td className="px-3 py-1.5"><span className="bg-muted px-1 rounded text-xs">{r.type}</span></td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.dataType}</td>
                <td className="px-3 py-1.5 font-mono">{r.value || <span className="text-muted-foreground/40">—</span>}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.tagName || <span className="text-muted-foreground/40">—</span>}</td>
                <td className="px-3 py-1.5">{r.uom || <span className="text-muted-foreground/40">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
