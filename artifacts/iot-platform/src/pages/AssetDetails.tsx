import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useListAssets, useListAssetAttributes, useCreateAssetAttribute, useDeleteAttribute,
  useDeleteAsset, useListAssetTemplates,
  getListAssetsQueryKey, getListAssetAttributesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronRight, Blocks, Plus, Trash2, Edit2, ArrowLeft, Download,
  FileSpreadsheet, Braces, LayoutTemplate, Calculator, AlertTriangle, Info,
  TrendingUp, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useCurrentUser } from "@/contexts/UserContext";
import {
  Asset, AttrDef, AssetHealth, AttributeType, TrendsPanel, ExpressionEditor, ImportPreviewTable,
  parseCsv, flattenPayload, CSV_EXAMPLE, JSON_EXAMPLE,
  deriveStatus, STATUS_STYLES, siteOf, HealthBar, STALE_AFTER_MS,
} from "./assetShared";

// Suggested Device ID per machine name (auto-prefill; user can edit).
const MACHINE_DEVICE_MAP: Record<string, string> = {
  "creel machine": "CREEL_01", "soft flow dyeing machine": "SFDM_01", "overflow washer": "OW_01", "rf dryer": "RF_DRYER_01",
  "auto bale opener": "ABO_01", "rectilinear comber": "COMBER_01", "draw frame": "DRAWFRAME_01", "ring spinning frame": "RINGSPIN_01",
  "auto cone winder": "CONEWINDER_01", "packing machine": "PACKING_01", "pet bottle washer": "PETWASHER_01", "extruder": "EXTRUDER_01",
  "melt filtration system": "MFS_01", "spinning machine": "SPINNING_01", "stenter dryer": "STENTER_01", "crimping machine": "CRIMPER_01",
  "baler": "BALER_01", "blending hopper": "HOPPER_01", "rotor spinning machine": "ROTORSPIN_01", "yarn doubler": "YARNDOUBLER_01",
};
function suggestDeviceId(asset: Asset, allAssets: Asset[]): string {
  const key = asset.name.trim().toLowerCase();
  if (key === "carding machine") {
    const byId = new Map(allAssets.map((a) => [a.id, a]));
    let cur: Asset | null = asset; const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); if (/unit\s*2/i.test(cur.name)) return "CARDING_02"; cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null; }
    return "CARDING_01";
  }
  return MACHINE_DEVICE_MAP[key] ?? "";
}

export default function AssetDetails({ assetId: assetIdProp, embedded }: { assetId?: string; embedded?: boolean } = {}) {
  const [, params] = useRoute("/assets/:id");
  // When embedded (e.g. in the Assets tree right panel) the id comes as a prop;
  // otherwise it's read from the route.
  const assetId = assetIdProp ?? params?.id ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useCurrentUser();

  const { data: assets } = useListAssets();
  const allAssets = (assets as Asset[] | undefined) ?? [];
  const asset = allAssets.find((a) => a.id === assetId) ?? null;

  const { data: attributes } = useListAssetAttributes(assetId, {
    query: { enabled: !!assetId, queryKey: getListAssetAttributesQueryKey(assetId) },
  });
  const { data: templates } = useListAssetTemplates();
  const templateList = (templates as any[] | undefined) ?? [];
  const attrList = (attributes as any[] | undefined) ?? [];

  const createAttr = useCreateAssetAttribute();
  const deleteAttr = useDeleteAttribute();
  const deleteAsset = useDeleteAsset();

  const [health, setHealth] = useState<AssetHealth | null>(null);
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    const load = () => fetch(`/api/assets/${assetId}/health`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null)).then((h) => { if (!cancelled) setHealth(h); }).catch(() => {});
    load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [assetId]);

  // ── Dialog + form state (relocated from Assets detail) ──
  const [addAttrOpen, setAddAttrOpen] = useState(false);
  const [editAttr, setEditAttr] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<"template" | "csv" | "json">("template");
  const [csvText, setCsvText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [previewRows, setPreviewRows] = useState<AttrDef[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [attrUseExpr, setAttrUseExpr] = useState(false);
  const [editAttrUseExpr, setEditAttrUseExpr] = useState(false);

  const attrForm = useForm({ defaultValues: { name: "", type: "static", dataType: "double", value: "", tagName: "", sourceMetric: "", uom: "", decimalPlaces: "", thousandSeparator: false, expression: "" } });
  const editAttrForm = useForm({ defaultValues: { name: "", type: "static", dataType: "double", value: "", tagName: "", sourceMetric: "", uom: "", decimalPlaces: "", thousandSeparator: false, expression: "" } });

  const attrNames = attrList.filter((a: any) => a.type !== "runtime").map((a: any) => a.name as string);


  function handleParse() {
    setParseError(null); setPreviewRows([]);
    try {
      if (importTab === "csv") {
        const rows = parseCsv(csvText);
        if (rows.length === 0) { setParseError("No data rows found."); return; }
        setPreviewRows(rows);
      } else if (importTab === "json") {
        const parsed = JSON.parse(jsonText);
        const payloads = Array.isArray(parsed) ? parsed : [parsed];
        const flattened: AttrDef[] = [];
        for (const item of payloads) {
          const obj = item && typeof item === "object" ? item as Record<string, any> : {};
          const source = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? obj.data
            : obj.metrics && typeof obj.metrics === "object" && !Array.isArray(obj.metrics) ? obj.metrics
              : flattenPayload(obj);
          for (const [key, value] of Object.entries(source)) {
            if (value === undefined) continue;
            const isNumber = typeof value === "number";
            flattened.push({
              name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              type: isNumber ? "dynamic" : "static",
              dataType: isNumber ? (Number.isInteger(value) ? "number" : "double") : "text",
              tagName: key,
            });
          }
        }
        setPreviewRows(flattened);
      }
    } catch (e: any) { setParseError(e.message); }
  }

  async function handleBulkImport() {
    if (!asset || previewRows.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/assets/${asset.id}/attributes/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: previewRows }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Import failed", description: data.error, variant: "destructive" }); return; }
      const desc = data.skipped > 0
        ? `${data.created} created · ${data.skipped} skipped: ${(data.skippedItems ?? []).join(", ")}`
        : `${data.created} attribute(s) created`;
      toast({ title: "Import complete", description: desc });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(asset.id) });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      closeImport();
    } finally { setImporting(false); }
  }

  async function handleApplyTemplate() {
    if (!asset) return;
    const tid = selectedTemplateId || asset.templateId || "";
    if (!tid) { toast({ title: "Please select a template", variant: "destructive" }); return; }
    setApplyingTemplate(true);
    try {
      const res = await fetch(`/api/assets/${asset.id}/apply-template`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: tid }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Failed", description: data.error, variant: "destructive" }); return; }
      let desc = `${data.created} attribute(s) created`;
      if (data.skipped > 0) desc += ` · ${data.skipped} skipped: ${(data.skippedItems ?? []).join(", ")}`;
      toast({ title: `Template "${data.templateName}" applied`, description: desc });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(asset.id) });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      closeImport(); setSelectedTemplateId("");
    } finally { setApplyingTemplate(false); }
  }

  async function handleSaveEdit(data: any) {
    if (!editAttr) return;
    const body: Record<string, any> = {
      name: data.name, type: data.type, dataType: data.dataType,
      value: data.value || null, tagName: data.tagName || null, sourceMetric: data.sourceMetric || null,
      uom: data.uom || null,
      decimalPlaces: data.decimalPlaces !== "" && data.decimalPlaces != null ? Number(data.decimalPlaces) : null,
      thousandSeparator: data.thousandSeparator === true,
      expression: editAttrUseExpr ? data.expression || null : null,
    };
    if (editAttrUseExpr) body.type = "runtime";
    try {
      const res = await fetch(`/api/attributes/${editAttr.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); toast({ title: "Update failed", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Attribute updated" });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(assetId) });
      setEditAttr(null); editAttrForm.reset();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  function handleExportCsv() {
    if (attrList.length === 0) return;
    const header = "name,type,dataType,value,tagName,sourceMetric,uom,decimalPlaces,thousandSeparator,expression";
    const rows = attrList.map((a: any) =>
      [a.name, a.type, a.dataType, a.value != null ? String(typeof a.value === "object" ? JSON.stringify(a.value) : a.value) : "",
        a.tagName ?? "", a.sourceMetric ?? "", a.uom ?? "", a.decimalPlaces != null ? String(a.decimalPlaces) : "",
        a.thousandSeparator ? "TRUE" : "FALSE", a.expression ?? ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header, ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${asset?.identifier ?? "attributes"}_attributes.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function onAddAttr(data: any) {
    if (!asset) return;
    const finalType = attrUseExpr ? "runtime" : data.type;
    createAttr.mutate({
      id: asset.id,
      data: {
        name: data.name, type: finalType as any, dataType: data.dataType as any,
        value: data.value || null, tagName: data.tagName || null, sourceMetric: data.sourceMetric || null,
        uom: data.uom || null,
        decimalPlaces: data.decimalPlaces !== "" && data.decimalPlaces != null ? Number(data.decimalPlaces) : null,
        thousandSeparator: data.thousandSeparator === true,
        expression: attrUseExpr ? data.expression || null : null,
      } as any,
    }, {
      onSuccess: () => {
        toast({ title: "Attribute added" });
        qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(asset.id) });
        setAddAttrOpen(false); attrForm.reset(); setAttrUseExpr(false);
      },
    });
  }

  function openEditAttr(attr: any) {
    setEditAttr(attr);
    setEditAttrUseExpr(!!attr.expression);
    editAttrForm.reset({
      name: attr.name, type: attr.type, dataType: attr.dataType,
      value: attr.value != null ? String(attr.value) : "",
      tagName: attr.tagName ?? "", sourceMetric: attr.sourceMetric ?? "",
      uom: attr.uom ?? "", decimalPlaces: attr.decimalPlaces != null ? String(attr.decimalPlaces) : "",
      thousandSeparator: attr.thousandSeparator ?? false, expression: attr.expression ?? "",
    });
  }
  function closeImport() {
    setImportOpen(false); setPreviewRows([]); setParseError(null); setCsvText(""); setJsonText(""); setSelectedTemplateId("");
  }

  if (!assets) {
    return <div className="p-6 space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!asset) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <Blocks className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <p className="text-sm font-medium">Asset not found</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/assets")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Assets
        </Button>
      </div>
    );
  }

  const status = deriveStatus(asset, health);
  // Availability = live or not. 100% only while telemetry is flowing now; 0% if the
  // source is offline (even if old values are still stored on the asset).
  const live = !!health?.lastSeen && !isNaN(new Date(health.lastSeen).getTime())
    && (Date.now() - new Date(health.lastSeen).getTime()) <= STALE_AFTER_MS;
  const availabilityPct = live ? 100 : 0;

  return (
    <div className={cn("space-y-4", embedded ? "p-5" : "p-6 max-w-6xl mx-auto")}>
      {!embedded && (
        <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/assets"))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <button onClick={() => navigate("/assets")} className="hover:text-foreground">Assets</button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-foreground font-medium">{asset.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {can("manage_assets") && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-8 text-xs"
              onClick={() => deleteAsset.mutate({ id: asset.id }, {
                onSuccess: () => { toast({ title: "Asset deleted" }); qc.invalidateQueries({ queryKey: getListAssetsQueryKey() }); navigate("/assets"); },
              })}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-lg bg-primary/10 text-primary"><Blocks className="w-5 h-5" /></div>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {asset.name}
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[status])}>{status}</span>
          </h1>
          <p className="text-sm text-muted-foreground font-mono">{asset.identifier}</p>
        </div>
      </div>

      {/* Asset Information */}
      <Card className="shadow-sm">
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-3">Asset Information</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <Info2 label="Asset Name" value={asset.name} />
            <Info2 label="Site" value={siteOf(asset, allAssets)} />
            <Info2 label="Status" value={status} />
            <div>
              <p className="text-xs text-muted-foreground mb-1">Availability</p>
              <HealthBar pct={availabilityPct} />
            </div>
            <Info2 label="Created / Installed" value={asset.createdAt ? format(new Date(asset.createdAt), "yyyy-MM-dd") : "—"} />
            <Info2 label="Last Updated" value={asset.updatedAt ? format(new Date(asset.updatedAt), "yyyy-MM-dd HH:mm") : "—"} />
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="attributes">
        <TabsList>
          <TabsTrigger value="attributes" className="text-xs">Attributes</TabsTrigger>
          <TabsTrigger value="media" className="text-xs">Media</TabsTrigger>
        </TabsList>

        {/* Attributes */}
        <TabsContent value="attributes" className="mt-3">
          <Card className="shadow-sm overflow-hidden">
            <div className="p-3 flex items-center gap-2 border-b border-border bg-muted/30 flex-wrap">
              {can("manage_assets") && (
                <Button size="sm" className="h-7 text-xs" onClick={() => { attrForm.reset(); setAttrUseExpr(false); setAddAttrOpen(true); }}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
                </Button>
              )}
              {can("manage_assets") && <div className="h-5 w-px bg-border" />}
              {can("manage_assets") && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setImportTab("template"); setImportOpen(true); setPreviewRows([]); }}>
                  <LayoutTemplate className="w-3.5 h-3.5 mr-1" /> Apply Template
                </Button>
              )}
              {can("manage_assets") && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setImportTab("csv"); setImportOpen(true); setPreviewRows([]); setCsvText(""); }}>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Import CSV
                </Button>
              )}
              {can("manage_assets") && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setImportTab("json"); setImportOpen(true); setPreviewRows([]); setJsonText(""); }}>
                  <Braces className="w-3.5 h-3.5 mr-1" /> Import JSON
                </Button>
              )}
              <div className="flex-1" />
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={handleExportCsv} disabled={attrList.length === 0}>
                <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
              </Button>
              <span className="text-xs text-muted-foreground">{attrList.length} attribute{attrList.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2 w-8" />
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">Type</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Value / UoM</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tag / Source</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Quality</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Updated</th>
                    <th className="px-3 py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {!attributes ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50"><td colSpan={8} className="px-3 py-2"><Skeleton className="h-3 w-full" /></td></tr>
                    ))
                  ) : attrList.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-12 text-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <Blocks className="w-8 h-8 opacity-20" /><p className="text-sm">No attributes yet</p>
                        {can("manage_assets") && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setImportTab("template"); setImportOpen(true); }}>
                            <LayoutTemplate className="w-3.5 h-3.5 mr-1" /> Apply Template
                          </Button>
                        )}
                      </div>
                    </td></tr>
                  ) : (
                    attrList.map((attr: any) => (
                      <tr key={attr.id} className={cn("border-b border-border/50 hover:bg-muted/30 transition-colors group", attr.type === "runtime" && "bg-orange-50/30 dark:bg-orange-950/10")}>
                        <td className="px-3 py-2">
                          {can("manage_assets") && (
                            <button className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100" onClick={() => openEditAttr(attr)}><Edit2 className="w-3 h-3" /></button>
                          )}
                        </td>
                        <td className="px-3 py-2"><AttributeType type={attr.type} /></td>
                        <td className="px-3 py-2 font-medium">{attr.name}</td>
                        <td className="px-3 py-2 font-mono">
                          {attr.value != null ? (
                            <span className={cn(attr.type === "runtime" && "font-semibold text-orange-700 dark:text-orange-400")}>
                              {(() => {
                                const raw = typeof attr.value === "object" ? JSON.stringify(attr.value) : String(attr.value);
                                const num = Number(raw);
                                if (!isNaN(num) && attr.decimalPlaces != null) return num.toLocaleString(undefined, { minimumFractionDigits: attr.decimalPlaces, maximumFractionDigits: attr.decimalPlaces, useGrouping: attr.thousandSeparator ?? false });
                                if (!isNaN(num) && attr.thousandSeparator) return num.toLocaleString(undefined, { useGrouping: true });
                                return raw;
                              })()}
                              {attr.uom && <span className="text-muted-foreground ml-1 font-normal">{attr.uom}</span>}
                            </span>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground font-mono">
                          {attr.tagName ? <span className="text-xs">{attr.tagName}</span>
                            : attr.sourceMetric ? <span className="text-xs text-blue-600 dark:text-blue-400">src:{attr.sourceMetric}</span>
                              : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {attr.quality ? <span className={cn("text-xs", attr.quality === "good" ? "text-green-600" : attr.quality === "bad" ? "text-red-500" : "text-yellow-600")}>{attr.quality}</span> : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {attr.timestamp ? format(new Date(attr.timestamp), "MM/dd HH:mm:ss") : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {can("manage_assets") && (
                            <button className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                              onClick={() => deleteAttr.mutate({ id: attr.id }, { onSuccess: () => { toast({ title: "Deleted" }); qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(assetId) }); } })}>
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Media (unchanged placeholder — Media module lives in Media Library) */}
        <TabsContent value="media" className="mt-3">
          <Card className="shadow-sm"><CardContent className="p-10 text-center text-sm text-muted-foreground">
            Media for this asset is managed in the <button className="text-primary hover:underline" onClick={() => navigate("/media-library")}>Media Library</button>.
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* ── Add Attribute Dialog ── */}
      <Dialog open={addAttrOpen} onOpenChange={(v) => { if (!v) { setAddAttrOpen(false); attrForm.reset(); setAttrUseExpr(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Attribute</DialogTitle><DialogDescription>Add a single attribute to {asset.name}.</DialogDescription></DialogHeader>
          <Form {...attrForm}>
            <form onSubmit={attrForm.handleSubmit(onAddAttr)} className="space-y-4">
              <FormField control={attrForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="e.g. Avg Temperature" {...field} /></FormControl></FormItem>
              )} />
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium flex items-center gap-1.5"><Calculator className="w-3.5 h-3.5 text-orange-500" /> Use Expression (Runtime)</Label>
                  <p className="text-xs text-muted-foreground">Calculate from other attributes on every payload ingest</p>
                </div>
                <Switch checked={attrUseExpr} onCheckedChange={setAttrUseExpr} />
              </div>
              {attrUseExpr ? (
                <ExpressionEditor control={attrForm.control} attrNames={attrNames} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={attrForm.control} name="type" render={({ field }) => (
                    <FormItem><FormLabel>Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="static">Static</SelectItem><SelectItem value="dynamic">Dynamic</SelectItem><SelectItem value="metric">Metric</SelectItem></SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={attrForm.control} name="dataType" render={({ field }) => (
                    <FormItem><FormLabel>Data Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="double">Double</SelectItem><SelectItem value="boolean">Boolean</SelectItem><SelectItem value="timestamp">Timestamp</SelectItem></SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>
              )}
              {!attrUseExpr && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={attrForm.control} name="tagName" render={({ field }) => (
                      <FormItem><FormLabel>Tag Name</FormLabel><FormControl><Input placeholder="device.key" className="font-mono text-xs" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={attrForm.control} name="sourceMetric" render={({ field }) => (
                      <FormItem><FormLabel>Source Metric <span className="text-muted-foreground font-normal text-[10px]">(remap)</span></FormLabel><FormControl><Input placeholder="energy_meter_kwh" className="font-mono text-xs" {...field} /></FormControl></FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={attrForm.control} name="uom" render={({ field }) => (<FormItem><FormLabel>UoM</FormLabel><FormControl><Input placeholder="kWh, °C" {...field} /></FormControl></FormItem>)} />
                    <FormField control={attrForm.control} name="decimalPlaces" render={({ field }) => (<FormItem><FormLabel>Decimals</FormLabel><FormControl><Input type="number" min={0} max={10} placeholder="2" {...field} /></FormControl></FormItem>)} />
                    <FormField control={attrForm.control} name="thousandSeparator" render={({ field }) => (
                      <FormItem className="flex flex-col justify-end gap-2 pb-1"><FormLabel>Thousand Sep.</FormLabel>
                        <div className="flex items-center gap-2 h-9"><Switch checked={!!field.value} onCheckedChange={field.onChange} /><span className="text-xs text-muted-foreground">{field.value ? "On" : "Off"}</span></div>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={attrForm.control} name="value" render={({ field }) => (<FormItem><FormLabel>Value <span className="text-muted-foreground font-normal">(optional, for static)</span></FormLabel><FormControl><Input placeholder="e.g. S125010T1TA10" {...field} /></FormControl></FormItem>)} />
                </>
              )}
              {attrUseExpr && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={attrForm.control} name="uom" render={({ field }) => (<FormItem><FormLabel>UoM</FormLabel><FormControl><Input placeholder="°C, mm/s, V" {...field} /></FormControl></FormItem>)} />
                  <FormField control={attrForm.control} name="dataType" render={({ field }) => (
                    <FormItem><FormLabel>Data Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="double">Double</SelectItem><SelectItem value="number">Number</SelectItem></SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setAddAttrOpen(false); attrForm.reset(); setAttrUseExpr(false); }}>Cancel</Button>
                <Button type="submit" disabled={createAttr.isPending}>Add Attribute</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Attribute Dialog ── */}
      <Dialog open={!!editAttr} onOpenChange={(v) => { if (!v) { setEditAttr(null); editAttrForm.reset(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Attribute</DialogTitle><DialogDescription>Update the configuration for "{editAttr?.name}".</DialogDescription></DialogHeader>
          <Form {...editAttrForm}>
            <form onSubmit={editAttrForm.handleSubmit(handleSaveEdit)} className="space-y-4">
              <FormField control={editAttrForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name *</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>)} />
              {editAttr?.type === "runtime" ? (
                <>
                  <div className="flex items-center gap-2 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40 px-3 py-2">
                    <Calculator className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <p className="text-xs text-orange-800 dark:text-orange-300">This is a <strong>computed attribute</strong>. Recalculated on every payload ingest.</p>
                  </div>
                  <ExpressionEditor control={editAttrForm.control} attrNames={attrNames.filter((n) => n !== editAttr?.name)} />
                  <FormField control={editAttrForm.control} name="uom" render={({ field }) => (<FormItem><FormLabel>UoM</FormLabel><FormControl><Input placeholder="°C, mm/s, V" {...field} /></FormControl></FormItem>)} />
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={editAttrForm.control} name="type" render={({ field }) => (
                      <FormItem><FormLabel>Type</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent><SelectItem value="static">Static</SelectItem><SelectItem value="dynamic">Dynamic</SelectItem><SelectItem value="metric">Metric</SelectItem></SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={editAttrForm.control} name="dataType" render={({ field }) => (
                      <FormItem><FormLabel>Data Type</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="double">Double</SelectItem><SelectItem value="boolean">Boolean</SelectItem><SelectItem value="timestamp">Timestamp</SelectItem></SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={editAttrForm.control} name="tagName" render={({ field }) => (<FormItem><FormLabel>Tag Name</FormLabel><FormControl><Input className="font-mono text-xs" placeholder="device-id.metric_name" {...field} /></FormControl></FormItem>)} />
                    <FormField control={editAttrForm.control} name="sourceMetric" render={({ field }) => (<FormItem><FormLabel>Source Metric <span className="text-muted-foreground font-normal text-[10px]">(remap)</span></FormLabel><FormControl><Input className="font-mono text-xs" placeholder="energy_meter_kwh" {...field} /></FormControl></FormItem>)} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={editAttrForm.control} name="uom" render={({ field }) => (<FormItem><FormLabel>UoM</FormLabel><FormControl><Input placeholder="kWh, °C" {...field} /></FormControl></FormItem>)} />
                    <FormField control={editAttrForm.control} name="decimalPlaces" render={({ field }) => (<FormItem><FormLabel>Decimals</FormLabel><FormControl><Input type="number" min={0} max={10} placeholder="2" {...field} /></FormControl></FormItem>)} />
                    <FormField control={editAttrForm.control} name="thousandSeparator" render={({ field }) => (
                      <FormItem className="flex flex-col justify-end gap-2 pb-1"><FormLabel>Thousand Sep.</FormLabel>
                        <div className="flex items-center gap-2 h-9"><Switch checked={!!field.value} onCheckedChange={field.onChange} /><span className="text-xs text-muted-foreground">{field.value ? "On" : "Off"}</span></div>
                      </FormItem>
                    )} />
                  </div>
                </>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setEditAttr(null); editAttrForm.reset(); }}>Cancel</Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Apply Template / Import Dialog ── */}
      <Dialog open={importOpen} onOpenChange={(v) => { if (!v) closeImport(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Add Attributes to "{asset.name}"</DialogTitle><DialogDescription>Duplicates (same name or tag) are automatically skipped.</DialogDescription></DialogHeader>
          <Tabs value={importTab} onValueChange={(v) => { setImportTab(v as any); setPreviewRows([]); setParseError(null); }}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="template" className="text-xs gap-1.5"><LayoutTemplate className="w-3 h-3" /> Apply Template</TabsTrigger>
              <TabsTrigger value="csv" className="text-xs gap-1.5"><FileSpreadsheet className="w-3 h-3" /> CSV</TabsTrigger>
              <TabsTrigger value="json" className="text-xs gap-1.5"><Braces className="w-3 h-3" /> JSON Array</TabsTrigger>
            </TabsList>
            <TabsContent value="template" className="space-y-3 mt-3">
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-3 text-xs">
                <p className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5 mb-1.5"><Info className="w-3.5 h-3.5" /> How Apply Template works</p>
                <ul className="text-blue-700 dark:text-blue-400 space-y-1">
                  <li>• Schema defined in Asset Templates → stamped onto this asset</li>
                  <li>• Tag names resolved: <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">temperature</code> → <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">{asset.identifier ? `${asset.identifier}.` : ""}temperature</code></li>
                  <li>• Existing attributes are skipped, not duplicated</li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Select Template</label>
                <Select value={selectedTemplateId || asset.templateId || ""} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Choose a template…" /></SelectTrigger>
                  <SelectContent className="max-h-72 overflow-y-auto">{templateList.map((t: any) => (<SelectItem key={t.id} value={t.id}>{t.name} <span className="text-muted-foreground ml-1">({t.attributeCount} attrs)</span></SelectItem>))}</SelectContent>
                </Select>
              </div>
              {(() => {
                const tid = selectedTemplateId || asset.templateId || "";
                const tmpl = templateList.find((t: any) => t.id === tid);
                const defs: any[] = tmpl?.attributeDefinitions ?? [];
                if (!tmpl || defs.length === 0) return null;
                return (
                  <div className="rounded border border-border overflow-hidden">
                    <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">{defs.length} attribute{defs.length !== 1 ? "s" : ""} · prefix: <code className="font-mono">{asset.identifier ? `${asset.identifier}.` : "(none — grouping asset)"}</code></div>
                    <div className="max-h-40 overflow-auto"><table className="w-full text-xs">
                      <thead><tr className="border-b border-border/50 bg-muted/30"><th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Name</th><th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Resolved Tag</th><th className="text-left px-3 py-1.5 font-medium text-muted-foreground">UoM</th></tr></thead>
                      <tbody>{defs.map((d: any, i: number) => (<tr key={i} className="border-b border-border/50 last:border-0"><td className="px-3 py-1.5 font-medium">{d.name}</td><td className="px-3 py-1.5 font-mono text-muted-foreground">{d.tagName ? `${asset.identifier ? `${asset.identifier}.` : ""}${d.tagName}` : "—"}</td><td className="px-3 py-1.5">{d.uom || "—"}</td></tr>))}</tbody>
                    </table></div>
                  </div>
                );
              })()}
              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>Cancel</Button>
                <Button onClick={handleApplyTemplate} disabled={applyingTemplate || (!selectedTemplateId && !asset.templateId)}>{applyingTemplate ? "Applying…" : "Apply Template"}</Button>
              </DialogFooter>
            </TabsContent>
            <TabsContent value="csv" className="space-y-3 mt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Columns: name, type, dataType, tagName, sourceMetric, uom</p>
                <button className="text-xs text-primary hover:underline" onClick={() => setCsvText(CSV_EXAMPLE)}>Load example</button>
              </div>
              <Textarea value={csvText} onChange={(e) => { setCsvText(e.target.value); setPreviewRows([]); setParseError(null); }} placeholder={"name,type,dataType,tagName,uom\nEnergy kWh,dynamic,double,device-01.energy_kwh,kWh"} className="font-mono text-xs h-36 resize-none" />
              {parseError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{parseError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!csvText.trim()}>Preview</Button>
              {previewRows.length > 0 && <ImportPreviewTable rows={previewRows} />}
              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>Cancel</Button>
                <Button onClick={handleBulkImport} disabled={importing || previewRows.length === 0}>{importing ? "Importing…" : `Import ${previewRows.length} attribute${previewRows.length !== 1 ? "s" : ""}`}</Button>
              </DialogFooter>
            </TabsContent>
            <TabsContent value="json" className="space-y-3 mt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">JSON array of attribute objects</p>
                <button className="text-xs text-primary hover:underline" onClick={() => setJsonText(JSON_EXAMPLE)}>Load example</button>
              </div>
              <Textarea value={jsonText} onChange={(e) => { setJsonText(e.target.value); setPreviewRows([]); setParseError(null); }} placeholder={'[\n  {"name":"Temperature","type":"dynamic","dataType":"double","tagName":"device-01.temperature","uom":"°C"}\n]'} className="font-mono text-xs h-36 resize-none" />
              {parseError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{parseError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!jsonText.trim()}>Preview</Button>
              {previewRows.length > 0 && <ImportPreviewTable rows={previewRows} />}
              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>Cancel</Button>
                <Button onClick={handleBulkImport} disabled={importing || previewRows.length === 0}>{importing ? "Importing…" : `Import ${previewRows.length} attribute${previewRows.length !== 1 ? "s" : ""}`}</Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function Info2({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">{icon}{label}</p>
      <p className={cn("font-medium truncate", mono && "font-mono text-sm")}>{value}</p>
    </div>
  );
}
