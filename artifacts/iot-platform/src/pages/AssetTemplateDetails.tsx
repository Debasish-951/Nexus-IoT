import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import {
  useListAssetTemplates, useDeleteAssetTemplate,
  getListAssetTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Save, Braces, FileSpreadsheet, ChevronRight, AlertTriangle,
  CheckCircle2, LayoutTemplate, Zap, Upload, Hash, User, Calendar, ArrowLeft, X, Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { apiFetch } from "@/lib/auth-api";
import { ATTR_TYPES, ATTR_DATATYPES, TEMPLATE_CSV_HEADERS, parseTemplateCsv, type AttrDef } from "./templateCsv";

type Def = AttrDef;
// Envelope keys that never become attributes. deviceId is deliberately absent from the
// attribute list because it is surfaced separately (detected + registered on import).
const PAYLOAD_SKIP_KEYS = new Set([
  "deviceId","device_id","sensor","asset","measurement_point","id","version","type","source",
]);
// Timestamp-ish keys ARE extracted (every payload carries one, and the template needs a
// slot to bind it to) but they are typed as `timestamp` rather than inferred from the JS
// value — otherwise an epoch reads as a plain number and an ISO string as free text.
const TIMESTAMP_KEYS = new Set([
  "ts","time","timestamp","timestampunix","timestamp_unix","capturedat","captured_at",
  "receivedat","received_at","eventtime","event_time","datetime","date_time",
]);
const isTimestampKey = (key: string) => TIMESTAMP_KEYS.has((key.split(".").pop() ?? key).toLowerCase());
const PAYLOAD_EXAMPLE = JSON.stringify({ deviceId: "my-device-01", timestampUnix: 1766062407826, data: { temperature: 31.7, humidity: 68.4, energy_kwh: 145.7, battery: 3.0 } }, null, 2);
const CSV_EXAMPLE = [
  TEMPLATE_CSV_HEADERS.join(","),
  "Temperature,dynamic,Chiller Section,temperature,double,°C,2,TRUE",
  "Vibration RMS X,dynamic,Chiller Section,vibration_rms_velocity_x,double,mm/s,3,FALSE",
  "Sensor Serial,static,Chiller Section,sensor_serial,text,,,FALSE",
].join("\n");
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
    const name = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    if (isTimestampKey(key)) return { name, type: "timestamp", dataType: "timestamp", tagName: key };
    const jsType = typeof val;
    let dataType = "text"; let attrType = "dynamic";
    if (jsType === "number") { dataType = Number.isInteger(val as number) ? "number" : "double"; }
    else if (jsType === "boolean") { dataType = "boolean"; }
    else {
      const lk = key.toLowerCase();
      const isSerial = ["serial","mac","id","name","point"].some((s) => lk.includes(s));
      attrType = isSerial ? "static" : "dynamic";
    }
    return { name, type: attrType, dataType, tagName: key };
  });
  return { defs, deviceId };
}
/** CSV pasted on THIS page always lands in the template being edited, so a Device
 *  Template Name column is optional here — but when one is present, rows naming a
 *  different template are dropped rather than silently absorbed. */
function parseCsvDefs(text: string, templateName: string): { defs: Def[]; error: string | null; skipped: number } {
  const { rows, errors } = parseTemplateCsv(text, { defaultTemplateName: templateName });
  if (errors.length > 0) return { defs: [], error: errors.slice(0, 4).join(" "), skipped: 0 };
  const mine = rows.filter((r) => r.templateName.toLowerCase() === templateName.toLowerCase());
  return {
    defs: mine.map(({ templateName: _t, line: _l, ...d }) => d),
    error: null,
    skipped: rows.length - mine.length,
  };
}

export default function AssetTemplateDetails() {
  const [, params] = useRoute("/asset-templates/:id");
  const id = params?.id ?? "";
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useCurrentUser();

  const [template, setTemplate] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [editedDefs, setEditedDefs] = useState<Def[]>([]);
  const [savingDefs, setSavingDefs] = useState(false);
  const [newDef, setNewDef] = useState<Def>({ name: "", type: "dynamic", dataType: "double", tagName: "", uom: "" });
  const [manualRowOpen, setManualRowOpen] = useState(false);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);

  const deleteTemplate = useDeleteAssetTemplate();

  // Inline import panel state
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
    apiFetch(`/api/asset-templates/${id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        if (cancelled) return;
        const defs = Array.isArray(t?.attributeDefinitions) ? t.attributeDefinitions : [];
        setTemplate(t);
        setEditedDefs(defs);
        // Open the import panel once, up front, for a brand-new template — it must
        // NOT be re-derived from editedDefs.length on every render, or it would
        // snap shut the moment the first attribute is added (mid add-another-one flow).
        // Also honored when the list page's "Import" action links here directly
        // (?openImport=1), since the top-level Import button no longer lives on this page.
        if (defs.length === 0 || new URLSearchParams(search).get("openImport") === "1") setImportOpen(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Manually-typed attributes join the same review list as extracted/parsed ones —
   * they are only committed to the template once "Add N definitions to template" is
   * clicked, same as anything pulled from a payload/CSV/JSON paste. */
  function addDefRow() {
    if (!newDef.name.trim()) return;
    setImportPreview((p) => [...p, { ...newDef, name: newDef.name.trim() }]);
    setNewDef({ name: "", type: "dynamic", dataType: "double", tagName: "", uom: "" });
  }
  function removeDef(idx: number) { setEditedDefs((p) => p.filter((_, i) => i !== idx)); }
  function updateDef(idx: number, field: keyof Def, val: any) {
    setEditedDefs((p) => p.map((d, i) => i === idx ? { ...d, [field]: val } : d));
  }
  async function saveDefs() {
    if (!template) return;
    setSavingDefs(true);
    try {
      const res = await apiFetch(`/api/asset-templates/${template.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributeDefinitions: editedDefs }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Save failed", description: data.error, variant: "destructive" }); return; }
      toast({ title: "Template saved", description: `${editedDefs.length} attribute definition(s)` });
      qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
      // Saving ends the editing session — go back to the list, where the refreshed
      // attribute count confirms the write landed.
      navigate("/asset-templates");
    } finally { setSavingDefs(false); }
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
        const { defs, error, skipped } = parseCsvDefs(importText, template?.name ?? "");
        if (error) throw new Error(error);
        if (defs.length === 0) {
          throw new Error(skipped > 0
            ? `No rows for "${template?.name}" — ${skipped} row(s) name a different template. Import those from the Asset Templates page.`
            : "No rows found. Check the CSV format.");
        }
        if (skipped > 0) toast({ title: `Skipped ${skipped} row(s)`, description: "They belong to a different Device Template Name." });
        setImportPreview(defs);
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
    const did = detectedDeviceId;
    closeImport();
    if (did) {
      // Register the payload's deviceId so it can be bound to an asset in the wizard.
      void apiFetch("/api/ingest/register-device", {
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
    { label: "Total Attributes", value: String(editedDefs.length), icon: Hash },
    { label: "Created By", value: "—", icon: User },
    { label: "Created On", value: template.createdAt ? format(new Date(template.createdAt), "yyyy-MM-dd") : "—", icon: Calendar },
  ];

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <button onClick={() => navigate("/asset-templates")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
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
          {can("manage_templates") && (
            <Button size="sm" className="h-8 text-xs" onClick={saveDefs} disabled={savingDefs}>
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

      {/* Attributes panel */}
      <Card className="shadow-sm overflow-hidden">
        {editedDefs.length > 0 && (
          <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{editedDefs.length} attribute definition{editedDefs.length !== 1 ? "s" : ""}</span>
          </div>
        )}

        {/* Inline Import / Parse panel — opened by default for a brand-new template (see the fetch effect above) so the fastest path (paste a payload) is visible immediately with no extra click. For an existing template it is reached from the list page's Import action (?openImport=1) — this page has no Import button of its own. Deliberately keyed off `importOpen` alone, NOT editedDefs.length — re-deriving it from the attribute count would snap the panel shut the moment the first attribute is added, cutting off "add one more" mid-flow. */}
        {importOpen && (
          <div className="border-b border-border">
            <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold flex items-center gap-1.5"><Zap className="w-4 h-4 text-primary" /> Import Attribute Definitions</p>
                <p className="text-xs text-muted-foreground mt-0.5">Three ways to populate a template. The fastest: paste a raw device payload.</p>
              </div>
              <button onClick={closeImport} className="text-muted-foreground hover:text-foreground shrink-0"><X className="w-4 h-4" /></button>
            </div>
          <Tabs value={importTab} onValueChange={(v) => { setImportTab(v as any); setImportText(""); setImportPreview([]); setImportError(null); setDetectedDeviceId(null); setPreviewUoms({}); }}>
            <div className="px-4">
              <TabsList className="grid grid-cols-3 w-full max-w-md">
                <TabsTrigger value="payload" className="text-xs gap-1.5"><Zap className="w-3 h-3" /> Device Payload</TabsTrigger>
                <TabsTrigger value="csv" className="text-xs gap-1.5"><FileSpreadsheet className="w-3 h-3" /> CSV</TabsTrigger>
                <TabsTrigger value="json" className="text-xs gap-1.5"><Braces className="w-3 h-3" /> Schema JSON</TabsTrigger>
              </TabsList>
            </div>
            {/* Device Payload */}
            <TabsContent value="payload" className="mt-0">
              <div className="px-4 py-3 space-y-3">
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
                      onEdit={(i, patch) => setImportPreview((p) => p.map((d, idx) => idx === i ? { ...d, ...patch } : d))}
                      onRemove={(i) => setImportPreview((p) => p.filter((_, idx) => idx !== i))} />
                  </div>
                )}
              </div>
            </TabsContent>
            {/* CSV */}
            <TabsContent value="csv" className="mt-0">
              <div className="px-4 py-3 space-y-3">
                <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-semibold text-foreground">Columns</p>
                  <p>{TEMPLATE_CSV_HEADERS.map((h) => <code key={h} className="bg-muted px-1 rounded mr-1">{h}</code>)}</p>
                  <p className="opacity-70">Tag Name must match the incoming payload key. Rows naming a different <span className="font-medium">Device Template Name</span> are skipped here — import a multi-template sheet from the Asset Templates page instead.</p>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">CSV Data</label>
                  <div className="flex items-center gap-3">
                    <input ref={csvFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ""; }} />
                    <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={() => csvFileRef.current?.click()}><Upload className="w-3 h-3" /> Upload CSV file</button>
                    <button className="text-xs text-primary hover:underline" onClick={() => setImportText(CSV_EXAMPLE)}>Load example</button>
                  </div>
                </div>
                <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportPreview([]); setImportError(null); }} placeholder={`${TEMPLATE_CSV_HEADERS.join(",")}\nTemperature,dynamic,${template?.name ?? "Section A"},temperature,double,°C,2,TRUE`} className="font-mono text-xs h-40 resize-none" />
                {importError && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{importError}</p>}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!importText.trim()}>Preview</Button>
                {importPreview.length > 0 && (
                  <PreviewTable rows={importPreview} uomOverrides={previewUoms}
                    onUomChange={(i, v) => setPreviewUoms((p) => ({ ...p, [i]: v }))}
                    onTypeChange={(i, v) => setImportPreview((p) => p.map((d, idx) => idx === i ? { ...d, type: v } : d))}
                    onEdit={(i, patch) => setImportPreview((p) => p.map((d, idx) => idx === i ? { ...d, ...patch } : d))}
                    onRemove={(i) => setImportPreview((p) => p.filter((_, idx) => idx !== i))} />
                )}
              </div>
            </TabsContent>
            {/* JSON */}
            <TabsContent value="json" className="mt-0">
              <div className="px-4 py-3 space-y-3">
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
                    onEdit={(i, patch) => setImportPreview((p) => p.map((d, idx) => idx === i ? { ...d, ...patch } : d))}
                    onRemove={(i) => setImportPreview((p) => p.filter((_, idx) => idx !== i))} />
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Manual entry — collapsed to a single button until the user opts in. Columns match
              PreviewTable exactly (Name/Type/Data Type/Tag/UoM) so a manually-typed attribute
              lands as just another row in that same review list, not a separately-structured one. */}
          {can("manage_templates") && (
          <div className="px-4 pb-1">
            {manualRowOpen ? (
              <div className="rounded border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    <tr className="bg-muted/10">
                      <td className="px-3 py-1.5">
                        <Input value={newDef.name} onChange={(e) => setNewDef((d) => ({ ...d, name: e.target.value }))} placeholder="Attribute name" className="h-7 text-xs" onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} autoFocus />
                      </td>
                      <td className="px-2 py-1 w-24">
                        <Select value={newDef.type} onValueChange={(v) => setNewDef((d) => ({ ...d, type: v }))}>
                          <SelectTrigger className="h-6 text-xs py-0"><SelectValue /></SelectTrigger>
                          <SelectContent>{ATTR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1 w-20">
                        <Select value={newDef.dataType} onValueChange={(v) => setNewDef((d) => ({ ...d, dataType: v }))}>
                          <SelectTrigger className="h-6 text-xs py-0"><SelectValue /></SelectTrigger>
                          <SelectContent>{ATTR_DATATYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1"><Input value={newDef.tagName ?? ""} onChange={(e) => setNewDef((d) => ({ ...d, tagName: e.target.value }))} placeholder="tag_name" className="h-7 text-xs font-mono" onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} /></td>
                      <td className="px-2 py-1 w-20"><Input value={newDef.uom ?? ""} onChange={(e) => setNewDef((d) => ({ ...d, uom: e.target.value }))} placeholder="unit" className="h-6 text-xs px-1 py-0" /></td>
                      <td className="px-2 py-1 w-8"><Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={addDefRow} disabled={!newDef.name.trim()}><Plus className="w-3 h-3" /></Button></td>
                      <td className="px-2 py-1 w-8"><button onClick={() => setManualRowOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setManualRowOpen(true)}>
                <Plus className="w-3 h-3 mr-1" /> Add Metric
              </Button>
            )}
          </div>
          )}

          <ImportFooter onCancel={closeImport} onConfirm={handleImportConfirm} count={importPreview.length} />
          </div>
        )}

        <div className="overflow-auto">
          <table className="w-full text-xs">
                {/* Column order mirrors the export CSV (minus Device Template Name, which
                    is this template) so the sheet and this table read the same way. */}
                {editedDefs.length > 0 && (
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-muted-foreground">
                      <th className="text-left px-3 py-2.5 font-medium min-w-36">Attribute Name</th>
                      <th className="text-left px-3 py-2.5 font-medium w-28">Type</th>
                      <th className="text-left px-3 py-2.5 font-medium min-w-32">Tag (relative)</th>
                      <th className="text-left px-3 py-2.5 font-medium w-28">Data Type</th>
                      <th className="text-left px-3 py-2.5 font-medium w-20">Unit</th>
                      <th className="text-left px-3 py-2.5 font-medium w-16">Decimal</th>
                      <th className="text-left px-3 py-2.5 font-medium w-20">Required</th>
                      <th className="text-left px-3 py-2.5 font-medium min-w-40">Description</th>
                      <th className="px-3 py-2.5 w-14" />
                    </tr>
                  </thead>
                )}
                <tbody>
                  {editedDefs.map((def, idx) => (
                    <tr key={idx} className="border-b border-border/50 hover:bg-muted/20 group">
                      <td className="px-2 py-1">
                        <Input value={def.name} onChange={(e) => updateDef(idx, "name", e.target.value)} disabled={!can("manage_templates")}
                          ref={(el) => { nameRefs.current[idx] = el; }}
                          className="h-7 text-xs border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                      </td>
                      <td className="px-2 py-1">
                        <Select value={def.type} onValueChange={(v) => updateDef(idx, "type", v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{ATTR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Input value={def.tagName ?? ""} onChange={(e) => updateDef(idx, "tagName", e.target.value)} placeholder="metric_key" disabled={!can("manage_templates")}
                          className="h-7 text-xs font-mono border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
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
                        {/* Blank = show the raw value; 0–10 rounds the displayed number. */}
                        <Input type="number" min={0} max={10} value={def.decimalPlaces ?? ""} disabled={!can("manage_templates")}
                          onChange={(e) => updateDef(idx, "decimalPlaces", e.target.value === "" ? undefined : Math.max(0, Math.min(10, Number(e.target.value))))}
                          placeholder="—" className="h-7 text-xs border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                      </td>
                      <td className="px-2 py-1">
                        <Switch checked={!!def.required} onCheckedChange={(v) => updateDef(idx, "required", v)} disabled={!can("manage_templates")} className="scale-75" />
                      </td>
                      <td className="px-2 py-1">
                        <Input value={def.description ?? ""} onChange={(e) => updateDef(idx, "description", e.target.value)} placeholder="—" disabled={!can("manage_templates")}
                          className="h-7 text-xs border-0 bg-transparent focus:bg-background focus:border focus:border-border px-1" />
                      </td>
                      <td className="px-2 py-1">
                        {can("manage_templates") && (
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                            <button onClick={() => nameRefs.current[idx]?.focus()} className="text-muted-foreground hover:text-primary">
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button onClick={() => removeDef(idx)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
      </Card>
    </div>
  );
}

function ImportFooter({ onCancel, onConfirm, count }: { onCancel: () => void; onConfirm: () => void; count: number }) {
  return (
    <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
      <Button size="sm" onClick={onConfirm} disabled={count === 0}>Add {count || ""} definition{count !== 1 ? "s" : ""} to template</Button>
    </div>
  );
}

function PreviewTable({ rows, uomOverrides, onUomChange, onTypeChange, onEdit, onRemove }: {
  rows: Def[]; uomOverrides: Record<number, string>;
  onUomChange: (i: number, v: string) => void; onTypeChange: (i: number, v: string) => void;
  onEdit: (i: number, patch: Partial<Def>) => void; onRemove: (i: number) => void;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
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
              <th className="text-left px-3 py-1.5 font-medium w-28">Type</th>
              <th className="text-left px-3 py-1.5 font-medium w-24">Data Type</th>
              <th className="text-left px-3 py-1.5 font-medium">Tag (relative)</th>
              <th className="text-left px-3 py-1.5 font-medium w-20">UoM</th>
              <th className="px-2 py-1.5 w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const editing = editingIdx === i;
              return (
                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-medium">
                    {editing ? (
                      <Input value={r.name} onChange={(e) => onEdit(i, { name: e.target.value })} className="h-6 text-xs px-1 py-0" />
                    ) : r.name}
                  </td>
                  <td className="px-2 py-1">
                    <Select value={r.type} onValueChange={(v) => onTypeChange(i, v)}>
                      <SelectTrigger className="h-6 text-xs py-0"><SelectValue /></SelectTrigger>
                      <SelectContent>{ATTR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  {/* Data type is always editable — the value-sniffed guess is only a
                      starting point (an int-looking first sample is often a double). */}
                  <td className="px-2 py-1">
                    <Select value={r.dataType} onValueChange={(v) => onEdit(i, { dataType: v })}>
                      <SelectTrigger className="h-6 text-xs py-0"><SelectValue /></SelectTrigger>
                      <SelectContent>{ATTR_DATATYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">
                    {editing ? (
                      <Input value={r.tagName ?? ""} onChange={(e) => onEdit(i, { tagName: e.target.value })} placeholder="tag_name" className="h-6 text-xs font-mono px-1 py-0" />
                    ) : (r.tagName || "—")}
                  </td>
                  <td className="px-2 py-1"><Input value={uomOverrides[i] ?? r.uom ?? ""} onChange={(e) => onUomChange(i, e.target.value)} placeholder="unit" className="h-6 text-xs px-1 py-0" /></td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setEditingIdx(editing ? null : i)} className={cn("text-muted-foreground hover:text-primary", editing && "text-primary")}><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

