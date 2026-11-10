// Shared types, helpers, and components for the Asset Management module.
// Extracted so the list pages (Assets, AssetTemplates) and detail pages
// (AssetDetails, AssetTemplateDetails) reuse one implementation.
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import {
  Calculator, HelpCircle, TrendingUp, RefreshCw, Download, CheckCircle2,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { format, subHours, subDays } from "date-fns";
import { SERIES } from "@/lib/chartColors";

// ── Types ───────────────────────────────────────────────────────────────────────
export interface Asset {
  id: string; name: string; identifier: string;
  parentId?: string | null; templateId?: string | null;
  templateName?: string | null; childCount: number;
  attributeCount: number; createdAt?: string; updatedAt: string;
  maintenanceMode?: boolean;
  maintenanceSince?: string | null;
  maintenanceNote?: string | null;
}
export interface AttrDef {
  name: string; type: string; dataType: string;
  value?: string; tagName?: string; sourceMetric?: string;
  uom?: string; decimalPlaces?: number | null; thousandSeparator?: boolean;
  expression?: string;
}
export interface AssetHealth {
  health: "ok" | "alarm" | "stale";
  freshnessPct: number | null; activeAlarms: number; lastSeen: string | null;
}

// ── Status / Health / Site derivation ─────────────────────────────────────────
export type AssetStatus = "Running" | "Warning" | "Critical" | "Offline" | "Unknown";

// A machine is "live" only if telemetry arrived within this window. Once the source
// (Node-RED / simulator) stops, the status flips to Stale (grey) within ~this long.
export const STALE_AFTER_MS = 60_000;

/**
 * When the asset last changed: its newest data or the last edit of its details,
 * whichever is later. Incoming data does not touch the asset's own updatedAt.
 */
export function lastUpdatedAt(updatedAt?: string | Date | null, lastSeen?: string | Date | null): Date | null {
  const times = [updatedAt, lastSeen]
    .map((value) => (value ? new Date(value).getTime() : NaN))
    .filter((time) => !isNaN(time));
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

export function deriveStatus(_asset: Asset, health: AssetHealth | null): AssetStatus {
  if (!health) return "Unknown";
  // No telemetry ever → Offline. Telemetry that stopped arriving → Offline after the window.
  if (!health.lastSeen) return "Offline";
  const age = Date.now() - new Date(health.lastSeen).getTime();
  if (isNaN(age) || age > STALE_AFTER_MS) return "Offline";
  if (health.health === "alarm") return health.activeAlarms > 1 ? "Critical" : "Warning";
  if (health.health === "stale") return "Offline";
  return "Running";
}

export const STATUS_STYLES: Record<AssetStatus, string> = {
  Running:     "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  Warning:     "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  Critical:    "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  Offline:     "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  Unknown:     "bg-muted text-muted-foreground",
};

// "Site" = the root ancestor's name (top of the parent chain). Root assets have none.
export function siteOf(asset: Asset, all: Asset[]): string {
  let cur = asset;
  const seen = new Set<string>();
  while (cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = all.find((a) => a.id === cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur.id === asset.id ? "—" : cur.name;
}

// Fetch computed health for a set of assets. Returns a map id -> health.
export function useAssetHealthMap(assetIds: string[]): Record<string, AssetHealth> {
  const [map, setMap] = useState<Record<string, AssetHealth>>({});
  const key = assetIds.join(",");
  useEffect(() => {
    let cancelled = false;
    if (assetIds.length === 0) { setMap({}); return; }
    const load = () => Promise.all(assetIds.map(async (id) => {
      try {
        const res = await fetch(`/api/assets/${id}/health`, { credentials: "include" });
        return res.ok ? ([id, await res.json()] as const) : null;
      } catch { return null; }
    })).then((entries) => {
      if (cancelled) return;
      const m: Record<string, AssetHealth> = {};
      for (const e of entries) if (e) m[e[0]] = e[1];
      setMap(m);
    });
    void load();
    // Same interval as the asset details page, so the times shown stay current.
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

export function HealthBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground/50 text-xs">—</span>;
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <span className="tabular-nums text-xs w-9">{Math.round(pct)}%</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[40px] max-w-[80px]">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Attribute type badge ──────────────────────────────────────────────────────
export function AttributeType({ type }: { type: string }) {
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

// ── CSV / payload parsers ───────────────────────────────────────────────────────
export function parseCsv(text: string): AttrDef[] {
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

export function flattenPayload(obj: Record<string, any>, prefix = "", out: Record<string, any> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (["deviceId","device_id","timestamp","timestampUnix","timestamp_unix","receivedAt","received_at","capturedAt","captured_at","sensor","asset","measurement_point","id","version","type","source"].includes(k)) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flattenPayload(v as Record<string, any>, key, out);
    else out[key] = v;
  }
  return out;
}

export const CSV_EXAMPLE = `name,type,dataType,tagName,uom\nTemperature,dynamic,double,device-01.temperature,°C\nEnergy kWh,dynamic,double,device-01.energy_kwh,kWh\nDevice ID,static,text,device-01.device_serial,`;
export const JSON_EXAMPLE = JSON.stringify([
  { name: "Temperature", type: "dynamic", dataType: "double", tagName: "device-01.temperature", uom: "°C" },
  { name: "Energy kWh", type: "dynamic", dataType: "double", tagName: "device-01.energy_kwh", uom: "kWh" },
], null, 2);

const TIME_RANGES = [
  { label: "1 min", hours: 1 / 60 }, { label: "5 min", hours: 5 / 60 },
  { label: "15 min", hours: 15 / 60 }, { label: "30 min", hours: 30 / 60 },
  { label: "1 h", hours: 1 }, { label: "6 h", hours: 6 }, { label: "24 h", hours: 24 },
  { label: "7 d", hours: 24 * 7 }, { label: "30 d", hours: 24 * 30 },
  { label: "1 year", hours: 24 * 365 }, { label: "Custom", hours: -1 },
];

/** The shared, CVD-validated series order — see src/lib/chartColors.ts. */
export const CHART_COLORS = SERIES;

// ── Trends Panel ──────────────────────────────────────────────────────────────
export function TrendsPanel({ assetId, attrList }: { assetId: string; attrList: any[] }) {
  const [telemetryKeys, setTelemetryKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!assetId) { setTelemetryKeys([]); return; }
    fetch(`/api/telemetry/${assetId}/metrics`, { credentials: "include" })
      .then(r => r.ok ? r.json() : []).then(setTelemetryKeys).catch(() => setTelemetryKeys([]));
  }, [assetId]);

  function metaForKey(key: string): { label: string; uom?: string } {
    const m = attrList.find((a: any) => {
      const tag = a.tagName ?? a.sourceMetric ?? ""; if (!tag) return false;
      return tag === key || tag.split(".").slice(1).join(".") === key;
    });
    return m ? { label: m.name, uom: m.uom } : { label: key };
  }

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

  useEffect(() => { setSelectedMetrics([]); }, [assetId]);
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
            timestamp: r.bucket, value: r.avg_val ?? r.max_val ?? r.min_val ?? null, _metric: metric,
          }));
          allRows.push(...aggRows);
        }
      }
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
    setSelectedMetrics((prev) => prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]);
  }
  function exportTelemetryCsv() {
    const metric = selectedMetrics[0];
    const from = rangeHours === -1 && customFrom
      ? new Date(customFrom).toISOString()
      : (rangeHours <= 24 ? subHours(new Date(), rangeHours) : subDays(new Date(), rangeHours / 24)).toISOString();
    const params = new URLSearchParams(metric ? { metric, from } : { from });
    const a = document.createElement("a");
    a.href = `/api/telemetry/${assetId}/export?${params}`; a.download = `telemetry_${assetId}_${Date.now()}.csv`;
    a.click();
  }
  const metricLabelOf = (key: string) => metricOptions.find((o: any) => o.key === key)?.label ?? key;
  const hasData = telemetry.length > 0;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Metrics:</span>
          {metricOptions.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">No numeric attributes found</span>
          ) : metricOptions.map(({ key, label, uom }, i) => (
            <button key={key} onClick={() => toggleMetric(key)}
              className={cn("text-xs px-2 py-0.5 rounded-full border font-medium transition-colors",
                selectedMetrics.includes(key) ? "border-transparent text-white" : "border-border text-muted-foreground hover:bg-muted")}
              style={selectedMetrics.includes(key) ? { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] } : {}}>
              {label}{uom ? ` (${uom})` : ""}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Select value={String(rangeHours)} onValueChange={(v) => setRangeHours(Number(v))}>
            <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Range" /></SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map(({ label, hours }) => <SelectItem key={label} value={String(hours)}>{label}</SelectItem>)}
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

      <div className="rounded-lg border border-border bg-card p-4">
        {loading && telemetry.length === 0 ? (
          <Skeleton className="h-64 w-full" />
        ) : !hasData ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
            <TrendingUp className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">No telemetry data in this time range</p>
            <p className="text-xs mt-1 opacity-60">
              {selectedMetrics.length === 0 ? "Select a metric above to see its trend"
                : `No data for "${selectedMetrics.join(", ")}" in the past ${rangeHours < 24 ? `${rangeHours}h` : `${rangeHours / 24}d`}`}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={telemetry} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} labelStyle={{ fontWeight: 600, marginBottom: 4 }} />
              {selectedMetrics.map((metric, i) => (
                <Line key={metric} type="monotone" dataKey={metric} stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2} dot={telemetry.length < 50} activeDot={{ r: 4 }} connectNulls={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

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
          <RefreshCw className="w-3 h-3" /> Updated {format(lastFetch, "HH:mm:ss")}
        </p>
      )}
    </div>
  );
}

// ── Expression Editor ─────────────────────────────────────────────────────────
export function ExpressionEditor({ control, attrNames }: { control: any; attrNames: string[] }) {
  const [showHint, setShowHint] = useState(false);
  return (
    <div className="space-y-2">
      <FormField control={control} name="expression" render={({ field }: any) => (
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
            <Input placeholder="e.g. (Temperature + Ultrasound) / 2" className="font-mono text-xs" {...field} />
          </FormControl>
          <FormDescription className="text-xs">Use attribute names as variables. Evaluated on every ingest.</FormDescription>
        </FormItem>
      )} />
      {showHint && (
        <div className="rounded-md bg-muted/50 border border-border p-3 space-y-2 text-xs">
          <p className="font-medium">Supported operators &amp; functions</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
            <span><code className="bg-muted px-1 rounded">+ - * /</code> arithmetic</span>
            <span><code className="bg-muted px-1 rounded">^ or **</code> power</span>
            <span><code className="bg-muted px-1 rounded">abs(x)</code> absolute value</span>
            <span><code className="bg-muted px-1 rounded">sqrt(x)</code> square root</span>
            <span><code className="bg-muted px-1 rounded">round(x)</code> round</span>
            <span><code className="bg-muted px-1 rounded">min(a,b) max(a,b)</code></span>
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
        </div>
      )}
    </div>
  );
}

// ── Import preview table ──────────────────────────────────────────────────────
export function ImportPreviewTable({ rows }: { rows: AttrDef[] }) {
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
