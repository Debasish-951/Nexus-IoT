import { useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
import {
  useListAssetTemplates,
  useCreateAssetTemplate,
  useDeleteAssetTemplate,
  getListAssetTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Search, FileText, Save, Braces, FileSpreadsheet,
  ChevronRight, AlertTriangle, CheckCircle2, LayoutTemplate, Zap, Info,
  Download, HelpCircle, Copy,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AttributeDefinition {
  name: string;
  type: "static" | "dynamic" | "metric";
  dataType: "text" | "number" | "double" | "boolean" | "timestamp";
  tagName?: string;
  uom?: string;
  value?: string;
}

const ATTR_TYPES     = ["static", "dynamic", "metric"] as const;
const ATTR_DATATYPES = ["text", "number", "double", "boolean", "timestamp"] as const;

// Metadata keys to skip when parsing a flat payload
const PAYLOAD_SKIP_KEYS = new Set([
  "deviceId","device_id","timestamp","timestampUnix","timestamp_unix",
  "receivedAt","received_at","capturedAt","captured_at",
  "sensor","asset","measurement_point","id","version","type","source",
]);

function AttributeType({ type }: { type: string }) {
  const colors: Record<string, string> = {
    static:  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    dynamic: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    metric:  "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  };
  return <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", colors[type] ?? "bg-muted text-muted-foreground")}>{type}</span>;
}

// ── Payload extractor ─────────────────────────────────────────────────────────
// Accepts nested-data, nested-metrics, flat JSON, or array of payloads
function extractFromPayload(text: string): { defs: AttributeDefinition[]; deviceId: string | null } {
  const raw = JSON.parse(text);
  const payloads: any[] = Array.isArray(raw) ? raw : [raw];

  let deviceId: string | null = null;
  const seen: Record<string, any> = {};

  function collectMetrics(obj: Record<string, any>, prefix = "") {
    for (const [k, v] of Object.entries(obj)) {
      if (PAYLOAD_SKIP_KEYS.has(k) || k === "metrics" || k === "data" || k === "values" || k === "payload") continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        collectMetrics(v as Record<string, any>, key);
      } else if (typeof v !== "undefined") {
        seen[key] = v;
      }
    }
  }

  for (const p of payloads) {
    // Capture device identifier
    if (!deviceId && (p.deviceId || p.device_id)) {
      deviceId = p.deviceId ?? p.device_id;
    }

    // Priority 1: explicit data / metrics / payload / values envelope
    const dataObj: Record<string, any> | null =
      (p.data    && typeof p.data    === "object" && !Array.isArray(p.data))    ? p.data    :
      (p.metrics && typeof p.metrics === "object" && !Array.isArray(p.metrics)) ? p.metrics :
      (p.payload && typeof p.payload === "object" && !Array.isArray(p.payload)) ? p.payload :
      (p.values  && typeof p.values  === "object" && !Array.isArray(p.values))  ? p.values  :
      null;

    if (dataObj) {
      for (const [k, v] of Object.entries(dataObj)) {
        if (typeof v !== "object" || v === null) seen[k] = v;
      }
    } else {
      // Priority 2: flat or nested-root payload — flatten nested objects
      collectMetrics(p);
    }
  }

  // ── Build attribute definitions ──────────────────────────────────────────
  const defs: AttributeDefinition[] = Object.entries(seen).map(([key, val]) => {
    const jsType = typeof val;

    let dataType: AttributeDefinition["dataType"] = "text";
    let attrType: AttributeDefinition["type"]     = "dynamic";

    if (jsType === "number") {
      dataType = Number.isInteger(val as number) ? "number" : "double";
      attrType = "dynamic";
    } else if (jsType === "boolean") {
      dataType = "boolean";
      attrType = "dynamic";
    } else {
      dataType = "text";
      // Heuristic: serial / MAC addresses are static metadata
      const lk = key.toLowerCase();
      const isSerial = lk.includes("serial") || lk.includes("mac") || lk.includes("id") || lk.includes("name") || lk.includes("point");
      const isMac    = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(String(val));
      attrType = (isSerial || isMac) ? "static" : "dynamic";
    }

    // Convert snake_case → "Title Case" for the display name
    const name = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    return { name, type: attrType, dataType, tagName: key };
  });

  return { defs, deviceId };
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCsvDefs(text: string): AttributeDefinition[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return {
      name:     row.name     || "Unnamed",
      type:     (ATTR_TYPES.includes(row.type as any) ? row.type : "static") as any,
      dataType: (ATTR_DATATYPES.includes(row.datatype as any)         ? row.datatype :
                 ATTR_DATATYPES.includes(row["data_type"] as any)     ? row["data_type"] : "text") as any,
      tagName:  row.tagname  || row["tag_name"] || row.tag  || undefined,
      uom:      row.uom      || row.unit                    || undefined,
      value:    row.value                                   || undefined,
    };
  }).filter((r) => r.name && r.name !== "Unnamed");
}

// ── Example payloads ──────────────────────────────────────────────────────────
const PAYLOAD_EXAMPLE = JSON.stringify({
  deviceId: "my-device-01",
  timestampUnix: 1766062407826,
  data: {
    temperature: 31.7,
    humidity: 68.4,
    pressure: 1013.2,
    energy_kwh: 145.7,
    vibration_rms_x: 1.1,
    vibration_rms_y: 0.8,
    battery: 3.0,
    runhours: 1654,
  },
}, null, 2);

const CSV_EXAMPLE = `name,type,dataType,tagName,uom\nTemperature,dynamic,double,temperature,°C\nVibration RMS X,dynamic,double,vibration_rms_velocity_x,mm/s\nUltrasound,dynamic,double,ultrasound,dB\nBattery,dynamic,double,battery,V\nRun Hours,dynamic,double,runhours,h\nSensor Serial,static,text,sensor_serial,`;

const JSON_SCHEMA_EXAMPLE = JSON.stringify([
  { name: "Temperature",       type: "dynamic", dataType: "double", tagName: "temperature",            uom: "°C" },
  { name: "Vibration RMS X",   type: "dynamic", dataType: "double", tagName: "vibration_rms_velocity_x", uom: "mm/s" },
  { name: "Ultrasound",        type: "dynamic", dataType: "double", tagName: "ultrasound",             uom: "dB" },
  { name: "Sensor Serial",     type: "static",  dataType: "text",   tagName: "sensor_serial" },
], null, 2);

// ── Main component ────────────────────────────────────────────────────────────
export default function AssetTemplates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useCurrentUser();

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const [editedDefs, setEditedDefs] = useState<AttributeDefinition[]>([]);
  const [defsDirty,  setDefsDirty]  = useState(false);
  const [savingDefs, setSavingDefs] = useState(false);

  const [newDef, setNewDef] = useState<AttributeDefinition>({
    name: "", type: "dynamic", dataType: "double", tagName: "", uom: "",
  });

  // Import dialog
  const [importOpen,   setImportOpen]   = useState(false);
  const [importTab,    setImportTab]    = useState<"payload" | "csv" | "json">("payload");
  const [importText,   setImportText]   = useState("");
  const [importPreview, setImportPreview] = useState<AttributeDefinition[]>([]);
  const [detectedDeviceId, setDetectedDeviceId] = useState<string | null>(null);
  const [importError,  setImportError]  = useState<string | null>(null);

  // Per-row UoM editing in the preview (payload mode)
  const [previewUoms, setPreviewUoms] = useState<Record<number, string>>({});

  const [cloning, setCloning] = useState(false);

  const { data: templates } = useListAssetTemplates({ search: search || undefined });
  const createTemplate = useCreateAssetTemplate();
  const deleteTemplate = useDeleteAssetTemplate();

  async function cloneTemplate(t: any) {
    setCloning(true);
    try {
      const res = await createTemplate.mutateAsync({ data: { name: `Copy of ${t.name}` } });
      const newId = (res as any).id;
      if (newId && editedDefs.length > 0) {
        await fetch(`${BASE}/api/asset-templates/${newId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attributeDefinitions: editedDefs }),
          credentials: "include",
        });
      }
      qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
      toast({ title: "Template cloned", description: `Created "Copy of ${t.name}"` });
    } finally {
      setCloning(false);
    }
  }

  const form = useForm({ defaultValues: { name: "" } });
  const templateList = (templates as any[] | undefined) ?? [];

  function selectTemplate(t: any) {
    setSelected(t);
    const defs: AttributeDefinition[] = Array.isArray(t.attributeDefinitions) ? t.attributeDefinitions : [];
    setEditedDefs(defs);
    setDefsDirty(false);
  }

  function addDefRow() {
    if (!newDef.name.trim()) return;
    setEditedDefs((prev) => [...prev, { ...newDef, name: newDef.name.trim() }]);
    setNewDef({ name: "", type: "dynamic", dataType: "double", tagName: "", uom: "" });
    setDefsDirty(true);
  }

  function removeDef(idx: number) {
    setEditedDefs((prev) => prev.filter((_, i) => i !== idx));
    setDefsDirty(true);
  }

  function updateDef(idx: number, field: keyof AttributeDefinition, val: string) {
    setEditedDefs((prev) => prev.map((d, i) => i === idx ? { ...d, [field]: val } : d));
    setDefsDirty(true);
  }

  async function saveDefs() {
    if (!selected) return;
    setSavingDefs(true);
    try {
      const res = await fetch(`/api/asset-templates/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributeDefinitions: editedDefs }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Save failed", description: data.error, variant: "destructive" }); return; }
      toast({ title: "Template saved", description: `${editedDefs.length} attribute definition(s)` });
      qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
      setSelected({ ...selected, attributeDefinitions: editedDefs, attributeCount: editedDefs.length });
      setDefsDirty(false);
    } finally {
      setSavingDefs(false);
    }
  }

  function exportDefsJson() {
    if (!editedDefs.length) return;
    const blob = new Blob([JSON.stringify(editedDefs, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${selected?.name ?? "template"}_schema.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  // ── Import parse ─────────────────────────────────────────────────────────
  function handleParse() {
    setImportError(null);
    setImportPreview([]);
    setPreviewUoms({});
    try {
      if (importTab === "payload") {
        const { defs, deviceId } = extractFromPayload(importText);
        if (defs.length === 0) throw new Error("No metric keys found in payload. Check that the payload contains a data/metrics field.");
        setImportPreview(defs);
        setDetectedDeviceId(deviceId);
      } else if (importTab === "csv") {
        const rows = parseCsvDefs(importText);
        if (rows.length === 0) throw new Error("No rows found. Check the CSV format.");
        setImportPreview(rows);
      } else {
        const parsed = JSON.parse(importText);
        const arr: AttributeDefinition[] = Array.isArray(parsed) ? parsed : [parsed];
        setImportPreview(arr);
      }
    } catch (e: any) {
      setImportError(e.message);
    }
  }

  function handleImportConfirm() {
    // Merge any user-edited UoMs from the preview
    const finalDefs = importPreview.map((d, i) =>
      previewUoms[i] !== undefined ? { ...d, uom: previewUoms[i] } : d
    );
    setEditedDefs((prev) => [...prev, ...finalDefs]);
    setDefsDirty(true);
    closeImport();
    toast({ title: `Added ${finalDefs.length} definition(s)`, description: "Click Save to persist the template" });
  }

  function closeImport() {
    setImportOpen(false);
    setImportText(""); setImportPreview([]); setImportError(null);
    setDetectedDeviceId(null); setPreviewUoms({});
  }

  function onSubmit(data: { name: string }) {
    createTemplate.mutate({ data: { name: data.name } }, {
      onSuccess: () => {
        toast({ title: "Template created" });
        qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
        setCreateOpen(false); form.reset();
      },
    });
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Template list ─────────────────────────────────────────────── */}
      <div className="w-72 border-r border-border flex flex-col shrink-0 bg-card">
        <div className="p-3 border-b border-border flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
          {can("manage_templates") && (
            <Button size="sm" className="h-8 shrink-0" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {!templates ? (
            <div className="p-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded" />)}</div>
          ) : templateList.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <LayoutTemplate className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No templates yet</p>
              {can("manage_templates") && (
                <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => setCreateOpen(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Create template
                </Button>
              )}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {templateList.map((t: any) => (
                <button key={t.id} onClick={() => selectTemplate(t)}
                  className={cn("w-full text-left rounded-md p-3 border transition-all",
                    selected?.id === t.id ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/50")}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <LayoutTemplate className="w-3.5 h-3.5 shrink-0 text-primary/60" />
                      <span className="font-medium text-sm truncate">{t.name}</span>
                    </div>
                    <ChevronRight className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", selected?.id === t.id && "rotate-90")} />
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 pl-5">
                    <Badge variant="secondary" className="text-xs h-4 px-1.5">{t.attributeCount} attrs</Badge>
                    <span className="text-xs text-muted-foreground">{format(new Date(t.updatedAt), "MM/dd/yyyy")}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Template detail panel ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <LayoutTemplate className="w-4 h-4 text-primary/70" />
                  {selected.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Define attribute blueprints · apply to any asset in one click
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportDefsJson} disabled={editedDefs.length === 0}
                  title="Download this template's attribute schema as JSON — useful for sharing between platforms or re-importing later">
                  <Download className="w-3 h-3 mr-1" /> Export Schema
                </Button>
                {can("manage_templates") && (
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => cloneTemplate(selected)} disabled={cloning}
                    title="Duplicate this template with all its attribute definitions">
                    <Copy className="w-3 h-3 mr-1" /> {cloning ? "Cloning…" : "Clone"}
                  </Button>
                )}
                {can("manage_templates") && (
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => { setImportOpen(true); setImportTab("payload"); setImportText(""); setImportPreview([]); setImportError(null); }}>
                    <Zap className="w-3 h-3 mr-1" /> Import / Parse
                  </Button>
                )}
                {can("manage_templates") && (
                  <Button size="sm" className="h-7 text-xs" onClick={saveDefs} disabled={!defsDirty || savingDefs}>
                    <Save className="w-3 h-3 mr-1" />{savingDefs ? "Saving…" : "Save"}
                  </Button>
                )}
                {can("manage_templates") && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => deleteTemplate.mutate({ id: selected.id }, {
                      onSuccess: () => { toast({ title: "Template deleted" }); qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() }); setSelected(null); }
                    })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* Attribute definitions table */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 sticky top-0 z-10">
                      <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-8">#</th>
                      <th className="text-left px-3 py-2.5 font-medium text-muted-foreground min-w-36">Name</th>
                      <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-28">Type</th>
                      <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-28">Data Type</th>
                      <th className="text-left px-3 py-2.5 font-medium text-muted-foreground min-w-40">
                        Tag Name <span className="font-normal opacity-50">(relative key)</span>
                      </th>
                      <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-20">UoM</th>
                      <th className="px-3 py-2.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editedDefs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                          <LayoutTemplate className="w-7 h-7 mx-auto mb-3 opacity-20" />
                          <p className="text-sm font-medium mb-1">No attribute definitions yet</p>
                          <p className="text-xs opacity-60 mb-4 max-w-xs mx-auto">
                            The fastest way: paste a raw device payload and extract all fields automatically.
                          </p>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => { setImportOpen(true); setImportTab("payload"); }}>
                            <Zap className="w-3 h-3 mr-1.5" /> Paste Device Payload
                          </Button>
                        </td>
                      </tr>
                    ) : (
                      editedDefs.map((def, idx) => (
                        <tr key={idx} className="border-b border-border/50 hover:bg-muted/20 group">
                          <td className="px-3 py-1.5 text-muted-foreground/50">{idx + 1}</td>
                          <td className="px-2 py-1">
                            <Input value={def.name} onChange={(e) => updateDef(idx, "name", e.target.value)}
                              className="h-6 text-xs border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                          </td>
                          <td className="px-2 py-1">
                            <Select value={def.type} onValueChange={(v) => updateDef(idx, "type", v)}>
                              <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>{ATTR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Select value={def.dataType} onValueChange={(v) => updateDef(idx, "dataType", v)}>
                              <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>{ATTR_DATATYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Input value={def.tagName ?? ""} onChange={(e) => updateDef(idx, "tagName", e.target.value)}
                              placeholder="metric_key"
                              className="h-6 text-xs font-mono border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                          </td>
                          <td className="px-2 py-1">
                            <Input value={def.uom ?? ""} onChange={(e) => updateDef(idx, "uom", e.target.value)}
                              placeholder="°C"
                              className="h-6 text-xs border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                          </td>
                          <td className="px-2 py-1">
                            <button onClick={() => removeDef(idx)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}

                    {/* New row input */}
                    <tr className="bg-muted/10">
                      <td className="px-3 py-1.5 text-muted-foreground/40">+</td>
                      <td className="px-2 py-1">
                        <Input value={newDef.name} onChange={(e) => setNewDef((d) => ({ ...d, name: e.target.value }))}
                          placeholder="Attribute name" className="h-6 text-xs"
                          onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} />
                      </td>
                      <td className="px-2 py-1">
                        <Select value={newDef.type} onValueChange={(v) => setNewDef((d) => ({ ...d, type: v as any }))}>
                          <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{ATTR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Select value={newDef.dataType} onValueChange={(v) => setNewDef((d) => ({ ...d, dataType: v as any }))}>
                          <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{ATTR_DATATYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Input value={newDef.tagName ?? ""} onChange={(e) => setNewDef((d) => ({ ...d, tagName: e.target.value }))}
                          placeholder="metric_key" className="h-6 text-xs font-mono"
                          onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} />
                      </td>
                      <td className="px-2 py-1">
                        <Input value={newDef.uom ?? ""} onChange={(e) => setNewDef((d) => ({ ...d, uom: e.target.value }))}
                          placeholder="unit" className="h-6 text-xs"
                          onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} />
                      </td>
                      <td className="px-2 py-1">
                        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={addDefRow} disabled={!newDef.name.trim()}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {defsDirty && (
                <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-800/40 flex items-center justify-between">
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" /> Unsaved changes — click Save to persist
                  </p>
                  <Button size="sm" className="h-6 text-xs" onClick={saveDefs} disabled={savingDefs}>
                    <Save className="w-3 h-3 mr-1" />{savingDefs ? "Saving…" : "Save now"}
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm">
              <LayoutTemplate className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
              <p className="text-sm font-medium text-muted-foreground">Select a template to edit attribute definitions</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Templates hold reusable attribute schemas you can apply to any asset in bulk</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Create template dialog ───────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Template</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel>
                  <FormControl><Input placeholder="e.g. Rotating Equipment, Energy Meter, Flow Sensor" {...field} /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createTemplate.isPending}>Create</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Import / Parse dialog ────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(v) => { if (!v) closeImport(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" /> Import Attribute Definitions
            </DialogTitle>
            <DialogDescription>
              Three ways to populate a template. The fastest: paste a raw device payload.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={importTab} onValueChange={(v) => { setImportTab(v as any); setImportText(""); setImportPreview([]); setImportError(null); setDetectedDeviceId(null); setPreviewUoms({}); }}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="payload" className="text-xs gap-1.5">
                <Zap className="w-3 h-3" /> Device Payload
              </TabsTrigger>
              <TabsTrigger value="csv" className="text-xs gap-1.5">
                <FileSpreadsheet className="w-3 h-3" /> CSV
              </TabsTrigger>
              <TabsTrigger value="json" className="text-xs gap-1.5">
                <Braces className="w-3 h-3" /> Schema JSON
              </TabsTrigger>
            </TabsList>

            {/* ── Device Payload tab ──────────────────────────────────── */}
            <TabsContent value="payload" className="space-y-3 mt-3">
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" /> How this works
                </p>
                <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1 list-none">
                  <li>• Paste the raw JSON your device or gateway sends to the ingest endpoint</li>
                  <li>• The platform reads every field in <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">data</code> / <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">metrics</code> and turns each one into an attribute definition</li>
                  <li>• Numbers → <span className="font-medium">dynamic / double</span> · strings → <span className="font-medium">static / text</span> · the <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">deviceId</code> is shown for reference but not stored in the template</li>
                  <li>• Tag names stay as relative keys (e.g. <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">temperature</code>) — the asset identifier is prepended when you apply the template to an asset</li>
                </ul>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Paste Device Payload</label>
                  <button className="text-xs text-primary hover:underline" onClick={() => setImportText(PAYLOAD_EXAMPLE)}>Load example</button>
                </div>
                <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportPreview([]); setImportError(null); }}
                  placeholder={'{\n  "deviceId": "my-device-01",\n  "data": {\n    "temperature": 31.7,\n    "energy_kwh": 145.7\n  }\n}'}
                  className="font-mono text-xs h-44 resize-none" />
              </div>
              {importError && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 shrink-0" />{importError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!importText.trim()}>
                <Zap className="w-3 h-3 mr-1" /> Extract attributes from payload
              </Button>

              {importPreview.length > 0 && (
                <div className="space-y-2">
                  {detectedDeviceId && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded px-2.5 py-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      Device ID detected: <code className="font-mono font-medium text-foreground">{detectedDeviceId}</code>
                      <span className="opacity-50 ml-1">— tag names will resolve as <code className="font-mono">{detectedDeviceId}.temperature</code> etc. when applied to an asset</span>
                    </div>
                  )}
                  <ImportPreviewTable
                    rows={importPreview}
                    uomOverrides={previewUoms}
                    onUomChange={(i, v) => setPreviewUoms((p) => ({ ...p, [i]: v }))}
                    onTypeChange={(i, v) => setImportPreview((prev) => prev.map((d, idx) => idx === i ? { ...d, type: v as any } : d))}
                    onRemove={(i) => setImportPreview((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>Cancel</Button>
                <Button onClick={handleImportConfirm} disabled={importPreview.length === 0}>
                  Add {importPreview.length || ""} definition{importPreview.length !== 1 ? "s" : ""} to template
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* ── CSV tab ─────────────────────────────────────────────── */}
            <TabsContent value="csv" className="space-y-3 mt-3">
              <div className="rounded-md bg-muted/40 border border-border p-3 space-y-1 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Required columns</p>
                <p>
                  <code className="bg-muted px-1 rounded">name</code> (required) ·
                  <code className="bg-muted px-1 rounded ml-1">type</code> static / dynamic / metric ·
                  <code className="bg-muted px-1 rounded ml-1">dataType</code> text / number / double / boolean ·
                  <code className="bg-muted px-1 rounded ml-1">tagName</code> relative key ·
                  <code className="bg-muted px-1 rounded ml-1">uom</code>
                </p>
                <p className="text-xs opacity-60">Use this if you manage your attribute list in Excel or Google Sheets — export as CSV and paste here.</p>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">CSV Data</label>
                <button className="text-xs text-primary hover:underline" onClick={() => setImportText(CSV_EXAMPLE)}>Load example</button>
              </div>
              <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportPreview([]); setImportError(null); }}
                placeholder={"name,type,dataType,tagName,uom\nTemperature,dynamic,double,temperature,°C"}
                className="font-mono text-xs h-40 resize-none" />
              {importError && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{importError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!importText.trim()}>Preview</Button>
              {importPreview.length > 0 && (
                <ImportPreviewTable rows={importPreview}
                  uomOverrides={previewUoms}
                  onUomChange={(i, v) => setPreviewUoms((p) => ({ ...p, [i]: v }))}
                  onTypeChange={(i, v) => setImportPreview((prev) => prev.map((d, idx) => idx === i ? { ...d, type: v as any } : d))}
                  onRemove={(i) => setImportPreview((prev) => prev.filter((_, idx) => idx !== i))}
                />
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>Cancel</Button>
                <Button onClick={handleImportConfirm} disabled={importPreview.length === 0}>
                  Add {importPreview.length || ""} definition{importPreview.length !== 1 ? "s" : ""} to template
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* ── Schema JSON tab ──────────────────────────────────────── */}
            <TabsContent value="json" className="space-y-3 mt-3">
              <div className="rounded-md bg-muted/40 border border-border p-3 space-y-1 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Schema JSON format</p>
                <p>
                  This is the same format produced by <span className="font-medium text-foreground">Export Schema</span>. Use it to copy an attribute schema from another template or another platform instance.
                </p>
                <p className="opacity-60">Each object: <code className="bg-muted px-1 rounded">name</code>, <code className="bg-muted px-1 rounded">type</code>, <code className="bg-muted px-1 rounded">dataType</code>, <code className="bg-muted px-1 rounded">tagName</code>, <code className="bg-muted px-1 rounded">uom</code></p>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Schema JSON Array</label>
                <button className="text-xs text-primary hover:underline" onClick={() => setImportText(JSON_SCHEMA_EXAMPLE)}>Load example</button>
              </div>
              <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportPreview([]); setImportError(null); }}
                placeholder={'[\n  {"name":"Temperature","type":"dynamic","dataType":"double","tagName":"temperature","uom":"°C"}\n]'}
                className="font-mono text-xs h-40 resize-none" />
              {importError && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{importError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!importText.trim()}>Preview</Button>
              {importPreview.length > 0 && (
                <ImportPreviewTable rows={importPreview}
                  uomOverrides={previewUoms}
                  onUomChange={(i, v) => setPreviewUoms((p) => ({ ...p, [i]: v }))}
                  onTypeChange={(i, v) => setImportPreview((prev) => prev.map((d, idx) => idx === i ? { ...d, type: v as any } : d))}
                  onRemove={(i) => setImportPreview((prev) => prev.filter((_, idx) => idx !== i))}
                />
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>Cancel</Button>
                <Button onClick={handleImportConfirm} disabled={importPreview.length === 0}>
                  Add {importPreview.length || ""} definition{importPreview.length !== 1 ? "s" : ""} to template
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Shared preview table (editable type, uom, remove) ────────────────────────
function ImportPreviewTable({ rows, uomOverrides, onUomChange, onTypeChange, onRemove }: {
  rows: AttributeDefinition[];
  uomOverrides: Record<number, string>;
  onUomChange: (i: number, v: string) => void;
  onTypeChange: (i: number, v: string) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="rounded border border-border overflow-hidden">
      <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
        {rows.length} attribute{rows.length !== 1 ? "s" : ""} extracted — review &amp; adjust before adding
      </div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-24">Type</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-20">Data Type</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Tag (relative)</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-20">UoM</th>
              <th className="px-2 py-1.5 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-1.5 font-medium">{r.name}</td>
                <td className="px-2 py-1">
                  <Select value={r.type} onValueChange={(v) => onTypeChange(i, v)}>
                    <SelectTrigger className="h-5 text-xs py-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="static">static</SelectItem>
                      <SelectItem value="dynamic">dynamic</SelectItem>
                      <SelectItem value="metric">metric</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.dataType}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.tagName || "—"}</td>
                <td className="px-2 py-1">
                  <Input
                    value={uomOverrides[i] ?? r.uom ?? ""}
                    onChange={(e) => onUomChange(i, e.target.value)}
                    placeholder="unit"
                    className="h-5 text-xs px-1 py-0"
                  />
                </td>
                <td className="px-2 py-1">
                  <button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
