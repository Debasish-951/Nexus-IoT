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
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ScatterChart, Scatter,
} from "recharts";
import {
  Plus, Trash2, RefreshCw, Settings2, TrendingUp, TrendingDown,
  Minus, Activity, LayoutDashboard, ChevronRight, ChevronDown,
  Folder, FolderOpen, Blocks, PanelLeftOpen, PanelLeftClose,
  BarChart2, PieChart as PieIcon, Zap, Layers, Clock, Maximize2, Minimize2,
  RotateCcw, Edit2, Copy, Shield, MoreVertical, BookOpen, Gauge,
  Clipboard, ClipboardPaste, FolderPlus,
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

// ── Time ranges ────────────────────────────────────────────────────────────────
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
interface OverlayMetric { assetId: string; assetName: string; metric: string; color: string; }
interface Widget {
  id: string; title: string; chartType: ChartType;
  assetId: string; assetName: string; metric: string;
  rangeMinutes: number; color: string;
  minVal?: number; maxVal?: number; unit?: string;
  customFrom?: string; customTo?: string;
  width?: number; height?: number;
  overlayMetrics?: OverlayMetric[];
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
function getFrom(w: Widget) {
  if (w.customFrom) return new Date(w.customFrom).toISOString();
  return subMinutes(new Date(), w.rangeMinutes > 0 ? w.rangeMinutes : 60).toISOString();
}
function getTo(w: Widget) { return w.customTo ? new Date(w.customTo).toISOString() : new Date().toISOString(); }
function rangeLabelOf(w: Widget) {
  if (w.customFrom && w.customTo)
    return `${format(new Date(w.customFrom), "MM/dd HH:mm")} → ${format(new Date(w.customTo), "MM/dd HH:mm")}`;
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
function widgetSeriesKeys(widget: Widget) {
  const keys = [widget.metric, widget.metric?.split(".").pop()].filter(Boolean) as string[];
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

function ChartWidget({ widget, data }: { widget: Widget; data: Record<string, any[]> }) {
  const allSeries = [
    { metric: widget.metric, color: widget.color, label: widget.metric },
    ...(widget.overlayMetrics ?? []).map(o => ({ metric: `${o.assetId}::${o.metric}`, color: o.color, label: `${o.assetName}/${o.metric}` })),
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
  const chartData = Object.entries(tsBuckets).sort(([a],[b])=>a.localeCompare(b)).map(([t,vals])=>({ t,...vals }));
  if (chartData.length === 0) return <EmptyState />;
  const commonProps = { data: chartData, margin: { top: 4, right: 8, bottom: 0, left: 0 } };
  if (widget.chartType === "bar" || widget.chartType === "stackbar") {
    const stacked = widget.chartType === "stackbar";
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart {...commonProps}>
          <CartesianGrid {...darkGrid} /><XAxis dataKey="t" {...darkAxis} /><YAxis {...darkAxis} width={36} />
          <Tooltip {...darkTooltip} />
          {allSeries.length > 1 && <Legend wrapperStyle={{ fontSize:9, color:D.muted }} />}
          {allSeries.map(s => <Bar key={s.metric} dataKey={s.metric} name={s.label} fill={s.color}
            stackId={stacked?"stack":undefined} radius={stacked?undefined:[2,2,0,0]} maxBarSize={20} />)}
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
          <CartesianGrid {...darkGrid} /><XAxis dataKey="t" {...darkAxis} /><YAxis {...darkAxis} width={36} />
          <Tooltip {...darkTooltip} />
          {allSeries.length > 1 && <Legend wrapperStyle={{ fontSize:9, color:D.muted }} />}
          {allSeries.map(s=><Area key={s.metric} dataKey={s.metric} name={s.label} stroke={s.color}
            fill={`url(#grad-${widget.id}-${s.metric})`} strokeWidth={1.5} dot={false} />)}
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart {...commonProps}>
        <CartesianGrid {...darkGrid} /><XAxis dataKey="t" {...darkAxis} /><YAxis {...darkAxis} width={36} />
        <Tooltip {...darkTooltip} />
        {allSeries.length > 1 && <Legend wrapperStyle={{ fontSize:9, color:D.muted }} />}
        {allSeries.map(s=><Line key={s.metric} dataKey={s.metric} name={s.label} stroke={s.color}
          strokeWidth={2} dot={false} activeDot={{ r:3, fill:s.color }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Widget Card ───────────────────────────────────────────────────────────────
function WidgetCard({ widget, onDelete, onEdit, onClone, onCopy, fullscreen, onFullscreen, wsSignal }: {
  widget: Widget; onDelete: () => void; onEdit: () => void;
  onClone: () => void; onCopy: () => void;
  fullscreen: boolean; onFullscreen: () => void;
  wsSignal?: number;
}) {
  const [data, setData]           = useState<Record<string, any[]>>({});
  const [loading, setLoading]     = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [liveFlash, setLiveFlash] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const from = getFrom(widget), to = getTo(widget);
    try {
      const result: Record<string, any[]> = {};
      const p = new URLSearchParams({ metric: widget.metric, from, to, limit: "2000" });
      const r = await fetch(`${BASE}/api/telemetry/${widget.assetId}?${p}`, { credentials: "include" });
      if (r.ok) {
        const rows = await r.json();
        const matched = Array.isArray(rows) ? rows : [];
        for (const key of widgetSeriesKeys(widget)) result[key] = matched;
      }
      for (const ov of (widget.overlayMetrics ?? [])) {
        const key = `${ov.assetId}::${ov.metric}`;
        const op = new URLSearchParams({ metric: ov.metric, from, to, limit: "2000" });
        const or2 = await fetch(`${BASE}/api/telemetry/${ov.assetId}?${op}`, { credentials: "include" });
        if (or2.ok) result[key] = await or2.json();
      }
      setData(result); setLastFetch(new Date());
    } finally { setLoading(false); }
  }, [widget.assetId, widget.metric, widget.rangeMinutes, widget.customFrom, widget.customTo,
      JSON.stringify(widget.overlayMetrics)]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh) timerRef.current = setInterval(fetchData, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, fetchData]);

  // Real-time: refetch when a WebSocket telemetry event arrives for this asset
  const prevWsSignal = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (wsSignal && wsSignal !== prevWsSignal.current) {
      prevWsSignal.current = wsSignal;
      fetchData();
      setLiveFlash(true);
      setTimeout(() => setLiveFlash(false), 1200);
    }
  }, [wsSignal, fetchData]);

  const overlayCount = widget.overlayMetrics?.length ?? 0;
  const chartH = widget.chartType === "kpi" ? 110 : widget.chartType === "gauge" ? 150 : 180;

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
      className="flex flex-col rounded-lg overflow-hidden resize"
      style={{ background: D.card, border: `1px solid ${D.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.4)", minWidth: 320, minHeight: 220 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${D.border}`, background: D.panel }}>
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: widget.color, boxShadow: `0 0 6px ${widget.color}` }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold truncate max-w-[120px]" style={{ color: D.text }}>{widget.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: D.border2, color: D.accent }}>{widget.assetName}</span>
            <span className="text-[9px] px-1 rounded font-mono" style={{ background: D.border2, color: D.accent2 }}>{widget.metric}</span>
            {overlayCount > 0 && <span className="text-[9px] px-1 rounded" style={{ background: D.purple+"33", color: D.purple }}>+{overlayCount}</span>}
            {liveFlash && <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold animate-pulse" style={{ background: D.green+"33", color: D.green }}>● LIVE</span>}
          </div>
          <div className="flex items-center gap-1 mt-px">
            <Clock className="w-2.5 h-2.5" style={{ color: D.muted }} />
            <span className="text-[9px]" style={{ color: D.muted }}>{rangeLabelOf(widget)}</span>
            {lastFetch && <span className="text-[9px]" style={{ color: D.muted }}>· {format(lastFetch, "HH:mm:ss")}</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
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

      <div className="p-2" style={{ height: fullscreen ? 420 : chartH }}>{renderContent()}</div>

      <div className="px-3 py-1 flex items-center justify-between shrink-0"
        style={{ borderTop: `1px solid ${D.border}`, background: D.panel }}>
        <span style={{ fontSize: 9, color: D.muted }}>
          {Object.values(data).reduce((s,a)=>s+a.length,0)} pts · {CHART_TYPE_OPTS.find(c=>c.value===widget.chartType)?.label}
        </span>
        <div className="flex items-center gap-1">
          <span style={{ fontSize: 9, color: D.muted }}>Auto</span>
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-50 origin-right" />
        </div>
      </div>
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
  return (
    <div className="flex items-center gap-2 p-2 rounded" style={{ background: D.panel, border: `1px solid ${D.border}` }}>
      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: overlay.color }} />
      <select value={overlay.assetId} onChange={e => onChange("assetId", e.target.value)}
        className="flex-1 h-7 rounded border border-border bg-background px-1.5 text-[11px]">
        <option value="">Asset…</option>
        {assetList.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select value={overlay.metric} onChange={e => onChange("metric", e.target.value)}
        disabled={!overlay.assetId}
        className="flex-1 h-7 rounded border border-border bg-background px-1.5 text-[11px] disabled:opacity-40">
        <option value="">Metric…</option>
        {attrs.map((a: any) => <option key={metricKeyOf(a)} value={metricKeyOf(a)}>{a.name}</option>)}
      </select>
      <div className="flex gap-1 shrink-0">
        {NEON_PALETTE.slice(0,6).map(c => (
          <button key={c} onClick={() => onChange("color", c)}
            className={cn("w-4 h-4 rounded-full border", overlay.color===c?"border-white":"border-transparent")}
            style={{ background: c }} />
        ))}
      </div>
      <button onClick={onRemove} className="p-0.5 rounded hover:bg-red-500/20">
        <Trash2 className="w-3 h-3" style={{ color: D.red }} />
      </button>
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

  const { data: assets }     = useListAssets();
  const { data: attributes } = useListAssetAttributes(assetId, { query: { enabled: !!assetId, queryKey: ["asset-attributes", assetId] } });
  const assetList   = (assets as any[] | undefined) ?? [];
  const metricAttrs = ((attributes as any[] | undefined) ?? []).filter((a: any) => metricKeyOf(a));
  const assetName   = assetList.find((a: any) => a.id === assetId)?.name ?? "";
  const canOverlay  = supportsOverlay(chartType);

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
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Widget" : "Add Widget"}</DialogTitle>
          <DialogDescription>Configure your visualization widget</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
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
              <option value="">{assetId ? "Select metric…" : "Select asset first"}</option>
              {metricAttrs.map((a: any) => <option key={metricValueOf(a)} value={metricValueOf(a)}>{a.name}</option>)}
            </select>
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
          <div className="space-y-1.5">
            <Label className="text-xs">Time Range</Label>
            <select value={useCustom ? -1 : rangeMinutes}
              onChange={e => { const v = Number(e.target.value); if (v===-1){setUseCustom(true);}else{setUseCustom(false);setRangeMinutes(v);} }}
              className="w-full h-8 rounded border border-border bg-background px-2 text-xs">
              {RANGES.map(r => <option key={r.minutes} value={r.minutes}>{r.label}</option>)}
            </select>
            {useCustom && (
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">From</Label>
                  <Input type="datetime-local" className="h-8 text-xs" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">To</Label>
                  <Input type="datetime-local" className="h-8 text-xs" value={customTo} onChange={e=>setCustomTo(e.target.value)} />
                </div>
              </div>
            )}
          </div>
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
          <div className="space-y-1">
            <Label className="text-xs">Widget Size</Label>
            <p className="text-[10px] text-muted-foreground">
              Drag the bottom-right corner of a widget on the dashboard to resize it.
            </p>
          </div>
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
        </div>
        <DialogFooter>
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
function loadDashboards(): Dashboard[] {
  try { return JSON.parse(localStorage.getItem(DASHBOARDS_KEY) ?? "[]"); } catch { return []; }
}
function saveDashboards(dbs: Dashboard[]) { localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(dbs)); }

export default function Visualization() {
  const { currentUser } = useCurrentUser();
  const userRole = currentUser?.role ?? "viewer";
  const canManage = ["admin","engineer"].includes(userRole);
  const qc = useQueryClient();
  const deleteAsset = useDeleteAsset();

  const [dashboards,   setDashboards]   = useState<Dashboard[]>(loadDashboards);
  const [activeDashId, setActiveDashId] = useState<string | null>(null);
  const [dialogOpen,   setDialogOpen]   = useState(false);
  const [editWidget,   setEditWidget]   = useState<Widget | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [treeOpen,     setTreeOpen]     = useState(true);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [globalRange,  setGlobalRange]  = useState<number | null>(null);

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

  // Persist dashboards
  useEffect(() => { saveDashboards(dashboards); }, [dashboards]);

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
  function createDashboard(fields: Partial<Dashboard>) {
    const d: Dashboard = {
      id: crypto.randomUUID(), widgets: [],
      name: fields.name ?? "New Dashboard",
      description: fields.description,
      roleAccess: fields.roleAccess ?? [...ALL_ROLES],
      createdAt: new Date().toISOString(),
    };
    setDashboards(prev => [...prev, d]);
    setActiveDashId(d.id);
  }
  function updateDashboard(id: string, fields: Partial<Dashboard>) {
    setDashboards(prev => prev.map(d => d.id === id ? { ...d, ...fields } : d));
  }
  function cloneDashboard(d: Dashboard) {
    // Name: "Test Dashboard" → "Test Dashboard_clone", if "_clone" exists → "Test Dashboard_clone2"
    const baseName = `${d.name}_clone`;
    const existingNames = dashboards.map(x => x.name);
    let cloneName = baseName;
    let counter = 2;
    while (existingNames.includes(cloneName)) { cloneName = `${baseName}${counter++}`; }
    const clone: Dashboard = {
      ...d,
      id: crypto.randomUUID(),
      name: cloneName,
      createdAt: new Date().toISOString(),
      widgets: d.widgets.map(w => ({ ...w, id: crypto.randomUUID() })),
    };
    // Use functional update to guarantee clone is in state before activeDashId effect
    setDashboards(prev => [...prev, clone]);
    setActiveDashId(clone.id);
    toast({ title: `Dashboard cloned as "${cloneName}"` });
  }
  function deleteDashboard(id: string) {
    const name = dashboards.find(d => d.id === id)?.name;
    setDashboards(prev => prev.filter(d => d.id !== id));
    if (activeDashId === id) setActiveDashId(null);
    toast({ title: `Dashboard "${name}" deleted` });
  }

  // ── Widget CRUD ─────────────────────────────────────────────────────────────
  function addOrUpdateWidget(w: Widget) {
    if (!activeDash) { createDashboard({ name: "My Dashboard" }); return; }
    setDashboards(prev => prev.map(d => {
      if (d.id !== activeDash.id) return d;
      const idx = d.widgets.findIndex(x => x.id === w.id);
      return { ...d, widgets: idx >= 0 ? d.widgets.map((x,i) => i===idx ? w : x) : [...d.widgets, w] };
    }));
  }
  function removeWidget(id: string) {
    if (!activeDash) return;
    setDashboards(prev => prev.map(d => d.id !== activeDash.id ? d : { ...d, widgets: d.widgets.filter(w => w.id !== id) }));
  }
  function cloneWidget(w: Widget) {
    if (!activeDash) return;
    const cloned: Widget = { ...w, id: crypto.randomUUID(), title: `${w.title} (Copy)` };
    setDashboards(prev => prev.map(d => d.id !== activeDash.id ? d : { ...d, widgets: [...d.widgets, cloned] }));
    toast({ title: "Widget cloned" });
  }
  function copyWidget(w: Widget) {
    setClipboard({ ...w });
    toast({ title: `"${w.title}" copied to clipboard`, description: "Switch dashboards and use Paste to add it there." });
  }
  function pasteWidget() {
    if (!clipboard || !activeDash) return;
    const pasted: Widget = { ...clipboard, id: crypto.randomUUID(), title: `${clipboard.title} (Pasted)` };
    setDashboards(prev => prev.map(d => d.id !== activeDash.id ? d : { ...d, widgets: [...d.widgets, pasted] }));
    toast({ title: "Widget pasted" });
  }
  function applyGlobalRange(minutes: number) {
    setGlobalRange(minutes);
    if (!activeDash) return;
    setDashboards(prev => prev.map(d => d.id !== activeDash.id ? d : {
      ...d, widgets: d.widgets.map(w => ({ ...w, rangeMinutes: minutes, customFrom: undefined, customTo: undefined }))
    }));
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
              <div className="px-3 py-6 text-center">
                <Blocks className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: D.muted }} />
                <p className="text-[10px]" style={{ color: D.muted }}>No projects yet</p>
                {canManage && (
                  <button onClick={() => { setAssetDialogEdit(null); setAssetDialogParent(null); setAssetDialogOpen(true); }}
                    className="mt-2 text-[10px] px-2 py-1 rounded" style={{ background:`${D.green}22`, color:D.green, border:`1px solid ${D.green}44` }}>
                    + Create first project
                  </button>
                )}
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
            <select
              value={activeDash?.id ?? ""}
              onChange={e => setActiveDashId(e.target.value || null)}
              className="h-7 rounded px-2 text-xs font-semibold border max-w-[200px]"
              style={{ background: D.card, color: D.text, borderColor: D.border2 }}>
              {visibleDashboards.length === 0
                ? <option value="">No dashboards — create one</option>
                : visibleDashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

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

        {/* ── No Dashboard state ── */}
        {!activeDash ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <BookOpen className="w-14 h-14 mb-4" style={{ color: D.border2 }} />
            <p className="text-sm font-semibold mb-1" style={{ color: D.text }}>No dashboards yet</p>
            <p className="text-xs mb-5 max-w-xs" style={{ color: D.muted }}>
              Create a dashboard to start adding widgets. Each dashboard can be scoped to specific roles and assets.
            </p>
            <button onClick={() => { setEditDashboard(null); setDbDialogOpen(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold"
              style={{ background:D.accent, color:"#000", boxShadow:`0 0 14px ${D.accent}55` }}>
              <Plus className="w-4 h-4" /> Create First Dashboard
            </button>
          </div>
        ) : (
          <>
            {activeDash.description && (
              <div className="px-4 py-1.5 shrink-0" style={{ background:D.card, borderBottom:`1px solid ${D.border}` }}>
                <p className="text-[10px]" style={{ color: D.muted }}>{activeDash.description}</p>
              </div>
            )}
            <div className="flex-1 overflow-auto p-4">
              {displayWidgets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <LayoutDashboard className="w-14 h-14 mb-4" style={{ color: D.border2 }} />
                  <p className="text-sm font-semibold mb-1" style={{ color: D.text }}>
                    {selectedAssetId ? "No widgets for this asset" : "No widgets yet"}
                  </p>
                  <p className="text-xs mb-5 max-w-xs" style={{ color: D.muted }}>
                    Click "Add Widget" or select an asset in the tree and add a widget for it.
                  </p>
                  <button onClick={() => { setEditWidget(null); setDialogOpen(true); }}
                    className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold"
                    style={{ background:D.accent, color:"#000", boxShadow:`0 0 16px ${D.accent}55` }}>
                    <Plus className="w-4 h-4" /> Add First Widget
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 auto-rows-auto">
                  {displayWidgets.map(w => (
                    <div key={w.id}>
                      <WidgetCard widget={w}
                        onDelete={() => removeWidget(w.id)}
                        onEdit={() => { setEditWidget(w); setDialogOpen(true); }}
                        onClone={() => cloneWidget(w)}
                        onCopy={() => copyWidget(w)}
                        fullscreen={fullscreenId === w.id}
                        onFullscreen={() => setFullscreenId(prev => prev === w.id ? null : w.id)}
                        wsSignal={wsSignals[w.assetId]} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Status bar */}
        <div className="px-4 py-1.5 flex items-center gap-3 shrink-0"
          style={{ background:D.panel, borderTop:`1px solid ${D.border}` }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: D.green }} />
          <span style={{ fontSize:10, color:D.muted }}>
            {displayWidgets.length} widget{displayWidgets.length!==1?"s":""}{activeDash?` · "${activeDash.name}"`:""}
            {" · "}Auto-refresh 30 s
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
