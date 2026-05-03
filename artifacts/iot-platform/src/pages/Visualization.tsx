import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useListAssets, useListAssetAttributes } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ScatterChart, Scatter, RadialBarChart, RadialBar,
} from "recharts";
import {
  Plus, Trash2, RefreshCw, Settings2, TrendingUp, TrendingDown,
  Minus, Activity, LayoutDashboard, ChevronRight, ChevronDown,
  Folder, FolderOpen, Blocks, PanelLeftOpen, PanelLeftClose,
  Gauge, BarChart2, PieChart as PieIcon, Zap, Grid3X3,
  ScatterChart as ScatterIcon, Layers, Clock, Calendar,
  Maximize2, Minimize2, RotateCcw,
} from "lucide-react";
import { format, subMinutes, subHours, subDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const STORAGE_KEY = "ws-viz-widgets-v2";

// ── Dark theme palette ─────────────────────────────────────────────────────────
const D = {
  bg:       "#0b0f1a",
  panel:    "#111827",
  card:     "#161e2e",
  cardHov:  "#1e293b",
  border:   "#1f2d45",
  border2:  "#2d3f5a",
  text:     "#e2e8f0",
  muted:    "#64748b",
  accent:   "#06b6d4",   // cyan
  accent2:  "#818cf8",   // indigo
  green:    "#10b981",
  amber:    "#f59e0b",
  red:      "#ef4444",
  purple:   "#a855f7",
  pink:     "#ec4899",
  orange:   "#f97316",
};

const NEON_PALETTE = [
  "#06b6d4","#10b981","#a855f7","#f59e0b",
  "#ef4444","#818cf8","#ec4899","#f97316",
  "#22d3ee","#84cc16","#fb923c","#e879f9",
];

// ── Time ranges ────────────────────────────────────────────────────────────────
const RANGES = [
  { label: "1 m",  minutes: 1 },
  { label: "5 m",  minutes: 5 },
  { label: "15 m", minutes: 15 },
  { label: "30 m", minutes: 30 },
  { label: "1 h",  minutes: 60 },
  { label: "6 h",  minutes: 360 },
  { label: "12 h", minutes: 720 },
  { label: "24 h", minutes: 1440 },
  { label: "3 d",  minutes: 4320 },
  { label: "7 d",  minutes: 10080 },
  { label: "30 d", minutes: 43200 },
];

// ── Widget types ───────────────────────────────────────────────────────────────
type ChartType = "line" | "area" | "bar" | "stackbar" | "kpi" | "gauge" | "pie" | "donut" | "scatter" | "heatmap" | "statetimeline";

const CHART_TYPES: { type: ChartType; label: string; icon: React.ElementType; desc: string }[] = [
  { type: "line",          label: "Line",          icon: Activity,   desc: "Continuous time-series trend" },
  { type: "area",          label: "Area",          icon: LayoutDashboard, desc: "Filled area under trend" },
  { type: "bar",           label: "Bar",           icon: BarChart2,  desc: "Discrete value bars" },
  { type: "stackbar",      label: "Stack Bar",     icon: Layers,     desc: "Stacked multi-metric bars" },
  { type: "kpi",           label: "KPI Card",      icon: Zap,        desc: "Latest value + trend" },
  { type: "gauge",         label: "Gauge",         icon: Gauge,      desc: "Radial gauge meter" },
  { type: "pie",           label: "Pie",           icon: PieIcon,    desc: "Distribution breakdown" },
  { type: "donut",         label: "Donut",         icon: PieIcon,    desc: "Ring chart with center value" },
  { type: "scatter",       label: "Scatter",       icon: ScatterIcon, desc: "Value distribution scatter" },
  { type: "heatmap",       label: "Heatmap",       icon: Grid3X3,    desc: "Hour-of-day intensity grid" },
  { type: "statetimeline", label: "State Timeline",icon: Layers,     desc: "High/normal/low state bands" },
];

interface Widget {
  id: string;
  title: string;
  chartType: ChartType;
  assetId: string;
  assetName: string;
  metric: string;
  rangeMinutes: number;
  color: string;
  minVal?: number;
  maxVal?: number;
  unit?: string;
  customFrom?: string;
  customTo?: string;
  size?: "sm" | "md" | "lg";
}

// ── helpers ────────────────────────────────────────────────────────────────────
function fmtTs(ts: string, rangeMinutes: number): string {
  const d = parseISO(ts);
  if (rangeMinutes <= 60)  return format(d, "HH:mm:ss");
  if (rangeMinutes <= 1440) return format(d, "HH:mm");
  return format(d, "MM/dd HH:mm");
}

function getFrom(w: Widget): string {
  if (w.customFrom) return new Date(w.customFrom).toISOString();
  return subMinutes(new Date(), w.rangeMinutes).toISOString();
}
function getTo(w: Widget): string {
  if (w.customTo) return new Date(w.customTo).toISOString();
  return new Date().toISOString();
}

function rangeLabelOf(w: Widget): string {
  if (w.customFrom && w.customTo) {
    return `${format(new Date(w.customFrom), "MM/dd HH:mm")} → ${format(new Date(w.customTo), "MM/dd HH:mm")}`;
  }
  return RANGES.find(r => r.minutes === w.rangeMinutes)?.label ?? `${w.rangeMinutes}m`;
}

// ── Dark chart axis/tooltip defaults ──────────────────────────────────────────
const darkAxis = { stroke: D.muted, fontSize: 10, tickLine: false, axisLine: false };
const darkGrid = { strokeDasharray: "3 3", stroke: D.border2, vertical: false };
const darkTooltip = {
  contentStyle: {
    background: D.card, border: `1px solid ${D.border2}`,
    borderRadius: 6, fontSize: 11, padding: "4px 10px", color: D.text,
  },
  labelStyle:   { color: D.muted, fontSize: 10 },
  cursor:       { stroke: D.border2 },
};

// ══════════════════════════════════════════════════════════════════════════════
// ── Gauge Widget ──────────────────────────────────────────────────────────────
function GaugeWidget({ widget, data }: { widget: Widget; data: any[] }) {
  const latest = data.length > 0 ? Number(data[data.length - 1]?.value) : null;
  const min = widget.minVal ?? 0;
  const max = widget.maxVal ?? 100;
  const pct = latest !== null ? Math.min(1, Math.max(0, (latest - min) / (max - min))) : 0;

  const W = 180, H = 110, cx = 90, cy = 96, R = 72;
  const startAngle = Math.PI * 1.15;
  const endAngle   = Math.PI * 1.85;
  const sweep      = endAngle - startAngle;
  const valAngle   = startAngle + sweep * pct;
  const arc = (a: number) => ({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  const bg1 = arc(startAngle); const bg2 = arc(endAngle);
  const v1  = arc(startAngle); const v2  = arc(valAngle);
  const needleX = cx + (R - 10) * Math.cos(valAngle);
  const needleY = cy + (R - 10) * Math.sin(valAngle);

  const zones = [
    { from: 0, to: 0.33, color: D.green },
    { from: 0.33, to: 0.66, color: D.amber },
    { from: 0.66, to: 1, color: D.red },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full gap-1">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Background arc */}
        <path d={`M ${bg1.x} ${bg1.y} A ${R} ${R} 0 ${sweep > Math.PI ? 1 : 0} 1 ${bg2.x} ${bg2.y}`}
          stroke={D.border2} strokeWidth={12} fill="none" strokeLinecap="round" />
        {/* Zone arcs */}
        {zones.map((z, i) => {
          const a1 = startAngle + sweep * z.from;
          const a2 = startAngle + sweep * z.to;
          const p1 = arc(a1); const p2 = arc(a2);
          const lg = (a2 - a1) > Math.PI ? 1 : 0;
          return <path key={i} d={`M ${p1.x} ${p1.y} A ${R} ${R} 0 ${lg} 1 ${p2.x} ${p2.y}`}
            stroke={z.color} strokeWidth={8} fill="none" strokeLinecap="round" opacity={0.35} />;
        })}
        {/* Value arc */}
        {latest !== null && pct > 0 && (
          <path d={`M ${v1.x} ${v1.y} A ${R} ${R} 0 ${(sweep * pct) > Math.PI ? 1 : 0} 1 ${v2.x} ${v2.y}`}
            stroke={widget.color} strokeWidth={10} fill="none" strokeLinecap="round" />
        )}
        {/* Needle */}
        {latest !== null && (
          <line x1={cx} y1={cy} x2={needleX} y2={needleY}
            stroke={D.text} strokeWidth={2} strokeLinecap="round" />
        )}
        <circle cx={cx} cy={cy} r={5} fill={D.text} />
        {/* Min/Max labels */}
        <text x={bg1.x - 4} y={bg1.y + 4} fill={D.muted} fontSize={9} textAnchor="middle">{min}</text>
        <text x={bg2.x + 4} y={bg2.y + 4} fill={D.muted} fontSize={9} textAnchor="middle">{max}</text>
        {/* Value label */}
        <text x={cx} y={cy - 14} fill={D.text} fontSize={18} fontWeight={700} textAnchor="middle">
          {latest !== null ? latest.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
        </text>
        {widget.unit && (
          <text x={cx} y={cy - 2} fill={D.muted} fontSize={10} textAnchor="middle">{widget.unit}</text>
        )}
      </svg>
      <div className="text-[10px]" style={{ color: D.muted }}>
        {pct !== null ? `${(pct * 100).toFixed(1)}%` : ""}
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiWidget({ widget, data }: { widget: Widget; data: any[] }) {
  const sorted = [...data].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const latest = sorted[0];
  const prev   = sorted[1];
  const val    = latest ? Number(latest.value) : null;
  const prevV  = prev   ? Number(prev.value)   : null;
  const delta  = val !== null && prevV !== null ? val - prevV : null;
  const pctChange = delta !== null && prevV !== 0 ? ((delta / prevV) * 100) : null;
  const TrendIcon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const trendColor = delta === null ? D.muted : delta > 0 ? D.green : delta < 0 ? D.red : D.muted;

  // mini sparkline last 20 points
  const sparkData = sorted.slice(0, 20).reverse().map((r, i) => ({ i, v: Number(r.value) }));

  return (
    <div className="flex flex-col h-full p-2 gap-1">
      <div className="flex items-end justify-between gap-2 flex-1 min-h-0">
        <div>
          <div className="text-3xl font-bold tabular-nums" style={{ color: widget.color }}>
            {val !== null ? val.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}
            {widget.unit && <span className="text-base ml-1" style={{ color: D.muted }}>{widget.unit}</span>}
          </div>
          {delta !== null && (
            <div className="flex items-center gap-1 mt-1" style={{ color: trendColor }}>
              <TrendIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">
                {delta > 0 ? "+" : ""}{delta.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                {pctChange !== null && <span className="ml-1 opacity-70">({pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%)</span>}
              </span>
            </div>
          )}
          {latest && (
            <p className="text-[10px] mt-1" style={{ color: D.muted }}>
              {format(new Date(latest.timestamp), "HH:mm:ss dd/MM")}
            </p>
          )}
        </div>
        {/* Mini sparkline */}
        {sparkData.length > 2 && (
          <div style={{ width: 80, height: 48 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Line dataKey="v" stroke={widget.color} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {data.length === 0 && <p className="text-xs" style={{ color: D.muted }}>No data</p>}
    </div>
  );
}

// ── Pie / Donut ───────────────────────────────────────────────────────────────
function PieWidget({ widget, data, donut }: { widget: Widget; data: any[]; donut?: boolean }) {
  // Bucket by value ranges for distribution
  const values = data.map(d => Number(d.value)).filter(v => !isNaN(v));
  if (values.length === 0) return <EmptyState />;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const BUCKETS = 6;
  const buckets = Array.from({ length: BUCKETS }, (_, i) => {
    const lo = min + (range / BUCKETS) * i;
    const hi = min + (range / BUCKETS) * (i + 1);
    const count = values.filter(v => i === BUCKETS - 1 ? v >= lo && v <= hi : v >= lo && v < hi).length;
    return { name: `${lo.toFixed(1)}–${hi.toFixed(1)}`, value: count };
  }).filter(b => b.value > 0);

  const COLORS = NEON_PALETTE.slice(0, buckets.length);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={buckets} cx="50%" cy="50%"
            innerRadius={donut ? "48%" : 0} outerRadius="72%"
            paddingAngle={2} dataKey="value"
            label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
            labelLine={false}
          >
            {buckets.map((_, i) => <Cell key={i} fill={COLORS[i]} opacity={0.85} />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: D.card, border: `1px solid ${D.border2}`, borderRadius: 6, fontSize: 11, color: D.text }}
            formatter={(v: number, name: string) => [v + " pts", name]}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: D.muted }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Scatter ────────────────────────────────────────────────────────────────────
function ScatterWidget({ widget, data }: { widget: Widget; data: any[] }) {
  const points = data.map((d, i) => ({ x: i, y: Number(d.value) })).filter(p => !isNaN(p.y));
  if (points.length === 0) return <EmptyState />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid {...darkGrid} />
        <XAxis dataKey="x" {...darkAxis} name="Index" hide />
        <YAxis dataKey="y" {...darkAxis} width={36} />
        <Tooltip {...darkTooltip} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={points} fill={widget.color} opacity={0.7} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── Heatmap (hour-of-day × value) ─────────────────────────────────────────────
function HeatmapWidget({ data }: { data: any[] }) {
  if (data.length === 0) return <EmptyState />;
  // Grid: hours 0-23
  const buckets: Record<number, number[]> = {};
  for (let h = 0; h < 24; h++) buckets[h] = [];
  data.forEach(d => {
    const h = new Date(d.timestamp).getHours();
    buckets[h].push(Number(d.value));
  });
  const avgs = Array.from({ length: 24 }, (_, h) => {
    const vals = buckets[h];
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  const defined = avgs.filter(v => v !== null) as number[];
  const minV = defined.length ? Math.min(...defined) : 0;
  const maxV = defined.length ? Math.max(...defined) : 1;
  const norm = (v: number | null) => v === null ? 0 : (v - minV) / (maxV - minV || 1);

  function heatColor(n: number) {
    // Deep blue → cyan → green → amber → red
    const stops = ["#1e3a5f","#0891b2","#10b981","#f59e0b","#dc2626"];
    const idx = n * (stops.length - 1);
    const lo = Math.floor(idx); const hi = Math.min(lo + 1, stops.length - 1);
    const t = idx - lo;
    const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    const c1 = hex(stops[lo]); const c2 = hex(stops[hi]);
    const r = Math.round(c1[0] + t * (c2[0] - c1[0]));
    const g = Math.round(c1[1] + t * (c2[1] - c1[1]));
    const b = Math.round(c1[2] + t * (c2[2] - c1[2]));
    return `rgb(${r},${g},${b})`;
  }

  return (
    <div className="p-2 h-full flex flex-col gap-1">
      <div className="flex gap-0.5 flex-1">
        {avgs.map((v, h) => (
          <div key={h} className="flex-1 flex flex-col gap-0.5 items-center">
            <div className="flex-1 w-full rounded-sm transition-all"
              style={{ background: heatColor(norm(v)), opacity: v === null ? 0.15 : 1, minHeight: 4 }}
              title={v !== null ? `${h}:00 — ${v.toFixed(2)}` : `${h}:00 — no data`} />
            {h % 4 === 0 && <span style={{ fontSize: 8, color: D.muted }}>{h}</span>}
          </div>
        ))}
      </div>
      <div className="flex justify-between" style={{ fontSize: 9, color: D.muted }}>
        <span>Hour of day (0–23)</span>
        <span>avg intensity</span>
      </div>
    </div>
  );
}

// ── State Timeline ─────────────────────────────────────────────────────────────
function StateTimelineWidget({ widget, data }: { widget: Widget; data: any[] }) {
  if (data.length === 0) return <EmptyState />;
  const sorted = [...data].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const values = sorted.map(d => Number(d.value));
  const minV = Math.min(...values), maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const lo = minV + range * 0.33;
  const hi = minV + range * 0.67;

  function stateColor(v: number) {
    if (v >= hi) return D.red;
    if (v >= lo) return D.amber;
    return D.green;
  }
  function stateLabel(v: number) {
    if (v >= hi) return "HIGH";
    if (v >= lo) return "NORM";
    return "LOW";
  }

  const total = sorted.length;
  return (
    <div className="flex flex-col h-full p-2 gap-2">
      {/* State strip */}
      <div className="flex h-8 rounded overflow-hidden border" style={{ borderColor: D.border }}>
        {sorted.map((d, i) => (
          <div key={i} className="flex-1" style={{ background: stateColor(Number(d.value)) }}
            title={`${fmtTs(d.timestamp, widget.rangeMinutes)}: ${Number(d.value).toFixed(2)}`} />
        ))}
      </div>
      {/* Distribution counts */}
      <div className="grid grid-cols-3 gap-1 flex-1">
        {[
          { label: "LOW",  color: D.green, count: values.filter(v => v < lo).length },
          { label: "NORM", color: D.amber, count: values.filter(v => v >= lo && v < hi).length },
          { label: "HIGH", color: D.red,   count: values.filter(v => v >= hi).length },
        ].map(s => (
          <div key={s.label} className="flex flex-col items-center justify-center rounded p-1"
            style={{ background: s.color + "22", border: `1px solid ${s.color}44` }}>
            <span className="text-xs font-bold" style={{ color: s.color }}>{s.label}</span>
            <span className="text-lg font-bold tabular-nums" style={{ color: s.color }}>{s.count}</span>
            <span style={{ fontSize: 9, color: D.muted }}>{total > 0 ? ((s.count / total) * 100).toFixed(0) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Line / Area / Bar / StackBar ──────────────────────────────────────────────
function ChartWidget({ widget, data }: { widget: Widget; data: any[] }) {
  const chartData = [...data]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map(r => ({ t: fmtTs(r.timestamp, widget.rangeMinutes), value: Number(r.value) }));

  if (chartData.length === 0) return <EmptyState />;

  const commonProps = { data: chartData, margin: { top: 4, right: 8, bottom: 0, left: 0 } };

  if (widget.chartType === "bar" || widget.chartType === "stackbar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart {...commonProps}>
          <CartesianGrid {...darkGrid} />
          <XAxis dataKey="t" {...darkAxis} />
          <YAxis {...darkAxis} width={36} />
          <Tooltip {...darkTooltip} />
          <Bar dataKey="value" fill={widget.color} radius={[2, 2, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (widget.chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart {...commonProps}>
          <defs>
            <linearGradient id={`grad-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={widget.color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={widget.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...darkGrid} />
          <XAxis dataKey="t" {...darkAxis} />
          <YAxis {...darkAxis} width={36} />
          <Tooltip {...darkTooltip} />
          <Area dataKey="value" stroke={widget.color} fill={`url(#grad-${widget.id})`} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart {...commonProps}>
        <CartesianGrid {...darkGrid} />
        <XAxis dataKey="t" {...darkAxis} />
        <YAxis {...darkAxis} width={36} />
        <Tooltip {...darkTooltip} />
        <Line dataKey="value" stroke={widget.color} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: widget.color }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full">
      <p style={{ fontSize: 11, color: D.muted }}>No data in range</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Widget Card ───────────────────────────────────────────────────────────────
function WidgetCard({
  widget, onDelete, onEdit, fullscreen, onFullscreen,
}: {
  widget: Widget; onDelete: () => void; onEdit: () => void;
  fullscreen: boolean; onFullscreen: () => void;
}) {
  const [data, setData]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const from = getFrom(widget);
      const to   = getTo(widget);
      const params = new URLSearchParams({ metric: widget.metric, from, to, limit: "2000" });
      const r = await fetch(`${BASE}/api/telemetry/${widget.assetId}?${params}`, { credentials: "include" });
      if (r.ok) { setData(await r.json()); setLastFetch(new Date()); }
    } finally { setLoading(false); }
  }, [widget.assetId, widget.metric, widget.rangeMinutes, widget.customFrom, widget.customTo]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh) timerRef.current = setInterval(fetchData, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, fetchData]);

  const chartH = widget.chartType === "kpi" ? 110 : widget.chartType === "gauge" ? 150 : widget.size === "lg" ? 240 : 180;

  function renderContent() {
    if (loading && data.length === 0) return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-4 h-4 animate-spin" style={{ color: D.muted }} />
      </div>
    );
    switch (widget.chartType) {
      case "kpi":          return <KpiWidget widget={widget} data={data} />;
      case "gauge":        return <GaugeWidget widget={widget} data={data} />;
      case "pie":          return <PieWidget widget={widget} data={data} />;
      case "donut":        return <PieWidget widget={widget} data={data} donut />;
      case "scatter":      return <ScatterWidget widget={widget} data={data} />;
      case "heatmap":      return <HeatmapWidget data={data} />;
      case "statetimeline":return <StateTimelineWidget widget={widget} data={data} />;
      default:             return <ChartWidget widget={widget} data={data} />;
    }
  }

  return (
    <div
      className="flex flex-col rounded-lg overflow-hidden transition-all"
      style={{
        background: D.card,
        border: `1px solid ${D.border}`,
        boxShadow: `0 2px 12px rgba(0,0,0,0.4)`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${D.border}`, background: D.panel }}>
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: widget.color, boxShadow: `0 0 6px ${widget.color}` }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold truncate max-w-[130px]" style={{ color: D.text }}>{widget.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: D.border2, color: D.accent }}>{widget.assetName}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: D.border2, color: D.accent2 }}>{widget.metric}</span>
          </div>
          <div className="flex items-center gap-2 mt-px">
            <Clock className="w-2.5 h-2.5" style={{ color: D.muted }} />
            <span className="text-[9px]" style={{ color: D.muted }}>{rangeLabelOf(widget)}</span>
            {lastFetch && <span className="text-[9px]" style={{ color: D.muted }}>· {format(lastFetch, "HH:mm:ss")}</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button className="p-1 rounded hover:bg-white/5 transition-colors" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} style={{ color: D.muted }} />
          </button>
          <button className="p-1 rounded hover:bg-white/5 transition-colors" onClick={onFullscreen}>
            {fullscreen ? <Minimize2 className="w-3 h-3" style={{ color: D.muted }} /> : <Maximize2 className="w-3 h-3" style={{ color: D.muted }} />}
          </button>
          <button className="p-1 rounded hover:bg-white/5 transition-colors" onClick={onEdit}>
            <Settings2 className="w-3 h-3" style={{ color: D.muted }} />
          </button>
          <button className="p-1 rounded hover:bg-red-500/20 transition-colors" onClick={onDelete}>
            <Trash2 className="w-3 h-3" style={{ color: D.red }} />
          </button>
        </div>
      </div>

      {/* Chart body */}
      <div className="p-2" style={{ height: fullscreen ? 420 : chartH }}>
        {renderContent()}
      </div>

      {/* Footer */}
      <div className="px-3 py-1 flex items-center justify-between shrink-0"
        style={{ borderTop: `1px solid ${D.border}`, background: D.panel }}>
        <span style={{ fontSize: 9, color: D.muted }}>
          {data.length} pts · {CHART_TYPES.find(c => c.type === widget.chartType)?.label}
        </span>
        <div className="flex items-center gap-1">
          <span style={{ fontSize: 9, color: D.muted }}>Auto</span>
          <Switch
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
            className="scale-50 origin-right"
          />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Asset Hierarchy Tree ──────────────────────────────────────────────────────
interface AssetNode {
  id: string; name: string; parentId?: string | null; childCount: number;
}

function AssetTreeNode({
  asset, allAssets, selectedId, onSelect, depth,
}: {
  asset: AssetNode; allAssets: AssetNode[]; selectedId: string | null;
  onSelect: (a: AssetNode) => void; depth: number;
}) {
  const children = allAssets.filter(a => a.parentId === asset.id);
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = children.length > 0;
  const isSelected = selectedId === asset.id;

  return (
    <div>
      <div
        className="flex items-center gap-1 py-1 rounded cursor-pointer group transition-all"
        style={{
          paddingLeft: `${8 + depth * 14}px`,
          paddingRight: 8,
          background: isSelected ? `${D.accent}18` : "transparent",
          color: isSelected ? D.accent : D.text,
        }}
        onClick={() => onSelect(asset)}
      >
        {hasChildren ? (
          <button onClick={e => { e.stopPropagation(); setExpanded(o => !o); }}
            className="shrink-0 p-0.5 rounded hover:bg-white/5">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : <span className="w-4 shrink-0" />}
        {hasChildren || asset.childCount > 0
          ? expanded
            ? <FolderOpen className="w-3 h-3 shrink-0" style={{ color: "#f59e0b" }} />
            : <Folder className="w-3 h-3 shrink-0" style={{ color: "#f59e0b" }} />
          : <Blocks className="w-3 h-3 shrink-0" style={{ color: D.accent }} />
        }
        <span className="truncate flex-1" style={{ fontSize: 11 }}>{asset.name}</span>
      </div>
      {expanded && children.map(child => (
        <AssetTreeNode key={child.id} asset={child} allAssets={allAssets}
          selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Widget Dialog ─────────────────────────────────────────────────────────────
function WidgetDialog({
  open, onOpenChange, initial, onSave, usedColors, preselectedAssetId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  initial?: Widget | null; onSave: (w: Widget) => void;
  usedColors: string[]; preselectedAssetId?: string;
}) {
  const nextColor = NEON_PALETTE.find(c => !usedColors.includes(c)) ?? NEON_PALETTE[0];

  const [title, setTitle]         = useState(initial?.title ?? "");
  const [chartType, setChartType] = useState<ChartType>(initial?.chartType ?? "line");
  const [assetId, setAssetId]     = useState(initial?.assetId ?? preselectedAssetId ?? "");
  const [metric, setMetric]       = useState(initial?.metric ?? "");
  const [rangeMinutes, setRangeMinutes] = useState(initial?.rangeMinutes ?? 60);
  const [color, setColor]         = useState(initial?.color ?? nextColor);
  const [minVal, setMinVal]       = useState(String(initial?.minVal ?? "0"));
  const [maxVal, setMaxVal]       = useState(String(initial?.maxVal ?? "100"));
  const [unit, setUnit]           = useState(initial?.unit ?? "");
  const [size, setSize]           = useState<"sm"|"md"|"lg">(initial?.size ?? "md");
  const [useCustom, setUseCustom] = useState(!!(initial?.customFrom));
  const [customFrom, setCustomFrom] = useState(initial?.customFrom ?? "");
  const [customTo, setCustomTo]   = useState(initial?.customTo ?? "");

  const { data: assets } = useListAssets();
  const { data: attributes } = useListAssetAttributes(assetId, {
    query: { enabled: !!assetId, queryKey: ["viz-attrs", assetId] },
  });

  const assetList = (assets as any[] | undefined) ?? [];
  const attrList  = (attributes as any[] | undefined) ?? [];
  const metricAttrs = attrList.filter((a: any) =>
    ["dynamic", "metric", "runtime"].includes(a.type)
  );
  const assetName = assetList.find((a: any) => a.id === assetId)?.name ?? "";

  useEffect(() => {
    if (preselectedAssetId && !initial) setAssetId(preselectedAssetId);
  }, [preselectedAssetId]);

  function handleSave() {
    if (!assetId || !metric) return;
    onSave({
      id:       initial?.id ?? crypto.randomUUID(),
      title:    title || `${assetName} / ${metric}`,
      chartType, assetId, assetName, metric, rangeMinutes, color,
      minVal:   Number(minVal),
      maxVal:   Number(maxVal),
      unit,     size,
      customFrom: useCustom ? customFrom : undefined,
      customTo:   useCustom ? customTo   : undefined,
    });
    onOpenChange(false);
  }

  const needsMinMax = chartType === "gauge";
  const needsUnit   = ["gauge", "kpi"].includes(chartType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Widget" : "Add Widget"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Widget type grid */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Widget Type</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {CHART_TYPES.map(ct => (
                <button key={ct.type} onClick={() => setChartType(ct.type)}
                  title={ct.desc}
                  className={cn(
                    "flex items-center gap-1.5 rounded border px-2 py-2 text-xs font-medium transition-colors",
                    chartType === ct.type
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted/60 text-muted-foreground"
                  )}>
                  <ct.icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{ct.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <Label className="text-xs">Title (optional)</Label>
            <Input className="h-8 text-xs" value={title}
              onChange={e => setTitle(e.target.value)} placeholder="Auto-generated if blank" />
          </div>

          {/* Asset */}
          <div className="space-y-1">
            <Label className="text-xs">Asset</Label>
            <select value={assetId} onChange={e => { setAssetId(e.target.value); setMetric(""); }}
              className="w-full h-8 rounded border border-border bg-background px-2 text-xs">
              <option value="">Select asset…</option>
              {assetList.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          {/* Metric */}
          <div className="space-y-1">
            <Label className="text-xs">Metric</Label>
            <select value={metric} onChange={e => setMetric(e.target.value)}
              disabled={!assetId}
              className="w-full h-8 rounded border border-border bg-background px-2 text-xs disabled:opacity-50">
              <option value="">{assetId ? "Select metric…" : "Select asset first"}</option>
              {metricAttrs.map((a: any) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>

          {/* Time range */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Time Range</Label>
              <div className="flex items-center gap-1.5">
                <Switch checked={useCustom} onCheckedChange={setUseCustom} className="scale-75 origin-right" />
                <span className="text-[10px] text-muted-foreground">Custom</span>
              </div>
            </div>
            {useCustom ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">From</Label>
                  <Input type="datetime-local" className="h-8 text-xs" value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">To</Label>
                  <Input type="datetime-local" className="h-8 text-xs" value={customTo}
                    onChange={e => setCustomTo(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {RANGES.map(r => (
                  <button key={r.minutes} onClick={() => setRangeMinutes(r.minutes)}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs border transition-colors",
                      rangeMinutes === r.minutes
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted/60"
                    )}>
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Gauge options */}
          {needsMinMax && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Min Value</Label>
                <Input className="h-8 text-xs" type="number" value={minVal} onChange={e => setMinVal(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Value</Label>
                <Input className="h-8 text-xs" type="number" value={maxVal} onChange={e => setMaxVal(e.target.value)} />
              </div>
            </div>
          )}

          {/* Unit */}
          {needsUnit && (
            <div className="space-y-1">
              <Label className="text-xs">Unit (optional)</Label>
              <Input className="h-8 text-xs" value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. °C, kWh, rpm" />
            </div>
          )}

          {/* Size */}
          <div className="space-y-1">
            <Label className="text-xs">Widget Size</Label>
            <div className="flex gap-2">
              {(["sm","md","lg"] as const).map(s => (
                <button key={s} onClick={() => setSize(s)}
                  className={cn(
                    "flex-1 rounded border py-1.5 text-xs font-medium capitalize transition-colors",
                    size === s ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted/60"
                  )}>
                  {s === "sm" ? "Small" : s === "md" ? "Medium" : "Large"}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className="space-y-1">
            <Label className="text-xs">Color</Label>
            <div className="flex gap-2 flex-wrap">
              {NEON_PALETTE.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={cn("w-6 h-6 rounded-full border-2 transition-all",
                    color === c ? "border-white scale-125" : "border-transparent")}
                  style={{ background: c, boxShadow: color === c ? `0 0 8px ${c}` : "none" }} />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!assetId || !metric}>
            {initial ? "Update Widget" : "Add Widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Main Visualization Page ───────────────────────────────────────────────────
export default function Visualization() {
  const [widgets, setWidgets] = useState<Widget[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
  });
  const [dialogOpen, setDialogOpen]     = useState(false);
  const [editWidget, setEditWidget]     = useState<Widget | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [treeOpen, setTreeOpen]         = useState(true);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [globalRange, setGlobalRange]   = useState<number | null>(null);

  const { data: assets } = useListAssets();
  const assetList = (assets as any[] | undefined) ?? [];
  const roots = assetList.filter(a => !a.parentId);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  }, [widgets]);

  function addOrUpdate(w: Widget) {
    setWidgets(prev => {
      const idx = prev.findIndex(x => x.id === w.id);
      return idx >= 0 ? prev.map((x, i) => i === idx ? w : x) : [...prev, w];
    });
  }
  function removeWidget(id: string) { setWidgets(prev => prev.filter(w => w.id !== id)); }

  // Apply global range to all widgets
  function applyGlobalRange(minutes: number) {
    setGlobalRange(minutes);
    setWidgets(prev => prev.map(w => ({ ...w, rangeMinutes: minutes, customFrom: undefined, customTo: undefined })));
  }

  const usedColors = widgets.map(w => w.color);

  // Filtered widgets by selected asset
  const displayWidgets = useMemo(() => {
    if (!selectedAssetId) return widgets;
    return widgets.filter(w => w.assetId === selectedAssetId);
  }, [widgets, selectedAssetId]);

  // Grid cols per size
  function sizeClass(w: Widget) {
    return w.chartType === "kpi"
      ? "col-span-1"
      : w.size === "lg" ? "col-span-2" : "col-span-1";
  }

  return (
    <div className="flex h-full overflow-hidden" style={{ background: D.bg }}>

      {/* ── Asset Hierarchy Tree Panel ── */}
      {treeOpen && (
        <div className="w-56 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ background: D.panel, borderRight: `1px solid ${D.border}` }}>
          <div className="px-3 py-2.5 flex items-center justify-between shrink-0"
            style={{ borderBottom: `1px solid ${D.border}` }}>
            <span className="text-xs font-semibold" style={{ color: D.accent }}>Asset Hierarchy</span>
            <button onClick={() => setSelectedAssetId(null)}
              title="Clear filter"
              className="p-0.5 rounded hover:bg-white/5 transition-colors">
              <RotateCcw className="w-3 h-3" style={{ color: D.muted }} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {/* "All" entry */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded mx-1 transition-all"
              style={{
                background: selectedAssetId === null ? `${D.accent}18` : "transparent",
                color: selectedAssetId === null ? D.accent : D.muted,
              }}
              onClick={() => setSelectedAssetId(null)}
            >
              <LayoutDashboard className="w-3 h-3 shrink-0" />
              <span style={{ fontSize: 11 }}>All Assets</span>
              <span className="ml-auto text-[9px] px-1 rounded" style={{ background: D.border2, color: D.muted }}>
                {widgets.length}
              </span>
            </div>
            {roots.map(root => (
              <AssetTreeNode
                key={root.id}
                asset={root}
                allAssets={assetList}
                selectedId={selectedAssetId}
                onSelect={a => setSelectedAssetId(prev => prev === a.id ? null : a.id)}
                depth={0}
              />
            ))}
          </div>
          {/* Add widget for selected asset */}
          {selectedAssetId && (
            <div className="p-2 shrink-0" style={{ borderTop: `1px solid ${D.border}` }}>
              <button
                onClick={() => { setEditWidget(null); setDialogOpen(true); }}
                className="w-full flex items-center justify-center gap-1.5 rounded py-1.5 text-xs font-medium transition-colors"
                style={{ background: `${D.accent}22`, color: D.accent, border: `1px solid ${D.accent}44` }}
              >
                <Plus className="w-3 h-3" /> Add Widget
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Main Canvas ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 shrink-0 flex-wrap"
          style={{ background: D.panel, borderBottom: `1px solid ${D.border}` }}>
          <button
            onClick={() => setTreeOpen(o => !o)}
            className="p-1.5 rounded transition-colors hover:bg-white/5"
            title={treeOpen ? "Hide tree" : "Show tree"}
          >
            {treeOpen
              ? <PanelLeftClose className="w-4 h-4" style={{ color: D.accent }} />
              : <PanelLeftOpen  className="w-4 h-4" style={{ color: D.accent }} />}
          </button>

          <div className="flex items-center gap-1 px-2 py-1 rounded" style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <LayoutDashboard className="w-3.5 h-3.5" style={{ color: D.accent }} />
            <span className="text-xs font-semibold" style={{ color: D.text }}>
              {selectedAssetId
                ? (assetList.find((a: any) => a.id === selectedAssetId)?.name ?? "Asset")
                : "All Assets"}
            </span>
            {selectedAssetId && (
              <span className="text-[9px] ml-1 px-1 rounded" style={{ background: `${D.accent}22`, color: D.accent }}>
                filtered
              </span>
            )}
          </div>

          <div className="flex-1" />

          {/* Global time range quick-set */}
          <div className="flex items-center gap-1 flex-wrap">
            <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: D.muted }} />
            {RANGES.map(r => (
              <button key={r.minutes}
                onClick={() => applyGlobalRange(r.minutes)}
                className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
                style={{
                  background: globalRange === r.minutes ? D.accent : D.border,
                  color: globalRange === r.minutes ? "#000" : D.muted,
                  border: `1px solid ${globalRange === r.minutes ? D.accent : D.border2}`,
                }}>
                {r.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => { setEditWidget(null); setDialogOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all"
            style={{ background: D.accent, color: "#000", boxShadow: `0 0 12px ${D.accent}44` }}>
            <Plus className="w-3.5 h-3.5" /> Add Widget
          </button>
        </div>

        {/* Widget grid */}
        <div className="flex-1 overflow-auto p-4">
          {displayWidgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <LayoutDashboard className="w-14 h-14 mb-4" style={{ color: D.border2 }} />
              <p className="text-sm font-semibold mb-1" style={{ color: D.text }}>
                {selectedAssetId ? "No widgets for this asset" : "No widgets yet"}
              </p>
              <p className="text-xs mb-5 max-w-xs" style={{ color: D.muted }}>
                {selectedAssetId
                  ? "Click \"Add Widget\" to create a visualization for the selected asset."
                  : "Add a widget to start visualizing your telemetry data. Supports 11 chart types, live auto-refresh, and custom time ranges."}
              </p>
              <button
                onClick={() => { setEditWidget(null); setDialogOpen(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold transition-all"
                style={{ background: D.accent, color: "#000", boxShadow: `0 0 16px ${D.accent}55` }}>
                <Plus className="w-4 h-4" /> Add First Widget
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 auto-rows-auto">
              {displayWidgets.map(w => (
                <div key={w.id} className={sizeClass(w)}>
                  <WidgetCard
                    widget={w}
                    onDelete={() => removeWidget(w.id)}
                    onEdit={() => { setEditWidget(w); setDialogOpen(true); }}
                    fullscreen={fullscreenId === w.id}
                    onFullscreen={() => setFullscreenId(prev => prev === w.id ? null : w.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="px-4 py-1.5 flex items-center gap-3 shrink-0"
          style={{ background: D.panel, borderTop: `1px solid ${D.border}` }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: D.green }} />
          <span style={{ fontSize: 10, color: D.muted }}>
            {displayWidgets.length} widget{displayWidgets.length !== 1 ? "s" : ""} · Auto-refresh 30 s
          </span>
          <span style={{ fontSize: 10, color: D.border2 }}>·</span>
          <span style={{ fontSize: 10, color: D.muted }}>
            {assetList.length} asset{assetList.length !== 1 ? "s" : ""} in hierarchy
          </span>
        </div>
      </div>

      <WidgetDialog
        open={dialogOpen}
        onOpenChange={v => { setDialogOpen(v); if (!v) setEditWidget(null); }}
        initial={editWidget}
        onSave={addOrUpdate}
        usedColors={usedColors}
        preselectedAssetId={selectedAssetId ?? undefined}
      />
    </div>
  );
}
