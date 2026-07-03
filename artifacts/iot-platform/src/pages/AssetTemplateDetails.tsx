import { useState, useEffect, useRef, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useListAssetTemplates, useDeleteAssetTemplate, useCreateAssetTemplate, useListAssets,
  getListAssetTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Save, Braces, FileSpreadsheet, ChevronRight, AlertTriangle,
  CheckCircle2, LayoutTemplate, Zap, Info, Download, Copy, Upload, Boxes, Hash, User, Calendar, ArrowLeft,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import {
  Asset, deriveStatus, STATUS_STYLES, siteOf, useAssetHealthMap, HealthBar,
} from "./assetShared";

interface Def {
  name: string; type: string; dataType: string;
  tagName?: string; uom?: string; value?: string;
  required?: boolean; description?: string;
}
const ATTR_TYPES = ["static", "dynamic", "metric"] as const;
const ATTR_DATATYPES = ["text", "number", "double", "boolean", "timestamp"] as const;
const PAYLOAD_SKIP_KEYS = new Set([
  "deviceId","device_id","timestamp","timestampUnix","timestamp_unix","receivedAt","received_at",
  "capturedAt","captured_at","sensor","asset","measurement_point","id","version","type","source",
]);
const PAYLOAD_EXAMPLE = JSON.stringify({ deviceId: "my-device-01", timestampUnix: 1766062407826, data: { temperature: 31.7, humidity: 68.4, energy_kwh: 145.7, battery: 3.0 } }, null, 2);
const CSV_EXAMPLE = `name,type,dataType,tagName,uom\nTemperature,dynamic,double,temperature,°C\nVibration RMS X,dynamic,double,vibration_rms_velocity_x,mm/s\nSensor Serial,static,text,sensor_serial,`;
const JSON_SCHEMA_EXAMPLE = JSON.stringify({ deviceId: "my-device-01", attributes: [{ name: "Temperature", type: "dynamic", dataType: "double", tagName: "temperature", uom: "°C" }] }, null, 2);

function extractFromPayload(text: string): { defs: Def[]; deviceId: string | null } {
  const raw = JSON.parse(text);
  const payloads: any[] = Array.isArray(raw) ? raw : [raw];
  let deviceId: string | null = null;
  const seen: Record<string, any> = {};
  function collect(obj: Record<string, any>, prefix = "") {
    for (const [k, v] of Object.entries(obj)) {
      if (PAYLOAD_SKIP_KEYS.has(k) || ["metrics","data","values","payload"].includes(k)) continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) {
        // Descend into arrays of objects (e.g. a sub-process holding one or more
        // machine readings). Label each element by its "machine" name (or index)
        // so every machine's fields become distinct attributes.
        v.forEach((item, i) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const label = typeof item.machine === "string" && item.machine.trim() ? item.machine : String(i);
            collect(item as Record<string, any>, `${key}.${label}`);
          } else if (typeof item !== "undefined" && typeof item !== "object") {
            seen[`${key}.${i}`] = item;
          }
        });
      } else if (v && typeof v === "object") {
        collect(v as Record<string, any>, key);
      } else if (typeof v !== "undefined") {
        seen[key] = v;
      }
    }
  }
  for (const p of payloads) {
    if (!deviceId && (p.deviceId || p.device_id)) deviceId = p.deviceId ?? p.device_id;
    const dataObj = (p.data && typeof p.data === "object" && !Array.isArray(p.data)) ? p.data
      : (p.metrics && typeof p.metrics === "object" && !Array.isArray(p.metrics)) ? p.metrics
      : (p.payload && typeof p.payload === "object" && !Array.isArray(p.payload)) ? p.payload
      : (p.values && typeof p.values === "object" && !Array.isArray(p.values)) ? p.values : null;
    // Recurse into the wrapper so NESTED metrics flatten to dot keys
    // (e.g. metrics:{grid:{cost_INR:170}} → "grid.cost_INR"), matching how the
    // server normalises nested-data / nested-metrics payloads.
    if (dataObj) collect(dataObj);
    else collect(p);
  }
  const defs: Def[] = Object.entries(seen).map(([key, val]) => {
    const jsType = typeof val;
    let dataType = "text"; let attrType = "dynamic";
    if (jsType === "number") { dataType = Number.isInteger(val as number) ? "number" : "double"; }
    else if (jsType === "boolean") { dataType = "boolean"; }
    else {
      const lk = key.toLowerCase();
      const isSerial = ["serial","mac","id","name","point"].some((s) => lk.includes(s));
      attrType = isSerial ? "static" : "dynamic";
    }
    const name = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { name, type: attrType, dataType, tagName: key };
  });
  return { defs, deviceId };
}
function parseCsvDefs(text: string): Def[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return {
      name: row.name || "Unnamed",
      type: (ATTR_TYPES.includes(row.type as any) ? row.type : "static"),
      dataType: (ATTR_DATATYPES.includes(row.datatype as any) ? row.datatype : ATTR_DATATYPES.includes(row["data_type"] as any) ? row["data_type"] : "text"),
      tagName: row.tagname || row["tag_name"] || row.tag || undefined,
      uom: row.uom || row.unit || undefined,
      description: row.description || undefined,
      required: row.required === "true" || row.required === "TRUE" || undefined,
    } as Def;
  }).filter((r) => r.name && r.name !== "Unnamed");
}

export default function AssetTemplateDetails() {
  const [, params] = useRoute("/asset-templates/:id");
  const id = params?.id ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useCurrentUser();

  const [template, setTemplate] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [editedDefs, setEditedDefs] = useState<Def[]>([]);
  const [defsDirty, setDefsDirty] = useState(false);
  const [savingDefs, setSavingDefs] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [newDef, setNewDef] = useState<Def>({ name: "", type: "dynamic", dataType: "double", tagName: "", uom: "" });

  const deleteTemplate = useDeleteAssetTemplate();
  const createTemplate = useCreateAssetTemplate();
  const { data: assets } = useListAssets();
  const allAssets = (assets as Asset[] | undefined) ?? [];
  const usingAssets = useMemo(() => allAssets.filter((a) => a.templateId === id), [allAssets, id]);

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<"payload" | "csv" | "json">("payload");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<Def[]>([]);
  const [detectedDeviceId, setDetectedDeviceId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [previewUoms, setPreviewUoms] = useState<Record<number, string>>({});
  const csvFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/asset-templates/${id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        if (cancelled) return;
        setTemplate(t);
        setEditedDefs(Array.isArray(t?.attributeDefinitions) ? t.attributeDefinitions : []);
        setDefsDirty(false);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [id]);

  function addDefRow() {
    if (!newDef.name.trim()) return;
    setEditedDefs((p) => [...p, { ...newDef, name: newDef.name.trim() }]);
    setNewDef({ name: "", type: "dynamic", dataType: "double", tagName: "", uom: "" });
    setDefsDirty(true);
  }
  function removeDef(idx: number) { setEditedDefs((p) => p.filter((_, i) => i !== idx)); setDefsDirty(true); }
  function updateDef(idx: number, field: keyof Def, val: any) {
    setEditedDefs((p) => p.map((d, i) => i === idx ? { ...d, [field]: val } : d)); setDefsDirty(true);
  }

  async function saveDefs() {
    if (!template) return;
    setSavingDefs(true);
    try {
      const res = await fetch(`/api/asset-templates/${template.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributeDefinitions: editedDefs }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Save failed", description: data.error, variant: "destructive" }); return; }
      toast({ title: "Template saved", description: `${editedDefs.length} attribute definition(s)` });
      qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
      setTemplate({ ...template, attributeDefinitions: editedDefs, attributeCount: editedDefs.length });
      setDefsDirty(false);
    } finally { setSavingDefs(false); }
  }

  function exportDefsExcel() {
    if (!editedDefs.length) return;
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const headers = ["Attribute Name", "Type", "Data Type", "Tag", "UoM", "Required", "Description"];
    const rows = editedDefs.map((d) => [
      d.name, d.type, d.dataType, d.tagName ?? "", d.uom ?? "", d.required ? "true" : "", d.description ?? "",
    ]);
    // HTML-table workbook — opens natively in Excel with proper columns, no deps/CSP issues.
    const table =
      `<table border="1"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` +
      `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${table}</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${template?.name ?? "template"}_schema.xls`;
    a.click(); URL.revokeObjectURL(url);
  }

  function exportDefsCsv() {
    if (!editedDefs.length) return;
    const esc = (s: any) => {
      const v = String(s ?? "");
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    // Header matches the CSV import parser (parseCsvDefs) so it round-trips.
    const headers = ["name", "type", "dataType", "tagName", "uom", "required", "description"];
    const rows = editedDefs.map((d) => [
      d.name, d.type, d.dataType, d.tagName ?? "", d.uom ?? "", d.required ? "true" : "", d.description ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${template?.name ?? "template"}_schema.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  async function cloneTemplate() {
    if (!template) return;
    setCloning(true);
    try {
      const res = await createTemplate.mutateAsync({ data: { name: `Copy of ${template.name}` } });
      const newId = (res as any).id;
      if (newId && editedDefs.length > 0) {
        await fetch(`/api/asset-templates/${newId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attributeDefinitions: editedDefs }), credentials: "include",
        });
      }
      qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
      toast({ title: "Template cloned", description: `Created "Copy of ${template.name}"` });
      if (newId) navigate(`/asset-templates/${newId}`);
    } finally { setCloning(false); }
  }

  function handleCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => { setImportText(String(reader.result ?? "")); setImportPreview([]); setImportError(null); };
    reader.onerror = () => setImportError("Could not read the file.");
    reader.readAsText(file);
  }
  function handleParse() {
    setImportError(null); setImportPreview([]); setPreviewUoms({});
    try {
      if (importTab === "payload") {
        const { defs, deviceId } = extractFromPayload(importText);
        if (defs.length === 0) throw new Error("No metric keys found in payload.");
        setImportPreview(defs); setDetectedDeviceId(deviceId);
      } else if (importTab === "csv") {
        const rows = parseCsvDefs(importText);
        if (rows.length === 0) throw new Error("No rows found. Check the CSV format.");
        setImportPreview(rows);
      } else {
        const parsed = JSON.parse(importText);
        let arr: Def[]; let did: string | null = null;
        if (Array.isArray(parsed)) arr = parsed;
        else if (parsed && Array.isArray(parsed.attributes)) { arr = parsed.attributes; did = parsed.deviceId ?? parsed.device_id ?? null; }
        else arr = [parsed];
        if (arr.length === 0) throw new Error("No attribute definitions found.");
        setImportPreview(arr); setDetectedDeviceId(did);
      }
    } catch (e: any) { setImportError(e.message); }
  }
  function handleImportConfirm() {
    const finalDefs = importPreview.map((d, i) => previewUoms[i] !== undefined ? { ...d, uom: previewUoms[i] } : d);
    setEditedDefs((p) => [...p, ...finalDefs]);
    setDefsDirty(true);
    const did = detectedDeviceId;
    closeImport();
    if (did) {
      // Register the payload's deviceId so it can be bound to an asset in the wizard.
      void fetch("/api/ingest/register-device", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: did }),
      }).catch(() => {});
      toast({ title: `Added ${finalDefs.length} definition(s)`, description: `Device "${did}" registered — you can now create an asset for it. Click Save to persist the template.` });
    } else {
      toast({ title: `Added ${finalDefs.length} definition(s)`, description: "Click Save to persist the template" });
    }
  }
  function closeImport() {
    setImportOpen(false); setImportText(""); setImportPreview([]); setImportError(null); setDetectedDeviceId(null); setPreviewUoms({});
  }

  if (loading) return <div className="p-6 space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /></div>;
  if (!template) return (
    <div className="p-6 text-center text-muted-foreground">
      <LayoutTemplate className="w-10 h-10 mx-auto mb-3 opacity-20" />
      <p className="text-sm font-medium">Template not found</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/asset-templates")}>Back to Templates</Button>
    </div>
  );

  const summary = [
    { label: "Assets Using", value: String(usingAssets.length), icon: Boxes },
    { label: "Total Attributes", value: String(editedDefs.length), icon: Hash },
    { label: "Created By", value: "—", icon: User },
    { label: "Created On", value: template.createdAt ? format(new Date(template.createdAt), "yyyy-MM-dd") : "—", icon: Calendar },
  ];

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/asset-templates"))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <button onClick={() => navigate("/asset-templates")} className="hover:text-foreground">Asset Templates</button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-foreground font-medium">{template.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={exportDefsExcel} disabled={editedDefs.length === 0}>
            <Download className="w-3.5 h-3.5 mr-1" /> Export to Excel
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={exportDefsCsv} disabled={editedDefs.length === 0}>
            <Download className="w-3.5 h-3.5 mr-1" /> Export to CSV
          </Button>
          {can("manage_templates") && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={cloneTemplate} disabled={cloning}>
              <Copy className="w-3.5 h-3.5 mr-1" /> {cloning ? "Cloning…" : "Clone"}
            </Button>
          )}
          {can("manage_templates") && (
            <Button size="sm" className="h-8 text-xs" onClick={saveDefs} disabled={!defsDirty || savingDefs}>
              <Save className="w-3.5 h-3.5 mr-1" />{savingDefs ? "Saving…" : "Save"}
            </Button>
          )}
          {can("manage_templates") && (
            <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteTemplate.mutate({ id: template.id }, {
                onSuccess: () => { toast({ title: "Template deleted" }); qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() }); navigate("/asset-templates"); },
              })}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-lg bg-primary/10 text-primary"><LayoutTemplate className="w-5 h-5" /></div>
        <div>
          <h1 className="text-xl font-bold">{template.name}</h1>
          <p className="text-sm text-muted-foreground">Template for {template.name.toLowerCase()} assets</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary.map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted text-muted-foreground"><s.icon className="w-4 h-4" /></div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold tabular-nums">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="attributes">
        <TabsList>
          <TabsTrigger value="assets" className="text-xs">Assets ({usingAssets.length})</TabsTrigger>
          <TabsTrigger value="attributes" className="text-xs">Attributes ({editedDefs.length})</TabsTrigger>
        </TabsList>

        {/* Assets tab */}
        <TabsContent value="assets" className="mt-3">
          <AssetsUsingTable assets={usingAssets} allAssets={allAssets} onOpen={(aid) => navigate(`/assets/${aid}`)} />
        </TabsContent>

        {/* Attributes tab */}
        <TabsContent value="attributes" className="mt-3">
          <Card className="shadow-sm overflow-hidden">
            <div className="p-3 flex items-center justify-between border-b border-border bg-muted/30">
              <span className="text-xs text-muted-foreground">{editedDefs.length} attribute definition{editedDefs.length !== 1 ? "s" : ""}</span>
              {can("manage_templates") && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setImportOpen(true); setImportTab("payload"); setImportText(""); setImportPreview([]); setImportError(null); }}>
                  <Zap className="w-3.5 h-3.5 mr-1" /> Import / Parse
                </Button>
              )}
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-muted-foreground">
                    <th className="text-left px-3 py-2.5 font-medium min-w-36">Attribute Name</th>
                    <th className="text-left px-3 py-2.5 font-medium w-28">Data Type</th>
                    <th className="text-left px-3 py-2.5 font-medium w-20">Unit</th>
                    <th className="text-left px-3 py-2.5 font-medium w-20">Required</th>
                    <th className="text-left px-3 py-2.5 font-medium min-w-48">Description</th>
                    <th className="text-left px-3 py-2.5 font-medium min-w-32">Tag (relative)</th>
                    <th className="px-3 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {editedDefs.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                      <LayoutTemplate className="w-7 h-7 mx-auto mb-3 opacity-20" />
                      <p className="text-sm font-medium mb-1">No attribute definitions yet</p>
                      <p className="text-xs opacity-60 mb-4">Paste a device payload to extract all fields automatically.</p>
                      {can("manage_templates") && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setImportOpen(true); setImportTab("payload"); }}>
                          <Zap className="w-3 h-3 mr-1.5" /> Paste Device Payload
                        </Button>
                      )}
                    </td></tr>
                  ) : editedDefs.map((def, idx) => (
                    <tr key={idx} className="border-b border-border/50 hover:bg-muted/20 group">
                      <td className="px-2 py-1">
                        <Input value={def.name} onChange={(e) => updateDef(idx, "name", e.target.value)} disabled={!can("manage_templates")}
                          className="h-7 text-xs border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                      </td>
                      <td className="px-2 py-1">
                        <Select value={def.dataType} onValueChange={(v) => updateDef(idx, "dataType", v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{ATTR_DATATYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Input value={def.uom ?? ""} onChange={(e) => updateDef(idx, "uom", e.target.value)} placeholder="—" disabled={!can("manage_templates")}
                          className="h-7 text-xs border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                      </td>
                      <td className="px-2 py-1">
                        <Switch checked={!!def.required} onCheckedChange={(v) => updateDef(idx, "required", v)} disabled={!can("manage_templates")} className="scale-75" />
                      </td>
                      <td className="px-2 py-1">
                        <Input value={def.description ?? ""} onChange={(e) => updateDef(idx, "description", e.target.value)} placeholder="—" disabled={!can("manage_templates")}
                          className="h-7 text-xs border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                      </td>
                      <td className="px-2 py-1">
                        <Input value={def.tagName ?? ""} onChange={(e) => updateDef(idx, "tagName", e.target.value)} placeholder="metric_key" disabled={!can("manage_templates")}
                          className="h-7 text-xs font-mono border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                      </td>
                      <td className="px-2 py-1">
                        {can("manage_templates") && (
                          <button onClick={() => removeDef(idx)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {/* New row */}
                  {can("manage_templates") && (
                    <tr className="bg-muted/10">
                      <td className="px-2 py-1">
                        <Input value={newDef.name} onChange={(e) => setNewDef((d) => ({ ...d, name: e.target.value }))} placeholder="+ Add attribute" className="h-7 text-xs" onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} />
                      </td>
                      <td className="px-2 py-1">
                        <Select value={newDef.dataType} onValueChange={(v) => setNewDef((d) => ({ ...d, dataType: v }))}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{ATTR_DATATYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1"><Input value={newDef.uom ?? ""} onChange={(e) => setNewDef((d) => ({ ...d, uom: e.target.value }))} placeholder="unit" className="h-7 text-xs" /></td>
                      <td className="px-2 py-1"><Switch checked={!!newDef.required} onCheckedChange={(v) => setNewDef((d) => ({ ...d, required: v }))} className="scale-75" /></td>
                      <td className="px-2 py-1"><Input value={newDef.description ?? ""} onChange={(e) => setNewDef((d) => ({ ...d, description: e.target.value }))} placeholder="description" className="h-7 text-xs" /></td>
                      <td className="px-2 py-1"><Input value={newDef.tagName ?? ""} onChange={(e) => setNewDef((d) => ({ ...d, tagName: e.target.value }))} placeholder="metric_key" className="h-7 text-xs font-mono" onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} /></td>
                      <td className="px-2 py-1"><Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={addDefRow} disabled={!newDef.name.trim()}><Plus className="w-3 h-3" /></Button></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {defsDirty && (
              <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-800/40 flex items-center justify-between">
                <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" /> Unsaved changes — click Save to persist</p>
                <Button size="sm" className="h-6 text-xs" onClick={saveDefs} disabled={savingDefs}><Save className="w-3 h-3 mr-1" />{savingDefs ? "Saving…" : "Save now"}</Button>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Import / Parse dialog */}
      <Dialog open={importOpen} onOpenChange={(v) => { if (!v) closeImport(); }}>
        <DialogContent className="max-w-2xl flex flex-col max-h-[90vh] p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
            <DialogTitle className="flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Import Attribute Definitions</DialogTitle>
            <DialogDescription>Three ways to populate a template. The fastest: paste a raw device payload.</DialogDescription>
          </DialogHeader>
          <Tabs value={importTab} onValueChange={(v) => { setImportTab(v as any); setImportText(""); setImportPreview([]); setImportError(null); setDetectedDeviceId(null); setPreviewUoms({}); }} className="flex flex-col flex-1 min-h-0">
            <div className="px-6 shrink-0">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="payload" className="text-xs gap-1.5"><Zap className="w-3 h-3" /> Device Payload</TabsTrigger>
                <TabsTrigger value="csv" className="text-xs gap-1.5"><FileSpreadsheet className="w-3 h-3" /> CSV</TabsTrigger>
                <TabsTrigger value="json" className="text-xs gap-1.5"><Braces className="w-3 h-3" /> Schema JSON</TabsTrigger>
              </TabsList>
            </div>
            {/* Device Payload */}
            <TabsContent value="payload" className="flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
                <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-3 space-y-1.5 text-xs">
                  <p className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> How this works</p>
                  <ul className="text-blue-700 dark:text-blue-400 space-y-1">
                    <li>• Paste the raw JSON your device sends to the ingest endpoint</li>
                    <li>• Every field in <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">data</code>/<code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">metrics</code> becomes an attribute</li>
                    <li>• Tag names stay relative; the asset identifier is prepended on apply</li>
                  </ul>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Paste Device Payload</label>
                  <button className="text-xs text-primary hover:underline" onClick={() => setImportText(PAYLOAD_EXAMPLE)}>Load example</button>
                </div>
                <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportPreview([]); setImportError(null); }} placeholder={'{\n  "deviceId": "my-device-01",\n  "data": { "temperature": 31.7 }\n}'} className="font-mono text-xs h-44 resize-none" />
                {importError && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{importError}</p>}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!importText.trim()}><Zap className="w-3 h-3 mr-1" /> Extract attributes from payload</Button>
                {importPreview.length > 0 && (
                  <div className="space-y-2">
                    {detectedDeviceId && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded px-2.5 py-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> Device ID detected: <code className="font-mono font-medium text-foreground">{detectedDeviceId}</code>
                      </div>
                    )}
                    <PreviewTable rows={importPreview} uomOverrides={previewUoms}
                      onUomChange={(i, v) => setPreviewUoms((p) => ({ ...p, [i]: v }))}
                      onTypeChange={(i, v) => setImportPreview((p) => p.map((d, idx) => idx === i ? { ...d, type: v } : d))}
                      onRemove={(i) => setImportPreview((p) => p.filter((_, idx) => idx !== i))} />
                  </div>
                )}
              </div>
              <ImportFooter onCancel={closeImport} onConfirm={handleImportConfirm} count={importPreview.length} />
            </TabsContent>
            {/* CSV */}
            <TabsContent value="csv" className="flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
                <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">Columns</p>
                  <p><code className="bg-muted px-1 rounded">name</code> · <code className="bg-muted px-1 rounded">type</code> · <code className="bg-muted px-1 rounded">dataType</code> · <code className="bg-muted px-1 rounded">tagName</code> · <code className="bg-muted px-1 rounded">uom</code> · <code className="bg-muted px-1 rounded">required</code> · <code className="bg-muted px-1 rounded">description</code></p>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">CSV Data</label>
                  <div className="flex items-center gap-3">
                    <input ref={csvFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ""; }} />
                    <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={() => csvFileRef.current?.click()}><Upload className="w-3 h-3" /> Upload CSV file</button>
                    <button className="text-xs text-primary hover:underline" onClick={() => setImportText(CSV_EXAMPLE)}>Load example</button>
                  </div>
                </div>
                <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportPreview([]); setImportError(null); }} placeholder={"name,type,dataType,tagName,uom\nTemperature,dynamic,double,temperature,°C"} className="font-mono text-xs h-40 resize-none" />
                {importError && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{importError}</p>}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!importText.trim()}>Preview</Button>
                {importPreview.length > 0 && (
                  <PreviewTable rows={importPreview} uomOverrides={previewUoms}
                    onUomChange={(i, v) => setPreviewUoms((p) => ({ ...p, [i]: v }))}
                    onTypeChange={(i, v) => setImportPreview((p) => p.map((d, idx) => idx === i ? { ...d, type: v } : d))}
                    onRemove={(i) => setImportPreview((p) => p.filter((_, idx) => idx !== i))} />
                )}
              </div>
              <ImportFooter onCancel={closeImport} onConfirm={handleImportConfirm} count={importPreview.length} />
            </TabsContent>
            {/* JSON */}
            <TabsContent value="json" className="flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
                <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">Schema JSON format</p>
                  <p className="opacity-60">Bare array, or envelope <code className="bg-muted px-1 rounded">{`{ "deviceId": "...", "attributes": [...] }`}</code>.</p>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Schema JSON</label>
                  <button className="text-xs text-primary hover:underline" onClick={() => setImportText(JSON_SCHEMA_EXAMPLE)}>Load example</button>
                </div>
                <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportPreview([]); setImportError(null); }} placeholder={'{\n  "deviceId": "my-device-01",\n  "attributes": [ ... ]\n}'} className="font-mono text-xs h-40 resize-none" />
                {importError && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{importError}</p>}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!importText.trim()}>Preview</Button>
                {importPreview.length > 0 && (
                  <PreviewTable rows={importPreview} uomOverrides={previewUoms}
                    onUomChange={(i, v) => setPreviewUoms((p) => ({ ...p, [i]: v }))}
                    onTypeChange={(i, v) => setImportPreview((p) => p.map((d, idx) => idx === i ? { ...d, type: v } : d))}
                    onRemove={(i) => setImportPreview((p) => p.filter((_, idx) => idx !== i))} />
                )}
              </div>
              <ImportFooter onCancel={closeImport} onConfirm={handleImportConfirm} count={importPreview.length} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImportFooter({ onCancel, onConfirm, count }: { onCancel: () => void; onConfirm: () => void; count: number }) {
  return (
    <div className="px-6 py-4 border-t border-border shrink-0">
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm} disabled={count === 0}>Add {count || ""} definition{count !== 1 ? "s" : ""} to template</Button>
      </DialogFooter>
    </div>
  );
}

function PreviewTable({ rows, uomOverrides, onUomChange, onTypeChange, onRemove }: {
  rows: Def[]; uomOverrides: Record<number, string>;
  onUomChange: (i: number, v: string) => void; onTypeChange: (i: number, v: string) => void; onRemove: (i: number) => void;
}) {
  return (
    <div className="rounded border border-border overflow-hidden">
      <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> {rows.length} attribute{rows.length !== 1 ? "s" : ""} extracted — review &amp; adjust before adding
      </div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30 text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-medium">Name</th>
              <th className="text-left px-3 py-1.5 font-medium w-24">Type</th>
              <th className="text-left px-3 py-1.5 font-medium w-20">Data Type</th>
              <th className="text-left px-3 py-1.5 font-medium">Tag (relative)</th>
              <th className="text-left px-3 py-1.5 font-medium w-20">UoM</th>
              <th className="px-2 py-1.5 w-6" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-1.5 font-medium">{r.name}</td>
                <td className="px-2 py-1">
                  <Select value={r.type} onValueChange={(v) => onTypeChange(i, v)}>
                    <SelectTrigger className="h-6 text-xs py-0"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="static">static</SelectItem><SelectItem value="dynamic">dynamic</SelectItem><SelectItem value="metric">metric</SelectItem></SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.dataType}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.tagName || "—"}</td>
                <td className="px-2 py-1"><Input value={uomOverrides[i] ?? r.uom ?? ""} onChange={(e) => onUomChange(i, e.target.value)} placeholder="unit" className="h-6 text-xs px-1 py-0" /></td>
                <td className="px-2 py-1"><button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssetsUsingTable({ assets, allAssets, onOpen }: { assets: Asset[]; allAssets: Asset[]; onOpen: (id: string) => void }) {
  const healthMap = useAssetHealthMap(assets.map((a) => a.id));
  if (assets.length === 0) {
    return <Card className="shadow-sm"><CardContent className="p-10 text-center text-sm text-muted-foreground">No assets are using this template yet.</CardContent></Card>;
  }
  return (
    <Card className="shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-medium">Asset Identifier</th>
              <th className="text-left px-4 py-2.5 font-medium">Asset Name</th>
              <th className="text-left px-4 py-2.5 font-medium">Site</th>
              <th className="text-left px-4 py-2.5 font-medium">Health</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 font-medium">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => {
              const h = healthMap[a.id] ?? null;
              const status = deriveStatus(a, h);
              return (
                <tr key={a.id} onClick={() => onOpen(a.id)} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-4 py-2.5 font-mono text-xs text-primary">{a.identifier}</td>
                  <td className="px-4 py-2.5 font-medium">{a.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{siteOf(a, allAssets)}</td>
                  <td className="px-4 py-2.5"><HealthBar pct={h?.freshnessPct ?? null} /></td>
                  <td className="px-4 py-2.5"><span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[status])}>{status}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.updatedAt ? format(new Date(a.updatedAt), "MM/dd HH:mm") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
