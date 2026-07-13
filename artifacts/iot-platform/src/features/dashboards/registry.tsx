import {
  Activity, ShieldCheck, Gauge as GaugeIcon, BadgeCheck, Percent, Timer, Clock, Zap,
  Boxes, Bell, LineChart as LineIcon, BarChart3, AreaChart as AreaIcon, PieChart as PieIcon,
  ScatterChart, Grid3x3, Table as TableIcon, Type, Thermometer, Battery, CircleDot,
  Droplet, TrafficCone, ListOrdered, Image as ImageIcon, ToggleLeft,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, XAxis, YAxis, Tooltip, Legend, ScatterChart as RScatterChart, Scatter, ReferenceLine,
} from "recharts";
import type { Widget } from "./types";
import { useMultiSeries, aggregate } from "./useWidgetData";

export const PALETTE = { primary: "#2563EB", success: "#22C55E", warning: "#F59E0B", critical: "#EF4444", neutral: "#64748B" };
const COLORS = [PALETTE.primary, PALETTE.success, PALETTE.warning, PALETTE.critical, "#a855f7", "#06b6d4"];

export interface WidgetDef {
  type: string; label: string; icon: React.ElementType; category: string;
  w: number; h: number;                 // default grid size
  defaults?: Record<string, any>;
}

// ── Catalog (Phase 1 core set + full list of names) ──
export const WIDGET_CATEGORIES: { name: string; items: WidgetDef[] }[] = [
  { name: "KPI", items: [
    { type: "kpi",        label: "Custom KPI",        icon: Activity,    category: "KPI", w: 3, h: 3, defaults: { title: "KPI", unit: "", color: PALETTE.primary } },
    { type: "health",     label: "Health Score",      icon: ShieldCheck, category: "KPI", w: 3, h: 3, defaults: { title: "Health Score", unit: "%", color: PALETTE.success, value: 92 } },
    { type: "availability", label: "Availability",    icon: BadgeCheck,  category: "KPI", w: 3, h: 3, defaults: { title: "Availability", unit: "%", color: PALETTE.success, value: 98 } },
    { type: "oee",        label: "OEE",               icon: Percent,     category: "KPI", w: 3, h: 3, defaults: { title: "OEE", unit: "%", color: PALETTE.primary, value: 84 } },
    { type: "downtime",   label: "Downtime",          icon: Clock,       category: "KPI", w: 3, h: 3, defaults: { title: "Downtime", unit: "h", color: PALETTE.warning, value: 3.2 } },
    { type: "runtime",    label: "Runtime",           icon: Timer,       category: "KPI", w: 3, h: 3, defaults: { title: "Runtime", unit: "h", color: PALETTE.primary, value: 128 } },
    { type: "energy",     label: "Energy",            icon: Zap,         category: "KPI", w: 3, h: 3, defaults: { title: "Energy", unit: "kWh", color: PALETTE.primary, value: 245 } },
    { type: "alarmcount", label: "Alarm Count",       icon: Bell,        category: "KPI", w: 3, h: 3, defaults: { title: "Active Alarms", color: PALETTE.critical, value: 0 } },
    { type: "assetcount", label: "Asset Count",       icon: Boxes,       category: "KPI", w: 3, h: 3, defaults: { title: "Assets", color: PALETTE.neutral, value: 0 } },
  ]},
  { name: "Charts", items: [
    { type: "line",  label: "Line Chart",  icon: LineIcon,  category: "Charts", w: 6, h: 5, defaults: { title: "Line Chart", color: PALETTE.primary } },
    { type: "area",  label: "Area Chart",  icon: AreaIcon,  category: "Charts", w: 6, h: 5, defaults: { title: "Area Chart", color: PALETTE.primary } },
    { type: "bar",   label: "Bar Chart",   icon: BarChart3, category: "Charts", w: 6, h: 5, defaults: { title: "Bar Chart", color: PALETTE.primary } },
    { type: "stackbar", label: "Stacked Bar", icon: BarChart3, category: "Charts", w: 6, h: 5, defaults: { title: "Stacked Bar", color: PALETTE.primary } },
    { type: "sparkline", label: "Sparkline", icon: LineIcon,  category: "Charts", w: 3, h: 2, defaults: { title: "Sparkline", color: PALETTE.primary } },
    { type: "pie",   label: "Pie Chart",   icon: PieIcon,   category: "Charts", w: 4, h: 5, defaults: { title: "Pie Chart" } },
    { type: "donut", label: "Donut Chart", icon: PieIcon,   category: "Charts", w: 4, h: 5, defaults: { title: "Donut Chart" } },
    { type: "scatter", label: "Scatter",   icon: ScatterChart, category: "Charts", w: 6, h: 5, defaults: { title: "Scatter" } },
    { type: "heatmap", label: "Heatmap",   icon: Grid3x3,   category: "Charts", w: 6, h: 5, defaults: { title: "Heatmap" } },
  ]},
  { name: "Industrial", items: [
    { type: "gauge",     label: "Gauge",           icon: GaugeIcon,   category: "Industrial", w: 3, h: 4, defaults: { title: "Gauge", value: 62, max: 100, color: PALETTE.primary } },
    { type: "thermometer", label: "Thermometer",   icon: Thermometer, category: "Industrial", w: 2, h: 5, defaults: { title: "Temp", value: 48, max: 120, color: PALETTE.critical } },
    { type: "tank",      label: "Tank Level",      icon: Droplet,     category: "Industrial", w: 2, h: 5, defaults: { title: "Tank", value: 70, color: PALETTE.primary } },
    { type: "progress",  label: "Progress Bar",    icon: CircleDot,   category: "Industrial", w: 4, h: 2, defaults: { title: "Progress", value: 65, color: PALETTE.success } },
    { type: "status",    label: "Status Indicator",icon: CircleDot,   category: "Industrial", w: 3, h: 2, defaults: { title: "Status", state: "ok" } },
    { type: "traffic",   label: "Traffic Light",   icon: TrafficCone, category: "Industrial", w: 2, h: 4, defaults: { title: "Traffic", state: "ok" } },
    { type: "battery",   label: "Battery",         icon: Battery,     category: "Industrial", w: 3, h: 2, defaults: { title: "Battery", value: 80, color: PALETTE.success } },
  ]},
  { name: "Tables", items: [
    { type: "table",   label: "Data Grid",       icon: TableIcon,  category: "Tables", w: 6, h: 5, defaults: { title: "Data Grid" } },
    { type: "alarms",  label: "Alarm Table",     icon: Bell,       category: "Tables", w: 6, h: 5, defaults: { title: "Alarms" } },
    { type: "events",  label: "Events",          icon: ListOrdered,category: "Tables", w: 6, h: 5, defaults: { title: "Events" } },
  ]},
  { name: "Media & Controls", items: [
    { type: "text",    label: "Text",            icon: Type,       category: "Media & Controls", w: 4, h: 2, defaults: { text: "Text widget" } },
    { type: "image",   label: "Image",           icon: ImageIcon,  category: "Media & Controls", w: 4, h: 4, defaults: { title: "Image", src: "" } },
    { type: "assetsel",label: "Asset Selector",  icon: Boxes,      category: "Media & Controls", w: 3, h: 2, defaults: { title: "Asset" } },
    { type: "button",  label: "Button",          icon: ToggleLeft, category: "Media & Controls", w: 2, h: 2, defaults: { label: "Button" } },
  ]},
];

const BY_TYPE: Record<string, WidgetDef> = {};
for (const c of WIDGET_CATEGORIES) for (const it of c.items) BY_TYPE[it.type] = it;
export function widgetDef(type: string): WidgetDef | undefined { return BY_TYPE[type]; }

// Deterministic-ish demo series (Phase 1 — real telemetry wiring is Phase 2).
function demoSeries(n = 24, seed = 1) {
  return Array.from({ length: n }, (_, i) => ({ t: i, v: +(50 + 30 * Math.sin(i / 3 + seed) + (i % 5) * 3).toFixed(1) }));
}
const demoPie = [{ name: "A", value: 42 }, { name: "B", value: 28 }, { name: "C", value: 18 }, { name: "D", value: 12 }];

// Threshold-aware color for numeric widgets.
function statusColor(value: number | null, c: Record<string, any>): string {
  if (value != null) {
    if (c.critical != null && c.critical !== "" && value >= Number(c.critical)) return PALETTE.critical;
    if (c.warn != null && c.warn !== "" && value >= Number(c.warn)) return PALETTE.warning;
  }
  return c.color ?? PALETTE.primary;
}
function fmt(v: number | null, c: Record<string, any>): string {
  if (v == null) return "—";
  const dec = c.decimals != null ? Number(c.decimals) : (Math.abs(v) < 10 ? 1 : 0);
  return v.toFixed(dec);
}

// ── Renderer ──
export function WidgetView({ widget }: { widget: Widget }) {
  const c = widget.config ?? {};
  const t = widget.type;
  // Tags: scatter uses X/Y; charts support multiple; single-value uses the first.
  const isScatter = t === "scatter";
  const tags: string[] = isScatter
    ? [c.xTag, c.yTag].filter(Boolean)
    : (Array.isArray(c.tags) && c.tags.length ? c.tags : (c.tag ? [c.tag] : []));
  const rows = useMultiSeries(c.assetId, tags, c.rangeHours ?? 24, c.refreshSec ?? 0);
  const bound = !!(c.assetId && tags.length && rows.length);
  const firstTag = tags[0];
  const singleSeries = firstTag ? rows.filter((r) => r[firstTag] != null).map((r) => ({ v: r[firstTag] as number })) : [];
  const chartData = bound ? rows : demoSeries();
  const seriesTags = bound ? tags : ["v"];
  const aggVal = bound ? aggregate(singleSeries as any, c.agg ?? "last") : null;

  // Control-limit (SPC) reference lines — drawn on time-series charts when set.
  const num = (x: any) => (x === "" || x == null || isNaN(Number(x)) ? null : Number(x));
  const spc = [
    { v: num(c.ucl), col: PALETTE.critical, lbl: "UCL" },
    { v: num(c.lcl), col: PALETTE.critical, lbl: "LCL" },
    { v: num(c.cl),  col: PALETTE.neutral,  lbl: "CL" },
  ].filter((s) => s.v != null) as { v: number; col: string; lbl: string }[];
  const spcLines = spc.map((s) => (
    <ReferenceLine key={s.lbl} y={s.v} stroke={s.col} strokeDasharray="4 3" ifOverflow="extendDomain"
      label={{ value: `${s.lbl} ${s.v}`, position: "right", fill: s.col, fontSize: 10 }} />
  ));

  // Bound to an asset+tag but no rows in range → show a real "no data" note instead
  // of misleading demo data. Only unbound (builder preview) widgets use demo data.
  const wantsData = !!c.assetId && tags.length > 0;
  const CHART_TYPES = ["line", "area", "bar", "stackbar", "sparkline", "scatter", "heatmap", "table"];
  if (wantsData && !bound && CHART_TYPES.includes(t)) {
    return <div className="h-full w-full flex items-center justify-center text-slate-400 text-xs">No data in selected range</div>;
  }

  if (["kpi", "health", "availability", "oee", "downtime", "runtime", "energy", "alarmcount", "assetcount"].includes(t)) {
    const value = bound ? aggVal : (c.value ?? 0);
    const color = statusColor(value, c);
    return (
      <div className="h-full w-full flex flex-col justify-center px-1">
        <p className="text-xs text-slate-500 truncate">{c.title ?? "KPI"}{c.tag && !bound ? " (no data)" : ""}</p>
        <p className="text-3xl font-bold tabular-nums" style={{ color }}>{typeof value === "number" ? fmt(value, c) : value}<span className="text-sm text-slate-400 ml-1">{c.unit ?? ""}</span></p>
        {c.subtitle && <p className="text-[11px] text-slate-400 truncate">{c.subtitle}</p>}
      </div>
    );
  }
  if (t === "line" || t === "area") {
    const Chart: any = t === "area" ? AreaChart : LineChart;
    const Series: any = t === "area" ? Area : Line;
    const baseColor = c.color ?? PALETTE.primary;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={chartData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <XAxis dataKey="t" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} /><Tooltip contentStyle={{ fontSize: 11 }} />
          {seriesTags.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {spcLines}
          {seriesTags.map((tg, i) => {
            const col = seriesTags.length > 1 ? COLORS[i % COLORS.length] : baseColor;
            return <Series key={tg} type="monotone" dataKey={tg} name={String(tg).split(".").pop()} stroke={col} fill={col} fillOpacity={0.15} strokeWidth={1.8} dot={false} isAnimationActive={false} />;
          })}
        </Chart>
      </ResponsiveContainer>
    );
  }
  if (t === "bar" || t === "stackbar") {
    const baseColor = c.color ?? PALETTE.primary;
    const stackId = t === "stackbar" ? "s" : undefined;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bound ? rows : demoSeries(12)} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <XAxis dataKey="t" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} /><Tooltip contentStyle={{ fontSize: 11 }} />
          {seriesTags.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {spcLines}
          {seriesTags.map((tg, i) => <Bar key={tg} dataKey={tg} name={String(tg).split(".").pop()} stackId={stackId} fill={seriesTags.length > 1 ? COLORS[i % COLORS.length] : baseColor} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (t === "sparkline") {
    const baseColor = c.color ?? PALETTE.primary;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
          <Tooltip contentStyle={{ fontSize: 11 }} />
          {seriesTags.map((tg, i) => (
            <Line key={tg} type="monotone" dataKey={tg} stroke={seriesTags.length > 1 ? COLORS[i % COLORS.length] : baseColor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (t === "pie" || t === "donut") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={demoPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="80%" innerRadius={t === "donut" ? "55%" : 0} isAnimationActive={false}>
            {demoPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie><Tooltip contentStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (t === "gauge") {
    const val = (bound ? aggVal : c.value) ?? 0, max = c.max ?? 100;
    const color = statusColor(val, c);
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <ResponsiveContainer width="100%" height="75%">
          <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ v: val, fill: color }]} startAngle={210} endAngle={-30}>
            <RadialBar dataKey="v" cornerRadius={6} background isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <p className="text-xl font-bold -mt-6" style={{ color }}>{fmt(val, c)}<span className="text-xs text-slate-400">/{max}</span></p>
      </div>
    );
  }
  if (t === "thermometer" || t === "tank" || t === "battery" || t === "progress") {
    const val = (bound ? aggVal : c.value) ?? 0, max = c.max ?? 100, pct = Math.max(0, Math.min(100, (val / max) * 100));
    const color = statusColor(val, c);
    const vertical = t === "thermometer" || t === "tank";
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-2">
        <div className={vertical ? "relative w-6 flex-1 rounded-full bg-slate-100 overflow-hidden" : "relative w-full h-3 rounded-full bg-slate-100 overflow-hidden"}>
          <div className={vertical ? "absolute bottom-0 w-full" : "absolute left-0 top-0 h-full"} style={{ [vertical ? "height" : "width"]: `${pct}%`, background: color }} />
        </div>
        <p className="text-sm font-semibold" style={{ color }}>{fmt(val, c)}{t === "battery" || t === "progress" ? "%" : ""}</p>
      </div>
    );
  }
  if (t === "status" || t === "traffic") {
    const state = c.state ?? "ok";
    const col = state === "ok" ? PALETTE.success : state === "warn" ? PALETTE.warning : PALETTE.critical;
    return <div className="h-full flex items-center justify-center gap-2"><span className="w-4 h-4 rounded-full" style={{ background: col }} /><span className="text-sm capitalize">{state}</span></div>;
  }
  if (t === "table" || t === "alarms" || t === "events") {
    const tableRows = bound && firstTag
      ? [...rows].reverse().slice(0, 30).map((r) => ({ t: r.t as string, v: r[firstTag] as number }))
      : demoSeries(6);
    return (
      <div className="h-full overflow-auto text-xs">
        <table className="w-full"><thead className="sticky top-0 bg-white"><tr className="text-slate-400 border-b"><th className="text-left py-1">{bound ? "Time" : "Name"}</th><th className="text-left">{firstTag ? String(firstTag).split(".").pop() : "Value"}</th></tr></thead>
          <tbody>{tableRows.map((r, i) => <tr key={i} className="border-b border-slate-100"><td className="py-1">{bound ? r.t : `Row ${r.t}`}</td><td>{fmt(r.v, c)}</td></tr>)}</tbody></table>
      </div>
    );
  }
  if (t === "scatter") {
    const color = c.color ?? PALETTE.primary;
    // X vs Y: correlate two tags. Falls back to sample if not both set.
    const pts = (bound && c.xTag && c.yTag)
      ? rows.filter((r) => r[c.xTag] != null && r[c.yTag] != null).map((r) => ({ x: r[c.xTag], y: r[c.yTag] }))
      : demoSeries().map((d, i) => ({ x: i, y: d.v }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RScatterChart margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <XAxis dataKey="x" type="number" name={c.xTag ? String(c.xTag).split(".").pop() : "x"} tick={{ fontSize: 9 }} />
          <YAxis dataKey="y" type="number" name={c.yTag ? String(c.yTag).split(".").pop() : "y"} tick={{ fontSize: 9 }} />
          <Tooltip contentStyle={{ fontSize: 11 }} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={pts} fill={color} isAnimationActive={false} />
        </RScatterChart>
      </ResponsiveContainer>
    );
  }
  if (t === "heatmap") {
    const vals: number[] = (bound && firstTag) ? rows.map((r) => r[firstTag] as number).filter((v) => v != null) : demoSeries(48).map((d) => d.v);
    const mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
    return (
      <div className="h-full w-full grid gap-0.5 p-1 content-start" style={{ gridTemplateColumns: "repeat(12, minmax(0,1fr))" }}>
        {vals.slice(0, 96).map((v, i) => {
          const k = (v - mn) / span; // 0..1 → light→dark blue
          return <div key={i} className="rounded-sm" style={{ aspectRatio: "1", background: `rgba(37,99,235,${0.15 + k * 0.85})` }} title={String(v)} />;
        })}
      </div>
    );
  }
  if (t === "text") return <div className="h-full w-full p-1 text-sm text-slate-700 overflow-auto whitespace-pre-wrap">{c.text ?? "Text"}</div>;
  if (t === "button") return <div className="h-full flex items-center justify-center"><span className="px-3 py-1.5 rounded-md text-white text-sm" style={{ background: PALETTE.primary }}>{c.label ?? "Button"}</span></div>;

  // Fallback for not-yet-implemented widget types
  const def = widgetDef(t);
  const Icon = def?.icon ?? Activity;
  return <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-1"><Icon className="w-6 h-6" /><span className="text-xs">{def?.label ?? t}</span></div>;
}
