import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  useListAssets, useListAssetAttributes,
  useCreateAsset, useUpdateAsset, useDeleteAsset,
  getListAssetsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWsEvents } from "@/hooks/useWsEvents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ScatterChart, Scatter, ReferenceLine,
} from "recharts";
import {
  Plus, Trash2, RefreshCw, Settings2, TrendingUp, TrendingDown,
  Minus, Activity, LayoutDashboard, ChevronRight, ChevronDown,
  Folder, FolderOpen, Blocks, PanelLeftOpen, PanelLeftClose,
  BarChart2, PieChart as PieIcon, Zap, Layers, Clock, Maximize2, Minimize2,
  RotateCcw, Edit2, Copy, Shield, MoreVertical, BookOpen, Gauge,
  Clipboard, ClipboardPaste, FolderPlus, CalendarDays, GripVertical,
} from "lucide-react";
import { format, subMinutes, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASHBOARDS_KEY = "ws-dashboards-v1";

// ── Dark theme palette ─────────────────────────────────────────────────────────
const D = {
  bg:      "#0b0f1a", panel:   "#111827", card:    "#161e2e",
  border:  "#1f2d45", border2: "#2d3f5a", text:    "#e2e8f0",
  muted:   "#64748b", accent:  "#06b6d4", accent2: "#818cf8",
  green:   "#10b981", amber:   "#f59e0b", red:     "#ef4444",
  purple:  "#a855f7", pink:    "#ec4899", orange:  "#f97316",
};

const NEON_PALETTE = [
  "#06b6d4","#10b981","#a855f7","#f59e0b",
  "#ef4444","#818cf8","#ec4899","#f97316",
  "#22d3ee","#84cc16","#fb923c","#e879f9",
];

// ── SPC control-limit helpers (module-level so React never remounts inputs) ────
const SPC_PALETTE = ["#f59e0b","#ef4444","#10b981","#3b82f6","#a855f7","#f97316","#e2e8f0"];

function StyleBtn({ active, color, dash, onClick }: { active: boolean; color: string; dash: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-all"
      style={{ background: active ? `${color}22` : "transparent", border: `1px solid ${active ? color : D.border2}`, color: active ? color : D.muted }}>
      {dash ? (
        <svg width="26" height="4"><line x1="0" y1="2" x2="26" y2="2" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
      ) : (
        <svg width="26" height="4"><line x1="0" y1="2" x2="26" y2="2" stroke="currentColor" strokeWidth="1.5" /></svg>
      )}
    </button>
  );
}

function SpcRow({ label, val, setVal, col, setCol, sty, setSty }: {
  label: string; val: string; setVal: (v: string) => void;
  col: string; setCol: (c: string) => void;
  sty: "solid" | "dashed"; setSty: (s: "solid" | "dashed") => void;
}) {
  return (
    <div className="rounded-md p-2.5 space-y-2" style={{ background: D.panel, border: `1px solid ${D.border2}` }}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium w-10 shrink-0" style={{ color: col }}>{label}</span>
        <input
          type="number"
          value={val}
          onChange={e => setVal(e.target.value)}
          placeholder=""
          className="h-7 text-xs flex-1 rounded border px-2 outline-none"
          style={{ background: "#ffffff", color: "#111827", borderColor: D.border2 }}
        />
        {val.trim() !== "" && (
          <button type="button" onClick={() => setVal("")}
            className="shrink-0 text-[11px] hover:opacity-100 opacity-40 transition-opacity"
            style={{ color: D.muted }}>✕</button>
        )}
      </div>
      {val.trim() !== "" && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] w-10 shrink-0" style={{ color: D.muted }}>Color</span>
            {SPC_PALETTE.map(c => (
              <button type="button" key={c} onClick={() => setCol(c)}
                className="w-4 h-4 rounded-full border-2 transition-all shrink-0"
                style={{ background: c, borderColor: col === c ? "#fff" : "transparent", transform: col === c ? "scale(1.25)" : "scale(1)" }} />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] w-10 shrink-0" style={{ color: D.muted }}>Style</span>
            <StyleBtn active={sty === "dashed"} color={col} dash onClick={() => setSty("dashed")} />
            <StyleBtn active={sty === "solid"}  color={col} dash={false} onClick={() => setSty("solid")} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Time ranges ────────────────────────────────────────────────────────────────
const REFRESH_INTERVALS = [
  { label: "1 s",   ms: 1_000 },
  { label: "2 s",   ms: 2_000 },
  { label: "20 s",  ms: 20_000 },
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 300_000 },
  { label: "15 min",ms: 900_000 },
  { label: "30 min",ms: 1_800_000 },
  { label: "1 hr",  ms: 3_600_000 },
  { label: "3 hr",  ms: 10_800_000 },
  { label: "6 hr",  ms: 21_600_000 },
  { label: "12 hr", ms: 43_200_000 },
  { label: "1 day", ms: 86_400_000 },
];

const GRANULARITY_OPTS = [
  { label: "Auto",  value: "auto" },
  { label: "1 min", value: "1m" },
  { label: "5 min", value: "5m" },
  { label: "15 min",value: "15m" },
  { label: "30 min",value: "30m" },
  { label: "1 hr",  value: "1h" },
  { label: "6 hr",  value: "6h" },
  { label: "12 hr", value: "12h" },
  { label: "1 day", value: "1d" },
  { label: "1 wk",  value: "1w" },
];

const AGG_TYPE_OPTS = [
  { label: "Average", value: "avg" },
  { label: "Sum",     value: "sum" },
  { label: "Min",     value: "min" },
  { label: "Max",     value: "max" },
  { label: "Count",   value: "count" },
];

const GRANULARITY_STEP_MAP: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "6h": "6h", "12h": "12h", "1d": "1d", "1w": "1w",
};

const RANGES = [
  { label: "Last 1 min",    minutes: 1 },
  { label: "Last 5 min",    minutes: 5 },
  { label: "Last 15 min",   minutes: 15 },
  { label: "Last 30 min",   minutes: 30 },
  { label: "Last 1 hour",   minutes: 60 },
  { label: "Last 6 hours",  minutes: 360 },
  { label: "Last 12 hours", minutes: 720 },
  { label: "Last 24 hours", minutes: 1440 },
  { label: "Last 3 days",   minutes: 4320 },
  { label: "Last 7 days",   minutes: 10080 },
  { label: "Last 30 days",  minutes: 43200 },
  { label: "Custom range",  minutes: -1 },
  { label: "WTD",           minutes: -2 },
  { label: "MTD",           minutes: -3 },
  { label: "YTD",           minutes: -4 },
];

// ── Widget types ───────────────────────────────────────────────────────────────
type ChartType = "line" | "area" | "bar" | "stackbar" | "kpi" | "gauge" | "pie" | "donut" | "scatter" | "heatmap" | "statetimeline";
const CHART_TYPE_OPTS: { value: ChartType; label: string; supportsOverlay: boolean }[] = [
  { value: "line",          label: "Line Chart",      supportsOverlay: true },
  { value: "area",          label: "Area Chart",      supportsOverlay: true },
  { value: "bar",           label: "Bar Chart",       supportsOverlay: true },
  { value: "stackbar",      label: "Stack Bar Chart", supportsOverlay: true },
  { value: "kpi",           label: "KPI Card",        supportsOverlay: false },
  { value: "gauge",         label: "Gauge Meter",     supportsOverlay: false },
  { value: "pie",           label: "Pie Chart",       supportsOverlay: false },
  { value: "donut",         label: "Donut Chart",     supportsOverlay: false },
  { value: "scatter",       label: "Scatter Plot",    supportsOverlay: false },
  { value: "heatmap",       label: "Hour Heatmap",    supportsOverlay: false },
  { value: "statetimeline", label: "State Timeline",  supportsOverlay: false },
];

// ── Roles ──────────────────────────────────────────────────────────────────────
const ALL_ROLES = ["admin", "engineer", "operator", "viewer"] as const;
type Role = typeof ALL_ROLES[number];
const ROLE_COLORS: Record<Role, string> = { admin: "#a855f7", engineer: "#06b6d4", operator: "#10b981", viewer: "#64748b" };

// ── Data model ─────────────────────────────────────────────────────────────────
interface OverlayMetric { assetId: string; assetName: string; metric: string; color: string; label?: string; uom?: string; }
interface Widget {
  id: string; title: string; chartType: ChartType;
  assetId: string; assetName: string; metric: string;
  rangeMinutes: number; color: string;
  minVal?: number; maxVal?: number; unit?: string;
  customFrom?: string; customTo?: string;
  width?: number; height?: number;
  ucl?: number; lcl?: number; centerLine?: number;
  uclColor?: string; lclColor?: string; clColor?: string;
  uclStyle?: "solid" | "dashed"; lclStyle?: "solid" | "dashed"; clStyle?: "solid" | "dashed";
  overlayMetrics?: OverlayMetric[];
  aggType?: "avg" | "sum" | "min" | "max" | "count";
  granularity?: string;
  interpolated?: boolean;
  refreshEnabled?: boolean;
  refreshInterval?: number;
  allowOverride?: boolean;
  imageUrl?: string;
  imageMode?: "background" | "icon";
  label?: string;
  uom?: string;
}
interface Dashboard {
  id: string; name: string; description?: string;
  roleAccess: Role[]; widgets: Widget[]; createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtTs(ts: string, rangeMinutes: number): string {
  const d = parseISO(ts);
  if (rangeMinutes <= 60)   return format(d, "HH:mm:ss");
  if (rangeMinutes <= 1440) return format(d, "HH:mm");
  return format(d, "MM/dd HH:mm");
}
function getFrom(w: Widget): string {
  if (w.customFrom) return new Date(w.customFrom).toISOString();
  if (w.rangeMinutes === -2) {
    // WTD — start of current week (Monday)
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.getFullYear(), d.getMonth(), diff).toISOString();
  }
  if (w.rangeMinutes === -3) {
    // MTD — start of current month
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  }
  if (w.rangeMinutes === -4) {
    // YTD — start of current year
    return new Date(new Date().getFullYear(), 0, 1).toISOString();
  }
  return subMinutes(new Date(), w.rangeMinutes > 0 ? w.rangeMinutes : 60).toISOString();
}
function getTo(w: Widget) { return w.customTo ? new Date(w.customTo).toISOString() : new Date().toISOString(); }
function rangeLabelOf(w: Widget) {
  if (w.customFrom && w.customTo)
    return `${format(new Date(w.customFrom), "MM/dd HH:mm")} → ${format(new Date(w.customTo), "MM/dd HH:mm")}`;
  if (w.rangeMinutes === -2) return "WTD";
  if (w.rangeMinutes === -3) return "MTD";
  if (w.rangeMinutes === -4) return "YTD";
  return RANGES.find(r => r.minutes === w.rangeMinutes)?.label ?? `${w.rangeMinutes}m`;
}
function supportsOverlay(ct: ChartType) { return CHART_TYPE_OPTS.find(o => o.value === ct)?.supportsOverlay ?? false; }

function pickDefaultMetric(attrs: any[]) {
  const usable = attrs.filter((a: any) => metricKeyOf(a));
  const first = usable[0];
  return first ? metricKeyOf(first) : "";
}
function metricKeyOf(a: any) {
  return a.tagName?.trim() || a.sourceMetric?.trim() || a.name;
}
function metricValueOf(a: any) {
  return a.tagName?.trim() || a.sourceMetric?.trim() || a.name;
}
// Fill missing time buckets with 0 between the first and last data points
function gapFill(rows: { timestamp: string; value: number | null }[], bucket: string) {
  const STEP: Record<string, number> = {
    "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "6h": 21_600_000, "12h": 43_200_000, "1d": 86_400_000, "1w": 604_800_000,
  };
  const step = STEP[bucket];
  if (!step || rows.length < 2) return rows.map(r => ({ ...r, value: r.value ?? 0 }));
  const sorted = [...rows].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  const map = new Map(sorted.map(r => [Math.round(+new Date(r.timestamp) / step), r.value]));
  const first = Math.round(+new Date(sorted[0].timestamp) / step);
  const last  = Math.round(+new Date(sorted[sorted.length - 1].timestamp) / step);
  const result: { timestamp: string; value: number }[] = [];
  for (let i = first; i <= last; i++) {
    const val = map.get(i);
    result.push({ timestamp: new Date(i * step).toISOString(), value: val ?? 0 });
  }
  return result;
}

function widgetSeriesKeys(widget: Widget) {
  const keys = [
    widget.metric,
    widget.metric?.split(".").pop(),
    widget.assetId && widget.metric ? `${widget.assetId}::${widget.metric}` : "",
  ].filter(Boolean) as string[];
  return [...new Set(keys)];
}
function seriesMatchesMetric(rowMetric: string | undefined, widgetMetric: string) {
  if (!rowMetric) return false;
  const a = rowMetric.split(".").pop();
  const b = widgetMetric.split(".").pop();
  return rowMetric === widgetMetric || a === widgetMetric || rowMetric === b || a === b;
}
function getWidgetRows(widget: Widget, data: Record<string, any[]>) {
  for (const key of widgetSeriesKeys(widget)) {
    if (data[key]?.length) return data[key];
  }
  const allRows = Object.values(data).flat();
  if (allRows.length) {
    const matched = allRows.filter((row: any) => seriesMatchesMetric(row?.metric ?? row?.name ?? row?.tagName, widget.metric));
    if (matched.length) return matched;
    return allRows;
  }
  return data[widget.metric] ?? [];
}

const darkAxis    = { stroke: D.muted, fontSize: 10, tickLine: false, axisLine: false };
const darkGrid    = { strokeDasharray: "3 3", stroke: D.border2, vertical: false };
const darkTooltip = {
  contentStyle: { background: D.card, border: `1px solid ${D.border2}`, borderRadius: 6, fontSize: 11, padding: "4px 10px", color: D.text },
  labelStyle: { color: D.muted, fontSize: 10 }, cursor: { stroke: D.border2 },
};
function EmptyState() {
  return <div className="flex items-center justify-center h-full"><p style={{ fontSize: 11, color: D.muted }}>No data in range</p></div>;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Chart sub-widgets (unchanged logic) ───────────────────────────────────────
function GaugeWidget({ widget, data }: { widget: Widget; data: Record<string, any[]> }) {
  const rows   = getWidgetRows(widget, data);
  const latest = rows.length > 0 ? Number(rows[rows.length - 1]?.value) : null;
  const min = widget.minVal ?? 0, max = widget.maxVal ?? 100;
  const pct = latest !== null ? Math.min(1, Math.max(0, (latest - min) / (max - min))) : 0;
  const cx = 90, cy = 92, R = 68;
  const startA = Math.PI * 1.15, endA = Math.PI * 1.85, sweep = endA - startA;
  const arc = (a: number) => ({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  const a1 = arc(startA), a2 = arc(endA), av = arc(startA + sweep * pct);
  const nX = cx + (R - 12) * Math.cos(startA + sweep * pct), nY = cy + (R - 12) * Math.sin(startA + sweep * pct);
  const zones = [{ f: 0, t: 0.33, c: D.green }, { f: 0.33, t: 0.66, c: D.amber }, { f: 0.66, t: 1, c: D.red }];
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <svg width={180} height={105} viewBox="0 0 180 105">
        <path d={`M ${a1.x} ${a1.y} A ${R} ${R} 0 1 1 ${a2.x} ${a2.y}`} stroke={D.border2} strokeWidth={12} fill="none" strokeLinecap="round" />
        {zones.map((z, i) => { const p1 = arc(startA + sweep * z.f), p2 = arc(startA + sweep * z.t); return (
          <path key={i} d={`M ${p1.x} ${p1.y} A ${R} ${R} 0 ${(sweep*(z.t-z.f))>Math.PI?1:0} 1 ${p2.x} ${p2.y}`}
            stroke={z.c} strokeWidth={8} fill="none" strokeLinecap="round" opacity={0.3} />); })}
        {latest !== null && pct > 0.01 && (
          <path d={`M ${a1.x} ${a1.y} A ${R} ${R} 0 ${(sweep*pct)>Math.PI?1:0} 1 ${av.x} ${av.y}`}
            stroke={widget.color} strokeWidth={10} fill="none" strokeLinecap="round" />)}
        {latest !== null && <line x1={cx} y1={cy} x2={nX} y2={nY} stroke={D.text} strokeWidth={2} strokeLinecap="round" />}
        <circle cx={cx} cy={cy} r={4} fill={D.text} />
        <text x={a1.x-2} y={a1.y+4} fill={D.muted} fontSize={9} textAnchor="end">{min}</text>
        <text x={a2.x+2} y={a2.y+4} fill={D.muted} fontSize={9} textAnchor="start">{max}</text>
        <text x={cx} y={cy-16} fill={D.text} fontSize={18} fontWeight={700} textAnchor="middle">
          {latest !== null ? latest.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</text>
        {widget.unit && <text x={cx} y={cy-3} fill={D.muted} fontSize={9} textAnchor="middle">{widget.unit}</text>}
      </svg>
    </div>
  );
}

function KpiWidget({ widget, data }: { widget: Widget; data: Record<string, any[]> }) {
  const rows   = [...getWidgetRows(widget, data)].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const latest = rows[0], prev = rows[1];
  const val = latest ? Number(latest.value) : null, prevV = prev ? Number(prev.value) : null;
  const delta = val !== null && prevV !== null ? val - prevV : null;
  const pct   = delta !== null && prevV !== null && prevV !== 0 ? (delta / prevV) * 100 : null;
  const TIcon = delta === null ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const tc    = delta === null ? D.muted : delta > 0 ? D.green : D.red;
  const spark = rows.slice(0, 20).reverse().map((r, i) => ({ i, v: Number(r.value) }));
  return (
    <div className="flex flex-col h-full p-2 gap-1">
      <div className="flex items-end justify-between gap-2 flex-1">
        <div>
          <div className="text-3xl font-bold tabular-nums" style={{ color: widget.color }}>
            {val !== null ? val.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}
            {widget.unit && <span className="text-sm ml-1" style={{ color: D.muted }}>{widget.unit}</span>}
          </div>
          {delta !== null && (
            <div className="flex items-center gap-1 mt-1" style={{ color: tc }}>
              <TIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">
                {delta > 0 ? "+" : ""}{delta.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                {pct !== null && <span className="ml-1 opacity-70">({pct > 0 ? "+" : ""}{pct.toFixed(1)}%)</span>}
              </span>
            </div>
          )}
          {latest && <p className="text-[10px] mt-1" style={{ color: D.muted }}>{format(new Date(latest.timestamp), "HH:mm:ss dd/MM")}</p>}
        </div>
        {spark.length > 2 && (
          <div style={{ width: 80, height: 44 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Line dataKey="v" stroke={widget.color} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function PieWidget({ widget, data, donut }: { widget: Widget; data: Record<string, any[]>; donut?: boolean }) {
  const values = getWidgetRows(widget, data).map(d => Number(d.value)).filter(v => !isNaN(v));
  if (values.length === 0) return <EmptyState />;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1, B = 6;
  const buckets = Array.from({ length: B }, (_, i) => {
    const lo = min + (range / B) * i, hi = min + (range / B) * (i + 1);
    return { name: `${lo.toFixed(1)}–${hi.toFixed(1)}`, value: values.filter(v => i === B-1 ? v>=lo&&v<=hi : v>=lo&&v<hi).length };
  }).filter(b => b.value > 0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={buckets} cx="50%" cy="50%" innerRadius={donut ? "48%" : 0} outerRadius="70%"
          paddingAngle={2} dataKey="value" label={({ percent }) => `${(percent*100).toFixed(0)}%`} labelLine={false}>
          {buckets.map((_, i) => <Cell key={i} fill={NEON_PALETTE[i % NEON_PALETTE.length]} opacity={0.85} />)}
        </Pie>
        <Tooltip contentStyle={{ background: D.card, border: `1px solid ${D.border2}`, borderRadius: 6, fontSize: 11, color: D.text }} />
        <Legend wrapperStyle={{ fontSize: 10, color: D.muted }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function ScatterWidget({ widget, data }: { widget: Widget; data: Record<string, any[]> }) {
  const points = getWidgetRows(widget, data).map((d, i) => ({ x: i, y: Number(d.value) })).filter(p => !isNaN(p.y));
  if (points.length === 0) return <EmptyState />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid {...darkGrid} />
        <XAxis dataKey="x" {...darkAxis} hide />
        <YAxis dataKey="y" {...darkAxis} width={36} />
        <Tooltip {...darkTooltip} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={points} fill={widget.color} opacity={0.75} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function HeatmapWidget({ widget, data }: { widget: Widget; data: Record<string, any[]> }) {
  const rows = getWidgetRows(widget, data);
  if (rows.length === 0) return <EmptyState />;
  const buckets: number[][] = Array.from({ length: 24 }, () => []);
  rows.forEach(d => buckets[new Date(d.timestamp).getHours()].push(Number(d.value)));
  const avgs = buckets.map(b => b.length ? b.reduce((a, x) => a+x, 0)/b.length : null);
  const def = avgs.filter(v => v !== null) as number[];
  const minV = def.length ? Math.min(...def) : 0, maxV = def.length ? Math.max(...def) : 1;
  const norm = (v: number | null) => v === null ? 0 : (v-minV)/(maxV-minV||1);
  const heatColor = (n: number) => {
    const stops = ["#1e3a5f","#0891b2","#10b981","#f59e0b","#dc2626"];
    const idx = n*(stops.length-1), lo = Math.floor(idx), hi = Math.min(lo+1, stops.length-1), t = idx-lo;
    const hex = (s: string) => [parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)];
    const c1 = hex(stops[lo]), c2 = hex(stops[hi]);
    return `rgb(${Math.round(c1[0]+t*(c2[0]-c1[0]))},${Math.round(c1[1]+t*(c2[1]-c1[1]))},${Math.round(c1[2]+t*(c2[2]-c1[2]))})`;
  };
  return (
    <div className="p-2 h-full flex flex-col gap-1">
      <div className="flex gap-0.5 flex-1">
        {avgs.map((v, h) => (
          <div key={h} className="flex-1 flex flex-col gap-0.5 items-center">
            <div className="flex-1 w-full rounded-sm" style={{ background: heatColor(norm(v)), opacity: v===null?0.1:1, minHeight: 4 }}
              title={v!==null?`${h}:00 → ${v.toFixed(2)}`:`${h}:00 → no data`} />
            {h%4===0 && <span style={{ fontSize:8, color:D.muted }}>{h}</span>}
          </div>
        ))}
      </div>
      <div className="flex justify-between" style={{ fontSize: 9, color: D.muted }}>
        <span>Hour of day (0–23)</span><span>avg intensity</span>
      </div>
    </div>
  );
}

function StateTimelineWidget({ widget, data }: { widget: Widget; data: Record<string, any[]> }) {
  const sorted = [...getWidgetRows(widget, data)].sort((a, b) => new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime());
  if (sorted.length === 0) return <EmptyState />;
  const vals = sorted.map(d => Number(d.value));
  const minV = Math.min(...vals), maxV = Math.max(...vals), range = maxV-minV||1;
  const lo = minV+range*0.33, hi = minV+range*0.67;
  const sc = (v: number) => v>=hi ? D.red : v>=lo ? D.amber : D.green;
  const total = sorted.length;
  return (
    <div className="flex flex-col h-full p-2 gap-2">
      <div className="flex h-8 rounded overflow-hidden" style={{ border: `1px solid ${D.border}` }}>
        {sorted.map((d, i) => <div key={i} className="flex-1" style={{ background: sc(Number(d.value)) }}
          title={`${fmtTs(d.timestamp, widget.rangeMinutes)}: ${Number(d.value).toFixed(2)}`} />)}
      </div>
      <div className="grid grid-cols-3 gap-1 flex-1">
        {[{label:"LOW",c:D.green,n:vals.filter(v=>v<lo).length},{label:"NORM",c:D.amber,n:vals.filter(v=>v>=lo&&v<hi).length},{label:"HIGH",c:D.red,n:vals.filter(v=>v>=hi).length}].map(s=>(
          <div key={s.label} className="flex flex-col items-center justify-center rounded p-1"
            style={{ background:s.c+"22", border:`1px solid ${s.c}44` }}>
            <span className="text-xs font-bold" style={{ color:s.c }}>{s.label}</span>
            <span className="text-lg font-bold tabular-nums" style={{ color:s.c }}>{s.n}</span>
            <span style={{ fontSize:9, color:D.muted }}>{total>0?((s.n/total)*100).toFixed(0):0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function seriesDisplayName(label: string, uom?: string) {
  return uom ? `${label} (${uom})` : label;
}

function ChartWidget({ widget, data }: { widget: Widget; data: Record<string, any[]> }) {
  const allSeries = [
    { metric: widget.metric, color: widget.color, label: widget.label || widget.metric, uom: widget.uom },
    ...(widget.overlayMetrics ?? []).map(o => ({ metric: `${o.assetId}::${o.metric}`, color: o.color, label: o.label || `${o.assetName}/${o.metric}`, uom: o.uom })),
  ];
  const tsBuckets: Record<string, Record<string, number>> = {};
  allSeries.forEach(s => {
    const rows = s.metric === widget.metric ? getWidgetRows(widget, data) : (data[s.metric] ?? []);
    rows.forEach(r => {
      const t = fmtTs(r.timestamp, widget.rangeMinutes);
      if (!tsBuckets[t]) tsBuckets[t] = {};
      tsBuckets[t][s.metric] = Number(r.value);
    });
  });
  const chartData = Object.entries(tsBuckets).sort(([a],[b])=>a.localeCompare(b)).map(([t,vals])=>({
    t,
    ...Object.fromEntries(allSeries.map(s => [s.metric, vals[s.metric] !== undefined ? vals[s.metric] : 0])),
  }));
  if (chartData.length === 0) return <EmptyState />;
  const commonProps = { data: chartData, margin: { top: 4, right: 8, bottom: 0, left: 0 } };
  // Compute Y-axis domain that always includes UCL / LCL / CL so lines are never clipped
  const allYValues: number[] = [];
  for (const row of chartData) {
    for (const s of allSeries) {
      const v = row[s.metric];
      if (typeof v === "number" && isFinite(v)) allYValues.push(v);
    }
  }
  if (widget.ucl       !== undefined) allYValues.push(widget.ucl);
  if (widget.lcl       !== undefined) allYValues.push(widget.lcl);
  if (widget.centerLine !== undefined) allYValues.push(widget.centerLine);
  const yMin  = allYValues.length ? Math.min(...allYValues) : 0;
  const yMax  = allYValues.length ? Math.max(...allYValues) : 100;
  const yPad  = (yMax - yMin) * 0.1 || 1;
  const yDomain: [number, number] = [
    Math.floor(yMin - yPad),
    Math.ceil(yMax  + yPad),
  ];

  // SPC reference lines — use widget-level color + style (solid/dashed)
  const uclColor = widget.uclColor ?? D.amber;
  const lclColor = widget.lclColor ?? D.amber;
  const clColor  = widget.clColor  ?? D.green;
  // Build optional strokeDasharray — never pass undefined as a recharts prop (causes silent no-render)
  const uclDashProps = (widget.uclStyle ?? "dashed") === "dashed" ? { strokeDasharray: "8 4" } : {};
  const lclDashProps = (widget.lclStyle ?? "dashed") === "dashed" ? { strokeDasharray: "8 4" } : {};
  const clDashProps  = (widget.clStyle  ?? "solid")  === "dashed" ? { strokeDasharray: "8 4" } : {};

  // Inline each ReferenceLine directly — recharts does NOT flatten Fragments so wrapping
  // in <> silently swallows all children. Each conditional must be a direct chart child.
  const uclLine = typeof widget.ucl === "number"
    ? <ReferenceLine key="ucl" y={widget.ucl} stroke={uclColor} strokeWidth={2}
        {...uclDashProps} isAnimationActive={false}
        label={{ position: "insideTopRight", value: `UCL ${widget.ucl}`, fontSize: 9, fill: uclColor }} />
    : null;
  const lclLine = typeof widget.lcl === "number"
    ? <ReferenceLine key="lcl" y={widget.lcl} stroke={lclColor} strokeWidth={2}
        {...lclDashProps} isAnimationActive={false}
        label={{ position: "insideBottomRight", value: `LCL ${widget.lcl}`, fontSize: 9, fill: lclColor }} />
    : null;
  const clLine = typeof widget.centerLine === "number"
    ? <ReferenceLine key="cl" y={widget.centerLine} stroke={clColor} strokeWidth={1.5}
        {...clDashProps} isAnimationActive={false}
        label={{ position: "insideTopRight", value: `CL ${widget.centerLine}`, fontSize: 9, fill: clColor }} />
    : null;

  if (widget.chartType === "bar" || widget.chartType === "stackbar") {
    const stacked = widget.chartType === "stackbar";
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart {...commonProps}>
          <CartesianGrid {...darkGrid} /><XAxis dataKey="t" {...darkAxis} /><YAxis {...darkAxis} width={36} domain={yDomain} />
          <Tooltip {...darkTooltip} />
          <Legend wrapperStyle={{ fontSize:9, color:D.muted }} />
          {allSeries.map(s => <Bar key={s.metric} dataKey={s.metric} name={seriesDisplayName(s.label, s.uom)} fill={s.color}
            stackId={stacked?"stack":undefined} radius={stacked?undefined:[2,2,0,0]} maxBarSize={20} />)}
          {uclLine}{lclLine}{clLine}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (widget.chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart {...commonProps}>
          <defs>{allSeries.map(s=>(
            <linearGradient key={s.metric} id={`grad-${widget.id}-${s.metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}</defs>
          <CartesianGrid {...darkGrid} /><XAxis dataKey="t" {...darkAxis} /><YAxis {...darkAxis} width={36} domain={yDomain} />
          <Tooltip {...darkTooltip} />
          <Legend wrapperStyle={{ fontSize:9, color:D.muted }} />
          {allSeries.map(s=><Area key={s.metric} dataKey={s.metric} name={seriesDisplayName(s.label, s.uom)} stroke={s.color}
            fill={`url(#grad-${widget.id}-${s.metric})`} strokeWidth={1.5} dot={false} />)}
          {uclLine}{lclLine}{clLine}
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart {...commonProps}>
        <CartesianGrid {...darkGrid} /><XAxis dataKey="t" {...darkAxis} /><YAxis {...darkAxis} width={36} domain={yDomain} />
        <Tooltip {...darkTooltip} />
        <Legend wrapperStyle={{ fontSize:9, color:D.muted }} />
        {allSeries.map(s=><Line key={s.metric} dataKey={s.metric} name={seriesDisplayName(s.label, s.uom)} stroke={s.color}
          strokeWidth={2} dot={false} activeDot={{ r:3, fill:s.color }} />)}
        {uclLine}{lclLine}{clLine}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Widget Time Range / Aggregation Popover ───────────────────────────────────
function WidgetTimePopover({ widget, onUpdate }: { widget: Widget; onUpdate: (u: Partial<Widget>) => void }) {
  const [open,           setOpen]           = useState(false);
  const [rangeMinutes,   setRangeMinutes]   = useState(widget.rangeMinutes);
  const [customFrom,     setCustomFrom]     = useState(widget.customFrom ?? "");
  const [customTo,       setCustomTo]       = useState(widget.customTo ?? "");
  const [granularity,    setGranularity]    = useState(widget.granularity ?? "auto");
  const [aggType,        setAggType]        = useState(widget.aggType ?? "avg");
  const [interpolated,   setInterpolated]   = useState(widget.interpolated ?? false);
  const [refreshEnabled, setRefreshEnabled] = useState(widget.refreshEnabled ?? false);
  const [refreshInterv,  setRefreshInterv]  = useState(widget.refreshInterval ?? 30_000);
  const [allowOverride,  setAllowOverride]  = useState(widget.allowOverride !== false);

  // Sync local state when popover opens
  useEffect(() => {
    if (!open) return;
    setRangeMinutes(widget.rangeMinutes);
    setCustomFrom(widget.customFrom ?? "");
    setCustomTo(widget.customTo ?? "");
    setGranularity(widget.granularity ?? "auto");
    setAggType(widget.aggType ?? "avg");
    setInterpolated(widget.interpolated ?? false);
    setRefreshEnabled(widget.refreshEnabled ?? false);
    setRefreshInterv(widget.refreshInterval ?? 30_000);
    setAllowOverride(widget.allowOverride !== false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCustom = rangeMinutes === -1;
  const sel: React.CSSProperties = { background: D.panel, border: `1px solid ${D.border2}`, color: D.text };

  function handleApply() {
    onUpdate({
      rangeMinutes,
      customFrom: isCustom ? customFrom : undefined,
      customTo:   isCustom ? customTo   : undefined,
      granularity: granularity as Widget["granularity"],
      aggType:     aggType    as Widget["aggType"],
      interpolated,
      refreshEnabled,
      refreshInterval: refreshInterv,
      allowOverride,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="p-1 rounded hover:bg-white/5 transition-colors" title="Time Range & Aggregation"
          style={{ color: open ? D.accent : D.muted }}>
          <Clock className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={6}
        className="w-80 p-0 rounded-lg overflow-hidden border-0 shadow-2xl"
        style={{ background: D.card, border: `1px solid ${D.border2}`, color: D.text, zIndex: 200 }}>

        {/* Header */}
        <div className="px-3 py-2 flex items-center gap-2"
          style={{ borderBottom: `1px solid ${D.border}`, background: D.panel }}>
          <Clock className="w-3.5 h-3.5" style={{ color: D.accent }} />
          <span className="text-xs font-semibold" style={{ color: D.accent }}>Time Range &amp; Aggregation</span>
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: D.border2, color: D.muted }}>
            {rangeLabelOf(widget)}
          </span>
        </div>

        <div className="p-3 space-y-3">
          {/* Row 1: Time Range + To Future */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[10px] font-medium" style={{ color: D.muted }}>Time Range</p>
              <select value={rangeMinutes} onChange={e => setRangeMinutes(Number(e.target.value))}
                className="w-full h-8 rounded px-2 text-xs" style={sel}>
                {RANGES.map(r => <option key={r.minutes} value={r.minutes}>{r.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-medium" style={{ color: D.muted }}>To Future</p>
              <select disabled={!isCustom}
                onChange={e => {
                  const offsets: Record<string, number> = { "+1h": 3_600_000, "+6h": 21_600_000, "+1d": 86_400_000 };
                  setCustomTo(format(new Date(Date.now() + (offsets[e.target.value] ?? 0)), "yyyy-MM-dd'T'HH:mm"));
                }}
                defaultValue="now"
                className="w-full h-8 rounded px-2 text-xs disabled:opacity-40" style={sel}>
                <option value="now">To Future</option>
                <option value="+1h">+1 hour</option>
                <option value="+6h">+6 hours</option>
                <option value="+1d">+1 day</option>
              </select>
            </div>
          </div>

          {/* Row 2: Custom time range (only shown when Custom is selected) */}
          {isCustom && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium" style={{ color: D.muted }}>Custom Time Range</p>
              <div className="flex items-center gap-1.5">
                <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  className="flex-1 h-7 rounded px-2 text-[10px] outline-none" style={sel} />
                <span className="text-[10px]" style={{ color: D.muted }}>→</span>
                <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  className="flex-1 h-7 rounded px-2 text-[10px] outline-none" style={sel} />
                <CalendarDays className="w-3.5 h-3.5 shrink-0" style={{ color: D.muted }} />
              </div>
            </div>
          )}

          {/* Row 3: Granularity + Aggregation Type */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[10px] font-medium" style={{ color: D.muted }}>Granularity</p>
              <select value={granularity} onChange={e => setGranularity(e.target.value)}
                className="w-full h-8 rounded px-2 text-xs" style={sel}>
                {GRANULARITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-medium" style={{ color: D.muted }}>Aggregation Type</p>
              <select value={aggType} onChange={e => setAggType(e.target.value)}
                className="w-full h-8 rounded px-2 text-xs" style={sel}>
                {AGG_TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-1.5 -mt-1">
            <input type="checkbox" id={`interp-${widget.id}`} checked={interpolated}
              onChange={e => setInterpolated(e.target.checked)} className="w-3 h-3 accent-cyan-500" />
            <label htmlFor={`interp-${widget.id}`} className="text-[10px] cursor-pointer" style={{ color: D.muted }}>
              Interpolated
            </label>
          </div>

          {/* Row 4: Refresh Time */}
          <div className="flex items-center gap-2" style={{ borderTop: `1px solid ${D.border}`, paddingTop: 8 }}>
            <Switch checked={refreshEnabled} onCheckedChange={setRefreshEnabled} className="scale-75 origin-left shrink-0" />
            <span className="text-[10px] shrink-0" style={{ color: refreshEnabled ? D.green : D.muted }}>Refresh Time</span>
            <select value={refreshInterv} onChange={e => setRefreshInterv(Number(e.target.value))}
              disabled={!refreshEnabled}
              className="flex-1 h-7 rounded px-2 text-[11px] disabled:opacity-40" style={sel}>
              {REFRESH_INTERVALS.map(r => <option key={r.ms} value={r.ms}>{r.label}</option>)}
            </select>
            <div className="flex items-center gap-1 shrink-0">
              <input type="checkbox" id={`offset-${widget.id}`} className="w-3 h-3 accent-cyan-500" />
              <label htmlFor={`offset-${widget.id}`} className="text-[10px] cursor-pointer" style={{ color: D.muted }}>Offset</label>
            </div>
          </div>

          {/* Row 5: Allow Override + Apply */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={allowOverride} onCheckedChange={setAllowOverride} className="scale-75 origin-left" />
              <span className="text-[10px]" style={{ color: allowOverride ? D.text : D.muted }}>Allow Override</span>
            </div>
            <button onClick={handleApply}
              className="px-4 py-1.5 rounded text-xs font-bold transition-all hover:opacity-90"
              style={{ background: D.accent, color: "#000" }}>
              Apply
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Widget Card ───────────────────────────────────────────────────────────────
function WidgetCard({ widget, onDelete, onEdit, onClone, onDuplicate, onCopy, onUpdate, fullscreen, onFullscreen, wsSignal, refreshSignal, onDragHandleMouseDown, onLiveSpanChange }: {
  widget: Widget; onDelete: () => void; onEdit: () => void;
  onClone: () => void; onDuplicate: () => void; onCopy: () => void;
  onUpdate: (u: Partial<Widget>) => void;
  fullscreen: boolean; onFullscreen: () => void;
  wsSignal?: number; refreshSignal?: number;
  onDragHandleMouseDown?: () => void;
  onLiveSpanChange?: (span: number | null) => void;
}) {
  const [data, setData]           = useState<Record<string, any[]>>({});
  const [loading, setLoading]     = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [liveFlash, setLiveFlash] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const from = getFrom(widget), to = getTo(widget);
    // WTD/MTD/YTD (negative range codes) and custom date ranges always use aggregation
    const rangeMin = (widget.customFrom || widget.rangeMinutes < 0)
      ? Infinity
      : (widget.rangeMinutes > 0 ? widget.rangeMinutes : 60);
    // Use aggregation when: range > 2h, OR explicit granularity, OR non-default agg type
    const hasCustomGran = widget.granularity && widget.granularity !== "auto";
    const hasCustomAgg  = widget.aggType && widget.aggType !== "avg";
    const useAgg = rangeMin > 120 || hasCustomGran || hasCustomAgg;
    // Auto-detect bucket from range, or use widget's granularity setting
    const autoGran = rangeMin <= 60 ? "1m" : rangeMin <= 360 ? "5m" : rangeMin <= 1440 ? "15m" : rangeMin <= 4320 ? "1h" : rangeMin <= 10080 ? "6h" : "1d";
    const aggBucket = hasCustomGran ? (GRANULARITY_STEP_MAP[widget.granularity!] ?? autoGran) : autoGran;
    // Select which aggregated field to show based on widget aggType
    const aggField = widget.aggType === "sum" ? "sum_val"
      : widget.aggType === "min" ? "min_val"
      : widget.aggType === "max" ? "max_val"
      : widget.aggType === "count" ? "count"
      : "avg_val";

    async function fetchOneSeries(assetId: string, metric: string): Promise<any[]> {
      if (useAgg) {
        const p = new URLSearchParams({ assetId, metric, from, to, bucket: aggBucket, limit: "2000" });
        const r = await fetch(`${BASE}/api/system/aggregate?${p}`, { credentials: "include" });
        if (!r.ok) return [];
        const json = await r.json();
        const aggRows = (json.data ?? []).map((d: any) => {
          const raw = d[aggField] ?? d.avg_val ?? d.max_val ?? d.min_val ?? null;
          return { timestamp: d.bucket, value: raw !== null ? parseFloat(String(raw)) : null };
        });
        return gapFill(aggRows, aggBucket);
      }
      const p = new URLSearchParams({ metric, from, to, limit: "2000" });
      const r = await fetch(`${BASE}/api/telemetry/${assetId}?${p}`, { credentials: "include" });
      if (!r.ok) return [];
      const rows: any[] = await r.json();
      return rows.map(d => ({ ...d, value: d.value !== null && d.value !== undefined ? parseFloat(String(d.value)) : null }));
    }

    try {
      const result: Record<string, any[]> = {};
      const primary = await fetchOneSeries(widget.assetId, widget.metric);
      for (const key of widgetSeriesKeys(widget)) result[key] = primary;
      for (const ov of (widget.overlayMetrics ?? [])) {
        result[`${ov.assetId}::${ov.metric}`] = await fetchOneSeries(ov.assetId, ov.metric);
      }
      setData(result); setLastFetch(new Date());
    } finally { setLoading(false); }
  }, [widget.assetId, widget.metric, widget.rangeMinutes, widget.customFrom, widget.customTo,
      widget.aggType, widget.granularity, widget.interpolated, JSON.stringify(widget.overlayMetrics)]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // React to global refresh signal
  const prevRefreshSignal = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal !== prevRefreshSignal.current) {
      prevRefreshSignal.current = refreshSignal;
      fetchData();
    }
  }, [refreshSignal, fetchData]);

  // Per-widget auto-refresh (independent of global refresh)
  const widgetRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (widgetRefreshTimer.current) clearInterval(widgetRefreshTimer.current);
    if (widget.refreshEnabled && widget.refreshInterval) {
      widgetRefreshTimer.current = setInterval(fetchData, widget.refreshInterval);
    }
    return () => { if (widgetRefreshTimer.current) clearInterval(widgetRefreshTimer.current); };
  }, [widget.refreshEnabled, widget.refreshInterval, fetchData]);

  // Real-time: flash LIVE badge when a WebSocket telemetry event arrives for this asset
  const prevWsSignal = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (wsSignal && wsSignal !== prevWsSignal.current) {
      prevWsSignal.current = wsSignal;
      setLiveFlash(true);
      setTimeout(() => setLiveFlash(false), 1200);
    }
  }, [wsSignal]);

  const overlayCount = widget.overlayMetrics?.length ?? 0;
  const baseH  = widget.chartType === "kpi" ? 110 : widget.chartType === "gauge" ? 150 : 180;
  const [resizeH, setResizeH] = useState<number | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number; h: number; span: number } | null>(null);
  const chartH = resizeH ?? (widget.height ?? baseH);

  // Single bottom-right corner handle: drag diagonally to resize both height and column width
  function handleResizeDown(e: React.MouseEvent) {
    e.preventDefault();
    resizeStartRef.current = { x: e.clientX, y: e.clientY, h: chartH, span: widget.width ?? 1 };
    const onMove = (me: MouseEvent) => {
      if (!resizeStartRef.current) return;
      // Live height preview
      setResizeH(Math.max(60, resizeStartRef.current.h + me.clientY - resizeStartRef.current.y));
      // Live column-span preview (threshold = 240px per step so it feels intentional)
      const deltaX    = me.clientX - resizeStartRef.current.x;
      const spanDelta = Math.round(deltaX / 240);
      const liveSpan  = Math.min(4, Math.max(1, resizeStartRef.current.span + spanDelta));
      onLiveSpanChange?.(liveSpan);
    };
    const onUp = (me: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const newH      = Math.max(60, resizeStartRef.current.h + me.clientY - resizeStartRef.current.y);
      const deltaX    = me.clientX - resizeStartRef.current.x;
      const spanDelta = Math.round(deltaX / 240);
      const newSpan   = Math.min(4, Math.max(1, resizeStartRef.current.span + spanDelta));
      const updates: Partial<Widget> = { height: newH };
      if (newSpan !== resizeStartRef.current.span) updates.width = newSpan;
      onUpdate(updates);
      onLiveSpanChange?.(null);
      setResizeH(null);
      resizeStartRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function renderContent() {
    if (loading && Object.keys(data).length === 0)
      return <div className="flex items-center justify-center h-full"><RefreshCw className="w-4 h-4 animate-spin" style={{ color: D.muted }} /></div>;
    switch (widget.chartType) {
      case "kpi":           return <KpiWidget widget={widget} data={data} />;
      case "gauge":         return <GaugeWidget widget={widget} data={data} />;
      case "pie":           return <PieWidget widget={widget} data={data} />;
      case "donut":         return <PieWidget widget={widget} data={data} donut />;
      case "scatter":       return <ScatterWidget widget={widget} data={data} />;
      case "heatmap":       return <HeatmapWidget widget={widget} data={data} />;
      case "statetimeline": return <StateTimelineWidget widget={widget} data={data} />;
      default:              return <ChartWidget widget={widget} data={data} />;
    }
  }

  return (
    <div
      className="flex flex-col rounded-lg overflow-hidden group relative"
      style={{ background: D.card, border: `1px solid ${D.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.4)", minHeight: 260 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${D.border}`, background: D.panel }}>
        <GripVertical data-drag-handle="true"
          className="w-3.5 h-3.5 shrink-0 cursor-grab opacity-20 group-hover:opacity-60 transition-opacity select-none"
          style={{ color: D.muted }}
          onMouseDown={e => { e.stopPropagation(); onDragHandleMouseDown?.(); }} />
        <div className={`w-2 h-2 rounded-full shrink-0 transition-all duration-300 ${liveFlash ? "scale-150" : ""}`}
          style={{ background: widget.color, boxShadow: liveFlash ? `0 0 12px ${widget.color}, 0 0 4px ${widget.color}` : `0 0 6px ${widget.color}` }} />
        {widget.imageUrl && widget.imageMode === "icon" && (
          <img src={widget.imageUrl} alt="" className="w-5 h-5 rounded object-cover shrink-0"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold truncate max-w-[120px]" style={{ color: D.text }}>{widget.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: D.border2, color: D.accent }}>{widget.assetName}</span>
            <span className="text-[9px] px-1 rounded font-mono" style={{ background: D.border2, color: D.accent2 }}>{widget.metric}</span>
            {overlayCount > 0 && <span className="text-[9px] px-1 rounded" style={{ background: D.purple+"33", color: D.purple }}>+{overlayCount}</span>}
          </div>
          <div className="flex items-center gap-1 mt-px">
            <Clock className="w-2.5 h-2.5" style={{ color: D.muted }} />
            <span className="text-[9px]" style={{ color: D.muted }}>{rangeLabelOf(widget)}</span>
            {lastFetch && <span className="text-[9px]" style={{ color: D.muted }}>· {format(lastFetch, "HH:mm:ss")}</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <WidgetTimePopover widget={widget} onUpdate={onUpdate} />
          <button className="p-1 rounded hover:bg-white/5" onClick={fetchData} disabled={loading} title="Refresh">
            <RefreshCw className={`w-3 h-3 ${loading?"animate-spin":""}`} style={{ color: D.muted }} />
          </button>
          <button className="p-1 rounded hover:bg-white/5" onClick={onFullscreen} title="Fullscreen">
            {fullscreen ? <Minimize2 className="w-3 h-3" style={{ color: D.muted }} /> : <Maximize2 className="w-3 h-3" style={{ color: D.muted }} />}
          </button>
          {/* Widget action menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 rounded hover:bg-white/5" title="More options">
                <MoreVertical className="w-3 h-3" style={{ color: D.muted }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onEdit}>
                <Settings2 className="w-3.5 h-3.5 mr-2" /> Edit Widget
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="w-3.5 h-3.5 mr-2" /> Duplicate Widget
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onClone}>
                <Copy className="w-3.5 h-3.5 mr-2" /> Clone Widget
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCopy}>
                <Clipboard className="w-3.5 h-3.5 mr-2" /> Copy to Clipboard
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Widget
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="p-2 relative overflow-hidden" style={{ height: fullscreen ? 420 : chartH }}>
        {widget.imageUrl && widget.imageMode === "background" && (
          <img src={widget.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.07] pointer-events-none select-none"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <div className="relative h-full">{renderContent()}</div>
      </div>

      {/* Single corner resize — drag diagonally to adjust both height and column width */}
      {!fullscreen && (
        <div onMouseDown={handleResizeDown}
          className="absolute bottom-0 right-0 w-6 h-6 z-10 cursor-se-resize flex items-end justify-end p-1 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Drag to resize (↕ height · ↔ width)">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <line x1="1" y1="10" x2="10" y2="1" stroke={D.border2} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="5" y1="10" x2="10" y2="5" stroke={D.border2} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Asset Hierarchy Tree (with inline management) ─────────────────────────────
interface AssetNode { id: string; name: string; identifier?: string; parentId?: string | null; }
interface AssetNodeWithTelemetry extends AssetNode { lastSeen?: string | null; }

function AssetTreeNode({ asset, allAssets, selectedId, onSelect, onAddChild, onEdit, onDelete, depth }: {
  asset: AssetNodeWithTelemetry; allAssets: AssetNodeWithTelemetry[]; selectedId: string | null;
  onSelect: (a: AssetNodeWithTelemetry) => void;
  onAddChild: (parentId: string) => void;
  onEdit: (a: AssetNodeWithTelemetry) => void;
  onDelete: (a: AssetNodeWithTelemetry) => void;
  depth: number;
}) {
  const children = allAssets.filter(a => a.parentId === asset.id);
  const [expanded, setExpanded] = useState(depth < 2);
  const [hovered,  setHovered]  = useState(false);
  const isSelected = selectedId === asset.id;

  return (
    <div>
      <div
        className="flex items-center gap-1 py-1 rounded cursor-pointer transition-all group"
        style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: 4,
          background: isSelected ? `${D.accent}18` : hovered ? "rgba(255,255,255,0.04)" : "transparent",
          color: isSelected ? D.accent : D.text }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onSelect(asset)}
      >
        {children.length > 0
          ? <button onClick={e => { e.stopPropagation(); setExpanded(o => !o); }} className="shrink-0 p-0.5 rounded hover:bg-white/10">
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          : <span className="w-4 shrink-0" />}
        {children.length > 0
          ? expanded ? <FolderOpen className="w-3 h-3 shrink-0" style={{ color: "#f59e0b" }} />
                     : <Folder     className="w-3 h-3 shrink-0" style={{ color: "#f59e0b" }} />
          : <Blocks className="w-3 h-3 shrink-0" style={{ color: D.accent }} />}
        <span className="truncate flex-1 text-[11px]">{asset.name}</span>
        {asset.lastSeen && <span className="text-[9px] px-1 rounded" style={{ background: `${D.green}22`, color: D.green }}>LIVE</span>}

        {/* Hover actions */}
        {hovered && (
          <div className="flex items-center gap-0.5 ml-1 shrink-0" onClick={e => e.stopPropagation()}>
            <button className="p-0.5 rounded hover:bg-white/10" title="Add child asset"
              onClick={() => onAddChild(asset.id)}>
              <Plus className="w-2.5 h-2.5" style={{ color: D.green }} />
            </button>
            <button className="p-0.5 rounded hover:bg-white/10" title="Edit asset"
              onClick={() => onEdit(asset)}>
              <Edit2 className="w-2.5 h-2.5" style={{ color: D.accent }} />
            </button>
            <button className="p-0.5 rounded hover:bg-red-500/20" title="Delete asset"
              onClick={() => onDelete(asset)}>
              <Trash2 className="w-2.5 h-2.5" style={{ color: D.red }} />
            </button>
          </div>
        )}
      </div>
      {expanded && children.map(child => (
        <AssetTreeNode key={child.id} asset={child} allAssets={allAssets}
          selectedId={selectedId} onSelect={onSelect}
          onAddChild={onAddChild} onEdit={onEdit} onDelete={onDelete}
          depth={depth + 1} />
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Asset Manage Dialog (create / edit asset from Visualization) ───────────────
function AssetManageDialog({ open, onOpenChange, parentId, editAsset, allAssets, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  parentId?: string | null; editAsset?: AssetNodeWithTelemetry | null;
  allAssets: AssetNodeWithTelemetry[]; onSaved: () => void;
}) {
  const createAsset = useCreateAsset();
  const updateAsset = useUpdateAsset();
  const [name,       setName]       = useState("");
  const [identifier, setIdentifier] = useState("");
  const [saving,     setSaving]     = useState(false);
  const parentName = parentId ? allAssets.find(a => a.id === parentId)?.name : null;

  useEffect(() => {
    if (open) {
      setName(editAsset?.name ?? "");
      setIdentifier(editAsset?.identifier ?? "");
    }
  }, [open, editAsset]);

  function autoId(n: string) { return n.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,""); }
  function safeIdentifier(n: string) {
    const id = autoId(n).slice(0, 64);
    return id || `asset_${crypto.randomUUID().slice(0, 8)}`;
  }

  async function handleSave() {
    if (!name) return;
    setSaving(true);
    try {
      const resolvedIdentifier = (identifier.trim() || safeIdentifier(name)).trim();
      if (editAsset) {
        await updateAsset.mutateAsync({ id: editAsset.id, data: { name } });
      } else {
        await createAsset.mutateAsync({ data: { name, identifier: resolvedIdentifier, parentId: parentId ?? null } });
      }
      onSaved(); onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Failed to save asset",
        description: err?.message ? String(err.message) : "The server rejected the project data.",
        variant: "destructive",
      });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle style={{ color: D.text }}>
            {editAsset ? "Edit Asset" : parentId ? "Add Child Asset" : "New Root Project"}
          </DialogTitle>
          <DialogDescription>
            {editAsset
              ? `Editing "${editAsset.name}"`
              : parentId
              ? `Adding a child under "${parentName}". Use this for equipment, sub-systems, or devices.`
              : "Create a top-level project or site (e.g. Plant 2, Site B). Add child assets beneath it after creation."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Name *</Label>
            <Input className="h-9" value={name}
              onChange={e => { setName(e.target.value); if (!editAsset && !identifier) setIdentifier(autoId(e.target.value)); }}
              placeholder={parentId ? "e.g. Fan Motor, Pump-A" : "e.g. Plant 2, Site B"} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Identifier</Label>
            <Input className="h-8 text-xs font-mono" value={identifier} onChange={e => setIdentifier(e.target.value)}
              placeholder="auto_generated" />
            <p className="text-[10px]" style={{ color: D.muted }}>Unique ID used in tags and API. Auto-filled from name.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!name || saving}>
            {saving ? "Saving…" : editAsset ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useAssetTelemetryMap(widgets: Widget[]) {
  return useMemo(() => {
    const latestByAsset: Record<string, string> = {};
    for (const w of widgets) {
      const rows = (w as any)?.data ?? [];
      const latest = [...rows].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
      if (latest?.timestamp) latestByAsset[w.assetId] = latest.timestamp;
    }
    return latestByAsset;
  }, [widgets]);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Widget Dialog ─────────────────────────────────────────────────────────────
function OverlayRow({ overlay, assetList, index, onChange, onRemove }: {
  overlay: OverlayMetric; assetList: any[]; index: number;
  onChange: (field: keyof OverlayMetric, val: string) => void; onRemove: () => void;
}) {
  const { data: attributes } = useListAssetAttributes(overlay.assetId, {
    query: { enabled: !!overlay.assetId, queryKey: ["viz-ov-attrs", overlay.assetId, index] },
  });
  const attrs = ((attributes as any[] | undefined) ?? []).filter((a: any) => metricKeyOf(a));
  const [telemetryMetrics, setTelemetryMetrics] = useState<string[]>([]);
  useEffect(() => {
    if (!overlay.assetId) { setTelemetryMetrics([]); return; }
    fetch(`${BASE}/api/telemetry/${overlay.assetId}/metrics`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((keys: string[]) => setTelemetryMetrics(keys))
      .catch(() => setTelemetryMetrics([]));
  }, [overlay.assetId]);
  function overlayLabelForKey(key: string) {
    const m = attrs.find((a: any) => {
      const tag = metricKeyOf(a); if (!tag) return false;
      return tag === key || tag.split('.').slice(1).join('.') === key;
    });
    return m ? `${m.name} (${key})` : key;
  }
  return (
    <div className="rounded p-2 space-y-2" style={{ background: D.panel, border: `1px solid ${D.border}` }}>
      {/* Row 1: asset + metric selects + delete */}
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: overlay.color }} />
        <select value={overlay.assetId} onChange={e => onChange("assetId", e.target.value)}
          className="flex-1 min-w-0 h-7 rounded border border-border bg-background px-1.5 text-[11px]">
          <option value="">Asset…</option>
          {assetList.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={overlay.metric} onChange={e => onChange("metric", e.target.value)}
          disabled={!overlay.assetId}
          className="flex-1 min-w-0 h-7 rounded border border-border bg-background px-1.5 text-[11px] disabled:opacity-40">
          <option value="">Metric…</option>
          {telemetryMetrics.length > 0
            ? telemetryMetrics.map(k => <option key={k} value={k}>{overlayLabelForKey(k)}</option>)
            : attrs.map((a: any) => <option key={metricKeyOf(a)} value={metricKeyOf(a)}>{a.name}</option>)
          }
        </select>
        <button onClick={onRemove} className="p-0.5 rounded hover:bg-red-500/20 shrink-0">
          <Trash2 className="w-3 h-3" style={{ color: D.red }} />
        </button>
      </div>
      {/* Row 2: color picker | Label | UoM */}
      <div className="flex items-end gap-2">
        <div className="space-y-0.5 shrink-0">
          <span className="text-[10px]" style={{ color: D.muted }}>Color</span>
          <div className="flex gap-1">
            {NEON_PALETTE.slice(0, 6).map(c => (
              <button key={c} onClick={() => onChange("color", c)}
                className={cn("w-4 h-4 rounded-full border-2 transition-all", overlay.color === c ? "border-white scale-110" : "border-transparent")}
                style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-0.5">
          <span className="text-[10px]" style={{ color: D.muted }}>Label</span>
          <input type="text" value={overlay.label ?? ""} onChange={e => onChange("label", e.target.value)}
            placeholder="Display name"
            className="w-full h-6 text-[11px] rounded border px-1.5 outline-none"
            style={{ background: "#ffffff", color: "#111827", borderColor: D.border2 }} />
        </div>
        <div className="w-20 shrink-0 space-y-0.5">
          <span className="text-[10px]" style={{ color: D.muted }}>UoM</span>
          <input type="text" value={overlay.uom ?? ""} onChange={e => onChange("uom", e.target.value)}
            placeholder="kWh"
            className="w-full h-6 text-[11px] rounded border px-1.5 outline-none"
            style={{ background: "#ffffff", color: "#111827", borderColor: D.border2 }} />
        </div>
      </div>
    </div>
  );
}

function WidgetDialog({ open, onOpenChange, initial, onSave, preselectedAssetId }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  initial?: Widget | null; onSave: (w: Widget) => void; preselectedAssetId?: string;
}) {
  const nextColor = NEON_PALETTE[0];
  const [title,        setTitle]        = useState(initial?.title ?? "");
  const [chartType,    setChartType]    = useState<ChartType>(initial?.chartType ?? "line");
  const [assetId,      setAssetId]      = useState(initial?.assetId ?? preselectedAssetId ?? "");
  const [metric,       setMetric]       = useState(initial?.metric ?? "");
  const [rangeMinutes, setRangeMinutes] = useState(initial?.rangeMinutes ?? 60);
  const [color,        setColor]        = useState(initial?.color ?? nextColor);
  const [minVal,       setMinVal]       = useState(String(initial?.minVal ?? "0"));
  const [maxVal,       setMaxVal]       = useState(String(initial?.maxVal ?? "100"));
  const [unit,         setUnit]         = useState(initial?.unit ?? "");
  const [width,        setWidth]        = useState(initial?.width ?? 1);
  const [height,       setHeight]       = useState(initial?.height ?? 1);
  const [useCustom,    setUseCustom]    = useState(!!(initial?.customFrom));
  const [customFrom,   setCustomFrom]   = useState(initial?.customFrom ?? "");
  const [customTo,     setCustomTo]     = useState(initial?.customTo ?? "");
  const [overlayMetrics, setOverlayMetrics] = useState<OverlayMetric[]>(initial?.overlayMetrics ?? []);
  const [telemetryMetrics, setTelemetryMetrics] = useState<string[]>([]);
  const [granularity,  setGranularity]  = useState<string>(initial?.granularity ?? "auto");
  const [aggType,      setAggType]      = useState<string>(initial?.aggType ?? "avg");
  const [imageUrl,     setImageUrl]     = useState(initial?.imageUrl ?? "");
  const [imageMode,    setImageMode]    = useState<"background" | "icon">(initial?.imageMode ?? "background");
  const [ucl,          setUcl]          = useState(initial?.ucl !== undefined ? String(initial.ucl) : "");
  const [lcl,          setLcl]          = useState(initial?.lcl !== undefined ? String(initial.lcl) : "");
  const [centerLine,   setCenterLine]   = useState(initial?.centerLine !== undefined ? String(initial.centerLine) : "");
  const [uclColor,     setUclColor]     = useState(initial?.uclColor  ?? D.amber);
  const [lclColor,     setLclColor]     = useState(initial?.lclColor  ?? D.amber);
  const [clColor,      setClColor]      = useState(initial?.clColor   ?? D.green);
  const [uclStyle,     setUclStyle]     = useState<"solid"|"dashed">(initial?.uclStyle ?? "dashed");
  const [lclStyle,     setLclStyle]     = useState<"solid"|"dashed">(initial?.lclStyle ?? "dashed");
  const [clStyle,      setClStyle]      = useState<"solid"|"dashed">(initial?.clStyle  ?? "solid");
  const [seriesLabel,  setSeriesLabel]  = useState(initial?.label  ?? "");
  const [seriesUom,    setSeriesUom]    = useState(initial?.uom    ?? "");

  const { data: assets }     = useListAssets();
  const { data: attributes } = useListAssetAttributes(assetId, { query: { enabled: !!assetId, queryKey: ["asset-attributes", assetId] } });
  const assetList   = (assets as any[] | undefined) ?? [];
  const metricAttrs = ((attributes as any[] | undefined) ?? []).filter((a: any) => metricKeyOf(a));
  const assetName   = assetList.find((a: any) => a.id === assetId)?.name ?? "";
  const canOverlay  = supportsOverlay(chartType);

  // Always fetch actual telemetry metric keys — these are the definitive stored keys for API queries
  useEffect(() => {
    if (!assetId) { setTelemetryMetrics([]); return; }
    fetch(`${BASE}/api/telemetry/${assetId}/metrics`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((keys: string[]) => setTelemetryMetrics(keys))
      .catch(() => setTelemetryMetrics([]));
  }, [assetId]);

  // Map a telemetry key to a friendly attribute label (handles "assetId.metric" prefix in tagName)
  function labelForKey(key: string): string {
    const m = metricAttrs.find((a: any) => {
      const tag = metricKeyOf(a); if (!tag) return false;
      return tag === key || tag.split('.').slice(1).join('.') === key;
    });
    return m ? `${m.name} (${key})` : key;
  }

  // Auto-select first energy/kWh metric when dialog opens with no metric chosen
  useEffect(() => {
    if (!open || initial || metric) return;
    const candidates = telemetryMetrics.length > 0 ? telemetryMetrics
      : metricAttrs.map((a: any) => metricValueOf(a));
    if (candidates.length === 0) return;
    const preferred = candidates.find(k =>
      /energy/i.test(k) || /kwh/i.test(k) || /kWh/.test(k)
    ) ?? candidates[0];
    setMetric(preferred);
  }, [open, initial, metric, telemetryMetrics, metricAttrs]);

  useEffect(() => { if (preselectedAssetId && !initial) setAssetId(preselectedAssetId); }, [preselectedAssetId]);
  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setChartType(initial?.chartType ?? "line");
    setAssetId(initial?.assetId ?? preselectedAssetId ?? "");
    setMetric(initial?.metric ?? "");
    setRangeMinutes(initial?.rangeMinutes ?? 60);
    setColor(initial?.color ?? nextColor);
    setMinVal(String(initial?.minVal ?? "0"));
    setMaxVal(String(initial?.maxVal ?? "100"));
    setUnit(initial?.unit ?? "");
    setWidth(initial?.width ?? 1);
    setHeight(initial?.height ?? 1);
    setUseCustom(!!initial?.customFrom);
    setCustomFrom(initial?.customFrom ?? "");
    setCustomTo(initial?.customTo ?? "");
    setOverlayMetrics(initial?.overlayMetrics ?? []);
    setTelemetryMetrics(initial?.metric ? [initial.metric] : []);
    setGranularity(initial?.granularity ?? "auto");
    setAggType(initial?.aggType ?? "avg");
    setImageUrl(initial?.imageUrl ?? "");
    setImageMode(initial?.imageMode ?? "background");
    setUcl(initial?.ucl !== undefined ? String(initial.ucl) : "");
    setLcl(initial?.lcl !== undefined ? String(initial.lcl) : "");
    setCenterLine(initial?.centerLine !== undefined ? String(initial.centerLine) : "");
    setUclColor(initial?.uclColor  ?? D.amber);
    setLclColor(initial?.lclColor  ?? D.amber);
    setClColor(initial?.clColor   ?? D.green);
    setUclStyle(initial?.uclStyle ?? "dashed");
    setLclStyle(initial?.lclStyle ?? "dashed");
    setClStyle(initial?.clStyle  ?? "solid");
    setSeriesLabel(initial?.label ?? "");
    setSeriesUom(initial?.uom    ?? "");
  }, [open, initial, preselectedAssetId, nextColor]);

  function addOverlay() { setOverlayMetrics(prev => [...prev, { assetId:"", assetName:"", metric:"", color: NEON_PALETTE[(prev.length+1)%NEON_PALETTE.length] }]); }
  function removeOverlay(i: number) { setOverlayMetrics(prev => prev.filter((_,idx)=>idx!==i)); }
  function updateOverlay(i: number, field: keyof OverlayMetric, value: string) {
    setOverlayMetrics(prev => prev.map((o,idx) => {
      if (idx !== i) return o;
      const updated = { ...o, [field]: value };
      if (field === "assetId") { updated.assetName = assetList.find((a: any)=>a.id===value)?.name??""; updated.metric = ""; }
      return updated;
    }));
  }

  function handleSave() {
    if (!assetId || !metric) return;
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      title: title || `${assetName} / ${metric}`,
      chartType, assetId, assetName, metric, rangeMinutes, color,
      minVal: Number(minVal), maxVal: Number(maxVal), unit, width, height,
      customFrom: useCustom ? customFrom : undefined,
      customTo:   useCustom ? customTo   : undefined,
      overlayMetrics: canOverlay ? overlayMetrics.filter(o => o.assetId && o.metric) : [],
      granularity: granularity as Widget["granularity"],
      aggType: aggType as Widget["aggType"],
      imageUrl: imageUrl.trim() || undefined,
      imageMode: imageUrl.trim() ? imageMode : undefined,
      label: seriesLabel.trim() || undefined,
      uom: seriesUom.trim() || undefined,
      ucl: ucl.trim() !== "" ? Number(ucl) : undefined,
      lcl: lcl.trim() !== "" ? Number(lcl) : undefined,
      centerLine: centerLine.trim() !== "" ? Number(centerLine) : undefined,
      uclColor: ucl.trim() !== "" ? uclColor : undefined,
      lclColor: lcl.trim() !== "" ? lclColor : undefined,
      clColor:  centerLine.trim() !== "" ? clColor : undefined,
      uclStyle: ucl.trim() !== "" ? uclStyle : undefined,
      lclStyle: lcl.trim() !== "" ? lclStyle : undefined,
      clStyle:  centerLine.trim() !== "" ? clStyle : undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 flex flex-col" style={{ maxHeight: "90vh" }}>
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b border-border">
          <DialogTitle>{initial ? "Edit Widget" : "Add Widget"}</DialogTitle>
          <DialogDescription>Configure your visualization widget</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-4 space-y-4">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Widget Type</Label>
            <select value={chartType} onChange={e => setChartType(e.target.value as ChartType)}
              className="w-full h-9 rounded border border-border bg-background px-2 text-sm">
              {CHART_TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Title (optional)</Label>
            <Input className="h-8 text-xs" value={title} onChange={e => setTitle(e.target.value)} placeholder="Auto-generated if blank" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Asset</Label>
            <select value={assetId} onChange={e => { setAssetId(e.target.value); setMetric(""); }}
              className="w-full h-8 rounded border border-border bg-background px-2 text-xs">
              <option value="">Select asset…</option>
              {assetList.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Primary Metric</Label>
            <select value={metric} onChange={e => setMetric(e.target.value)} disabled={!assetId}
              className="w-full h-8 rounded border border-border bg-background px-2 text-xs disabled:opacity-50">
              <option value="">{assetId ? (telemetryMetrics.length === 0 ? "Loading…" : "Select metric…") : "Select asset first"}</option>
              {telemetryMetrics.length > 0
                ? telemetryMetrics.map(k => <option key={k} value={k}>{labelForKey(k)}</option>)
                : metricAttrs.map((a: any) => <option key={metricValueOf(a)} value={metricValueOf(a)}>{a.name}</option>)
              }
            </select>
            {assetId && telemetryMetrics.length === 0 && metricAttrs.length === 0 && (
              <p className="text-[10px]" style={{ color: D.amber }}>No telemetry found — run the Simulator first to populate metrics.</p>
            )}
            {assetId && telemetryMetrics.length > 0 && (
              <p className="text-[10px]" style={{ color: D.muted }}>
                {metricAttrs.length > 0 ? "Metrics from live telemetry — attribute names shown where matched." : "Showing live telemetry metrics."}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div className="space-y-1">
                <Label className="text-xs">Label</Label>
                <input type="text" value={seriesLabel} onChange={e => setSeriesLabel(e.target.value)}
                  placeholder="Short display name"
                  className="w-full h-7 text-xs rounded border px-2 outline-none"
                  style={{ background: "#ffffff", color: "#111827", borderColor: D.border2 }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">UoM</Label>
                <input type="text" value={seriesUom} onChange={e => setSeriesUom(e.target.value)}
                  placeholder="e.g. kWh, °C"
                  className="w-full h-7 text-xs rounded border px-2 outline-none"
                  style={{ background: "#ffffff", color: "#111827", borderColor: D.border2 }} />
              </div>
            </div>
          </div>
          {canOverlay && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Overlay Metrics (multi-series)</Label>
                <button onClick={addOverlay}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded"
                  style={{ background:`${D.accent}22`, color:D.accent, border:`1px solid ${D.accent}44` }}>
                  <Plus className="w-2.5 h-2.5" /> Add Series
                </button>
              </div>
              {overlayMetrics.map((ov, i) => (
                <OverlayRow key={i} overlay={ov} assetList={assetList} index={i}
                  onChange={(field,val)=>updateOverlay(i,field,val)} onRemove={()=>removeOverlay(i)} />
              ))}
              {overlayMetrics.length === 0 && (
                <p className="text-[10px]" style={{ color: D.muted }}>Add extra series to overlay on the same chart from any asset.</p>
              )}
            </div>
          )}
          {chartType === "gauge" && (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1"><Label className="text-xs">Min</Label><Input className="h-8 text-xs" type="number" value={minVal} onChange={e=>setMinVal(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Max</Label><Input className="h-8 text-xs" type="number" value={maxVal} onChange={e=>setMaxVal(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Unit</Label><Input className="h-8 text-xs" value={unit} onChange={e=>setUnit(e.target.value)} placeholder="°C" /></div>
            </div>
          )}
          {chartType === "kpi" && (
            <div className="space-y-1"><Label className="text-xs">Unit (optional)</Label><Input className="h-8 text-xs" value={unit} onChange={e=>setUnit(e.target.value)} placeholder="kWh, rpm…" /></div>
          )}
          <div className="rounded-md bg-muted/30 border border-border px-3 py-2.5 flex items-start gap-2">
            <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Time range, granularity, and aggregation are configured per-widget via the{" "}
              <strong className="text-foreground">clock icon</strong> in the widget header after saving.
              WTD, MTD, YTD and custom date ranges are also available there.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Widget Size</Label>
            <p className="text-[10px] text-muted-foreground">
              Drag the bottom-right corner of a widget on the dashboard to resize height and width simultaneously.
              Drag the grip icon (⠿) in the header to reorder widgets.
            </p>
          </div>
          {(["line","area","bar","stackbar"] as ChartType[]).includes(chartType) && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Control Limit Lines (SPC)</Label>
              <p className="text-[10px]" style={{ color: D.muted }}>Enter a Y-axis value to draw a horizontal reference line on the chart. Leave blank to hide.</p>
              <SpcRow label="UCL" val={ucl} setVal={setUcl} col={uclColor} setCol={setUclColor} sty={uclStyle} setSty={setUclStyle} />
              <SpcRow label="LCL" val={lcl} setVal={setLcl} col={lclColor} setCol={setLclColor} sty={lclStyle} setSty={setLclStyle} />
              <SpcRow label="CL"  val={centerLine} setVal={setCenterLine} col={clColor} setCol={setClColor} sty={clStyle} setSty={setClStyle} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Primary Color</Label>
            <div className="flex gap-2 flex-wrap">
              {NEON_PALETTE.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={cn("w-6 h-6 rounded-full border-2 transition-all", color===c?"border-white scale-125":"border-transparent")}
                  style={{ background:c, boxShadow:color===c?`0 0 8px ${c}`:"none" }} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Widget Image (optional)</Label>
            <Input className="h-8 text-xs font-mono" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              placeholder="Paste image URL or copy from Media Library" />
            {imageUrl && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {(["background", "icon"] as const).map(mode => (
                    <button key={mode} onClick={() => setImageMode(mode)}
                      className={cn("flex-1 py-1.5 rounded text-xs border transition-all capitalize",
                        imageMode === mode ? "border-accent/70 bg-accent/10 text-accent" : "border-border text-muted-foreground")}
                      style={{ color: imageMode === mode ? D.accent : undefined, borderColor: imageMode === mode ? D.accent : undefined }}>
                      {mode === "background" ? "Background" : "Header Icon"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 rounded border border-border p-2 bg-muted/20">
                  <img src={imageUrl} alt="Preview" className="w-10 h-10 object-contain rounded shrink-0"
                    onError={e => { (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='1.5'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Cpath d='M3 9l4-4 4 4 4-6 6 8'/%3E%3C/svg%3E"; }} />
                  <p className="text-[10px]" style={{ color: D.muted }}>
                    {imageMode === "background"
                      ? "Image will display as a subtle background behind the chart."
                      : "Image will show as a small icon in the widget header bar."}
                  </p>
                </div>
              </div>
            )}
            {!imageUrl && (
              <p className="text-[10px]" style={{ color: D.muted }}>
                Upload images first in <strong>Asset Management → Media Library</strong>, then copy the URL here.
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="px-6 py-4 shrink-0 border-t border-border">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!assetId || !metric}>{initial ? "Update Widget" : "Add Widget"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dashboard Dialog ───────────────────────────────────────────────────────────
function DashboardDialog({ open, onOpenChange, initial, onSave }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  initial?: Dashboard | null; onSave: (d: Partial<Dashboard>) => void;
}) {
  const [name,       setName] = useState(initial?.name ?? "");
  const [description,setDesc] = useState(initial?.description ?? "");
  const [roleAccess, setRoleAccess] = useState<Role[]>(initial?.roleAccess ?? [...ALL_ROLES]);

  useEffect(() => {
    if (open) { setName(initial?.name??""); setDesc(initial?.description??""); setRoleAccess(initial?.roleAccess??[...ALL_ROLES]); }
  }, [open, initial]);

  function toggleRole(r: Role) { setRoleAccess(prev => prev.includes(r) ? prev.filter(x=>x!==r) : [...prev,r]); }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Dashboard" : "New Dashboard"}</DialogTitle>
          <DialogDescription>Set a name, description, and which user roles can see this dashboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Dashboard Name *</Label>
            <Input className="h-9" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Plant 1 Overview, Fan Monitoring" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Description (optional)</Label>
            <Textarea className="text-xs resize-none h-16" value={description} onChange={e=>setDesc(e.target.value)} placeholder="What this dashboard monitors…" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Access Control</Label>
            <p className="text-[10px]" style={{ color: D.muted }}>Toggle which roles can view this dashboard. All roles selected = everyone can see it.</p>
            <div className="flex gap-2 flex-wrap">
              {ALL_ROLES.map(r => (
                <button key={r} onClick={() => toggleRole(r)}
                  className={cn("px-3 py-1.5 rounded-full text-xs font-medium border capitalize transition-all",
                    roleAccess.includes(r)?"border-current":"border-border opacity-40")}
                  style={{ color:ROLE_COLORS[r], borderColor:roleAccess.includes(r)?ROLE_COLORS[r]:undefined,
                    background:roleAccess.includes(r)?ROLE_COLORS[r]+"22":"transparent" }}>
                  {r}
                </button>
              ))}
            </div>
            {roleAccess.length === 0 && <p className="text-[10px] text-destructive">Select at least one role.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!name||!roleAccess.length}
            onClick={() => { if (name&&roleAccess.length) { onSave({ name, description, roleAccess }); onOpenChange(false); } }}>
            {initial ? "Save Changes" : "Create Dashboard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Main Visualization Page ───────────────────────────────────────────────────

async function apiDash(method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}/api${path}`, {
    method, credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function Visualization() {
  const { currentUser } = useCurrentUser();
  const userRole = currentUser?.role ?? "viewer";
  const canManage = ["admin","engineer"].includes(userRole);
  const qc = useQueryClient();
  const deleteAsset = useDeleteAsset();

  const [dashboards,    setDashboards]    = useState<Dashboard[]>([]);
  const [dashLoading,   setDashLoading]   = useState(true);
  const [activeDashId,  setActiveDashId]  = useState<string | null>(null);
  const [dialogOpen,   setDialogOpen]   = useState(false);
  const [editWidget,   setEditWidget]   = useState<Widget | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [treeOpen,     setTreeOpen]     = useState(true);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [globalRange,  setGlobalRange]  = useState<number | null>(null);
  const [dragId,       setDragId]       = useState<string | null>(null);
  const [dragOverId,   setDragOverId]   = useState<string | null>(null);
  const [liveSpans,    setLiveSpans]    = useState<Record<string, number>>({});
  // dragAllowRef: set to widget id when the grip handle is mousedown'd, cleared after dragstart
  const dragAllowRef = useRef<string | null>(null);

  // Global refresh control
  const [dashRefreshEnabled,  setDashRefreshEnabled]  = useState(false);
  const [dashRefreshInterval, setDashRefreshInterval] = useState(30_000);
  const [dashRefreshSignal,   setDashRefreshSignal]   = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  function refreshAll() { setDashRefreshSignal(s => s + 1); }
  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (dashRefreshEnabled) refreshTimerRef.current = setInterval(refreshAll, dashRefreshInterval);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [dashRefreshEnabled, dashRefreshInterval]);

  // Dashboard dialogs
  const [dbDialogOpen,   setDbDialogOpen]   = useState(false);
  const [editDashboard,  setEditDashboard]  = useState<Dashboard | null>(null);
  const [deleteConfirmId,setDeleteConfirmId]= useState<string | null>(null);

  // Asset management from tree panel
  const [assetDialogOpen,   setAssetDialogOpen]   = useState(false);
  const [assetDialogParent, setAssetDialogParent] = useState<string | null>(null);
  const [assetDialogEdit,   setAssetDialogEdit]   = useState<AssetNodeWithTelemetry | null>(null);
  const [deleteAssetConfirm,setDeleteAssetConfirm]= useState<AssetNodeWithTelemetry | null>(null);

  // Widget clipboard (copy/paste between dashboards)
  const [clipboard, setClipboard] = useState<Widget | null>(null);

  const { data: assets } = useListAssets();
  const assetList = (assets as any[] | undefined) ?? [];
  const roots     = assetList.filter(a => !a.parentId);

  // Real-time WebSocket telemetry signals: assetId → last received timestamp
  const [wsSignals, setWsSignals] = useState<Record<string, number>>({});
  useWsEvents({
    telemetry: (data: any) => {
      if (data?.assetId) setWsSignals(prev => ({ ...prev, [data.assetId]: Date.now() }));
    }
  });

  // ── Load dashboards from API on mount; migrate localStorage if needed ────────
  useEffect(() => {
    apiDash("GET", "/viz-dashboards")
      .then(async (rows: Dashboard[]) => {
        if (rows.length === 0) {
          // One-time migration of any localStorage dashboards
          try {
            const local: Dashboard[] = JSON.parse(localStorage.getItem(DASHBOARDS_KEY) ?? "[]");
            if (local.length > 0) {
              const migrated = await Promise.all(local.map(d =>
                apiDash("POST", "/viz-dashboards", { name: d.name, roleAccess: d.roleAccess ?? ALL_ROLES, widgets: d.widgets ?? [] })
              ));
              localStorage.removeItem(DASHBOARDS_KEY);
              setDashboards(migrated);
              setActiveDashId(migrated[0]?.id ?? null);
              return;
            }
          } catch { /* ignore migration errors */ }
        }
        setDashboards(rows);
        setActiveDashId(prev => prev ?? rows[0]?.id ?? null);
      })
      .catch(() => setDashboards([]))
      .finally(() => setDashLoading(false));
  }, []);

  // Debounced widget sync — pushes widget array to server 800ms after any widget change
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncWidgets = useCallback((dashId: string, widgets: Widget[]) => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      apiDash("PUT", `/viz-dashboards/${dashId}`, { widgets }).catch(() => {});
    }, 800);
  }, []);

  // Visible dashboards (role-filtered)
  const visibleDashboards = useMemo(() =>
    dashboards.filter(d => d.roleAccess.includes(userRole as Role)),
    [dashboards, userRole]
  );

  // Auto-select first dashboard only when activeDashId is null (don't override explicit selection)
  useEffect(() => {
    if (!activeDashId && visibleDashboards.length > 0) {
      setActiveDashId(visibleDashboards[0].id);
    }
  }, [visibleDashboards.length, activeDashId]);

  const activeDash = useMemo(() => {
    if (activeDashId) return visibleDashboards.find(d => d.id === activeDashId) ?? null;
    return visibleDashboards[0] ?? null;
  }, [visibleDashboards, activeDashId]);

  // ── Dashboard CRUD ──────────────────────────────────────────────────────────
  async function createDashboard(fields: Partial<Dashboard>) {
    try {
      const d: Dashboard = await apiDash("POST", "/viz-dashboards", {
        name: fields.name ?? "New Dashboard",
        roleAccess: fields.roleAccess ?? [...ALL_ROLES],
        widgets: [],
      });
      setDashboards(prev => [...prev, d]);
      setActiveDashId(d.id);
    } catch { toast({ title: "Failed to create dashboard", variant: "destructive" }); }
  }
  async function updateDashboard(id: string, fields: Partial<Dashboard>) {
    try {
      const updated: Dashboard = await apiDash("PUT", `/viz-dashboards/${id}`, fields);
      setDashboards(prev => prev.map(d => d.id === id ? { ...d, ...updated } : d));
    } catch { toast({ title: "Failed to update dashboard", variant: "destructive" }); }
  }
  async function cloneDashboard(d: Dashboard) {
    const baseName = `${d.name}_clone`;
    const existingNames = dashboards.map(x => x.name);
    let cloneName = baseName;
    let counter = 2;
    while (existingNames.includes(cloneName)) { cloneName = `${baseName}${counter++}`; }
    try {
      const clone: Dashboard = await apiDash("POST", "/viz-dashboards", {
        name: cloneName,
        roleAccess: d.roleAccess ?? [...ALL_ROLES],
        widgets: d.widgets.map(w => ({ ...w, id: crypto.randomUUID() })),
      });
      setDashboards(prev => [...prev, clone]);
      setActiveDashId(clone.id);
      toast({ title: `Dashboard cloned as "${cloneName}"` });
    } catch { toast({ title: "Failed to clone dashboard", variant: "destructive" }); }
  }
  async function deleteDashboard(id: string) {
    const name = dashboards.find(d => d.id === id)?.name;
    setDashboards(prev => prev.filter(d => d.id !== id));
    if (activeDashId === id) setActiveDashId(null);
    try {
      await apiDash("DELETE", `/viz-dashboards/${id}`);
      toast({ title: `Dashboard "${name}" deleted` });
    } catch { toast({ title: "Failed to delete dashboard", variant: "destructive" }); }
  }

  // ── Widget CRUD ─────────────────────────────────────────────────────────────
  function mutateWidgets(dashId: string, updater: (ws: Widget[]) => Widget[]) {
    const current = dashboards.find(d => d.id === dashId);
    const next = current ? updater(current.widgets) : [];
    setDashboards(prev => prev.map(d => d.id !== dashId ? d : { ...d, widgets: next }));
    syncWidgets(dashId, next);
  }
  function addOrUpdateWidget(w: Widget) {
    if (!activeDash) { createDashboard({ name: "My Dashboard" }); return; }
    mutateWidgets(activeDash.id, ws => {
      const idx = ws.findIndex(x => x.id === w.id);
      return idx >= 0 ? ws.map((x, i) => i === idx ? w : x) : [...ws, w];
    });
  }
  function reorderWidgets(fromId: string, toId: string) {
    if (!activeDash || fromId === toId) return;
    mutateWidgets(activeDash.id, ws => {
      const arr = [...ws];
      const fromIdx = arr.findIndex(w => w.id === fromId);
      const toIdx   = arr.findIndex(w => w.id === toId);
      if (fromIdx < 0 || toIdx < 0) return ws;
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr;
    });
  }
  function removeWidget(id: string) {
    if (!activeDash) return;
    mutateWidgets(activeDash.id, ws => ws.filter(w => w.id !== id));
  }
  function cloneWidget(w: Widget) {
    if (!activeDash) return;
    const cloned: Widget = { ...w, id: crypto.randomUUID(), title: `${w.title} (Copy)` };
    mutateWidgets(activeDash.id, ws => [...ws, cloned]);
    toast({ title: "Widget cloned" });
  }
  function duplicateWidget(w: Widget) {
    if (!activeDash) return;
    const duplicated: Widget = { ...w, id: crypto.randomUUID(), title: `${w.title} (Duplicate)` };
    mutateWidgets(activeDash.id, ws => [...ws, duplicated]);
    toast({ title: "Widget duplicated" });
  }
  function copyWidget(w: Widget) {
    setClipboard({ ...w });
    toast({ title: `"${w.title}" copied to clipboard`, description: "Switch dashboards and use Paste to add it there." });
  }
  function pasteWidget() {
    if (!clipboard || !activeDash) return;
    const pasted: Widget = { ...clipboard, id: crypto.randomUUID(), title: `${clipboard.title} (Pasted)` };
    mutateWidgets(activeDash.id, ws => [...ws, pasted]);
    toast({ title: "Widget pasted" });
  }
  function applyGlobalRange(minutes: number) {
    setGlobalRange(minutes);
    if (!activeDash) return;
    mutateWidgets(activeDash.id, ws =>
      ws.map(w =>
        w.allowOverride === false
          ? w
          : { ...w, rangeMinutes: minutes, customFrom: undefined, customTo: undefined }
      )
    );
  }

  // ── Asset management from tree ──────────────────────────────────────────────
  function handleAssetSaved() {
    qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
    toast({ title: "Asset saved" });
  }
  function handleDeleteAsset(asset: AssetNodeWithTelemetry) { setDeleteAssetConfirm(asset); }
  async function confirmDeleteAsset() {
    if (!deleteAssetConfirm) return;
    try {
      await deleteAsset.mutateAsync({ id: deleteAssetConfirm.id });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      if (selectedAssetId === deleteAssetConfirm.id) setSelectedAssetId(null);
      toast({ title: `"${deleteAssetConfirm.name}" deleted` });
    } catch { toast({ title: "Failed to delete asset", variant: "destructive" }); }
    finally { setDeleteAssetConfirm(null); }
  }

  const widgets = activeDash?.widgets ?? [];
  const latestByAsset = useAssetTelemetryMap(widgets);
  const assetListWithTelemetry = useMemo(() => assetList.map((a: any) => ({ ...a, lastSeen: latestByAsset[a.id] ?? null })), [assetList, latestByAsset]);
  const displayWidgets = useMemo(() => {
    if (!selectedAssetId) return widgets;
    return widgets.filter(w => w.assetId === selectedAssetId || (w.overlayMetrics ?? []).some(o => o.assetId === selectedAssetId));
  }, [widgets, selectedAssetId]);

  function sizeClass() { return "col-span-1"; }

  return (
    <div className="flex h-full overflow-hidden" style={{ background: D.bg }}>

      {/* ── Asset Hierarchy Panel ── */}
      {treeOpen && (
        <div className="w-60 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ background: D.panel, borderRight: `1px solid ${D.border}` }}>

          {/* Tree header */}
          <div className="px-3 py-2 shrink-0 flex items-center justify-between"
            style={{ borderBottom: `1px solid ${D.border}` }}>
            <span className="text-xs font-semibold" style={{ color: D.accent }}>Asset Hierarchy</span>
            <div className="flex items-center gap-1">
              {canManage && (
                <button
                  onClick={() => { setAssetDialogEdit(null); setAssetDialogParent(null); setAssetDialogOpen(true); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium"
                  style={{ background:`${D.green}22`, color:D.green, border:`1px solid ${D.green}44` }}
                  title="New root project">
                  <FolderPlus className="w-3 h-3" /> New Project
                </button>
              )}
              <button onClick={() => setSelectedAssetId(null)} title="Clear filter" className="p-0.5 rounded hover:bg-white/5">
                <RotateCcw className="w-3 h-3" style={{ color: D.muted }} />
              </button>
            </div>
          </div>

          {/* Tree content */}
          <div className="flex-1 overflow-y-auto py-1">
            {/* All Assets entry */}
            <div className="flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded mx-1 transition-all"
              style={{ background:selectedAssetId===null?`${D.accent}18`:"transparent", color:selectedAssetId===null?D.accent:D.muted }}
              onClick={() => setSelectedAssetId(null)}>
              <LayoutDashboard className="w-3 h-3 shrink-0" />
              <span style={{ fontSize:11 }}>All Assets</span>
              <span className="ml-auto text-[9px] px-1 rounded" style={{ background:D.border2, color:D.muted }}>{widgets.length}</span>
            </div>

            {roots.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-[10px]" style={{ color: D.muted }}>No assets — create one above</p>
              </div>
            ) : assetListWithTelemetry.filter(a => !a.parentId).map(root => (
              <AssetTreeNode key={root.id} asset={root} allAssets={assetListWithTelemetry}
                selectedId={selectedAssetId} depth={0}
                onSelect={a => setSelectedAssetId(prev => prev === a.id ? null : a.id)}
                onAddChild={parentId => { setAssetDialogEdit(null); setAssetDialogParent(parentId); setAssetDialogOpen(true); }}
                onEdit={a => { setAssetDialogEdit(a); setAssetDialogParent(null); setAssetDialogOpen(true); }}
                onDelete={handleDeleteAsset} />
            ))}
          </div>

          {/* Add widget for selected asset */}
          {selectedAssetId && activeDash && (
            <div className="p-2 shrink-0" style={{ borderTop:`1px solid ${D.border}` }}>
              <button onClick={() => { setEditWidget(null); setDialogOpen(true); }}
                className="w-full flex items-center justify-center gap-1.5 rounded py-1.5 text-xs font-medium"
                style={{ background:`${D.accent}22`, color:D.accent, border:`1px solid ${D.accent}44` }}>
                <Plus className="w-3 h-3" /> Add Widget for This Asset
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Main Canvas ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Toolbar ── */}
        <div className="flex items-center gap-2 px-3 py-2 shrink-0 flex-wrap"
          style={{ background: D.panel, borderBottom: `1px solid ${D.border}` }}>

          {/* Tree toggle */}
          <button onClick={() => setTreeOpen(o => !o)} className="p-1.5 rounded hover:bg-white/5">
            {treeOpen ? <PanelLeftClose className="w-4 h-4" style={{ color: D.accent }} />
                      : <PanelLeftOpen  className="w-4 h-4" style={{ color: D.accent }} />}
          </button>

          {/* Dashboard selector */}
          <div className="flex items-center gap-1 min-w-0">
            <BookOpen className="w-3.5 h-3.5 shrink-0" style={{ color: D.accent }} />
            {visibleDashboards.length === 0 ? (
              <button
                onClick={() => { setEditDashboard(null); setDbDialogOpen(true); }}
                className="h-7 rounded px-3 text-xs font-semibold border flex items-center gap-1.5"
                style={{ background: D.card, color: D.accent, borderColor: D.accent, borderStyle: "dashed" }}>
                <Plus className="w-3 h-3" /> New Dashboard
              </button>
            ) : (
              <select
                value={activeDash?.id ?? ""}
                onChange={e => setActiveDashId(e.target.value || null)}
                className="h-7 rounded px-2 text-xs font-semibold border max-w-[200px]"
                style={{ background: D.card, color: D.text, borderColor: D.border2 }}>
                {visibleDashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}

            {/* Dashboard actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded hover:bg-white/5" style={{ color: D.muted }} title="Dashboard options">
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem onClick={() => { setEditDashboard(null); setDbDialogOpen(true); }}>
                  <Plus className="w-3.5 h-3.5 mr-2" /> New Dashboard
                </DropdownMenuItem>
                {activeDash && (<>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setEditDashboard(activeDash); setDbDialogOpen(true); }}>
                    <Edit2 className="w-3.5 h-3.5 mr-2" /> Edit Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => cloneDashboard(activeDash)}>
                    <Copy className="w-3.5 h-3.5 mr-2" /> Clone Dashboard
                  </DropdownMenuItem>
                  {canManage && (<>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { setEditDashboard(activeDash); setDbDialogOpen(true); }}>
                      <Shield className="w-3.5 h-3.5 mr-2" /> Access Control
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteConfirmId(activeDash.id)}>
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Dashboard
                    </DropdownMenuItem>
                  </>)}
                </>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Role badge */}
          <div className="px-2 py-0.5 rounded-full text-[10px] font-medium capitalize shrink-0"
            style={{ background: D.border2, color: ROLE_COLORS[userRole as Role] ?? D.muted }}>
            <Shield className="w-2.5 h-2.5 inline mr-1" />
            {userRole}
          </div>

          <div className="flex-1" />

          {/* Clipboard paste button */}
          {clipboard && activeDash && (
            <button onClick={pasteWidget}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium animate-pulse"
              style={{ background:`${D.amber}22`, color:D.amber, border:`1px solid ${D.amber}44` }}
              title={`Paste "${clipboard.title}" into this dashboard`}>
              <ClipboardPaste className="w-3.5 h-3.5" />
              Paste "{clipboard.title}"
            </button>
          )}

          {/* Global refresh control */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={refreshAll}
              className="p-1.5 rounded hover:bg-white/5 transition-colors"
              title="Refresh all widgets now"
              style={{ color: D.muted }}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <Switch
              checked={dashRefreshEnabled}
              onCheckedChange={setDashRefreshEnabled}
              className="scale-75 origin-left"
            />
            <span style={{ fontSize: 10, color: dashRefreshEnabled ? D.green : D.muted, userSelect: "none" }}>
              {dashRefreshEnabled ? "On" : "Off"}
            </span>
            <select
              value={dashRefreshInterval}
              onChange={e => setDashRefreshInterval(Number(e.target.value))}
              className="h-7 rounded px-2 text-xs border"
              style={{ background: D.card, color: D.text, borderColor: D.border2 }}
              title="Refresh interval">
              {REFRESH_INTERVALS.map(r => <option key={r.ms} value={r.ms}>{r.label}</option>)}
            </select>
          </div>

          {/* Global time range */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Clock className="w-3.5 h-3.5" style={{ color: D.muted }} />
            <select value={globalRange ?? ""} onChange={e => { if (e.target.value) applyGlobalRange(Number(e.target.value)); }}
              className="h-7 rounded px-2 text-xs border"
              style={{ background:D.card, color:D.text, borderColor:D.border2 }}>
              <option value="">Set all ranges…</option>
              {RANGES.filter(r=>r.minutes>0).map(r => <option key={r.minutes} value={r.minutes}>{r.label}</option>)}
            </select>
          </div>

          {/* Add widget */}
          {activeDash && (
            <button onClick={() => { setEditWidget(null); setDialogOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold shrink-0"
              style={{ background:D.accent, color:"#000", boxShadow:`0 0 10px ${D.accent}44` }}>
              <Plus className="w-3.5 h-3.5" /> Add Widget
            </button>
          )}
        </div>

        {/* ── Main content ── */}
        {(() => {
          const hasAssets = assetList.length > 0;
          const hasDash   = !!activeDash;
          const hasWidgets = displayWidgets.length > 0;

          // Unified 3-step guide — shown whenever any step is incomplete
          if (!hasAssets || !hasDash || !hasWidgets) {
            const steps = [
              {
                num: 1,
                done: hasAssets,
                title: "Create an Asset",
                desc: "Assets represent your physical devices or equipment.",
                action: canManage ? (
                  <button
                    onClick={() => { setAssetDialogEdit(null); setAssetDialogParent(null); setAssetDialogOpen(true); }}
                    className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold"
                    style={{ background: D.green, color: "#000" }}>
                    <Plus className="w-3.5 h-3.5" /> Add Asset
                  </button>
                ) : null,
              },
              {
                num: 2,
                done: hasDash,
                title: "Create a Dashboard",
                desc: "Dashboards hold your charts and KPI widgets.",
                action: hasAssets ? (
                  <button
                    onClick={() => { setEditDashboard(null); setDbDialogOpen(true); }}
                    className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold"
                    style={{ background: D.accent, color: "#000" }}>
                    <Plus className="w-3.5 h-3.5" /> New Dashboard
                  </button>
                ) : null,
              },
              {
                num: 3,
                done: hasWidgets,
                title: "Add a Widget",
                desc: "Pick a chart type, select an asset and metric.",
                action: hasDash ? (
                  <button
                    onClick={() => { setEditWidget(null); setDialogOpen(true); }}
                    className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold"
                    style={{ background: D.accent2, color: "#fff" }}>
                    <Plus className="w-3.5 h-3.5" /> Add Widget
                  </button>
                ) : null,
              },
            ];

            const activeStep = !hasAssets ? 1 : !hasDash ? 2 : 3;

            return (
              <div className="flex-1 flex flex-col items-center justify-center px-6">
                <LayoutDashboard className="w-10 h-10 mb-4 opacity-20" style={{ color: D.accent }} />
                <p className="text-sm font-semibold mb-1" style={{ color: D.text }}>Get started with Visualization</p>
                <p className="text-xs mb-8" style={{ color: D.muted }}>Follow the steps below to build your first live dashboard.</p>

                <div className="flex items-start gap-0 w-full max-w-xl">
                  {steps.map((step, idx) => {
                    const isActive = step.num === activeStep;
                    const isDone   = step.done;
                    const isFuture = step.num > activeStep;
                    return (
                      <div key={step.num} className="flex items-start flex-1">
                        {/* Step card */}
                        <div className="flex flex-col items-center flex-1 text-center">
                          {/* Circle */}
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mb-3 shrink-0"
                            style={{
                              background: isDone ? D.green : isActive ? D.accent : D.border,
                              color: isDone || isActive ? "#000" : D.muted,
                              boxShadow: isActive ? `0 0 14px ${D.accent}66` : undefined,
                            }}>
                            {isDone ? "✓" : step.num}
                          </div>
                          {/* Card */}
                          <div className="w-full rounded-lg p-4 text-left"
                            style={{
                              background: isActive ? D.card : "transparent",
                              border: `1px solid ${isActive ? D.border2 : isFuture ? D.border + "60" : D.green + "44"}`,
                              opacity: isFuture ? 0.45 : 1,
                            }}>
                            <p className="text-xs font-semibold mb-1" style={{ color: isDone ? D.green : isActive ? D.text : D.muted }}>
                              {step.title}
                            </p>
                            <p className="text-[11px]" style={{ color: D.muted }}>{step.desc}</p>
                            {isActive && step.action}
                          </div>
                        </div>

                        {/* Connector line (not after last) */}
                        {idx < steps.length - 1 && (
                          <div className="w-8 shrink-0 mt-4" style={{ height: 1, background: step.done ? D.green : D.border }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          // Normal dashboard view
          return (
            <>
              {activeDash.description && (
                <div className="px-4 py-1.5 shrink-0" style={{ background:D.card, borderBottom:`1px solid ${D.border}` }}>
                  <p className="text-[10px]" style={{ color: D.muted }}>{activeDash.description}</p>
                </div>
              )}
              <div className="flex-1 overflow-auto p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 auto-rows-auto">
                  {displayWidgets.map(w => {
                    const span = Math.min(liveSpans[w.id] ?? w.width ?? 1, 4);
                    return (
                    <div key={w.id}
                      draggable
                      onDragStart={e => {
                        // Only allow drag when the grip handle triggered the mousedown
                        if (dragAllowRef.current !== w.id) { e.preventDefault(); return; }
                        dragAllowRef.current = null;
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(w.id);
                      }}
                      onDragOver={e => { e.preventDefault(); if (dragId && dragId !== w.id) setDragOverId(w.id); }}
                      onDrop={e => { e.preventDefault(); if (dragId && dragId !== w.id) reorderWidgets(dragId, w.id); setDragId(null); setDragOverId(null); }}
                      onDragEnd={() => { setDragId(null); setDragOverId(null); dragAllowRef.current = null; }}
                      style={{
                        gridColumn: `span ${span}`,
                        opacity: dragId === w.id ? 0.35 : 1,
                        transition: "opacity 0.15s",
                        outline: dragOverId === w.id && dragId !== w.id ? `2px solid ${D.accent}88` : "none",
                        borderRadius: 8,
                      }}>
                      <WidgetCard widget={w}
                        onDelete={() => removeWidget(w.id)}
                        onEdit={() => { setEditWidget(w); setDialogOpen(true); }}
                        onClone={() => cloneWidget(w)}
                        onDuplicate={() => duplicateWidget(w)}
                        onCopy={() => copyWidget(w)}
                        onUpdate={updates => addOrUpdateWidget({ ...w, ...updates })}
                        fullscreen={fullscreenId === w.id}
                        onFullscreen={() => setFullscreenId(prev => prev === w.id ? null : w.id)}
                        wsSignal={wsSignals[w.assetId]}
                        refreshSignal={dashRefreshSignal}
                        onDragHandleMouseDown={() => { dragAllowRef.current = w.id; }}
                        onLiveSpanChange={s => setLiveSpans(prev => s === null ? (({ [w.id]: _, ...rest }) => rest)(prev) : { ...prev, [w.id]: s })} />
                    </div>
                    );
                  })}
                </div>
              </div>
            </>
          );
        })()}

        {/* Status bar */}
        <div className="px-4 py-1.5 flex items-center gap-3 shrink-0"
          style={{ background:D.panel, borderTop:`1px solid ${D.border}` }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: D.green }} />
          <span style={{ fontSize:10, color:D.muted }}>
            {displayWidgets.length} widget{displayWidgets.length!==1?"s":""}{activeDash?` · "${activeDash.name}"`:""}
            {" · "}{dashRefreshEnabled
              ? `Auto-refresh ${REFRESH_INTERVALS.find(r=>r.ms===dashRefreshInterval)?.label ?? "…"}`
              : "Auto-refresh off"}
          </span>
          <span style={{ fontSize:10, color:D.border2 }}>·</span>
          <span style={{ fontSize:10, color:D.muted }}>{assetList.length} assets</span>
          <span style={{ fontSize:10, color:D.border2 }}>·</span>
          <span style={{ fontSize:10, color:D.muted }}>{visibleDashboards.length} dashboard{visibleDashboards.length!==1?"s":""}</span>
          {clipboard && (
            <>
              <span style={{ fontSize:10, color:D.border2 }}>·</span>
              <span style={{ fontSize:10, color:D.amber }}>
                <Clipboard className="w-2.5 h-2.5 inline mr-1" />Clipboard: "{clipboard.title}"
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── All Dialogs ── */}

      <WidgetDialog
        open={dialogOpen}
        onOpenChange={v => { setDialogOpen(v); if (!v) setEditWidget(null); }}
        initial={editWidget}
        onSave={addOrUpdateWidget}
        preselectedAssetId={selectedAssetId ?? undefined}
      />

      <DashboardDialog
        open={dbDialogOpen}
        onOpenChange={v => { setDbDialogOpen(v); if (!v) setEditDashboard(null); }}
        initial={editDashboard}
        onSave={fields => {
          if (editDashboard) updateDashboard(editDashboard.id, fields);
          else createDashboard(fields);
        }}
      />

      <AssetManageDialog
        open={assetDialogOpen}
        onOpenChange={v => { setAssetDialogOpen(v); if (!v) { setAssetDialogEdit(null); setAssetDialogParent(null); } }}
        parentId={assetDialogParent}
        editAsset={assetDialogEdit}
        allAssets={assetList}
        onSaved={handleAssetSaved}
      />

      {/* Delete dashboard confirm */}
      <Dialog open={!!deleteConfirmId} onOpenChange={open => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Dashboard</DialogTitle>
            <DialogDescription>
              "{dashboards.find(d=>d.id===deleteConfirmId)?.name}" and all its widgets will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => { if (deleteConfirmId) { deleteDashboard(deleteConfirmId); setDeleteConfirmId(null); } }}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete asset confirm */}
      <Dialog open={!!deleteAssetConfirm} onOpenChange={open => { if (!open) setDeleteAssetConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Asset</DialogTitle>
            <DialogDescription>
              "{deleteAssetConfirm?.name}" and all its child assets and telemetry data will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteAssetConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={confirmDeleteAsset} disabled={deleteAsset.isPending}>
              {deleteAsset.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
