import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useListAssets, useListAssetAttributes } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/auth-api";
import { toCsv, downloadCsvText } from "@/lib/csv";
import { useCurrentUser } from "@/contexts/UserContext";
import { useProjectScope } from "@/hooks/useProjectScope";
import { describeApiError, formatApiError } from "@/lib/validation";
import {
  FileText, Download, Play, RefreshCw, Table, BarChart2,
  ClipboardList, AlertTriangle, Blocks, TrendingUp, Activity,
  ShieldAlert, Clock, CheckCircle2, Gauge, Sparkles,
} from "lucide-react";
import { useT } from "@/i18n";
import { format, subHours } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ReportType = "telemetry" | "alarms" | "asset-status" | "alarm-analysis" | "operational-health";
type Persona = "engineer" | "manager" | "executive";

interface ReportMeta {
  type: ReportType;
  generatedAt: string;
  totalRows: number;
  filters: Record<string, string>;
}

interface ReportDef {
  value: ReportType;
  label: string;
  icon: React.ElementType;
  description: string;
  persona: Persona;
  personaLabel: string;
}

const REPORT_TYPES: ReportDef[] = [
  {
    value: "telemetry",
    label: "Telemetry Summary",
    icon: BarChart2,
    description: "Aggregated min / avg / max per metric over the selected time window.",
    persona: "engineer",
    personaLabel: "Engineer",
  },
  {
    value: "alarms",
    label: "Alarm Event Log",
    icon: AlertTriangle,
    description: "All alarm events (active and cleared) within the date range.",
    persona: "engineer",
    personaLabel: "Engineer",
  },
  {
    value: "asset-status",
    label: "Asset Status Snapshot",
    icon: Blocks,
    description: "Current maintenance mode, health, attribute counts for every asset.",
    persona: "engineer",
    personaLabel: "Engineer",
  },
  {
    value: "alarm-analysis",
    label: "Alarm Analysis by Asset",
    icon: ShieldAlert,
    description: "Alarm frequency, severity breakdown, and mean time to resolve per asset — identify problem areas fast.",
    persona: "manager",
    personaLabel: "Manager",
  },
  {
    value: "operational-health",
    label: "Operational Health Report",
    icon: Gauge,
    description: "Health scores, data freshness, uptime estimate, and alarm burden per asset — executive-ready overview.",
    persona: "executive",
    personaLabel: "Executive",
  },
];

const PERSONA_STYLES: Record<Persona, { badge: string; dot: string }> = {
  engineer:  { badge: "bg-blue-100 text-blue-700 border-blue-200",    dot: "bg-blue-500" },
  manager:   { badge: "bg-purple-100 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  executive: { badge: "bg-amber-100 text-amber-700 border-amber-200",  dot: "bg-amber-500" },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#22c55e", info: "#3b82f6",
};

const BUCKETS = [
  { value: "15m", label: "15 minutes" },
  { value: "1h",  label: "1 hour" },
  { value: "6h",  label: "6 hours" },
  { value: "1d",  label: "1 day" },
];

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  downloadCsvText(toCsv(headers, rows.map((r) => headers.map((h) => r[h] ?? ""))), filename);
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

// ── Summary KPI bar ────────────────────────────────────────────────────────────
function SummaryKpis({ rows, type }: { rows: Record<string, unknown>[]; type: ReportType }) {
  if (!rows.length) return null;

  if (type === "telemetry") {
    const avgVals = rows.map((r) => Number(r.avg)).filter((v) => !isNaN(v));
    const overall = avgVals.length ? (avgVals.reduce((s, v) => s + v, 0) / avgVals.length) : 0;
    const maxVal  = Math.max(...rows.map((r) => Number(r.max)).filter((v) => !isNaN(v)));
    const minVal  = Math.min(...rows.map((r) => Number(r.min)).filter((v) => !isNaN(v)));
    const samples = rows.reduce((s, r) => s + Number(r.samples ?? 0), 0);
    return (
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-muted/20 shrink-0">
        {[
          { label: "Avg Value", value: overall.toFixed(3), icon: Activity },
          { label: "Peak Value", value: maxVal.toFixed(3), icon: TrendingUp },
          { label: "Min Value", value: minVal.toFixed(3), icon: Activity },
          { label: "Total Samples", value: samples.toLocaleString(), icon: ClipboardList },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="px-4 py-3 flex items-center gap-3">
            <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-bold tabular-nums">{value}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "alarms") {
    const total    = rows.length;
    const critical = rows.filter((r) => r.severity === "critical").length;
    const cleared  = rows.filter((r) => r.status === "cleared").length;
    const active   = rows.filter((r) => r.status === "active").length;
    return (
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-muted/20 shrink-0">
        {[
          { label: "Total Events",    value: total,    icon: AlertTriangle, danger: false },
          { label: "Critical",        value: critical, icon: ShieldAlert,   danger: critical > 0 },
          { label: "Still Active",    value: active,   icon: AlertTriangle, danger: active > 0 },
          { label: "Cleared",         value: cleared,  icon: CheckCircle2,  danger: false },
        ].map(({ label, value, icon: Icon, danger }) => (
          <div key={label} className="px-4 py-3 flex items-center gap-3">
            <Icon className={`w-4 h-4 shrink-0 ${danger ? "text-red-500" : "text-muted-foreground"}`} />
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-sm font-bold tabular-nums ${danger ? "text-red-600" : ""}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "alarm-analysis") {
    const totalAlarms  = rows.reduce((s, r) => s + Number(r.totalAlarms ?? 0), 0);
    const criticalAssets = rows.filter((r) => Number(r.criticalAlarms ?? 0) > 0).length;
    const avgMttr      = rows.filter((r) => r.avgResolveMins !== "N/A").map((r) => Number(r.avgResolveMins));
    const meanMttr     = avgMttr.length ? avgMttr.reduce((s, v) => s + v, 0) / avgMttr.length : null;
    const worstAsset   = [...rows].sort((a, b) => Number(b.totalAlarms ?? 0) - Number(a.totalAlarms ?? 0))[0];
    return (
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-muted/20 shrink-0">
        {[
          { label: "Total Alarms",      value: totalAlarms.toString(), icon: AlertTriangle },
          { label: "Assets with Critical", value: criticalAssets.toString(), icon: ShieldAlert },
          { label: "Avg Resolution Time", value: meanMttr != null ? `${meanMttr.toFixed(0)} min` : "N/A", icon: Clock },
          { label: "Most Alarms",       value: worstAsset ? String(worstAsset.asset) : "—", icon: Blocks },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="px-4 py-3 flex items-center gap-3">
            <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-bold truncate max-w-[120px]">{value}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "operational-health") {
    const healthy = rows.filter((r) => r.health === "ok").length;
    const inAlarm = rows.filter((r) => r.health === "alarm").length;
    const stale   = rows.filter((r) => r.health === "stale").length;
    const avgFreshness = rows.map((r) => Number(r.freshnessScore)).filter((v) => !isNaN(v));
    const freshnessMean = avgFreshness.length ? avgFreshness.reduce((s, v) => s + v, 0) / avgFreshness.length : 0;
    return (
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-muted/20 shrink-0">
        {[
          { label: "Healthy",          value: `${healthy} assets`,  icon: CheckCircle2, color: "text-green-600" },
          { label: "In Alarm",         value: `${inAlarm} assets`,  icon: AlertTriangle, color: inAlarm > 0 ? "text-red-500" : "text-muted-foreground" },
          { label: "Stale / Offline",  value: `${stale} assets`,   icon: Clock,        color: stale > 0 ? "text-yellow-600" : "text-muted-foreground" },
          { label: "Avg Data Freshness", value: `${freshnessMean.toFixed(0)}%`, icon: Activity, color: "text-muted-foreground" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="px-4 py-3 flex items-center gap-3">
            <Icon className={`w-4 h-4 shrink-0 ${color}`} />
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-sm font-bold ${color}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ── Inline chart for certain report types ──────────────────────────────────────
function InlineChart({ rows, type }: { rows: Record<string, unknown>[]; type: ReportType }) {
  if (type === "alarms" && rows.length > 0) {
    const counts: Record<string, number> = {};
    for (const r of rows) { const s = String(r.severity ?? "info"); counts[s] = (counts[s] ?? 0) + 1; }
    const data = Object.entries(counts).map(([name, count]) => ({ name, count, fill: SEVERITY_COLORS[name] ?? "#94a3b8" }));
    return (
      <div className="border-b border-border bg-card px-4 pt-3 pb-2 shrink-0">
        <p className="text-xs font-medium text-muted-foreground mb-2">Events by Severity</p>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={data} barSize={24}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={24} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} cursor={{ fill: "rgba(0,0,0,0.05)" }} />
            <Bar dataKey="count" radius={[3,3,0,0]}>
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === "operational-health" && rows.length > 0) {
    const counts = { ok: 0, alarm: 0, stale: 0 };
    for (const r of rows) { const h = r.health as keyof typeof counts; if (h in counts) counts[h]++; }
    const data = [
      { name: "Healthy", value: counts.ok,    fill: "#22c55e" },
      { name: "In Alarm", value: counts.alarm, fill: "#ef4444" },
      { name: "Stale",   value: counts.stale, fill: "#eab308" },
    ].filter((d) => d.value > 0);
    if (!data.length) return null;
    return (
      <div className="border-b border-border bg-card px-4 pt-3 pb-2 shrink-0">
        <p className="text-xs font-medium text-muted-foreground mb-1">Health Distribution</p>
        <ResponsiveContainer width="100%" height={90}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={35} innerRadius={18}>
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === "alarm-analysis" && rows.length > 0) {
    const top = [...rows].sort((a, b) => Number(b.totalAlarms ?? 0) - Number(a.totalAlarms ?? 0)).slice(0, 8);
    return (
      <div className="border-b border-border bg-card px-4 pt-3 pb-2 shrink-0">
        <p className="text-xs font-medium text-muted-foreground mb-2">Alarm Count by Asset (top 8)</p>
        <ResponsiveContainer width="100%" height={90}>
          <BarChart data={top} barSize={20} layout="vertical">
            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis dataKey="asset" type="category" tick={{ fontSize: 9 }} width={80} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} cursor={{ fill: "rgba(0,0,0,0.05)" }} />
            <Bar dataKey="totalAlarms" fill="#f97316" radius={[0,3,3,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return null;
}

// ── Main Reports page ──────────────────────────────────────────────────────────
/**
 * GET a report source and return its JSON body, or throw with the server's own
 * error message. An error body (403 project restriction, 400 validation) must
 * never be read as data — that is how a refused report used to render as an
 * empty success.
 */
async function getReportJson<T>(path: string): Promise<T> {
  const r = await apiFetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(formatApiError(await describeApiError(r)));
  return (await r.json()) as T;
}

export default function Reports() {
  const { toast } = useToast();
  const [reportType, setReportType] = useState<ReportType>("telemetry");
  const [assetId,  setAssetId]      = useState("all");
  const [metric,   setMetric]       = useState("all");
  const [bucket,   setBucket]       = useState("1h");
  const [severity, setSeverity]     = useState("all");
  const [fromDate, setFromDate]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 16);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [loading, setLoading] = useState(false);
  const [rows,    setRows]    = useState<Record<string, unknown>[] | null>(null);
  const [meta,    setMeta]    = useState<ReportMeta | null>(null);

  const { data: assets }     = useListAssets();
  const { data: attributes } = useListAssetAttributes(assetId !== "all" ? assetId : "", {
    query: { enabled: assetId !== "all", queryKey: ["report-attrs", assetId] },
  });

  const { session, canModule } = useCurrentUser();
  const { inScope } = useProjectScope();
  const t = useT();
  const [, navigate] = useLocation();
  // Opens AI Advisor -> AI Reports with this page's asset and period.
  const canAiReport = canModule("ai_advisor") && !session?.restrictProjects;
  function openAiSummary() {
    const p = new URLSearchParams();
    if (assetId !== "all") p.set("assetId", assetId);
    const from = new Date(fromDate), to = new Date(toDate);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) { p.set("from", from.toISOString()); p.set("to", to.toISOString()); }
    navigate(`/ai-reports?${p}`);
  }
  // A project-restricted user is refused plant-wide figures, so their telemetry
  // report always names one asset instead of offering "All assets".
  const singleAssetOnly = !!session?.restrictProjects;
  // Only the open project's assets.
  const assetList   = ((assets as any[] | undefined) ?? []).filter((a: any) => inScope(a.id, { strict: true }));
  useEffect(() => {
    if (singleAssetOnly && assetId === "all" && assetList.length > 0) setAssetId(assetList[0].id);
  }, [singleAssetOnly, assetId, assetList]);
  const attrList    = (attributes as any[] | undefined) ?? [];
  const metricKeyOf = (a: any) => a.sourceMetric?.split(".").pop() ?? a.tagName?.split(".").pop() ?? a.name;
  const metricAttrs = attrList.filter((a: any) => metricKeyOf(a));
  const selectedAssetName = assetList.find((a: any) => a.id === assetId)?.name ?? "All Assets";

  const currentDef = REPORT_TYPES.find((r) => r.value === reportType)!;

  async function generate() {
    setLoading(true); setRows(null); setMeta(null);
    try {
      const from = new Date(fromDate).toISOString();
      const to   = new Date(toDate).toISOString();

      // ── Telemetry Summary ─────────────────────────────────────────────
      if (reportType === "telemetry") {
        const params = new URLSearchParams({ from, to, bucket, limit: "5000" });
        if (assetId !== "all") params.set("assetId", assetId);
        if (metric !== "all")  params.set("metric", metric);
        const json = await getReportJson<{ data?: any[] }>(`/api/system/aggregate?${params}`);
        const data: Record<string, unknown>[] = (json.data ?? []).filter((row: any) => inScope(row.asset_id, { strict: true })).map((row: any) => ({
          bucket: row.bucket ? format(new Date(row.bucket), "yyyy-MM-dd HH:mm") : "",
          asset_id: row.asset_id, metric: row.metric,
          avg: Number(row.avg_val ?? 0).toFixed(4),
          min: Number(row.min_val ?? 0).toFixed(4),
          max: Number(row.max_val ?? 0).toFixed(4),
          samples: row.count,
        }));
        setRows(data);
        setMeta({ type: "telemetry", generatedAt: new Date().toISOString(), totalRows: data.length,
          filters: { asset: selectedAssetName, metric: metric === "all" ? "All" : metric, bucket, from, to } });

      // ── Alarm Event Log ───────────────────────────────────────────────
      } else if (reportType === "alarms") {
        const params = new URLSearchParams({ limit: "5000" });
        if (severity !== "all") params.set("severity", severity);
        const allRows = (await getReportJson<any[]>(`/api/alarms?${params}`)).filter((row: any) => inScope(row.assetId, { strict: true }));
        const filtered = allRows.filter((row: any) => {
          const ts = new Date(row.triggeredAt ?? "").getTime();
          return ts >= new Date(from).getTime() && ts <= new Date(to).getTime();
        });
        const data: Record<string, unknown>[] = filtered.map((row: any) => ({
          id: row.id, asset: row.assetName, name: row.name, severity: row.severity,
          status: row.status, alarmClass: row.alarmClass ?? "", message: row.message ?? "",
          triggeredAt: row.triggeredAt ? format(new Date(row.triggeredAt), "yyyy-MM-dd HH:mm:ss") : "",
          clearedAt:   row.clearedAt   ? format(new Date(row.clearedAt),   "yyyy-MM-dd HH:mm:ss") : "",
        }));
        setRows(data);
        setMeta({ type: "alarms", generatedAt: new Date().toISOString(), totalRows: data.length,
          filters: { severity: severity === "all" ? "All" : severity, from, to } });

      // ── Asset Status ──────────────────────────────────────────────────
      } else if (reportType === "asset-status") {
        const allAssets = (await getReportJson<any[]>("/api/assets")).filter((a: any) => inScope(a.id, { strict: true }));
        const data: Record<string, unknown>[] = allAssets.map((a: any) => ({
          id: a.id, name: a.name, identifier: a.identifier,
          attributes: a.attributeCount, children: a.childCount,
          maintenance: a.maintenanceMode ? "Yes" : "No",
          maintenanceSince: a.maintenanceSince ? format(new Date(a.maintenanceSince), "yyyy-MM-dd HH:mm") : "",
          maintenanceNote: a.maintenanceNote ?? "",
          updatedAt: format(new Date(a.updatedAt), "yyyy-MM-dd HH:mm"),
        }));
        setRows(data);
        setMeta({ type: "asset-status", generatedAt: new Date().toISOString(), totalRows: data.length,
          filters: { scope: "All Assets" } });

      // ── Alarm Analysis by Asset (Manager) ─────────────────────────────
      } else if (reportType === "alarm-analysis") {
        const [activeAlarms, historyData] = (await Promise.all([
          getReportJson<any[]>("/api/alarms?limit=5000"),
          getReportJson<any[]>("/api/alarms/history?limit=5000"),
        ])).map((list) => list.filter((row: any) => inScope(row.assetId, { strict: true })));

        // Filter history to date range
        const filtered = historyData.filter((row: any) => {
          const ts = new Date(row.triggeredAt ?? "").getTime();
          return ts >= new Date(from).getTime() && ts <= new Date(to).getTime();
        });

        // Aggregate per asset
        const assetMap: Record<string, {
          name: string; total: number; critical: number; high: number; medium: number;
          low: number; cleared: number; resolveTimes: number[];
        }> = {};

        for (const row of filtered) {
          const key = row.assetName ?? row.assetId ?? "Unknown";
          if (!assetMap[key]) {
            assetMap[key] = { name: key, total: 0, critical: 0, high: 0, medium: 0, low: 0, cleared: 0, resolveTimes: [] };
          }
          const entry = assetMap[key];
          entry.total++;
          if (row.severity === "critical") entry.critical++;
          else if (row.severity === "high")   entry.high++;
          else if (row.severity === "medium") entry.medium++;
          else if (row.severity === "low")    entry.low++;
          if (row.status === "cleared" && row.triggeredAt && row.clearedAt) {
            const diff = (new Date(row.clearedAt).getTime() - new Date(row.triggeredAt).getTime()) / 60000;
            if (diff > 0) entry.resolveTimes.push(diff);
            entry.cleared++;
          }
        }

        // Also add currently active alarms
        for (const alarm of activeAlarms) {
          const key = alarm.assetName ?? "Unknown";
          if (!assetMap[key]) {
            assetMap[key] = { name: key, total: 0, critical: 0, high: 0, medium: 0, low: 0, cleared: 0, resolveTimes: [] };
          }
        }

        const data: Record<string, unknown>[] = Object.values(assetMap)
          .sort((a, b) => b.total - a.total)
          .map((e) => ({
            asset: e.name,
            totalAlarms: e.total,
            criticalAlarms: e.critical,
            highAlarms: e.high,
            mediumAlarms: e.medium,
            lowAlarms: e.low,
            clearedAlarms: e.cleared,
            activeAlarms: activeAlarms.filter((a) => a.assetName === e.name && a.status === "active").length,
            avgResolveMins: e.resolveTimes.length
              ? (e.resolveTimes.reduce((s, v) => s + v, 0) / e.resolveTimes.length).toFixed(0)
              : "N/A",
          }));

        setRows(data);
        setMeta({ type: "alarm-analysis", generatedAt: new Date().toISOString(), totalRows: data.length,
          filters: { period: `${from} → ${to}`, scope: "All Assets" } });

      // ── Operational Health (Executive) ────────────────────────────────
      } else if (reportType === "operational-health") {
        const allAssets = (await getReportJson<any[]>("/api/assets")).filter((a: any) => inScope(a.id, { strict: true }));

        // A failed health fetch rejects, so that asset reads as Unknown below
        // rather than borrowing an error body as its health.
        const healthResults = await Promise.allSettled(
          allAssets.map((a: any) => getReportJson<any>(`/api/assets/${a.id}/health`))
        );

        const data: Record<string, unknown>[] = allAssets.map((asset: any, idx: number) => {
          const h = healthResults[idx].status === "fulfilled" ? (healthResults[idx] as any).value : null;
          const freshnessScore = h?.freshnessPct ?? 0;
          const activeAlarms   = h?.activeAlarms ?? 0;
          const health         = h?.health ?? "unknown";

          // Only a positive "ok" from the server counts as Healthy; a failed or
          // unrecognised health result is Unknown, not green.
          let status = "Unknown";
          if (health === "ok") status = "Healthy";
          else if (health === "alarm") status = "In Alarm";
          else if (health === "stale") status = "Stale / Offline";

          return {
            asset: asset.name,
            identifier: asset.identifier ?? "",
            status,
            health,
            freshnessScore,
            activeAlarms,
            lastSeen: h?.lastSeen ? format(new Date(h.lastSeen), "yyyy-MM-dd HH:mm") : "Never",
            maintenance: asset.maintenanceMode ? "Yes" : "No",
            attributes: h?.totalAttributes ?? 0,
            note: asset.maintenanceMode ? (asset.maintenanceNote ?? "In maintenance") : "",
          };
        });

        setRows(data);
        setMeta({ type: "operational-health", generatedAt: new Date().toISOString(), totalRows: data.length,
          filters: { scope: "All Assets", generatedAt: format(new Date(), "yyyy-MM-dd HH:mm") } });
      }
    } catch (err) {
      setRows(null); setMeta(null);
      toast({
        title: "Could not generate report",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally { setLoading(false); }
  }

  const filenameBase = `ws-report-${reportType}-${format(new Date(), "yyyyMMdd-HHmm")}`;
  const previewRows  = (rows ?? []).slice(0, 100);
  const headers      = previewRows.length > 0 ? Object.keys(previewRows[0]) : [];

  // Color row in operational-health by health
  function rowClass(row: Record<string, unknown>, idx: number): string {
    if (reportType === "operational-health") {
      if (row.health === "alarm") return "bg-red-50/60 dark:bg-red-950/20";
      if (row.health === "stale") return "bg-yellow-50/60 dark:bg-yellow-950/20";
      if (row.health === "ok")    return "bg-green-50/30 dark:bg-green-950/10";
    }
    if (reportType === "alarms") {
      if (row.severity === "critical") return "bg-red-50/60 dark:bg-red-950/20";
      if (row.severity === "high")     return "bg-orange-50/40";
    }
    return idx % 2 === 0 ? "bg-card" : "bg-muted/20";
  }

  const byPersona = (p: Persona) => REPORT_TYPES.filter((r) => r.persona === p);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border bg-card flex items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" /> Reports
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Role-appropriate reports for engineers, managers, and executives
          </p>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Config panel */}
        <div className="w-72 shrink-0 border-r border-border overflow-y-auto p-4 space-y-5 bg-muted/20">

          {/* Report type — grouped by persona */}
          <div className="space-y-3">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Report Type</Label>

            {(["engineer", "manager", "executive"] as Persona[]).map((persona) => (
              <div key={persona} className="space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${PERSONA_STYLES[persona].badge}`}>
                    {persona}
                  </span>
                </div>
                {byPersona(persona).map((rt) => (
                  <button key={rt.value}
                    onClick={() => { setReportType(rt.value); setRows(null); setMeta(null); }}
                    className={`w-full text-left rounded-md border px-3 py-2.5 transition-colors ${
                      reportType === rt.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
                    }`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <rt.icon className={`w-3.5 h-3.5 ${reportType === rt.value ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-xs font-medium">{rt.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-tight pl-5">{rt.description}</p>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <Separator />

          {/* Date range */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date Range</Label>
            <div className="space-y-1.5">
              <div>
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input type="datetime-local" className="h-8 text-xs mt-0.5" value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input type="datetime-local" className="h-8 text-xs mt-0.5" value={toDate}
                  onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {[{ label: "Last 1h", hours: 1 }, { label: "Last 24h", hours: 24 },
                { label: "Last 7d", hours: 168 }, { label: "Last 30d", hours: 720 }].map((q) => (
                <button key={q.label}
                  className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted/60 transition-colors"
                  onClick={() => {
                    const now = new Date();
                    setToDate(now.toISOString().slice(0, 16));
                    setFromDate(subHours(now, q.hours).toISOString().slice(0, 16));
                  }}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Telemetry-specific filters */}
          {reportType === "telemetry" && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</Label>
                <div>
                  <Label className="text-xs text-muted-foreground">Asset</Label>
                  <Select value={assetId} onValueChange={(v) => { setAssetId(v); setMetric("all"); }}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="All assets" /></SelectTrigger>
                    <SelectContent>
                      {!singleAssetOnly && <SelectItem value="all" className="text-xs">All assets</SelectItem>}
                      {assetList.map((a: any) => <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Metric</Label>
                  <Select value={metric} onValueChange={setMetric} disabled={assetId === "all"}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="All metrics" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All metrics</SelectItem>
                      {metricAttrs.map((a: any) => <SelectItem key={metricKeyOf(a)} value={metricKeyOf(a)} className="text-xs">{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Aggregation Bucket</Label>
                  <Select value={bucket} onValueChange={setBucket}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUCKETS.map((b) => <SelectItem key={b.value} value={b.value} className="text-xs">{b.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {/* Alarm-specific filters */}
          {(reportType === "alarms") && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</Label>
                <div>
                  <Label className="text-xs text-muted-foreground">Severity</Label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All severities</SelectItem>
                      {["critical","high","medium","low","info"].map((s) => (
                        <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          <Separator />

          <Button className="w-full gap-2" onClick={generate} disabled={loading}>
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {loading ? "Generating…" : "Generate Report"}
          </Button>
          {canAiReport && (
            <Button variant="outline" className="w-full gap-2" onClick={openAiSummary} title={t("Open AI Reports for the same asset and period")}>
              <Sparkles className="w-3.5 h-3.5 text-primary" /> {t("Generate AI summary")}
            </Button>
          )}
        </div>

        {/* Result panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!rows && !loading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-sm">
                <currentDef.icon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">{currentDef.label}</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">{currentDef.description}</p>
                <div className="flex items-center justify-center gap-2">
                  <Badge variant="outline" className={`text-xs ${PERSONA_STYLES[currentDef.persona].badge}`}>
                    For {currentDef.personaLabel}s
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-4">Configure the date range, then click Generate.</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Generating report…</p>
                {reportType === "operational-health" && (
                  <p className="text-xs text-muted-foreground mt-1">Fetching health scores for all assets…</p>
                )}
              </div>
            </div>
          )}

          {rows && meta && (
            <>
              {/* Toolbar */}
              <div className="shrink-0 px-4 py-2.5 border-b border-border bg-card flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div>
                    <span className="text-xs font-medium">{REPORT_TYPES.find((r) => r.value === meta.type)?.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">{meta.totalRows.toLocaleString()} rows</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {Object.entries(meta.filters).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {k}: {String(v).slice(0, 30)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    {format(new Date(meta.generatedAt), "HH:mm:ss")}
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => downloadCsv(rows, `${filenameBase}.csv`)}>
                    <Download className="w-3 h-3" /> CSV
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => downloadJson(rows, `${filenameBase}.json`)}>
                    <Download className="w-3 h-3" /> JSON
                  </Button>
                </div>
              </div>

              {/* Summary KPIs */}
              <SummaryKpis rows={rows} type={meta.type} />

              {/* Inline chart */}
              <InlineChart rows={rows} type={meta.type} />

              {/* Table */}
              <div className="flex-1 overflow-auto">
                {previewRows.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Table className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No data found for the selected filters.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <table className="w-full text-xs min-w-max">
                      <thead className="bg-muted/50 sticky top-0 z-10">
                        <tr>
                          {headers.map((h) => (
                            <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap border-b border-border">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} className={rowClass(row, i)}>
                            {headers.map((h) => {
                              const val = String(row[h] ?? "");
                              // Severity badge
                              if (h === "severity" && val) {
                                const sty = SEVERITY_COLORS[val];
                                return (
                                  <td key={h} className="px-3 py-1.5 whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1 text-xs font-medium capitalize">
                                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sty ?? "#94a3b8" }} />
                                      {val}
                                    </span>
                                  </td>
                                );
                              }
                              // Status badge
                              if (h === "status" && val) {
                                const color = val === "active" ? "text-red-600" : val === "acknowledged" ? "text-orange-600" : val === "Unknown" ? "text-muted-foreground" : "text-green-600";
                                return <td key={h} className={`px-3 py-1.5 whitespace-nowrap font-medium ${color}`}>{val}</td>;
                              }
                              if (h === "health" && val) {
                                const color = val === "ok" ? "text-green-600" : val === "alarm" ? "text-red-600" : val === "stale" ? "text-yellow-600" : "text-muted-foreground";
                                return <td key={h} className={`px-3 py-1.5 whitespace-nowrap font-medium capitalize ${color}`}>{val}</td>;
                              }
                              return (
                                <td key={h} className="px-3 py-1.5 whitespace-nowrap tabular-nums max-w-[200px] truncate">
                                  {val}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 100 && (
                      <p className="text-xs text-muted-foreground p-3 border-t border-border">
                        Showing first 100 of {rows.length.toLocaleString()} rows. Download CSV/JSON for the full dataset.
                      </p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
