import { useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListAssetTemplates, useCreateAssetTemplate, useDeleteAssetTemplate, useListAssets,
  getListAssetTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, LayoutTemplate, ArrowLeft, Trash2, Download, Upload, AlertTriangle, CheckCircle2, FilePlus2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { useCurrentUser } from "@/contexts/UserContext";
import { apiFetch } from "@/lib/auth-api";
import type { Asset } from "./assetShared";
import {
  TEMPLATE_CSV_HEADERS, ATTR_TYPES, ATTR_DATATYPES, templatesToRows, parseTemplateCsv,
  parseTemplateRows, groupRowsByTemplate, mergeDefs, splitDeviceId, type AttrDef, type CsvRow,
} from "./templateCsv";
import { buildXlsx, readXlsx } from "./xlsxIo";

export default function AssetTemplates() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useCurrentUser();

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Master-CSV import
  const [importOpen, setImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importResult, setImportResult] = useState<ReturnType<typeof parseTemplateCsv> | null>(null);
  const [importing, setImporting] = useState(false);
  /** One Device ID for the whole sheet: the id belongs to the gateway payload, and
   *  every section split out of that payload is fed by it. */
  const [importDeviceId, setImportDeviceId] = useState("");
  /** Template the file becomes. One file = one section = one template. */
  const [importTemplateName, setImportTemplateName] = useState("");
  const csvFileRef = useRef<HTMLInputElement>(null);

  const { data: templates } = useListAssetTemplates();
  const { data: assets } = useListAssets();
  const allTemplates = (templates as any[] | undefined) ?? [];
  const allAssets = (assets as Asset[] | undefined) ?? [];

  // Client-side filter so search is exact and reliable.
  const templateList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? allTemplates.filter((t) => (t.name ?? "").toLowerCase().includes(q)) : allTemplates;
  }, [allTemplates, search]);

  function toggleSelected(id: string) {
    setSelected((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((p) => p.size === templateList.length ? new Set() : new Set(templateList.map((t) => t.id)));
  }

  /**
   * One worksheet per template, written as .xlsx so the header row can be highlighted
   * and the Type / Data Type / Required columns get dropdowns.
   *
   * One file per template (not one sheet for all of them): a file no longer carries a
   * template name — import asks for it — so a combined sheet could not be routed back.
   */
  function exportSelected() {
    const chosen = allTemplates.filter((t) => selected.size === 0 || selected.has(t.id));
    const stamp = format(new Date(), "yyyy-MM-dd");
    let files = 0, totalRows = 0;

    for (const t of chosen) {
      const defs = (Array.isArray(t.attributeDefinitions) ? t.attributeDefinitions : []) as AttrDef[];
      const rows = templatesToRows([{ name: t.name ?? "Untitled", deviceId: t.deviceId ?? null, defs }]);
      if (rows.length === 0) continue;

      const bytes = buildXlsx({
        sheetName: "Attributes",
        headers: [...TEMPLATE_CSV_HEADERS],
        rows,
        colWidths: [34, 14, 20, 34, 14, 10, 15, 11],
        choices: [
          { column: 1, values: [...ATTR_TYPES] },
          { column: 4, values: [...ATTR_DATATYPES] },
          { column: 7, values: ["TRUE", "FALSE"] },
        ],
      });
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(t.name ?? "template").replace(/[\/:*?"<>|]/g, "-")}_${stamp}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
      files++; totalRows += rows.length;
    }

    if (files === 0) { toast({ title: "Nothing to export", description: "The selected template(s) have no attributes yet." }); return; }
    toast({
      title: `Exported ${totalRows} attribute${totalRows !== 1 ? "s" : ""} in ${files} file${files !== 1 ? "s" : ""}`,
      description: "Split a file per section, rename Attribute Name as you like, keep Tag Name and Device Id as they are.",
    });
  }

  /** Every tag already defined anywhere in the platform — the master template a section
   * sheet was split from is normally in here, so a mistyped tag stands out. */
  const knownTags = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTemplates) {
      for (const d of (Array.isArray(t.attributeDefinitions) ? t.attributeDefinitions : []) as AttrDef[]) {
        if (d.tagName) s.add(d.tagName.toLowerCase());
      }
    }
    return s;
  }, [allTemplates]);

  /**
   * Takes the .xlsx this page exports, or a plain .csv if that is what the user has.
   *
   * One file is one section, and becomes one template: the name is typed in the dialog
   * (seeded from the file name) and the Device Id comes from the sheet's column, which
   * every row repeats.
   */
  async function handleImportFile(file: File) {
    const baseName = file.name.replace(/\.(xlsx|csv)$/i, "").replace(/[_-]+/g, " ").trim();
    try {
      const opts = { knownTags, defaultTemplateName: baseName };
      const isXlsx = /\.xlsx$/i.test(file.name) || file.type.includes("spreadsheetml");
      let parsed;
      if (isXlsx) {
        const { rows, sheetCount } = await readXlsx(await file.arrayBuffer());
        parsed = parseTemplateRows(rows, opts);
        if (sheetCount > 1) parsed.warnings.push(`The workbook has ${sheetCount} sheets — only the first one was read.`);
      } else {
        parsed = parseTemplateCsv(await file.text(), opts);
      }
      setImportFileName(file.name);
      setImportResult(parsed);
      setImportTemplateName(baseName);
      // The column wins; fall back to a `deviceid` row (older sheets) and then to the
      // id already on a template of the same name.
      const fromRows = groupRowsByTemplate(parsed.rows).map((g) => splitDeviceId(g.defs).deviceId).find(Boolean);
      const existing = allTemplates.find((t) => String(t.name ?? "").toLowerCase() === baseName.toLowerCase());
      const chosenDeviceId = parsed.deviceIds[0] ?? fromRows ?? existing?.deviceId ?? "";
      setImportDeviceId(chosenDeviceId);

      // Splitting a big payload by hand, the same tag can end up in two section sheets.
      // Both sections would then store it on every ingest — double storage, and a
      // dashboard summing across assets double-counts. Cheap to catch here.
      if (chosenDeviceId) {
        const mine = new Set(parsed.rows.map((r) => (r.tagName ?? "").toLowerCase()).filter(Boolean));
        for (const t of allTemplates) {
          if (String(t.name ?? "").toLowerCase() === baseName.toLowerCase()) continue;
          if ((t.deviceId ?? "").toLowerCase() !== chosenDeviceId.toLowerCase()) continue;
          const clash = ((Array.isArray(t.attributeDefinitions) ? t.attributeDefinitions : []) as AttrDef[])
            .map((d) => (d.tagName ?? "").toLowerCase())
            .filter((tag) => tag && mine.has(tag));
          if (clash.length > 0) {
            parsed.warnings.push(
              `${clash.length} tag(s) here are already declared by "${t.name}", which shares device id "${chosenDeviceId}" — both assets will store them: ${clash.slice(0, 5).join(", ")}${clash.length > 5 ? "…" : ""}`,
            );
          }
        }
      }
      setImportOpen(true);
    } catch (e: any) {
      toast({ title: "Could not read the file", description: e?.message ?? "Expected a .xlsx or .csv sheet.", variant: "destructive" });
    }
  }

  /**
   * Writes the file as ONE template, named in the dialog: creating it if the name is
   * new, merging into it if the name already exists (nothing is ever dropped).
   */
  async function runImport() {
    if (!importResult) return;
    const name = importTemplateName.trim();
    if (!name) { toast({ title: "Template Name is required", variant: "destructive" }); return; }

    setImporting(true);
    const deviceId = importDeviceId.trim() || null;
    try {
      // A `deviceid` row (older sheets) is the binding, never an attribute.
      const attributes = splitDeviceId(
        importResult.rows.map(({ templateName: _t, line: _l, ...d }) => d as AttrDef),
      ).attributes;

      let target = allTemplates.find((t) => String(t.name ?? "").toLowerCase() === name.toLowerCase());
      let createdNew = false;
      if (!target) {
        const res = await apiFetch("/api/asset-templates", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, deviceId }),
        });
        if (!res.ok) throw new Error((await res.json())?.error ?? "create failed");
        target = await res.json();
        createdNew = true;
      }

      const existing = (Array.isArray(target.attributeDefinitions) ? target.attributeDefinitions : []) as AttrDef[];
      const { defs, added, updated } = mergeDefs(existing, attributes);
      const put = await apiFetch(`/api/asset-templates/${target.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributeDefinitions: defs, deviceId }),
      });
      if (!put.ok) throw new Error((await put.json())?.error ?? "save failed");

      // So the id is offered when binding assets, even before any telemetry arrives.
      if (deviceId) {
        void apiFetch("/api/ingest/register-device", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }),
        }).catch(() => {});
      }

      qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
      toast({
        title: `${createdNew ? "Created" : "Updated"} template "${name}"`,
        description: `${added} attribute(s) added, ${updated} overwritten${deviceId ? ` · device id "${deviceId}"` : " · no device id, so assets using it will not receive data"}`,
      });
      closeImport();
    } catch (e: any) {
      toast({ title: "Import failed", description: e?.message ?? "Try again", variant: "destructive" });
    } finally { setImporting(false); }
  }

  function closeImport() {
    setImportOpen(false); setImportResult(null); setImportFileName(""); setImportDeviceId(""); setImportTemplateName("");
    if (csvFileRef.current) csvFileRef.current.value = "";
  }

  const usageCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of allAssets) if (a.templateId) m[a.templateId] = (m[a.templateId] ?? 0) + 1;
    return m;
  }, [allAssets]);

  const createTemplate = useCreateAssetTemplate();
  const deleteTemplate = useDeleteAssetTemplate();
  function handleDeleteTemplate(e: React.MouseEvent, t: any) {
    e.stopPropagation();
    if (!confirm(`Delete template "${t.name}"?`)) return;
    deleteTemplate.mutate({ id: t.id }, {
      onSuccess: () => {
        toast({ title: "Template deleted" });
        qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
        setSelected((p) => { const next = new Set(p); next.delete(t.id); return next; });
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  const form = useForm({ defaultValues: { name: "" } });
  async function onSubmit(data: { name: string }) {
    createTemplate.mutate({ data: { name: data.name } }, {
      onSuccess: (created) => {
        toast({ title: "Template created" });
        qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
        setCreateOpen(false); form.reset();
        if (created.id) navigate(`/asset-templates/${created.id}`);
      },
      onError: (err: any) => toast({ title: "Create failed", description: err?.data?.error ?? "Try again", variant: "destructive" }),
    });
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <button onClick={() => navigate("/asset-management")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><LayoutTemplate className="w-5 h-5 text-primary" /> Asset Templates</h1>
          <p className="text-sm text-muted-foreground">Create and manage reusable attribute templates</p>
        </div>
        {can("manage_templates") && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportSelected} title={selected.size === 0 ? "Exports every template as one master CSV" : `Exports ${selected.size} selected template(s)`}>
              <Download className="w-4 h-4 mr-1.5" /> Export
            </Button>
            <input ref={csvFileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); }} />
            <Button variant="outline" onClick={() => csvFileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-1.5" /> Import
            </Button>
            <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> Create Template</Button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
      </div>

      {/* Table */}
      <Card className="shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <th className="px-4 py-2.5 w-10">
                  {can("manage_templates") && templateList.length > 0 && (
                    <Checkbox checked={selected.size > 0 && selected.size === templateList.length} onCheckedChange={toggleSelectAll} />
                  )}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">Template Name</th>
                <th className="text-left px-4 py-2.5 font-medium">Asset Type</th>
                <th className="text-left px-4 py-2.5 font-medium">Assets Using</th>
                <th className="text-left px-4 py-2.5 font-medium">Attributes</th>
                <th className="text-left px-4 py-2.5 font-medium">Last Updated</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {!templates ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50"><td colSpan={7} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td></tr>
                ))
              ) : templateList.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                  <LayoutTemplate className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No templates {search ? "match your search" : "yet"}</p>
                  {!search && can("manage_templates") && (
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" /> Create your first template</Button>
                  )}
                </td></tr>
              ) : (
                templateList.map((t: any) => (
                  <tr key={t.id} onClick={() => navigate(`/asset-templates/${t.id}`)}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer group">
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {can("manage_templates") && (
                        <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSelected(t.id)} />
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-primary">{t.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.tags?.[0] ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{usageCount[t.id] ?? 0}</td>
                    <td className="px-4 py-2.5 tabular-nums">{t.attributeCount ?? (t.attributeDefinitions?.length ?? 0)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{t.updatedAt ? format(new Date(t.updatedAt), "MM/dd/yyyy") : "—"}</td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {can("manage_templates") && (
                        <button title="Delete template" onClick={(e) => handleDeleteTemplate(e, t)}
                          className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 className="w-4 h-4" />
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

      {/* Import preview — nothing is written until Import is confirmed here */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!o) closeImport(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Upload className="w-4 h-4" /> Import a section sheet</DialogTitle></DialogHeader>
          <ImportPreview result={importResult} fileName={importFileName}
            existingNames={new Set(allTemplates.map((t) => String(t.name ?? "").toLowerCase()))}
            templateName={importTemplateName} onTemplateNameChange={setImportTemplateName}
            deviceId={importDeviceId} onDeviceIdChange={setImportDeviceId} />
          <DialogFooter>
            <Button variant="outline" onClick={closeImport}>Cancel</Button>
            <Button onClick={runImport} disabled={importing || !importResult || importResult.errors.length > 0 || importResult.rows.length === 0 || !importTemplateName.trim()}>
              {importing ? "Importing…" : `Import ${importResult?.rows.length ?? 0} attribute${importResult?.rows.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
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
                <Button type="submit" disabled={createTemplate.isPending}>{createTemplate.isPending ? "Creating…" : "Create"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Read-out of a parsed sheet: what it will create, every blocking error, and any tag
 *  that looks unfamiliar. Errors block; warnings do not. */
function ImportPreview({ result, fileName, existingNames, templateName, onTemplateNameChange, deviceId, onDeviceIdChange }: {
  result: ReturnType<typeof parseTemplateCsv> | null;
  fileName: string;
  existingNames: Set<string>;
  templateName: string;
  onTemplateNameChange: (value: string) => void;
  deviceId: string;
  onDeviceIdChange: (value: string) => void;
}) {
  if (!result) return null;
  const exists = existingNames.has(templateName.trim().toLowerCase());

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{fileName}</span> · {result.rows.length} attribute row(s) · expected columns: {TEMPLATE_CSV_HEADERS.join(" · ")}
      </p>

      {/* The two things a sheet cannot state for itself: what to call the template, and
          which device feeds it. Both are seeded from the file, both are editable. */}
      <div className="grid grid-cols-2 gap-3 rounded border border-border bg-muted/30 p-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Template Name</label>
          <Input value={templateName} onChange={(e) => onTemplateNameChange(e.target.value)}
            placeholder="e.g. Chiller Section" className="h-8 text-sm" />
          <p className="text-[11px] text-muted-foreground">
            {exists
              ? <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> merges into the existing template</span>
              : <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><FilePlus2 className="w-3 h-3" /> creates a new template</span>}
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Device ID</label>
          <Input value={deviceId} onChange={(e) => onDeviceIdChange(e.target.value)}
            placeholder="e.g. energy" className="h-8 text-sm font-mono" />
          <p className="text-[11px] text-muted-foreground">
            From your gateway payload. Every section of that payload shares it; assets
            inherit it when this template is applied.
          </p>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3 space-y-1 max-h-52 overflow-auto">
          <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {result.errors.length} error{result.errors.length !== 1 ? "s" : ""} — fix the file and import again
          </p>
          {result.errors.map((e, i) => <p key={i} className="text-xs text-destructive/90">{e}</p>)}
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 space-y-1 max-h-40 overflow-auto">
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {result.warnings.length} thing{result.warnings.length !== 1 ? "s" : ""} to check
          </p>
          {result.warnings.map((w, i) => <p key={i} className="text-xs text-muted-foreground">{w}</p>)}
        </div>
      )}

      {result.errors.length === 0 && result.warnings.length === 0 && result.rows.length > 0 && (
        <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Every row checks out. Existing attributes are matched by tag and overwritten; nothing is deleted.
        </p>
      )}
    </div>
  );
}
