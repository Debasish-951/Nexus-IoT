import { useState, useRef, useEffect, useCallback } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronRight, ChevronDown, Blocks, Plus, Trash2, Edit2,
  Search, Download, FileSpreadsheet, Braces, LayoutTemplate,
  CheckCircle2, AlertTriangle, Info, Folder, FolderOpen, Calculator,
  Zap, HelpCircle, TrendingUp, RefreshCw, Wrench,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { format, subHours, subDays } from "date-fns";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Asset {
  id: string; name: string; identifier: string;
  parentId?: string | null; templateId?: string | null;
  templateName?: string | null; childCount: number;
  attributeCount: number; updatedAt: string;
  maintenanceMode?: boolean;
  maintenanceSince?: string | null;
  maintenanceNote?: string | null;
}
interface AttrDef {
  name: string; type: string; dataType: string;
  value?: string; tagName?: string; sourceMetric?: string;
  uom?: string; decimalPlaces?: number | null; thousandSeparator?: boolean;
  expression?: string;
}

// ── Attribute type badge ──────────────────────────────────────────────────────
function AttributeType({ type }: { type: string }) {
  const styles: Record<string, string> = {
    static:  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    dynamic: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    metric:  "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
    runtime: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  };
  return (
    <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1",
      styles[type] ?? "bg-muted text-muted-foreground")}>
      {type === "runtime" && <Calculator className="w-2.5 h-2.5" />}
      {type}
    </span>
  );
}

// ── Asset tree node ───────────────────────────────────────────────────────────
function AssetTreeNode({ asset, allAssets, selectedId, onSelect, onAddChild, canManage, depth }: {
  asset: Asset; allAssets: Asset[]; selectedId: string | null;
  onSelect: (a: Asset) => void; onAddChild: (parentId: string) => void;
  canManage: boolean; depth: number;
}) {
  const children   = allAssets.filter((a) => a.parentId === asset.id);
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = children.length > 0;

  return (
    <div>
      <div
        className={cn("group flex items-center gap-1 py-1 px-1 rounded cursor-pointer text-sm transition-colors",
          selectedId === asset.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60")}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        onClick={() => onSelect(asset)}
      >
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); setExpanded((o) => !o); }} className="shrink-0 p-0.5">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : <span className="w-4 shrink-0" />}

        {hasChildren || asset.childCount > 0
          ? expanded
            ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500/80" />
            : <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500/80" />
          : <Blocks className="w-3.5 h-3.5 shrink-0 text-primary/60" />
        }
        <span className="truncate flex-1 text-xs">{asset.name}</span>
        {canManage && (
          <button title="Add child asset"
            onClick={(e) => { e.stopPropagation(); onAddChild(asset.id); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all shrink-0">
            <Plus className="w-3 h-3" />
          </button>
        )}
      </div>
      {expanded && children.map((child) => (
        <AssetTreeNode key={child.id} asset={child} allAssets={allAssets}
          selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild}
          canManage={canManage} depth={depth + 1} />
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

function flattenPayload(obj: Record<string, any>, prefix = "", out: Record<string, any> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (["deviceId","device_id","timestamp","timestampUnix","timestamp_unix","receivedAt","received_at","capturedAt","captured_at","sensor","asset","measurement_point","id","version","type","source"].includes(k)) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flattenPayload(v as Record<string, any>, key, out);
    else out[key] = v;
  }
  return out;
}

const CSV_EXAMPLE = `name,type,dataType,tagName,uom\nTemperature,dynamic,double,device-01.temperature,°C\nEnergy kWh,dynamic,double,device-01.energy_kwh,kWh\nDevice ID,static,text,device-01.device_serial,`;
const JSON_EXAMPLE = JSON.stringify([
  { name: "Temperature", type: "dynamic", dataType: "double", tagName: "device-01.temperature", uom: "°C" },
  { name: "Energy kWh", type: "dynamic", dataType: "double", tagName: "device-01.energy_kwh", uom: "kWh" },
], null, 2);

const TIME_RANGES = [
  { label: "1 min", hours: 1 / 60 },
  { label: "5 min", hours: 5 / 60 },
  { label: "15 min", hours: 15 / 60 },
  { label: "30 min", hours: 30 / 60 },
  { label: "1 h", hours: 1 },
  { label: "6 h", hours: 6 },
  { label: "24 h", hours: 24 },
  { label: "7 d", hours: 24 * 7 },
  { label: "30 d", hours: 24 * 30 },
  { label: "1 month", hours: 24 * 30 },
  { label: "1 year", hours: 24 * 365 },
  { label: "Custom", hours: -1 },
];

const CHART_COLORS = [
  "#3b82f6","#22c55e","#f97316","#a855f7","#ef4444","#14b8a6","#eab308","#6366f1",
];

// ── Trends Panel ──────────────────────────────────────────────────────────────
function TrendsPanel({ assetId, attrList }: { assetId: string; attrList: any[] }) {
  const [telemetryKeys, setTelemetryKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!assetId) { setTelemetryKeys([]); return; }
    fetch(`/api/telemetry/${assetId}/metrics`, { credentials: "include" })
      .then(r => r.ok ? r.json() : []).then(setTelemetryKeys).catch(() => setTelemetryKeys([]));
  }, [assetId]);

  // Map a real telemetry key to a friendly attribute label + UoM
  function metaForKey(key: string): { label: string; uom?: string } {
    const m = attrList.find((a: any) => {
      const tag = a.tagName ?? a.sourceMetric ?? ""; if (!tag) return false;
      return tag === key || tag.split(".").slice(1).join(".") === key;
    });
    return m ? { label: m.name, uom: m.uom } : { label: key };
  }

  // Always use real telemetry keys; fall back to attributes if no telemetry ingested yet
  const metricOptions = telemetryKeys.length > 0
    ? telemetryKeys.map(k => { const { label, uom } = metaForKey(k); return { key: k, label, uom }; })
    : attrList
        .filter((a: any) => a.tagName ?? a.sourceMetric)
        .map((a: any) => {
          const raw = a.tagName ?? a.sourceMetric ?? a.name;
          const key = raw.split(".").slice(1).join(".") || raw;
          return { key, label: a.name, uom: a.uom };
        });

  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [rangeHours, setRangeHours] = useState(1);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [telemetry, setTelemetry] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  // Reset selected metrics when asset changes
  useEffect(() => { setSelectedMetrics([]); }, [assetId]);

  // Default to first available metric
  useEffect(() => {
    if (metricOptions.length > 0 && selectedMetrics.length === 0) {
      setSelectedMetrics([metricOptions[0].key]);
    }
  }, [metricOptions, selectedMetrics.length]);

  const fetchTelemetry = useCallback(async () => {
    if (selectedMetrics.length === 0) return;
    setLoading(true);
    try {
      const from = rangeHours === -1 && customFrom
        ? new Date(customFrom).toISOString()
        : (rangeHours <= 24 ? subHours(new Date(), rangeHours) : subDays(new Date(), rangeHours / 24)).toISOString();
      const allRows: any[] = [];
      for (const metric of selectedMetrics) {
        const params = new URLSearchParams({ metric, from, limit: "1000" });
        const res = await fetch(`/api/telemetry/${assetId}?${params}`);
        const rows: any[] = res.ok ? await res.json() : [];
        if (rows.length > 0) allRows.push(...rows.map((r) => ({ ...r, _metric: metric })));
        if (rows.length === 0) {
          const agg = await fetch(`/api/system/aggregate?${new URLSearchParams({ assetId, metric, from, to: new Date().toISOString(), bucket: "1h", limit: "1000" })}`);
          const json = agg.ok ? await agg.json() : null;
          const aggRows = (json?.data ?? []).map((r: any) => ({
            timestamp: r.bucket,
            value: r.avg_val ?? r.max_val ?? r.min_val ?? null,
            _metric: metric,
          }));
          allRows.push(...aggRows);
        }
      }
      // Pivot: group by timestamp, one key per metric
      const byTs: Record<string, any> = {};
      for (const row of allRows) {
        const ts = new Date(row.timestamp).getTime();
        if (!byTs[ts]) byTs[ts] = { ts, time: format(new Date(row.timestamp), rangeHours <= 1 ? "HH:mm:ss" : rangeHours <= 24 ? "HH:mm" : "MM/dd HH:mm") };
        const v = Number(row.value);
        if (!isNaN(v)) byTs[ts][row._metric] = v;
      }
      const sorted = Object.values(byTs).sort((a, b) => a.ts - b.ts);
      setTelemetry(sorted);
      setLastFetch(new Date());
    } finally { setLoading(false); }
  }, [assetId, selectedMetrics, rangeHours, customFrom, customTo]);

  useEffect(() => { fetchTelemetry(); }, [fetchTelemetry]);

  function toggleMetric(key: string) {
    setSelectedMetrics((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );
  }

  function exportTelemetryCsv() {
    const metric = selectedMetrics[0];
    const from = rangeHours === -1 && customFrom
      ? new Date(customFrom).toISOString()
      : (rangeHours <= 24 ? subHours(new Date(), rangeHours) : subDays(new Date(), rangeHours / 24)).toISOString();
    const params = new URLSearchParams(metric ? { metric, from } : { from });
    const url = `/api/telemetry/${assetId}/export?${params}`;
    const a = document.createElement("a");
    a.href = url; a.download = `telemetry_${assetId}_${Date.now()}.csv`;
    a.click();
  }

  const metricLabelOf = (key: string) => metricOptions.find((o: any) => o.key === key)?.label ?? key;

  const hasData = telemetry.length > 0;

  return (
    <div className="p-4 space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Metric toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Metrics:</span>
          {metricOptions.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">No numeric attributes found</span>
          ) : metricOptions.map(({ key, label, uom }, i) => (
            <button key={key}
              onClick={() => toggleMetric(key)}
              className={cn("text-xs px-2 py-0.5 rounded-full border font-medium transition-colors",
                selectedMetrics.includes(key)
                  ? "border-transparent text-white"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
              style={selectedMetrics.includes(key) ? { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] } : {}}
            >
              {label}{uom ? ` (${uom})` : ""}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Time range */}
        <div className="flex items-center gap-2">
          <Select value={String(rangeHours)} onValueChange={(v) => setRangeHours(Number(v))}>
            <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Range" /></SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map(({ label, hours }) => (
                <SelectItem key={label} value={String(hours)}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rangeHours === -1 && (
            <>
              <Input type="datetime-local" className="h-8 text-xs w-44" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <Input type="datetime-local" className="h-8 text-xs w-44" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          )}
        </div>

        <button onClick={fetchTelemetry} disabled={loading}
          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>

        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportTelemetryCsv}>
          <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
        </Button>
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-border bg-card p-4">
        {loading && telemetry.length === 0 ? (
          <Skeleton className="h-64 w-full" />
        ) : !hasData ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
            <TrendingUp className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">No telemetry data in this time range</p>
            <p className="text-xs mt-1 opacity-60">
              {selectedMetrics.length === 0
                ? "Select a metric above to see its trend"
                : `No data for "${selectedMetrics.join(", ")}" in the past ${rangeHours < 24 ? `${rangeHours}h` : `${rangeHours / 24}d`}`}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={telemetry} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              />
              {selectedMetrics.map((metric, i) => (
                <Line
                  key={metric}
                  type="monotone"
                  dataKey={metric}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={telemetry.length < 50}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Summary stats */}
          {hasData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {selectedMetrics.map((metric, i) => {
            const vals = telemetry.map((r) => r[metric]).filter((v) => v != null) as number[];
            if (vals.length === 0) return null;
            const min = Math.min(...vals); const max = Math.max(...vals);
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            const last = vals[vals.length - 1];
            const color = CHART_COLORS[i % CHART_COLORS.length];
            return (
              <div key={metric} className="rounded-lg border border-border bg-muted/30 p-3" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
                <p className="text-xs font-medium mb-1.5 truncate">{metricLabelOf(metric)}</p>
                <div className="grid grid-cols-2 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Last</span><span className="font-mono font-medium">{last.toFixed(2)}</span>
                  <span className="text-muted-foreground">Avg</span><span className="font-mono">{avg.toFixed(2)}</span>
                  <span className="text-muted-foreground">Min</span><span className="font-mono">{min.toFixed(2)}</span>
                  <span className="text-muted-foreground">Max</span><span className="font-mono">{max.toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">{vals.length} samples</p>
              </div>
            );
          })}
        </div>
      )}

      {lastFetch && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <RefreshCw className="w-3 h-3" />
          Updated {format(lastFetch, "HH:mm:ss")}
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Assets() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useCurrentUser();

  const [search, setSearch]             = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [addAssetParentId, setAddAssetParentId] = useState<string | null>(null);
  const [showIdentifierField, setShowIdentifierField] = useState(false);
  const [addAttrOpen, setAddAttrOpen]   = useState(false);
  const [editAttr, setEditAttr]         = useState<any | null>(null);
  const [importOpen, setImportOpen]     = useState(false);
  const [importTab, setImportTab]       = useState<"template" | "csv" | "json">("template");

  const [csvText, setCsvText]           = useState("");
  const [jsonText, setJsonText]         = useState("");
  const [previewRows, setPreviewRows]   = useState<AttrDef[]>([]);
  const [parseError, setParseError]     = useState<string | null>(null);
  const [importing, setImporting]       = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);

  // Add/Edit attribute form state
  const [attrUseExpr, setAttrUseExpr]   = useState(false);
  const [editAttrUseExpr, setEditAttrUseExpr] = useState(false);

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
  const attrForm  = useForm({ defaultValues: { name: "", type: "static", dataType: "double", value: "", tagName: "", sourceMetric: "", uom: "", decimalPlaces: "", thousandSeparator: false, expression: "" } });
  const editAttrForm = useForm({ defaultValues: { name: "", type: "static", dataType: "double", value: "", tagName: "", sourceMetric: "", uom: "", decimalPlaces: "", thousandSeparator: false, expression: "" } });

  const allAssets    = (assets    as Asset[] | undefined) ?? [];
  const templateList = (templates as any[]   | undefined) ?? [];
  const rootAssets   = allAssets.filter((a) => !a.parentId);
  const attrList     = (attributes as any[] | undefined) ?? [];

  const filteredSearch = search
    ? allAssets.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()) || a.identifier.toLowerCase().includes(search.toLowerCase()))
    : [];

  function flattenTree(roots: Asset[], all: Asset[], depth = 0): Array<{ asset: Asset; depth: number }> {
    const result: Array<{ asset: Asset; depth: number }> = [];
    for (const a of roots) {
      result.push({ asset: a, depth });
      result.push(...flattenTree(all.filter((c) => c.parentId === a.id), all, depth + 1));
    }
    return result;
  }
  const treeFlat = flattenTree(rootAssets, allAssets);

  // Available attribute names for expression autocomplete
  const attrNames = attrList
    .filter((a: any) => a.type !== "runtime")
    .map((a: any) => a.name as string);

  function openAddAsset(parentId: string | null = null) {
    setAddAssetParentId(parentId);
    assetForm.reset({ name: "", identifier: "", parentId: parentId ?? "" });
    setAddAssetOpen(true);
  }

  async function toggleMaintenance(asset: Asset) {
    setMaintenanceLoading(true);
    try {
      const res = await fetch(`/api/assets/${asset.id}/maintenance`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !asset.maintenanceMode }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json() as Asset;
      setSelectedAsset((prev) => prev ? { ...prev, ...updated } : prev);
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      toast({
        title: updated.maintenanceMode ? "Maintenance mode ON" : "Maintenance mode OFF",
        description: updated.maintenanceMode
          ? "Alarm evaluation is suspended for this asset."
          : "Alarm evaluation resumed for this asset.",
      });
    } catch {
      toast({ title: "Failed to toggle maintenance mode", variant: "destructive" });
    } finally {
      setMaintenanceLoading(false);
    }
  }

  function handleNameChange(name: string) {
    assetForm.setValue("name", name);
    const curr = assetForm.getValues("identifier");
    if (!curr) assetForm.setValue("identifier", name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
  }

  // ── Parse preview ─────────────────────────────────────────────────────────
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
          const source = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
            ? obj.data
            : obj.metrics && typeof obj.metrics === "object" && !Array.isArray(obj.metrics)
              ? obj.metrics
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

  // ── Bulk import ───────────────────────────────────────────────────────────
  async function handleBulkImport() {
    if (!selectedAsset || previewRows.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/assets/${selectedAsset.id}/attributes/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: previewRows }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Import failed", description: data.error, variant: "destructive" }); return; }
      const desc = data.skipped > 0
        ? `${data.created} created · ${data.skipped} skipped: ${(data.skippedItems ?? []).join(", ")}`
        : `${data.created} attribute(s) created`;
      toast({ title: "Import complete", description: desc });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      closeImport();
    } finally { setImporting(false); }
  }

  // ── Apply template ────────────────────────────────────────────────────────
  async function handleApplyTemplate() {
    if (!selectedAsset) return;
    const tid = selectedTemplateId || selectedAsset.templateId || "";
    if (!tid) { toast({ title: "Please select a template", variant: "destructive" }); return; }
    setApplyingTemplate(true);
    try {
      const res = await fetch(`/api/assets/${selectedAsset.id}/apply-template`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: tid }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Failed", description: data.error, variant: "destructive" }); return; }
      let desc = `${data.created} attribute(s) created`;
      if (data.skipped > 0) desc += ` · ${data.skipped} skipped: ${(data.skippedItems ?? []).join(", ")}`;
      toast({ title: `Template "${data.templateName}" applied`, description: desc });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      closeImport(); setSelectedTemplateId("");
    } finally { setApplyingTemplate(false); }
  }

  // ── Save edited attribute ─────────────────────────────────────────────────
  async function handleSaveEdit(data: any) {
    if (!editAttr) return;
    const body: Record<string, any> = {
      name: data.name, type: data.type, dataType: data.dataType,
      value: data.value || null, tagName: data.tagName || null,
      sourceMetric: data.sourceMetric || null,
      uom: data.uom || null,
      decimalPlaces: data.decimalPlaces !== "" && data.decimalPlaces != null ? Number(data.decimalPlaces) : null,
      thousandSeparator: data.thousandSeparator === true,
      expression: editAttrUseExpr ? data.expression || null : null,
    };
    if (editAttrUseExpr) body.type = "runtime";

    try {
      const res = await fetch(`/api/attributes/${editAttr.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); toast({ title: "Update failed", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Attribute updated" });
      qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset!.id) });
      setEditAttr(null); editAttrForm.reset();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  // ── Export CSV ────────────────────────────────────────────────────────────
  function handleExportCsv() {
    if (attrList.length === 0) return;
    const header = "name,type,dataType,value,tagName,sourceMetric,uom,decimalPlaces,thousandSeparator,expression";
    const rows = attrList.map((a: any) =>
      [a.name, a.type, a.dataType,
        a.value != null ? String(typeof a.value === "object" ? JSON.stringify(a.value) : a.value) : "",
        a.tagName ?? "", a.sourceMetric ?? "", a.uom ?? "",
        a.decimalPlaces != null ? String(a.decimalPlaces) : "",
        a.thousandSeparator ? "TRUE" : "FALSE",
        a.expression ?? ""]
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

  function onAddAsset(data: { name: string; identifier: string; parentId?: string }) {
    const finalId = (data.identifier || "").trim()
      || data.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    createAsset.mutate({ data: { name: data.name, identifier: finalId, parentId: data.parentId || null } }, {
      onSuccess: () => {
        toast({ title: "Asset created" });
        qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
        setAddAssetOpen(false); assetForm.reset();
      },
    });
  }

  function onAddAttr(data: any) {
    if (!selectedAsset) return;
    const finalType = attrUseExpr ? "runtime" : data.type;
    createAttr.mutate({
      id: selectedAsset.id,
      data: {
        name: data.name, type: finalType as any, dataType: data.dataType as any,
        value: data.value || null, tagName: data.tagName || null,
        sourceMetric: data.sourceMetric || null,
        uom: data.uom || null,
        decimalPlaces: data.decimalPlaces !== "" && data.decimalPlaces != null ? Number(data.decimalPlaces) : null,
        thousandSeparator: data.thousandSeparator === true,
        expression: attrUseExpr ? data.expression || null : null,
      } as any,
    }, {
      onSuccess: () => {
        toast({ title: "Attribute added" });
        qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) });
        setAddAttrOpen(false); attrForm.reset(); setAttrUseExpr(false);
      },
    });
  }

  function openEditAttr(attr: any) {
    setEditAttr(attr);
    const hasExpr = !!attr.expression;
    setEditAttrUseExpr(hasExpr);
    editAttrForm.reset({
      name: attr.name, type: attr.type, dataType: attr.dataType,
      value: attr.value != null ? String(attr.value) : "",
      tagName: attr.tagName ?? "", sourceMetric: attr.sourceMetric ?? "",
      uom: attr.uom ?? "", decimalPlaces: attr.decimalPlaces != null ? String(attr.decimalPlaces) : "",
      thousandSeparator: attr.thousandSeparator ?? false,
      expression: attr.expression ?? "",
    });
  }

  function closeImport() {
    setImportOpen(false);
    setPreviewRows([]); setParseError(null); setCsvText(""); setJsonText("");
    setSelectedTemplateId("");
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Asset tree ──────────────────────────────────────────────────── */}
      <div className="w-64 border-r border-border flex flex-col shrink-0 bg-card">
        {/* Header with title + Add New button */}
        <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground/80">Projects &amp; Assets</span>
          {can("manage_assets") && (
            <Button size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => openAddAsset(null)}>
              <Plus className="w-3.5 h-3.5" /> Add New
            </Button>
          )}
        </div>
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search assets…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1.5 space-y-0.5">
            {!assets ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full rounded" />)
            ) : search ? (
              filteredSearch.length === 0
                ? <p className="text-xs text-muted-foreground text-center py-4">No assets match</p>
                : filteredSearch.map((a) => (
                  <div key={a.id} onClick={() => setSelectedAsset(a)}
                    className={cn("flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-xs",
                      selectedAsset?.id === a.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60")}>
                    <Blocks className="w-3.5 h-3.5 shrink-0 text-primary/60" /><span className="truncate">{a.name}</span>
                  </div>
                ))
            ) : rootAssets.length === 0 ? (
              <div className="px-3 py-8 text-center text-muted-foreground">
                <Blocks className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-xs">No assets yet</p>
                {can("manage_assets") && (
                  <Button size="sm" variant="outline" className="mt-2 text-xs h-7" onClick={() => openAddAsset(null)}>
                    <Plus className="w-3 h-3 mr-1" /> Add first asset
                  </Button>
                )}
              </div>
            ) : (
              rootAssets.map((a) => (
                <AssetTreeNode key={a.id} asset={a} allAssets={allAssets}
                  selectedId={selectedAsset?.id ?? null}
                  onSelect={setSelectedAsset}
                  onAddChild={openAddAsset}
                  canManage={can("manage_assets")}
                  depth={0} />
              ))
            )}
          </div>
        </ScrollArea>
        {can("manage_assets") && (
          <div className="p-2 border-t border-border">
            <Button size="sm" variant="outline" className="w-full text-xs h-7" onClick={() => openAddAsset(null)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> New Root Project
            </Button>
          </div>
        )}
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedAsset ? (
          <>
            <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-sm truncate">{selectedAsset.name}</h2>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{selectedAsset.identifier}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedAsset.templateName && <Badge variant="secondary" className="text-xs">{selectedAsset.templateName}</Badge>}
                {/* Maintenance Mode toggle */}
                {can("manage_assets") && (
                  <div className="flex items-center gap-1.5 border border-border rounded-md px-2 py-1">
                    <Wrench className={`w-3 h-3 ${selectedAsset.maintenanceMode ? "text-amber-500" : "text-muted-foreground"}`} />
                    <Switch
                      checked={!!selectedAsset.maintenanceMode}
                      onCheckedChange={() => toggleMaintenance(selectedAsset)}
                      disabled={maintenanceLoading}
                      className="scale-75 -my-0.5"
                      aria-label="Maintenance mode"
                    />
                    {selectedAsset.maintenanceMode && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Maintenance</span>
                    )}
                  </div>
                )}
                {can("manage_assets") && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openAddAsset(selectedAsset.id)}>
                    <Plus className="w-3 h-3 mr-1" /> Add Child
                  </Button>
                )}
                {can("manage_assets") && (
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 text-xs"
                    onClick={() => deleteAsset.mutate({ id: selectedAsset.id }, {
                      onSuccess: () => { toast({ title: "Asset deleted" }); qc.invalidateQueries({ queryKey: getListAssetsQueryKey() }); setSelectedAsset(null); }
                    })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>

            <Tabs defaultValue="attributes" className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 pt-2 border-b border-border bg-card">
                <TabsList className="h-8">
                  <TabsTrigger value="attributes" className="text-xs h-7">Attributes</TabsTrigger>
                  <TabsTrigger value="trends" className="text-xs h-7 gap-1"><TrendingUp className="w-3 h-3" />Trends</TabsTrigger>
                  <TabsTrigger value="table" className="text-xs h-7">Table</TabsTrigger>
                  <TabsTrigger value="media" className="text-xs h-7">Media</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="attributes" className="flex-1 overflow-auto m-0">
                {/* Toolbar */}
                <div className="p-3 flex items-center gap-2 border-b border-border bg-muted/30 flex-wrap">
                  {can("manage_assets") && (
                    <Button size="sm" className="h-7 text-xs" onClick={() => { attrForm.reset(); setAttrUseExpr(false); setAddAttrOpen(true); }}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add
                    </Button>
                  )}
                  {can("manage_assets") && <div className="h-5 w-px bg-border" />}
                  {can("manage_assets") && (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => { setImportTab("template"); setImportOpen(true); setPreviewRows([]); }}>
                      <LayoutTemplate className="w-3.5 h-3.5 mr-1" /> Apply Template
                    </Button>
                  )}
                  {can("manage_assets") && (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => { setImportTab("csv"); setImportOpen(true); setPreviewRows([]); setCsvText(""); }}>
                      <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Import CSV
                    </Button>
                  )}
                  {can("manage_assets") && (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => { setImportTab("json"); setImportOpen(true); setPreviewRows([]); setJsonText(""); }}>
                      <Braces className="w-3.5 h-3.5 mr-1" /> Import JSON
                    </Button>
                  )}
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
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">Type</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Value / UoM</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Expression</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tag / Source</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Quality</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Updated</th>
                      <th className="px-3 py-2 w-8"></th>
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
                            <Button size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => { setImportTab("template"); setImportOpen(true); }}>
                              <LayoutTemplate className="w-3.5 h-3.5 mr-1" /> Apply Template
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      attrList.map((attr: any) => (
                        <tr key={attr.id}
                          className={cn("border-b border-border/50 hover:bg-muted/30 transition-colors group",
                            attr.type === "runtime" && "bg-orange-50/30 dark:bg-orange-950/10")}>
                          <td className="px-3 py-2">
                            {can("manage_assets") && (
                              <button className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100"
                                onClick={() => openEditAttr(attr)}>
                                <Edit2 className="w-3 h-3" />
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2"><AttributeType type={attr.type} /></td>
                          <td className="px-3 py-2 font-medium">{attr.name}</td>
                          <td className="px-3 py-2 font-mono">
                            {attr.value != null
                              ? <span className={cn(attr.type === "runtime" && "font-semibold text-orange-700 dark:text-orange-400")}>
                                  {(() => {
                                    const raw = typeof attr.value === "object" ? JSON.stringify(attr.value) : String(attr.value);
                                    const num = Number(raw);
                                    if (!isNaN(num) && attr.decimalPlaces != null) {
                                      return num.toLocaleString(undefined, {
                                        minimumFractionDigits: attr.decimalPlaces,
                                        maximumFractionDigits: attr.decimalPlaces,
                                        useGrouping: attr.thousandSeparator ?? false,
                                      });
                                    }
                                    if (!isNaN(num) && attr.thousandSeparator) {
                                      return num.toLocaleString(undefined, { useGrouping: true });
                                    }
                                    return raw;
                                  })()}
                                  {attr.uom && <span className="text-muted-foreground ml-1 font-normal">{attr.uom}</span>}
                                </span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {attr.expression
                              ? <code className="text-xs bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 px-1.5 py-0.5 rounded font-mono">
                                  {attr.expression}
                                </code>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground font-mono">
                            {attr.tagName
                              ? <span className="text-xs">{attr.tagName}</span>
                              : attr.sourceMetric
                                ? <span className="text-xs text-blue-600 dark:text-blue-400">src:{attr.sourceMetric}</span>
                                : <span className="text-muted-foreground/40">—</span>}
                            {attr.sourceMetric && attr.tagName
                              ? <span className="ml-1 text-[10px] text-blue-600 dark:text-blue-400">→{attr.sourceMetric}</span>
                              : null}
                          </td>
                          <td className="px-3 py-2">
                            {attr.quality
                              ? <span className={cn("text-xs",
                                  attr.quality === "good" ? "text-green-600" :
                                  attr.quality === "bad"  ? "text-red-500"  : "text-yellow-600")}>
                                  {attr.quality}
                                </span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {attr.timestamp ? format(new Date(attr.timestamp), "MM/dd HH:mm:ss") : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {can("manage_assets") && (
                              <button className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                                onClick={() => deleteAttr.mutate({ id: attr.id }, {
                                  onSuccess: () => { toast({ title: "Deleted" }); qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) }); }
                                })}>
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TabsContent>
              <TabsContent value="trends" className="flex-1 overflow-auto m-0">
                <TrendsPanel assetId={selectedAsset.id} attrList={attrList} />
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

      {/* ── Add Asset Dialog ──────────────────────────────────────────── */}
      <Dialog open={addAssetOpen} onOpenChange={(v) => { if (!v) { setAddAssetOpen(false); assetForm.reset(); setShowIdentifierField(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addAssetParentId ? "Add Child Asset" : "New Root Project"}
            </DialogTitle>
            <DialogDescription>
              {addAssetParentId
                ? `Adding a child asset under "${allAssets.find((a) => a.id === addAssetParentId)?.name ?? "selected asset"}". Use this to model sub-systems, equipment, or devices.`
                : "Create a top-level project or site (e.g. Plant 1, Site A, Factory). You can then add child assets beneath it to build your hierarchy."}
            </DialogDescription>
          </DialogHeader>
          <Form {...assetForm}>
            <form onSubmit={assetForm.handleSubmit(onAddAsset)} className="space-y-4">
              <FormField control={assetForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Fan, Compressor, Plant 2" {...field} onChange={(e) => handleNameChange(e.target.value)} />
                  </FormControl>
                  {/* Auto-identifier preview */}
                  {assetForm.watch("name") && !showIdentifierField && (
                    <div className="flex items-center gap-2 pt-0.5">
                      <p className="text-xs text-muted-foreground">
                        Identifier: <code className="font-mono bg-muted px-1 rounded">
                          {(assetForm.watch("identifier") || assetForm.watch("name").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""))}
                        </code>
                      </p>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline shrink-0"
                        onClick={() => setShowIdentifierField(true)}
                      >
                        Customize
                      </button>
                    </div>
                  )}
                </FormItem>
              )} />

              {/* Identifier field — only shown when user clicks Customize */}
              {showIdentifierField && (
                <FormField control={assetForm.control} name="identifier" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Identifier</FormLabel>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => { setShowIdentifierField(false); }}
                      >
                        ✕ Hide
                      </button>
                    </div>
                    <FormControl>
                      <Input placeholder="unique_key" className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Used as the tag name prefix when connecting live data (e.g. from Node-RED). Leave blank to auto-generate from the name.
                    </FormDescription>
                  </FormItem>
                )} />
              )}

              {!addAssetParentId && (
                <FormField control={assetForm.control} name="parentId" render={({ field }) => (
                  <FormItem><FormLabel>Parent Asset <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
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

      {/* ── Add Attribute Dialog ─────────────────────────────────────── */}
      <Dialog open={addAttrOpen} onOpenChange={(v) => { if (!v) { setAddAttrOpen(false); attrForm.reset(); setAttrUseExpr(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Attribute</DialogTitle>
            <DialogDescription>Add a single attribute to {selectedAsset?.name}.</DialogDescription>
          </DialogHeader>
          <Form {...attrForm}>
            <form onSubmit={attrForm.handleSubmit(onAddAttr)} className="space-y-4">
              <FormField control={attrForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel>
                  <FormControl><Input placeholder="e.g. Avg Temperature" {...field} /></FormControl>
                </FormItem>
              )} />

              {/* Use Expression toggle */}
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Calculator className="w-3.5 h-3.5 text-orange-500" /> Use Expression (Runtime)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Calculate this attribute from others on every payload ingest
                  </p>
                </div>
                <Switch checked={attrUseExpr} onCheckedChange={setAttrUseExpr} />
              </div>

              {attrUseExpr ? (
                <ExpressionEditor
                  control={attrForm.control}
                  attrNames={attrNames}
                />
              ) : (
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
              )}

              {!attrUseExpr && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={attrForm.control} name="tagName" render={({ field }) => (
                      <FormItem><FormLabel>Tag Name</FormLabel>
                        <FormControl><Input placeholder="device.key" className="font-mono text-xs" {...field} /></FormControl>
                        <FormDescription className="text-[10px]">Auto-updated by ingest when tagName matches payload</FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={attrForm.control} name="sourceMetric" render={({ field }) => (
                      <FormItem><FormLabel>Source Metric <span className="text-muted-foreground font-normal text-[10px]">(remap)</span></FormLabel>
                        <FormControl><Input placeholder="energy_meter_kwh" className="font-mono text-xs" {...field} /></FormControl>
                        <FormDescription className="text-[10px]">Payload key that feeds this attribute (if ≠ tagName key)</FormDescription>
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={attrForm.control} name="uom" render={({ field }) => (
                      <FormItem><FormLabel>UoM</FormLabel>
                        <FormControl><Input placeholder="kWh, °C" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={attrForm.control} name="decimalPlaces" render={({ field }) => (
                      <FormItem><FormLabel>Decimal Places</FormLabel>
                        <FormControl><Input type="number" min={0} max={10} placeholder="2" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={attrForm.control} name="thousandSeparator" render={({ field }) => (
                      <FormItem className="flex flex-col justify-end gap-2 pb-1">
                        <FormLabel>Thousand Sep.</FormLabel>
                        <div className="flex items-center gap-2 h-9">
                          <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                          <span className="text-xs text-muted-foreground">{field.value ? "On" : "Off"}</span>
                        </div>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={attrForm.control} name="value" render={({ field }) => (
                    <FormItem><FormLabel>Value <span className="text-muted-foreground font-normal">(optional, for static)</span></FormLabel>
                      <FormControl><Input placeholder="e.g. S125010T1TA10" {...field} /></FormControl>
                    </FormItem>
                  )} />
                </>
              )}

              {attrUseExpr && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={attrForm.control} name="uom" render={({ field }) => (
                    <FormItem><FormLabel>UoM</FormLabel>
                      <FormControl><Input placeholder="°C, mm/s, V" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={attrForm.control} name="dataType" render={({ field }) => (
                    <FormItem><FormLabel>Data Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="double">Double</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                        </SelectContent>
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

      {/* ── Edit Attribute Dialog ────────────────────────────────────── */}
      <Dialog open={!!editAttr} onOpenChange={(v) => { if (!v) { setEditAttr(null); editAttrForm.reset(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Attribute</DialogTitle>
            <DialogDescription>Update the configuration for "{editAttr?.name}".</DialogDescription>
          </DialogHeader>
          <Form {...editAttrForm}>
            <form onSubmit={editAttrForm.handleSubmit(handleSaveEdit)} className="space-y-4">
              <FormField control={editAttrForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />

              {editAttr?.type === "runtime" ? (
                /* Runtime attribute — only edit the expression and UoM */
                <>
                  <div className="flex items-center gap-2 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40 px-3 py-2">
                    <Calculator className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <p className="text-xs text-orange-800 dark:text-orange-300">
                      This is a <strong>computed attribute</strong>. Its value is recalculated on every payload ingest.
                    </p>
                  </div>
                  <ExpressionEditor control={editAttrForm.control} attrNames={attrNames.filter((n) => n !== editAttr?.name)} />
                  <FormField control={editAttrForm.control} name="uom" render={({ field }) => (
                    <FormItem><FormLabel>UoM</FormLabel><FormControl><Input placeholder="°C, mm/s, V" {...field} /></FormControl></FormItem>
                  )} />
                </>
              ) : (
                /* Normal attribute — edit type, dataType, tagName, sourceMetric, uom, decimalPlaces, value */
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={editAttrForm.control} name="type" render={({ field }) => (
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
                    <FormField control={editAttrForm.control} name="dataType" render={({ field }) => (
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
                    <FormField control={editAttrForm.control} name="tagName" render={({ field }) => (
                      <FormItem><FormLabel>Tag Name</FormLabel>
                        <FormControl><Input className="font-mono text-xs" placeholder="device-id.metric_name" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={editAttrForm.control} name="sourceMetric" render={({ field }) => (
                      <FormItem><FormLabel>Source Metric <span className="text-muted-foreground font-normal text-[10px]">(remap)</span></FormLabel>
                        <FormControl><Input className="font-mono text-xs" placeholder="energy_meter_kwh" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={editAttrForm.control} name="uom" render={({ field }) => (
                      <FormItem><FormLabel>UoM</FormLabel><FormControl><Input placeholder="kWh, °C" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={editAttrForm.control} name="decimalPlaces" render={({ field }) => (
                      <FormItem><FormLabel>Decimal Places</FormLabel>
                        <FormControl><Input type="number" min={0} max={10} placeholder="2" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={editAttrForm.control} name="thousandSeparator" render={({ field }) => (
                      <FormItem className="flex flex-col justify-end gap-2 pb-1">
                        <FormLabel>Thousand Sep.</FormLabel>
                        <div className="flex items-center gap-2 h-9">
                          <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                          <span className="text-xs text-muted-foreground">{field.value ? "On" : "Off"}</span>
                        </div>
                      </FormItem>
                    )} />
                  </div>
                  <div className="rounded-md bg-muted/40 border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    To add a <strong>computed attribute</strong> using this value, click <strong>Add</strong> and enable "Use Expression".
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

      {/* ── Apply Template / Import Dialog ──────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(v) => { if (!v) closeImport(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Attributes to "{selectedAsset?.name}"</DialogTitle>
            <DialogDescription>Duplicates (same name or tag) are automatically skipped.</DialogDescription>
          </DialogHeader>

          <Tabs value={importTab} onValueChange={(v) => { setImportTab(v as any); setPreviewRows([]); setParseError(null); }}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="template" className="text-xs gap-1.5"><LayoutTemplate className="w-3 h-3" /> Apply Template</TabsTrigger>
              <TabsTrigger value="csv" className="text-xs gap-1.5"><FileSpreadsheet className="w-3 h-3" /> CSV</TabsTrigger>
              <TabsTrigger value="json" className="text-xs gap-1.5"><Braces className="w-3 h-3" /> JSON Array</TabsTrigger>
            </TabsList>

            <TabsContent value="template" className="space-y-3 mt-3">
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-3 text-xs">
                <p className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5 mb-1.5">
                  <Info className="w-3.5 h-3.5" /> How Apply Template works
                </p>
                <ul className="text-blue-700 dark:text-blue-400 space-y-1">
                  <li>• Schema defined once in Asset Templates (via device payload) → stamped onto this asset here</li>
                  <li>• Tag names resolved: <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">temperature</code> → <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">{selectedAsset?.identifier ?? "asset"}.temperature</code></li>
                  <li>• Existing attributes are skipped, not duplicated</li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Select Template</label>
                <Select value={selectedTemplateId || selectedAsset?.templateId || ""} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Choose a template…" /></SelectTrigger>
                  <SelectContent>
                    {templateList.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.name} <span className="text-muted-foreground ml-1">({t.attributeCount} attrs)</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Preview */}
              {(() => {
                const tid = selectedTemplateId || selectedAsset?.templateId || "";
                const tmpl = templateList.find((t: any) => t.id === tid);
                const defs: any[] = tmpl?.attributeDefinitions ?? [];
                if (!tmpl || defs.length === 0) return null;
                return (
                  <div className="rounded border border-border overflow-hidden">
                    <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                      {defs.length} attribute{defs.length !== 1 ? "s" : ""} · prefix: <code className="font-mono">{selectedAsset?.identifier ?? "asset"}.</code>
                    </div>
                    <div className="max-h-40 overflow-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-border/50 bg-muted/30">
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Name</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Resolved Tag</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">UoM</th>
                        </tr></thead>
                        <tbody>{defs.map((d: any, i: number) => (
                          <tr key={i} className="border-b border-border/50 last:border-0">
                            <td className="px-3 py-1.5 font-medium">{d.name}</td>
                            <td className="px-3 py-1.5 font-mono text-muted-foreground">
                              {d.tagName ? `${selectedAsset?.identifier ?? "asset"}.${d.tagName}` : "—"}
                            </td>
                            <td className="px-3 py-1.5">{d.uom || "—"}</td>
                          </tr>
                        ))}</tbody>
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

            <TabsContent value="csv" className="space-y-3 mt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Columns: name, type, dataType, tagName, sourceMetric, uom, decimalPlaces, thousandSeparator</p>
                <button className="text-xs text-primary hover:underline" onClick={() => setCsvText(CSV_EXAMPLE)}>Load example</button>
              </div>
              <Textarea value={csvText} onChange={(e) => { setCsvText(e.target.value); setPreviewRows([]); setParseError(null); }}
                placeholder={"name,type,dataType,tagName,sourceMetric,uom,decimalPlaces\nEnergy kWh,dynamic,double,device-01.energy_kwh,energy_kwh,kWh,2"}
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

            <TabsContent value="json" className="space-y-3 mt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">JSON array of attribute objects</p>
                <button className="text-xs text-primary hover:underline" onClick={() => setJsonText(JSON_EXAMPLE)}>Load example</button>
              </div>
              <Textarea value={jsonText} onChange={(e) => { setJsonText(e.target.value); setPreviewRows([]); setParseError(null); }}
                placeholder={'[\n  {"name":"Temperature","type":"dynamic","dataType":"double","tagName":"device-01.temperature","uom":"°C"}\n]'}
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

// ── Expression Editor subcomponent ────────────────────────────────────────────
function ExpressionEditor({ control, attrNames }: { control: any; attrNames: string[] }) {
  const [showHint, setShowHint] = useState(false);
  return (
    <div className="space-y-2">
      <FormField control={control} name="expression" render={({ field }) => (
        <FormItem>
          <div className="flex items-center justify-between">
            <FormLabel className="flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5 text-orange-500" /> Expression
            </FormLabel>
            <button type="button" onClick={() => setShowHint((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <HelpCircle className="w-3 h-3" /> syntax help
            </button>
          </div>
          <FormControl>
            <Input
              placeholder="e.g. (Temperature + Ultrasound) / 2"
              className="font-mono text-xs"
              {...field}
            />
          </FormControl>
          <FormDescription className="text-xs">
            Use attribute names as variables. Evaluated on every ingest.
          </FormDescription>
        </FormItem>
      )} />

      {showHint && (
        <div className="rounded-md bg-muted/50 border border-border p-3 space-y-2 text-xs">
          <p className="font-medium">Supported operators & functions</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
            <span><code className="bg-muted px-1 rounded">+ - * /</code> arithmetic</span>
            <span><code className="bg-muted px-1 rounded">^ or **</code> power</span>
            <span><code className="bg-muted px-1 rounded">abs(x)</code> absolute value</span>
            <span><code className="bg-muted px-1 rounded">sqrt(x)</code> square root</span>
            <span><code className="bg-muted px-1 rounded">round(x)</code> round</span>
            <span><code className="bg-muted px-1 rounded">min(a,b) max(a,b)</code></span>
            <span><code className="bg-muted px-1 rounded">sin(x) cos(x)</code> trig</span>
            <span><code className="bg-muted px-1 rounded">log(x) exp(x)</code></span>
          </div>
          {attrNames.length > 0 && (
            <div>
              <p className="font-medium mb-1">Available attributes</p>
              <div className="flex flex-wrap gap-1">
                {attrNames.map((n) => (
                  <code key={n} className="bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 px-1.5 py-0.5 rounded text-xs">{n}</code>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-border/50 pt-2 space-y-1">
            <p className="font-medium">Examples</p>
            <div className="text-muted-foreground space-y-0.5">
              <p><code className="bg-muted px-1 rounded">(Temperature + Ultrasound) / 2</code> — average of two sensors</p>
              <p><code className="bg-muted px-1 rounded">Temperature * 1.8 + 32</code> — Celsius to Fahrenheit</p>
              <p><code className="bg-muted px-1 rounded">sqrt(Vibration_RMS_Vel_X ^ 2 + Vibration_RMS_Vel_Y ^ 2)</code></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Import preview table ──────────────────────────────────────────────────────
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
