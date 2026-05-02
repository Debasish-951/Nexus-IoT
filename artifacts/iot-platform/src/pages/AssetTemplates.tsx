import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Search, FileText, Save, Braces, FileSpreadsheet,
  ChevronRight, AlertTriangle, CheckCircle2, LayoutTemplate,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AttributeDefinition {
  name: string;
  type: "static" | "dynamic" | "metric";
  dataType: "text" | "number" | "double" | "boolean" | "timestamp";
  tagName?: string;
  uom?: string;
  value?: string;
}

const ATTR_TYPES    = ["static", "dynamic", "metric"] as const;
const ATTR_DATATYPES = ["text", "number", "double", "boolean", "timestamp"] as const;

function AttributeType({ type }: { type: string }) {
  const colors: Record<string, string> = {
    static:  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    dynamic: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    metric:  "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  };
  return <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", colors[type] ?? "bg-muted text-muted-foreground")}>{type}</span>;
}

// ── Simple CSV parser for attribute definitions ───────────────────────────────
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
      dataType: (ATTR_DATATYPES.includes(row.datatype as any) ? row.datatype :
                 ATTR_DATATYPES.includes(row["data_type"] as any) ? row["data_type"] : "text") as any,
      tagName:  row.tagname  || row["tag_name"] || row.tag || undefined,
      uom:      row.uom      || row.unit || undefined,
      value:    row.value    || undefined,
    };
  }).filter((r) => r.name);
}

const CSV_EXAMPLE = `name,type,dataType,tagName,uom
Temperature,dynamic,double,temperature,°C
Vibration RMS X,dynamic,double,vibration_rms_velocity_x,mm/s
Vibration RMS Y,dynamic,double,vibration_rms_velocity_y,mm/s
Vibration RMS Z,dynamic,double,vibration_rms_velocity_z,mm/s
Ultrasound,dynamic,double,ultrasound,dB
Battery,dynamic,double,battery,V
Run Hours,dynamic,double,runhours,h
Sensor Serial,static,text,sensor_serial,
Measurement Point,static,text,measurement_point,`;

// ── Main component ────────────────────────────────────────────────────────────
export default function AssetTemplates() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  // Attribute definitions edit state for the selected template
  const [editedDefs, setEditedDefs] = useState<AttributeDefinition[]>([]);
  const [defsDirty, setDefsDirty] = useState(false);
  const [savingDefs, setSavingDefs] = useState(false);

  // New attribute definition row
  const [newDef, setNewDef] = useState<AttributeDefinition>({
    name: "", type: "dynamic", dataType: "double", tagName: "", uom: "",
  });

  // Import defs dialog
  const [importDefsOpen, setImportDefsOpen] = useState(false);
  const [importMode, setImportMode] = useState<"csv" | "json">("csv");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<AttributeDefinition[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  const { data: templates } = useListAssetTemplates({ search: search || undefined });
  const createTemplate = useCreateAssetTemplate();
  const deleteTemplate = useDeleteAssetTemplate();

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

  function handleImportPreview() {
    try {
      if (importMode === "csv") {
        const rows = parseCsvDefs(importText);
        if (rows.length === 0) { setImportError("No rows found. Check format."); return; }
        setImportPreview(rows); setImportError(null);
      } else {
        const parsed = JSON.parse(importText);
        const arr: AttributeDefinition[] = Array.isArray(parsed) ? parsed : [parsed];
        setImportPreview(arr); setImportError(null);
      }
    } catch (e: any) {
      setImportError(e.message);
    }
  }

  function handleImportConfirm() {
    setEditedDefs((prev) => [...prev, ...importPreview]);
    setDefsDirty(true);
    setImportDefsOpen(false);
    setImportPreview([]); setImportText(""); setImportError(null);
    toast({ title: `Added ${importPreview.length} definition(s) — click Save to apply` });
  }

  function exportDefsJson() {
    if (!editedDefs.length) return;
    const blob = new Blob([JSON.stringify(editedDefs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${selected?.name ?? "template"}_attribute_definitions.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  function onSubmit(data: { name: string }) {
    createTemplate.mutate(
      { data: { name: data.name } },
      {
        onSuccess: () => {
          toast({ title: "Template created" });
          qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
          setCreateOpen(false);
          form.reset();
        },
      }
    );
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
          <Button size="sm" className="h-8 text-xs shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {!templates ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded" />)}
            </div>
          ) : templateList.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No templates yet</p>
              <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => setCreateOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Create template
              </Button>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {templateList.map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className={cn(
                    "w-full text-left rounded-md p-3 border transition-all",
                    selected?.id === t.id
                      ? "border-primary/40 bg-primary/5"
                      : "border-border hover:border-border hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <LayoutTemplate className="w-3.5 h-3.5 shrink-0 text-primary/60" />
                      <span className="font-medium text-sm truncate">{t.name}</span>
                    </div>
                    <ChevronRight className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", selected?.id === t.id && "rotate-90")} />
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 pl-5">
                    <Badge variant="secondary" className="text-xs h-4 px-1.5">
                      {t.attributeCount} attrs
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(t.updatedAt), "MM/dd/yyyy")}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Template detail / attribute definition editor ──────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <LayoutTemplate className="w-4 h-4 text-primary/70" />
                  {selected.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Define attribute blueprints — apply them to any asset in one click
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportDefsJson} disabled={editedDefs.length === 0}>
                  <Braces className="w-3 h-3 mr-1" /> Export JSON
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setImportDefsOpen(true); setImportPreview([]); setImportText(""); setImportError(null); }}>
                  <FileSpreadsheet className="w-3 h-3 mr-1" /> Import
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={saveDefs} disabled={!defsDirty || savingDefs}>
                  <Save className="w-3 h-3 mr-1" /> {savingDefs ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={() => deleteTemplate.mutate({ id: selected.id }, {
                    onSuccess: () => {
                      toast({ title: "Template deleted" });
                      qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
                      setSelected(null);
                    }
                  })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
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
                        Tag Name <span className="font-normal text-muted-foreground/60">(relative)</span>
                      </th>
                      <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-20">UoM</th>
                      <th className="px-3 py-2.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editedDefs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                          <FileText className="w-7 h-7 mx-auto mb-2 opacity-20" />
                          <p className="text-sm">No attribute definitions yet</p>
                          <p className="text-xs mt-1">Add rows below or use Import to load from CSV / JSON</p>
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
                              <SelectContent>
                                {ATTR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Select value={def.dataType} onValueChange={(v) => updateDef(idx, "dataType", v)}>
                              <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {ATTR_DATATYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                              </SelectContent>
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
                    <tr className="border-b border-border/50 bg-muted/10">
                      <td className="px-3 py-1.5 text-muted-foreground/40">+</td>
                      <td className="px-2 py-1">
                        <Input value={newDef.name} onChange={(e) => setNewDef((d) => ({ ...d, name: e.target.value }))}
                          placeholder="Attribute name" className="h-6 text-xs" onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} />
                      </td>
                      <td className="px-2 py-1">
                        <Select value={newDef.type} onValueChange={(v) => setNewDef((d) => ({ ...d, type: v as any }))}>
                          <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ATTR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Select value={newDef.dataType} onValueChange={(v) => setNewDef((d) => ({ ...d, dataType: v as any }))}>
                          <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ATTR_DATATYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Input value={newDef.tagName ?? ""} onChange={(e) => setNewDef((d) => ({ ...d, tagName: e.target.value }))}
                          placeholder="metric_key" className="h-6 text-xs font-mono" onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} />
                      </td>
                      <td className="px-2 py-1">
                        <Input value={newDef.uom ?? ""} onChange={(e) => setNewDef((d) => ({ ...d, uom: e.target.value }))}
                          placeholder="unit" className="h-6 text-xs" onKeyDown={(e) => { if (e.key === "Enter") addDefRow(); }} />
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

              {/* Footer hint */}
              {defsDirty && (
                <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-800/40 flex items-center justify-between">
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" />
                    Unsaved changes — click Save to persist
                  </p>
                  <Button size="sm" className="h-6 text-xs" onClick={saveDefs} disabled={savingDefs}>
                    <Save className="w-3 h-3 mr-1" />{savingDefs ? "Saving…" : "Save now"}
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <LayoutTemplate className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">Select a template to edit its attribute definitions</p>
              <p className="text-xs mt-1 opacity-60">Templates let you apply bulk attribute schemas to any asset</p>
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
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="e.g. Rotating Equipment, Energy Meter" {...field} /></FormControl></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createTemplate.isPending}>Create</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Import definitions dialog ────────────────────────────────── */}
      <Dialog open={importDefsOpen} onOpenChange={(v) => { setImportDefsOpen(v); if (!v) { setImportPreview([]); setImportError(null); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Import Attribute Definitions</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant={importMode === "csv" ? "default" : "outline"} className="h-7 text-xs" onClick={() => { setImportMode("csv"); setImportPreview([]); setImportError(null); }}>
                <FileSpreadsheet className="w-3 h-3 mr-1" /> CSV
              </Button>
              <Button size="sm" variant={importMode === "json" ? "default" : "outline"} className="h-7 text-xs" onClick={() => { setImportMode("json"); setImportPreview([]); setImportError(null); }}>
                <Braces className="w-3 h-3 mr-1" /> JSON
              </Button>
              <button className="ml-auto text-xs text-primary hover:underline"
                onClick={() => setImportText(importMode === "csv" ? CSV_EXAMPLE : JSON.stringify([
                  { name: "Temperature", type: "dynamic", dataType: "double", tagName: "temperature", uom: "°C" },
                  { name: "Vibration RMS X", type: "dynamic", dataType: "double", tagName: "vibration_rms_velocity_x", uom: "mm/s" },
                ], null, 2))}>
                Load example
              </button>
            </div>
            <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportPreview([]); setImportError(null); }}
              placeholder={importMode === "csv" ? "name,type,dataType,tagName,uom\nTemperature,dynamic,double,temperature,°C" : '[{"name":"Temperature","type":"dynamic","dataType":"double","tagName":"temperature","uom":"°C"}]'}
              className="font-mono text-xs h-36 resize-none" />
            {importError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{importError}</p>}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleImportPreview} disabled={!importText.trim()}>
              Preview
            </Button>
            {importPreview.length > 0 && (
              <div className="rounded border border-border overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                  {importPreview.length} definition{importPreview.length !== 1 ? "s" : ""} found
                </div>
                <div className="max-h-36 overflow-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border/50 bg-muted/30">
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Tag</th>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">UoM</th>
                    </tr></thead>
                    <tbody>
                      {importPreview.map((d, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-1 font-medium">{d.name}</td>
                          <td className="px-3 py-1"><AttributeType type={d.type} /></td>
                          <td className="px-3 py-1 font-mono text-muted-foreground">{d.tagName || "—"}</td>
                          <td className="px-3 py-1">{d.uom || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDefsOpen(false)}>Cancel</Button>
            <Button onClick={handleImportConfirm} disabled={importPreview.length === 0}>
              Add {importPreview.length || ""} to template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
