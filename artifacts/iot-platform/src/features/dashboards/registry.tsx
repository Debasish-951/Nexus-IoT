import { memo } from "react";
import {
  Activity, ShieldCheck, Gauge as GaugeIcon, BadgeCheck, Percent, Timer, Clock, Zap,
  Boxes, Bell, LineChart as LineIcon, BarChart3, AreaChart as AreaIcon, PieChart as PieIcon,
  ScatterChart, Grid3x3, Table as TableIcon, Type, Thermometer, Battery, CircleDot,
  Droplet, TrafficCone, ListOrdered, Image as ImageIcon, ToggleLeft,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, XAxis, YAxis, Tooltip, Legend, ScatterChart as RScatterChart, Scatter, ReferenceLine, CartesianGrid,
} from "recharts";
import type { Widget } from "./types";
import { useSeriesSet, useAttributeMeta, aggregate, type SeriesSpec } from "./useWidgetData";
import type { TimeCfg } from "./timeRange";

export const PALETTE = { primary: "#2563EB", success: "#22C55E", warning: "#F59E0B", critical: "#EF4444", neutral: "#64748B" };
const COLORS = [PALETTE.primary, PALETTE.success, PALETTE.warning, PALETTE.critical, "#a855f7", "#06b6d4"];

/**
 * Shared <Tooltip> look for every chart type.
 *
 * Two real bugs, not just polish: (1) `contentStyle` alone left Recharts' own
 * white-background default showing through as an unthemed box that stood out
 * against a dark dashboard and was hard to read; (2) Recharts fades the tooltip
 * in/out by default (its own `isAnimationActive`), and on a widget refreshing
 * every few seconds a new fade can start before the last one finished, leaving
 * a stale, textless tooltip shell rendered behind the current one — the "ghost
 * white bars" while moving the cursor. `isAnimationActive={false}` removes the
 * transition entirely, which is the actual fix; the styling is the readability
 * half of the same complaint.
 *
 * Colors are the theme's own `--popover`/`--border` CSS variables (see
 * index.css), so this matches light/dark mode automatically instead of a
 * hardcoded scheme that would look wrong in the other one.
 */
const TOOLTIP_PROPS = {
  isAnimationActive: false,
  contentStyle: {
    fontSize: 11,
    background: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    border: "1px solid hsl(var(--popover-border))",
    borderRadius: 6,
    padding: "6px 10px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
  },
  labelStyle: { color: "hsl(var(--muted-foreground))", marginBottom: 2 },
  itemStyle: { padding: 0 },
} as const;

export interface WidgetDef {
  type: string; label: string; icon: React.ElementType; category: string;
  w: number; h: number;                 // default grid size
  defaults?: Record<string, any>;
}

// ── Catalog (Phase 1 core set + full list of names) ──
export const WIDGET_CATEGORIES: { name: string; items: WidgetDef[] }[] = [
  { name: "KPI", items: [
    { type: "kpi",        label: "Custom KPI",        icon: Activity,    category: "KPI", w: 3, h: 3, defaults: { unit: "", color: PALETTE.primary } },
    { type: "health",     label: "Health Score",      icon: ShieldCheck, category: "KPI", w: 3, h: 3, defaults: { unit: "%", color: PALETTE.success, value: 92 } },
    { type: "availability", label: "Availability",    icon: BadgeCheck,  category: "KPI", w: 3, h: 3, defaults: { unit: "%", color: PALETTE.success, value: 98 } },
    { type: "oee",        label: "OEE",               icon: Percent,     category: "KPI", w: 3, h: 3, defaults: { unit: "%", color: PALETTE.primary, value: 84 } },
    { type: "downtime",   label: "Downtime",          icon: Clock,       category: "KPI", w: 3, h: 3, defaults: { unit: "h", color: PALETTE.warning, value: 3.2 } },
    { type: "runtime",    label: "Runtime",           icon: Timer,       category: "KPI", w: 3, h: 3, defaults: { unit: "h", color: PALETTE.primary, value: 128 } },
    { type: "energy",     label: "Energy",            icon: Zap,         category: "KPI", w: 3, h: 3, defaults: { unit: "kWh", color: PALETTE.primary, value: 245 } },
    { type: "alarmcount", label: "Alarm Count",       icon: Bell,        category: "KPI", w: 3, h: 3, defaults: { color: PALETTE.critical, value: 0 } },
    { type: "assetcount", label: "Asset Count",       icon: Boxes,       category: "KPI", w: 3, h: 3, defaults: { color: PALETTE.neutral, value: 0 } },
  ]},
  { name: "Charts", items: [
    { type: "line",  label: "Line Chart",  icon: LineIcon,  category: "Charts", w: 6, h: 5, defaults: { color: PALETTE.primary } },
    { type: "area",  label: "Area Chart",  icon: AreaIcon,  category: "Charts", w: 6, h: 5, defaults: { color: PALETTE.primary } },
    { type: "bar",   label: "Bar Chart",   icon: BarChart3, category: "Charts", w: 6, h: 5, defaults: { color: PALETTE.primary } },
    { type: "stackbar", label: "Stacked Bar", icon: BarChart3, category: "Charts", w: 6, h: 5, defaults: { color: PALETTE.primary } },
    { type: "sparkline", label: "Sparkline", icon: LineIcon,  category: "Charts", w: 3, h: 2, defaults: { color: PALETTE.primary } },
    { type: "pie",   label: "Pie Chart",   icon: PieIcon,   category: "Charts", w: 4, h: 5 },
    { type: "donut", label: "Donut Chart", icon: PieIcon,   category: "Charts", w: 4, h: 5 },
    { type: "scatter", label: "Scatter",   icon: ScatterChart, category: "Charts", w: 6, h: 5 },
    { type: "heatmap", label: "Heatmap",   icon: Grid3x3,   category: "Charts", w: 6, h: 5 },
  ]},
  { name: "Industrial", items: [
    { type: "gauge",     label: "Gauge",           icon: GaugeIcon,   category: "Industrial", w: 3, h: 4, defaults: { value: 62, max: 100, color: PALETTE.primary } },
    { type: "thermometer", label: "Thermometer",   icon: Thermometer, category: "Industrial", w: 2, h: 5, defaults: { value: 48, max: 120, color: PALETTE.critical } },
    { type: "tank",      label: "Tank Level",      icon: Droplet,     category: "Industrial", w: 2, h: 5, defaults: { value: 70, color: PALETTE.primary } },
    { type: "progress",  label: "Progress Bar",    icon: CircleDot,   category: "Industrial", w: 4, h: 2, defaults: { value: 65, color: PALETTE.success } },
    { type: "status",    label: "Status Indicator",icon: CircleDot,   category: "Industrial", w: 3, h: 2, defaults: { state: "ok" } },
    { type: "traffic",   label: "Traffic Light",   icon: TrafficCone, category: "Industrial", w: 2, h: 4, defaults: { state: "ok" } },
    { type: "battery",   label: "Battery",         icon: Battery,     category: "Industrial", w: 3, h: 2, defaults: { value: 80, color: PALETTE.success } },
  ]},
  { name: "Tables", items: [
    { type: "table",   label: "Data Grid",       icon: TableIcon,  category: "Tables", w: 6, h: 5 },
    { type: "alarms",  label: "Alarm Table",     icon: Bell,       category: "Tables", w: 6, h: 5 },
    { type: "events",  label: "Events",          icon: ListOrdered,category: "Tables", w: 6, h: 5 },
  ]},
  { name: "Media & Controls", items: [
    { type: "text",    label: "Text",            icon: Type,       category: "Media & Controls", w: 4, h: 2, defaults: { text: "Text widget" } },
    { type: "image",   label: "Image",           icon: ImageIcon,  category: "Media & Controls", w: 4, h: 4, defaults: { src: "" } },
    { type: "assetsel",label: "Asset Selector",  icon: Boxes,      category: "Media & Controls", w: 3, h: 2 },
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
// Wrapped in memo(): dragging or resizing ANY widget replaces the whole
// customWidgets array, but unaffected widgets keep the exact same `widget`
// object reference (see DashboardCanvas/AssetVizPanel's `.map`). Without this,
// every WidgetView on the canvas — including Recharts-heavy charts — re-rendered
// on every pointermove of a drag, which is what made the canvas feel laggy with
// more than a couple of chart widgets on screen.
export const WidgetView = memo(function WidgetView({ widget, refreshNonce, dashTimeCfg }: {
  widget: Widget; refreshNonce?: string | number;
  /** The dashboard-wide range. Used ONLY for the range portion of this widget's
   *  query, and ONLY while the widget has no `timeIsCustom` range of its own —
   *  granularity/aggregation/refresh always come from the widget's own config,
   *  dashboard-wide or not (see the WidgetTimePopover module comment). */
  dashTimeCfg?: TimeCfg | null;
}) {
  const c = widget.config ?? {};
  const t = widget.type;
  // Series: scatter uses X/Y; charts support a primary metric + overlay series,
  // each of which can bind to its OWN asset and carry its own color/label. Falls
  // back to the legacy `tags` array for widgets saved before overlays existed.
  // Single-value / table widgets use just the primary series.
  const isScatter = t === "scatter";
  const isMultiSeriesChart = ["line", "area", "bar", "stackbar"].includes(t);
  const seriesList: SeriesSpec[] = [];
  // What each series was bound to, kept separate from its display name — the name
  // can only be resolved after the attribute-name lookup a few lines down.
  interface SeriesSrc { assetId?: string; tag?: string; color?: string; label?: string; unit?: string }
  const seriesSrc: Record<string, SeriesSrc> = {};
  if (isScatter) {
    if (c.xTag) seriesList.push({ key: "x", assetId: c.assetId, tag: c.xTag });
    if (c.yTag) seriesList.push({ key: "y", assetId: c.assetId, tag: c.yTag });
  } else if (isMultiSeriesChart) {
    const overlays: { assetId?: string; tag?: string; color?: string; label?: string; unit?: string }[] = Array.isArray(c.overlays) ? c.overlays : [];
    if (c.tag || overlays.length) {
      if (c.tag) {
        seriesList.push({ key: "s0", assetId: c.assetId, tag: c.tag });
        seriesSrc.s0 = { assetId: c.assetId, tag: c.tag, color: c.color, label: c.label, unit: c.unit };
      }
      overlays.forEach((o, i) => {
        if (!o.tag) return;
        const key = `s${i + 1}`;
        const assetId = o.assetId || c.assetId;
        seriesList.push({ key, assetId, tag: o.tag });
        seriesSrc[key] = { assetId, tag: o.tag, color: o.color, label: o.label, unit: o.unit };
      });
    } else if (Array.isArray(c.tags)) {
      c.tags.forEach((tg: string, i: number) => {
        if (!tg) return;
        seriesList.push({ key: `s${i}`, assetId: c.assetId, tag: tg });
        seriesSrc[`s${i}`] = { assetId: c.assetId, tag: tg };
      });
    }
  } else if (c.tag) {
    seriesList.push({ key: "s0", assetId: c.assetId, tag: c.tag });
    seriesSrc.s0 = { assetId: c.assetId, tag: c.tag, color: c.color, label: c.label, unit: c.unit };
  }

  // A series is named after the attribute the user named, not the raw payload tag
  // — "Chiller Energy", not "chiller.energy_kWh" — and carries the unit already
  // declared in the template's UoM column. Precedence for both: the widget's own
  // Label/UoM field (an explicit per-widget override) → what the attribute itself
  // says → the tag's last segment / no unit as a last resort.
  const attrMeta = useAttributeMeta(seriesList.map((s) => s.assetId));
  const metaFor = (src: SeriesSrc | undefined) =>
    (src?.assetId && src.tag) ? attrMeta.get(`${src.assetId}::${src.tag}`) : undefined;
  const displayName = (src: SeriesSrc | undefined): string | undefined => {
    if (!src) return undefined;
    return src.label?.trim()
      || metaFor(src)?.name
      || (src.tag ? String(src.tag).split(".").pop() : undefined);
  };
  const displayUnit = (src: SeriesSrc | undefined): string | undefined =>
    src?.unit?.trim() || metaFor(src)?.uom;
  const seriesMeta: Record<string, { color?: string; label?: string; unit?: string }> = {};
  for (const [key, src] of Object.entries(seriesSrc)) {
    seriesMeta[key] = { color: src.color, label: displayName(src), unit: displayUnit(src) };
  }
  // Range comes from the widget's OWN setting once it has one (`timeIsCustom`, set
  // the instant its clock-icon popover is applied); until then it tracks the
  // dashboard-wide range LIVE — not a copy taken at some past moment, so it never
  // goes stale and there is nothing to leave behind if the widget later gets its
  // own range. Granularity/aggregation are always the widget's own, dashboard-wide
  // range or not — the dashboard selector has no notion of either.
  const isTimeCustom = !!c.timeIsCustom || c.allowOverride === false;
  const range = isTimeCustom
    ? { rangeMinutes: c.rangeMinutes, rangeHours: c.rangeHours, customFrom: c.customFrom, customTo: c.customTo }
    : (dashTimeCfg ?? {});
  const timeCfg: TimeCfg = { ...range, granularity: c.granularity, aggType: c.aggType };
  const refreshSec = c.refreshEnabled ? Math.round((c.refreshInterval ?? 30_000) / 1000) : (c.refreshSec ?? 0);
  const rows = useSeriesSet(seriesList, timeCfg, refreshSec, refreshNonce);
  const interpolated = !!c.interpolated;
  const wantsData = seriesList.some((s) => s.assetId && s.tag);
  const bound = wantsData && rows.length > 0;
  const firstKey = seriesList[0]?.key;
  const singleSeries = firstKey ? rows.filter((r) => r[firstKey] != null).map((r) => ({ v: r[firstKey] as number })) : [];
  const chartData = bound ? rows : demoSeries();
  const seriesTags = bound ? seriesList.map((s) => s.key) : ["v"];
  const aggVal = bound ? aggregate(singleSeries as any, c.agg ?? "last") : null;

  // Axis/legend split, matching how trend tools conventionally read:
  //   • y-axis  → the unit of measure ALONE ("kWh"). It describes the scale, and a
  //               scale has a unit, not a name.
  //   • legend  → one entry per series, named after its attribute, under the x-axis.
  // Cramming "{name} ({unit})" onto the y-axis (the old behaviour) had to be
  // suppressed the moment a second series appeared, since one axis label cannot
  // honestly speak for two attributes — so a multi-series chart ended up with no
  // unit shown at all. Distinct units are joined rather than silently showing the
  // first, which would mislabel the rest.
  const units = [...new Set(
    Object.values(seriesMeta).map((m) => m.unit?.trim()).filter((u): u is string => !!u),
  )];
  const yAxisLabel = units.length ? units.join(" / ") : undefined;
  const yAxisProps = yAxisLabel
    ? { label: { value: yAxisLabel, angle: -90, position: "insideLeft" as const, offset: 8, style: { fontSize: 9, textAnchor: "middle" as const } } }
    : {};
  // The label needs room the tight default margin doesn't leave.
  const chartMarginLeft = yAxisLabel ? 4 : -18;

  // The legend used to appear only for 2+ series, so a single-series chart showed
  // its attribute name nowhere at all — which is exactly the "I set a Label and it
  // isn't on the widget" complaint. Now any bound chart with a resolvable name
  // shows it; unbound preview widgets (demo data, series key "v") still don't.
  const showLegend = seriesTags.length > 1 || (bound && !!seriesMeta[firstKey ?? ""]?.label);
  // No `iconType` — Recharts then derives each entry's swatch from its own series
  // (a line for Line, a block for Bar), which is what makes an overlay of both
  // readable at a glance.
  const legendEl = showLegend
    ? <Legend verticalAlign="bottom" height={20} iconSize={10} wrapperStyle={{ fontSize: 10 }} />
    : null;

  // Control-limit (SPC) reference lines — drawn on time-series charts when set.
  // Each line's color/style is independently configurable from the Edit Widget dialog.
  const num = (x: any) => (x === "" || x == null || isNaN(Number(x)) ? null : Number(x));
  const spc = [
    { v: num(c.ucl), col: c.uclColor ?? PALETTE.critical, dashed: c.uclStyle !== "solid", lbl: "UCL" },
    { v: num(c.lcl), col: c.lclColor ?? PALETTE.critical, dashed: c.lclStyle !== "solid", lbl: "LCL" },
    { v: num(c.cl),  col: c.clColor ?? PALETTE.neutral,   dashed: c.clStyle !== "solid",  lbl: "CL" },
  ].filter((s) => s.v != null) as { v: number; col: string; dashed: boolean; lbl: string }[];
  const spcLines = spc.map((s) => (
    <ReferenceLine key={s.lbl} y={s.v} stroke={s.col} strokeDasharray={s.dashed ? "4 3" : undefined} ifOverflow="extendDomain"
      label={{ value: `${s.lbl} ${s.v}`, position: "right", fill: s.col, fontSize: 10 }} />
  ));

  // Bound to an asset+tag but no rows in range → show a real "no data" note instead
  // of misleading demo data. Only unbound (builder preview) widgets use demo data.
  const CHART_TYPES = ["line", "area", "bar", "stackbar", "sparkline", "scatter", "heatmap", "table"];
  if (wantsData && !bound && CHART_TYPES.includes(t)) {
    return <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs">No data in selected range</div>;
  }

  if (["kpi", "health", "availability", "oee", "downtime", "runtime", "energy", "alarmcount", "assetcount"].includes(t)) {
    const value = bound ? aggVal : (c.value ?? 0);
    const color = statusColor(value, c);
    return (
      <div className="h-full w-full flex flex-col justify-center px-1">
        {/* The series name, NOT the title — the widget header already carries the
            title, and printing it in both places put the same text on one widget
            twice. A KPI has no legend, so this caption is where its attribute name
            belongs. */}
        <p className="text-xs text-muted-foreground truncate">{seriesMeta[firstKey ?? ""]?.label || widgetDef(t)?.label || "KPI"}{c.tag && !bound ? " (no data)" : ""}</p>
        <p className="text-3xl font-bold tabular-nums" style={{ color }}>{typeof value === "number" ? fmt(value, c) : value}<span className="text-sm text-muted-foreground ml-1">{seriesMeta[firstKey ?? ""]?.unit ?? c.unit ?? ""}</span></p>
        {c.subtitle && <p className="text-[11px] text-muted-foreground truncate">{c.subtitle}</p>}
      </div>
    );
  }
  if (t === "line" || t === "area") {
    const Chart: any = t === "area" ? AreaChart : LineChart;
    const Series: any = t === "area" ? Area : Line;
    const baseColor = c.color ?? PALETTE.primary;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={chartData} margin={{ top: 6, right: 8, left: chartMarginLeft, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} vertical={false} /><XAxis dataKey="t" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} {...yAxisProps} /><Tooltip {...TOOLTIP_PROPS} />
          {legendEl}
          {spcLines}
          {seriesTags.map((tg, i) => {
            const meta = seriesMeta[tg];
            const col = meta?.color ?? (seriesTags.length > 1 ? COLORS[i % COLORS.length] : baseColor);
            const name = meta?.label || String(tg).split(".").pop();
            return <Series key={tg} type="monotone" dataKey={tg} name={name} stroke={col} fill={col} fillOpacity={0.15} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={interpolated} />;
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
        <BarChart data={bound ? rows : demoSeries(12)} margin={{ top: 6, right: 8, left: chartMarginLeft, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} vertical={false} /><XAxis dataKey="t" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} {...yAxisProps} /><Tooltip {...TOOLTIP_PROPS} />
          {legendEl}
          {spcLines}
          {seriesTags.map((tg, i) => {
            const meta = seriesMeta[tg];
            const fill = meta?.color ?? (seriesTags.length > 1 ? COLORS[i % COLORS.length] : baseColor);
            const name = meta?.label || String(tg).split(".").pop();
            return <Bar key={tg} dataKey={tg} name={name} stackId={stackId} fill={fill} isAnimationActive={false} />;
          })}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (t === "sparkline") {
    const baseColor = c.color ?? PALETTE.primary;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
          <Tooltip {...TOOLTIP_PROPS} />
          {seriesTags.map((tg, i) => (
            <Line key={tg} type="monotone" dataKey={tg} stroke={seriesTags.length > 1 ? COLORS[i % COLORS.length] : baseColor} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={interpolated} />
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
          </Pie><Tooltip {...TOOLTIP_PROPS} />
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
        <p className="text-xl font-bold -mt-6" style={{ color }}>{fmt(val, c)}<span className="text-xs text-muted-foreground">/{max}</span></p>
      </div>
    );
  }
  if (t === "thermometer" || t === "tank" || t === "battery" || t === "progress") {
    const val = (bound ? aggVal : c.value) ?? 0, max = c.max ?? 100, pct = Math.max(0, Math.min(100, (val / max) * 100));
    const color = statusColor(val, c);
    const vertical = t === "thermometer" || t === "tank";
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-2">
        <div className={vertical ? "relative w-6 flex-1 rounded-full bg-muted overflow-hidden" : "relative w-full h-3 rounded-full bg-muted overflow-hidden"}>
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
    const colName = firstKey ? (seriesMeta[firstKey]?.label ?? "Value") : "Value";
    const tableRows = bound && firstKey
      ? [...rows].reverse().slice(0, 30).map((r) => ({ t: r.t as string, v: r[firstKey] as number }))
      : demoSeries(6);
    return (
      <div className="h-full overflow-auto text-xs">
        <table className="w-full"><thead className="sticky top-0 bg-card"><tr className="text-muted-foreground border-b border-border"><th className="text-left py-1">{bound ? "Time" : "Name"}</th><th className="text-left">{colName}</th></tr></thead>
          <tbody>{tableRows.map((r, i) => <tr key={i} className="border-b border-border"><td className="py-1">{bound ? r.t : `Row ${r.t}`}</td><td>{fmt(r.v, c)}</td></tr>)}</tbody></table>
      </div>
    );
  }
  if (t === "scatter") {
    const color = c.color ?? PALETTE.primary;
    // X vs Y: correlate two tags. Falls back to sample if not both set.
    const pts = (bound && c.xTag && c.yTag)
      ? rows.filter((r) => r.x != null && r.y != null).map((r) => ({ x: r.x, y: r.y }))
      : demoSeries().map((d, i) => ({ x: i, y: d.v }));
    // Both scatter axes ARE attributes, so both get named after theirs — there is
    // no legend to carry them here (a single scatter series has nothing to
    // distinguish), which makes the axis titles the only place they can appear.
    const xName = displayName({ assetId: c.assetId, tag: c.xTag });
    const yName = displayName({ assetId: c.assetId, tag: c.yTag });
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RScatterChart margin={{ top: 6, right: 8, left: yName ? 4 : -18, bottom: xName ? 14 : 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis dataKey="x" type="number" name={xName ?? "x"} tick={{ fontSize: 9 }}
            {...(xName ? { label: { value: xName, position: "insideBottom" as const, offset: -10, style: { fontSize: 9 } } } : {})} />
          <YAxis dataKey="y" type="number" name={yName ?? "y"} tick={{ fontSize: 9 }}
            {...(yName ? { label: { value: yName, angle: -90, position: "insideLeft" as const, offset: 8, style: { fontSize: 9, textAnchor: "middle" as const } } } : {})} />
          <Tooltip {...TOOLTIP_PROPS} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={pts} fill={color} isAnimationActive={false} />
        </RScatterChart>
      </ResponsiveContainer>
    );
  }
  if (t === "heatmap") {
    const vals: number[] = (bound && firstKey) ? rows.map((r) => r[firstKey] as number).filter((v) => v != null) : demoSeries(48).map((d) => d.v);
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
  if (t === "text") return <div className="h-full w-full p-1 text-sm text-foreground overflow-auto whitespace-pre-wrap">{c.text ?? "Text"}</div>;
  if (t === "button") return <div className="h-full flex items-center justify-center"><span className="px-3 py-1.5 rounded-md text-white text-sm" style={{ background: PALETTE.primary }}>{c.label ?? "Button"}</span></div>;

  // Fallback for not-yet-implemented widget types
  const def = widgetDef(t);
  const Icon = def?.icon ?? Activity;
  return <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-1"><Icon className="w-6 h-6" /><span className="text-xs">{def?.label ?? t}</span></div>;
});
