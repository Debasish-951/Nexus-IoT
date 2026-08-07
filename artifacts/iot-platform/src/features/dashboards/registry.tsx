import { memo } from "react";
import {
  Activity, Gauge as GaugeIcon, Timer, Zap,
  Boxes, Bell, LineChart as LineIcon, BarChart3, AreaChart as AreaIcon, PieChart as PieIcon,
  ScatterChart, Grid3x3, Table as TableIcon, Type, Thermometer, Battery, CircleDot,
  Droplet, TrafficCone, ListOrdered, Image as ImageIcon, ToggleLeft, CreditCard,
  TrendingUp, Wind, Move, Waves, AlertTriangle, Cpu, Package,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, XAxis, YAxis, Tooltip, Legend, ScatterChart as RScatterChart, Scatter, ReferenceLine, CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import type { Widget } from "./types";
import { useSeriesSet, useAttributeMeta, aggregate, type SeriesSpec } from "./useWidgetData";
import type { TimeCfg } from "./timeRange";
import { SERIES, STATUS } from "@/lib/chartColors";

/**
 * Widget colours. Status colours come from the shared STATUS set; `primary` is the
 * theme accent, used as a widget's default single-series colour.
 *
 * The series list and the status list are deliberately separate — see
 * src/lib/chartColors.ts for why.
 */
export const PALETTE = {
  primary: "#3B82F6",
  success: STATUS.ok,
  warning: STATUS.warning,
  critical: STATUS.critical,
  neutral: STATUS.neutral,
};

/** Re-exported so the widget config panel can offer the same order. */
export const SERIES_COLORS = SERIES;

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

/**
 * Icon choices offered per-metric on the Card widget (see WidgetConfigPanel's
 * metric rows). Deliberately a small curated set, hand-picked per metric — not
 * inferred from the attribute's name/unit, which would silently guess wrong for
 * anything the heuristic didn't anticipate.
 */
export const CARD_ICONS: Record<string, React.ElementType> = {
  activity: Activity, gauge: GaugeIcon, thermometer: Thermometer, zap: Zap,
  droplet: Droplet, battery: Battery, timer: Timer, trendingUp: TrendingUp,
  wind: Wind, move: Move, waves: Waves, alert: AlertTriangle, cpu: Cpu,
  package: Package, bell: Bell, boxes: Boxes,
};
export const CARD_ICON_KEYS = Object.keys(CARD_ICONS);

/**
 * Widget types that group N independently-bound metrics into one grid, each
 * rendered as its own tile — a Card's label+value, or one of the Industrial
 * marks (a gauge, a thermometer, a traffic light, …). One config shape
 * (`config.metrics: []` + shared layout knobs) and one series-building /
 * migration path serve all of them; only the per-tile "mark" differs.
 */
export const GROUPED_TYPES = ["card", "gauge", "thermometer", "tank", "progress", "status", "traffic", "battery"] as const;

// ── Catalog (Phase 1 core set + full list of names) ──
export const WIDGET_CATEGORIES: { name: string; items: WidgetDef[] }[] = [
  { name: "Charts", items: [
    // A single generic Card, not nine near-identical single-value widgets (Custom
    // KPI, Health Score, OEE, …) that all rendered the same label+value tile. One
    // metric bound = the old single-KPI look; add more to group several readings
    // into one grid, like a "Recent Sensor Data" tile.
    { type: "card",  label: "Card",        icon: CreditCard, category: "Charts", w: 4, h: 3, defaults: {
      metrics: [{}], columns: 2, gridGap: 8, textOrientation: "vertical", unitPlacement: "suffix",
      showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 20,
    } },
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
    // Same grouping model as Card (config.metrics + shared layout) — one gauge
    // bound = the old single-value look; add more to compare several readings
    // in one grid of dials/bars/lights instead of one widget each.
    { type: "gauge",     label: "Gauge",           icon: GaugeIcon,   category: "Industrial", w: 4, h: 5, defaults: {
      metrics: [{ max: 100, color: PALETTE.primary }], columns: 1, gridGap: 8, unitPlacement: "suffix",
      showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 18,
    } },
    { type: "thermometer", label: "Thermometer",   icon: Thermometer, category: "Industrial", w: 3, h: 6, defaults: {
      metrics: [{ max: 120, color: PALETTE.critical }], columns: 1, gridGap: 8, unitPlacement: "suffix",
      showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 14,
    } },
    { type: "tank",      label: "Tank Level",      icon: Droplet,     category: "Industrial", w: 3, h: 6, defaults: {
      metrics: [{ max: 100, color: PALETTE.primary }], columns: 1, gridGap: 8, unitPlacement: "suffix",
      showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 14,
    } },
    { type: "progress",  label: "Progress Bar",    icon: CircleDot,   category: "Industrial", w: 4, h: 3, defaults: {
      metrics: [{ color: PALETTE.success }], columns: 1, gridGap: 8, unitPlacement: "suffix",
      showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 13,
    } },
    { type: "status",    label: "Status Indicator",icon: CircleDot,   category: "Industrial", w: 3, h: 3, defaults: {
      metrics: [{ state: "ok" }], columns: 1, gridGap: 8, showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 13,
    } },
    { type: "traffic",   label: "Traffic Light",   icon: TrafficCone, category: "Industrial", w: 2, h: 5, defaults: {
      metrics: [{ state: "ok" }], columns: 1, gridGap: 8, showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 13,
    } },
    { type: "battery",   label: "Battery",         icon: Battery,     category: "Industrial", w: 4, h: 3, defaults: {
      metrics: [{ max: 100, color: PALETTE.success }], columns: 1, gridGap: 8, unitPlacement: "suffix",
      showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 13,
    } },
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

// ── Legacy KPI types → Card ──
// The old single-value widgets (Custom KPI, Health Score, Availability, OEE,
// Downtime, Runtime, Energy, Alarm Count, Asset Count) are gone from the
// library, folded into the general Card widget above. Dashboards saved before
// this change still name one of these types in localStorage, so every widget
// is upgraded in place the first time it's loaded (see AssetVizPanel) rather
// than silently rendering broken.
export const LEGACY_KPI_TYPES = [
  "kpi", "health", "availability", "oee", "downtime", "runtime", "energy", "alarmcount", "assetcount",
] as const;
const LEGACY_ICON: Record<string, string> = {
  kpi: "activity", health: "gauge", availability: "gauge", oee: "gauge",
  downtime: "timer", runtime: "timer", energy: "zap", alarmcount: "alert", assetcount: "package",
};
export function migrateLegacyWidget(w: Widget): Widget {
  const c = w.config ?? {};

  // Case 1: an old KPI-only type — the type itself is gone, folded into Card.
  if ((LEGACY_KPI_TYPES as readonly string[]).includes(w.type)) {
    return {
      ...w,
      type: "card",
      config: {
        metrics: [{
          assetId: c.assetId, tag: c.tag, label: c.label, unit: c.unit,
          color: c.color, icon: LEGACY_ICON[w.type] ?? "activity",
          // The old types shipped a hardcoded demo number (e.g. Health Score → 92)
          // shown only while unbound — carried over so an unbound migrated widget
          // still looks the way it did, instead of collapsing to a bare "0.0".
          defaultValue: c.value,
        }],
        columns: 1, gridGap: 8, textOrientation: "vertical", unitPlacement: "suffix",
        showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 26,
      },
    };
  }

  // Case 2: an Industrial type (Gauge, Thermometer, Tank, Progress, Status,
  // Traffic, Battery) still exists, but its config used to hold ONE flat
  // value/max/state directly rather than a `metrics` array — upgrade the shape
  // in place so a dashboard saved before grouping still shows its binding.
  const isGrouped = (GROUPED_TYPES as readonly string[]).includes(w.type) && w.type !== "card";
  if (isGrouped && !Array.isArray(c.metrics)) {
    return {
      ...w,
      config: {
        metrics: [{
          assetId: c.assetId, tag: c.tag, label: c.label, unit: c.unit, color: c.color,
          max: c.max, critical: c.critical, warn: c.warn, state: c.state, defaultValue: c.value,
        }],
        columns: 1, gridGap: 8, unitPlacement: "suffix",
        showFullText: false, radius: 10, titleFontSize: 13, valueFontSize: 16,
      },
    };
  }

  return w;
}

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

// Black or white, whichever reads on a given fill — so a Card tile's user-picked
// background never buries its own label/value/icon. Perceived-luminance (ITU-R
// BT.601) rather than a straight RGB average, since that's what "looks light or
// dark to a person" actually tracks.
function contrastText(hex?: string): string | undefined {
  if (!hex) return undefined;
  const h = hex.replace("#", "");
  if (h.length !== 6) return undefined;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  return luma >= 150 ? "#111827" : "#ffffff";
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
  } else if ((GROUPED_TYPES as readonly string[]).includes(t)) {
    // Each metric is its own independent binding (own asset, own attribute) —
    // same idea as overlay series above, but these are the widget's ONLY
    // content rather than extras layered on a primary series. Shared by Card
    // and every Industrial type (Gauge, Thermometer, …) — one grouping model.
    const metrics: { assetId?: string; tag?: string }[] = Array.isArray(c.metrics) ? c.metrics : [];
    metrics.forEach((m, i) => {
      if (!m.tag) return;
      const key = `m${i}`;
      seriesList.push({ key, assetId: m.assetId, tag: m.tag });
      seriesSrc[key] = { assetId: m.assetId, tag: m.tag, color: (m as any).color, label: (m as any).label, unit: (m as any).unit };
    });
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

  if (t === "card") {
    const metrics: Record<string, any>[] = Array.isArray(c.metrics) ? c.metrics : [];
    const columns = Math.max(1, Number(c.columns) || 1);
    const gap = Number(c.gridGap) || 0;
    const orientation = c.textOrientation === "horizontal" ? "horizontal" : "vertical";
    const unitPlacement = c.unitPlacement === "prefix" ? "prefix" : "suffix";
    const showFullText = !!c.showFullText;
    const radius = Number(c.radius) || 0;
    const titleFs = Number(c.titleFontSize) || 13;
    const valueFs = Number(c.valueFontSize) || 20;
    // Last non-null value for one metric's series key — same "last" semantics as
    // aggVal above, just resolved per-metric instead of for a single primary series.
    const lastOf = (key: string): number | null => {
      for (let i = rows.length - 1; i >= 0; i--) { const v = rows[i]?.[key]; if (v != null) return v as number; }
      return null;
    };

    if (metrics.length === 0) {
      return <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs">Add a metric in the Edit Widget panel to get started.</div>;
    }

    return (
      <div className="h-full w-full overflow-auto p-1.5">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`, gap }}>
          {metrics.map((m, i) => {
            const key = `m${i}`;
            const src = seriesSrc[key];
            const metricBound = !!(m.assetId && m.tag);
            const val = metricBound ? lastOf(key) : null;
            const label = displayName(src) || m.label || `Metric ${i + 1}`;
            const unit = displayUnit(src) ?? m.unit ?? "";
            const Icon: React.ElementType = CARD_ICONS[m.icon as string] ?? Activity;
            const customIcon = String(m.customIcon ?? "").trim();
            const color = m.color || PALETTE.primary;
            const shown = val != null ? fmt(val, m) : (m.defaultValue != null ? fmt(Number(m.defaultValue), m) : (metricBound ? "—" : "0.0"));
            // A filled tile switches everything on it to black-or-white so the
            // user's own accent color (meant to read on the neutral default
            // tile) never fights the fill for contrast — but that's a default,
            // not a lock: an explicit Text Color in the edit panel wins over
            // the auto-computed one.
            const bg: string | undefined = m.bgColor || undefined;
            const onFill = bg ? (m.textColor || contrastText(bg)) : undefined;
            const iconColor = onFill ?? color;
            const unitStyle = { fontSize: titleFs, color: onFill } as const;
            const valueEl = (
              <p className="font-bold tabular-nums" style={{ fontSize: valueFs, color: onFill ?? color }}>
                {unit && unitPlacement === "prefix" && <span className={cn(!onFill && "text-muted-foreground", "mr-1")} style={unitStyle}>{unit}</span>}
                {shown}
                {unit && unitPlacement === "suffix" && <span className={cn(!onFill && "text-muted-foreground", "ml-1")} style={unitStyle}>{unit}</span>}
              </p>
            );
            return (
              <div key={i} className={cn("flex border border-border p-2", !bg && "bg-muted/40", orientation === "horizontal" ? "flex-row items-center gap-2" : "flex-col gap-1")} style={{ borderRadius: radius, background: bg }}>
                {/* A pasted emoji overrides the preset icon — see the Icon field's
                    note in the widget's edit panel. */}
                {customIcon
                  ? <span className="shrink-0 leading-none" style={{ fontSize: 18, color: onFill }}>{customIcon}</span>
                  : <Icon className="w-5 h-5 shrink-0" style={{ color: iconColor }} />}
                <div className={cn("min-w-0 flex-1", orientation === "horizontal" && "text-right")}>
                  <p className={cn(!onFill && "text-muted-foreground", !showFullText && "truncate")} style={{ fontSize: titleFs, color: onFill }}>{label}</p>
                  {valueEl}
                </div>
              </div>
            );
          })}
        </div>
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
            const col = meta?.color ?? (seriesTags.length > 1 ? SERIES_COLORS[i % SERIES_COLORS.length] : baseColor);
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
            const fill = meta?.color ?? (seriesTags.length > 1 ? SERIES_COLORS[i % SERIES_COLORS.length] : baseColor);
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
            <Line key={tg} type="monotone" dataKey={tg} stroke={seriesTags.length > 1 ? SERIES_COLORS[i % SERIES_COLORS.length] : baseColor} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={interpolated} />
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
            {demoPie.map((_, i) => <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />)}
          </Pie><Tooltip {...TOOLTIP_PROPS} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (["gauge", "thermometer", "tank", "progress", "battery", "status", "traffic"].includes(t)) {
    const metrics: Record<string, any>[] = Array.isArray(c.metrics) ? c.metrics : [];
    const columns = Math.max(1, Number(c.columns) || 1);
    const gap = Number(c.gridGap) || 0;
    const unitPlacement = c.unitPlacement === "prefix" ? "prefix" : "suffix";
    const showFullText = !!c.showFullText;
    const radius = Number(c.radius) || 0;
    const titleFs = Number(c.titleFontSize) || 13;
    const valueFs = Number(c.valueFontSize) || 16;
    const isStateType = t === "status" || t === "traffic";
    const lastOf = (key: string): number | null => {
      for (let i = rows.length - 1; i >= 0; i--) { const v = rows[i]?.[key]; if (v != null) return v as number; }
      return null;
    };

    if (metrics.length === 0) {
      return <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs">Add a metric in the Edit Widget panel to get started.</div>;
    }

    return (
      <div className="h-full w-full overflow-auto p-1.5">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`, gap }}>
          {metrics.map((m, i) => {
            const key = `m${i}`;
            const src = seriesSrc[key];
            const metricBound = !!(m.assetId && m.tag);
            const val = metricBound ? lastOf(key) : null;
            const label = displayName(src) || m.label || `Metric ${i + 1}`;
            const unit = displayUnit(src) ?? m.unit ?? "";
            const Icon: React.ElementType = CARD_ICONS[m.icon as string] ?? Activity;
            const customIcon = String(m.customIcon ?? "").trim();
            const bg: string | undefined = m.bgColor || undefined;
            const onFill = bg ? (m.textColor || contrastText(bg)) : undefined;

            // status/traffic have no numeric value at all — just a state,
            // bound or picked manually per tile (same as before grouping).
            const state: string = m.state ?? "ok";
            const stateColor = state === "ok" ? PALETTE.success : state === "warn" ? PALETTE.warning : PALETTE.critical;

            const resolved = val ?? (m.defaultValue != null ? Number(m.defaultValue) : (isStateType ? null : 0));
            const color = onFill ?? statusColor(resolved, m);
            const max = Number(m.max) || 100;
            const pct = resolved != null ? Math.max(0, Math.min(100, (resolved / max) * 100)) : 0;
            const valueText = resolved != null ? fmt(resolved, m) : "—";
            const unitSuffix = t === "progress" || t === "battery" ? "%" : (unit ? (unitPlacement === "prefix" ? "" : ` ${unit}`) : "");
            const unitPrefix = unit && unitPlacement === "prefix" && t !== "progress" && t !== "battery" ? `${unit} ` : "";

            let mark: React.ReactNode;
            if (t === "gauge") {
              mark = (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <ResponsiveContainer width="100%" height="70%">
                    <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ v: pct, fill: color }]} startAngle={210} endAngle={-30}>
                      <RadialBar dataKey="v" cornerRadius={6} background isAnimationActive={false} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <p className="font-bold -mt-3 tabular-nums" style={{ fontSize: valueFs, color }}>{unitPrefix}{valueText}{unitSuffix}</p>
                </div>
              );
            } else if (t === "thermometer" || t === "tank") {
              mark = (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 py-1">
                  <div className="relative w-5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div className="absolute bottom-0 w-full" style={{ height: `${pct}%`, background: color }} />
                  </div>
                  <p className="font-semibold tabular-nums" style={{ fontSize: valueFs, color }}>{unitPrefix}{valueText}{unitSuffix}</p>
                </div>
              );
            } else if (t === "battery" || t === "progress") {
              mark = (
                <div className="w-full flex flex-col items-center justify-center gap-1.5">
                  <div className="relative w-full h-3 rounded-full bg-muted overflow-hidden">
                    <div className="absolute left-0 top-0 h-full" style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <p className="font-semibold tabular-nums" style={{ fontSize: valueFs, color }}>{valueText}{unitSuffix}</p>
                </div>
              );
            } else if (t === "status") {
              mark = (
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ background: stateColor }} />
                  <span className="capitalize" style={{ fontSize: valueFs, color: onFill }}>{state}</span>
                </div>
              );
            } else { // traffic
              mark = (
                <div className="flex flex-col items-center gap-1.5">
                  {["critical", "warn", "ok"].map((s) => (
                    <span key={s} className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{ background: s === state ? stateColor : "hsl(var(--muted))", opacity: s === state ? 1 : 0.35 }} />
                  ))}
                </div>
              );
            }

            // The mark needs real pixel space to draw into — a RadialBarChart's
            // ResponsiveContainer (and the thermometer/tank fill bar) resolve
            // their percentage height against the nearest ANCESTOR with a
            // definite height. A CSS Grid row sized purely by content has no
            // such ancestor, so without this the chart/bar silently collapsed
            // to zero height — leaving only the icon+label+number visible,
            // which is exactly what made a Gauge look like a plain Card.
            const tileMinH = t === "gauge" ? 150 : t === "thermometer" || t === "tank" ? 170 : t === "traffic" ? 120 : 80;

            return (
              <div key={i} className={cn("flex flex-col items-stretch gap-1 border border-border p-2", !bg && "bg-muted/40")} style={{ borderRadius: radius, background: bg, minHeight: tileMinH }}>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* A pasted emoji overrides the preset icon — see the Icon field's
                      note in the widget's edit panel. */}
                  {customIcon
                    ? <span className="shrink-0 leading-none" style={{ fontSize: 13, color: onFill }}>{customIcon}</span>
                    : <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: onFill ?? color }} />}
                  <span className={cn("min-w-0 flex-1", !onFill && "text-muted-foreground", !showFullText && "truncate")} style={{ fontSize: titleFs, color: onFill }}>{label}</span>
                </div>
                {/* A fixed (not min-) height here, not just on the tile above —
                    ResponsiveContainer needs its OWN ancestor's height to be
                    unambiguous, and an auto-height flex item sized only by a
                    minHeight on a grandparent doesn't reliably give it that. */}
                <div className="flex items-center justify-center" style={{ height: tileMinH - 28 }}>{mark}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
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
