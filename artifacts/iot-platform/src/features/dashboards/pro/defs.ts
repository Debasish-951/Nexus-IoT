/**
 * Catalog of the expanded widget set (52 types, previewed in the widget gallery
 * before they were built).
 *
 * Every type here is NEW: the original widgets (Line, Bar, Gauge, Tank, …) are
 * left exactly as they were, and the improved versions sit beside them as "Pro"
 * types. Saved dashboards therefore render unchanged, and the whole set can be
 * hidden again with one switch (FEATURES.proWidgets in lib/features.ts).
 *
 * Kept free of React and of registry.tsx so the registry and the config panel
 * can both import it without a cycle.
 *
 * Binding kinds, reusing the editors the config panel already has:
 *   single  one Data Source + Attribute (c.assetId + c.tag)
 *   multi   primary metric + overlay series, each with its own asset
 *   scope   an optional asset; the widget covers that asset and everything below it
 *   none    nothing to bind
 *
 * `fields` are widget-specific settings rendered by ProFields in the config panel.
 * `need` says, in plain words, what data the widget depends on that a plant may not
 * have yet. It is shown in the config panel, and on the widget while it is unbound,
 * so a widget is never silently showing numbers it cannot back up.
 */
import {
  Gauge, TrendingUp, Activity, Fan, Waves, Droplet, LayoutGrid, AudioWaveform, ScrollText,
  Target, Binary, PieChart, LineChart, BarChart3, AreaChart, CalendarRange, CalendarDays, Table2,
  GanttChart, Thermometer, ListOrdered, BarChartHorizontal, Flame, Hash, Wind, CircleSlash2,
  MoveVertical, Clock, CircleDot, Factory, Radar, HeartPulse, Hourglass, ShieldAlert, Timer,
  Vibrate, Grid3x3, IndianRupee, Leaf, Scale, Zap, Cable, FlaskConical, Medal, Map, Globe2,
  Wifi, BellRing, StickyNote, Sparkles,
} from "lucide-react";
import { EQUIP_CATEGORIES } from "./equip/defs";

export type ProBind = "single" | "multi" | "scope" | "none";

export interface ProField {
  key: string;
  label: string;
  kind: "number" | "text" | "textarea" | "select" | "datetime";
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
}

export interface ProDef {
  type: string;
  label: string;
  icon: React.ElementType;
  category: string;
  w: number;
  h: number;
  bind: ProBind;
  /** What the primary metric and overlays mean, for multi widgets where order matters. */
  bindHelp?: string;
  /**
   * Named inputs, in order: roles[0] is the primary metric (series s0), roles[i] is
   * overlay i (series s{i}). The config panel labels each input with its role.
   */
  roles?: string[];
  fields?: ProField[];
  need?: string;
  defaults?: Record<string, any>;
}

const num = (key: string, label: string, help?: string, placeholder?: string): ProField => ({ key, label, kind: "number", help, placeholder });
const MODE: ProField = {
  key: "energyMode", label: "Energy attribute is", kind: "select",
  options: [
    { value: "counter", label: "A running meter total (kWh counter)" },
    { value: "interval", label: "Energy per reading (kWh each interval)" },
  ],
  help: "A meter total keeps rising; energy used is the rise over the range. Per-reading values are added up.",
};

export const PRO_CATEGORIES: { name: string; items: ProDef[] }[] = [
  { name: "Charts Pro", items: [
    { type: "linepro", label: "Line Chart Pro", icon: LineChart, category: "Charts Pro", w: 6, h: 5, bind: "multi",
      fields: [num("lo", "Normal band: low"), num("hi", "Normal band: high")] },
    { type: "barpro", label: "Bar Chart Pro", icon: BarChart3, category: "Charts Pro", w: 6, h: 5, bind: "multi",
      fields: [num("target", "Target", "Bars above the target turn amber, and the target is drawn as a line.")] },
    { type: "stackareapro", label: "Stacked Area Pro", icon: AreaChart, category: "Charts Pro", w: 6, h: 5, bind: "multi" },
    { type: "donutpro", label: "Donut Pro", icon: PieChart, category: "Charts Pro", w: 4, h: 5, bind: "multi",
      bindHelp: "One series per slice; each slice is that series' latest value." },
    { type: "stream", label: "Live Trend Stream", icon: Activity, category: "Charts Pro", w: 6, h: 4, bind: "multi",
      fields: [num("lo", "Limit band: low"), num("hi", "Limit band: high")] },
    { type: "todayvs", label: "Today vs Yesterday", icon: CalendarRange, category: "Charts Pro", w: 6, h: 5, bind: "single" },
    { type: "calheat", label: "Calendar Heatmap", icon: CalendarDays, category: "Charts Pro", w: 6, h: 5, bind: "single",
      bindHelp: "Always shows the last 7 days by hour, whatever the widget's time range." },
    { type: "rangeband", label: "Range Band", icon: MoveVertical, category: "Charts Pro", w: 6, h: 5, bind: "single",
      fields: [num("bucketMinutes", "Bucket size (minutes)", undefined, "60")] },
    { type: "waterfall", label: "Waterfall", icon: BarChartHorizontal, category: "Charts Pro", w: 6, h: 5, bind: "multi",
      bindHelp: "Each series is one step; its latest value is added (or, if negative, taken away)." },
    { type: "forecast", label: "Forecast Chart", icon: Sparkles, category: "Charts Pro", w: 6, h: 5, bind: "single",
      fields: [num("horizon", "Forecast length (points)", "How far ahead to project, in data points of the chosen granularity.", "24")],
      need: "Forecast is a statistical projection worked out in the browser from the loaded history (trend plus daily pattern). A server-side forecast job would be more accurate." },
    { type: "shiftnotes", label: "Shift Notes", icon: StickyNote, category: "Charts Pro", w: 6, h: 5, bind: "single",
      fields: [{ key: "notes", label: "Notes (one per line: YYYY-MM-DD HH:mm | text)", kind: "textarea", placeholder: "2026-11-12 07:40 | Filter changed" }],
      need: "Notes are saved with the dashboard and added here in Edit Widget. Adding a note by clicking the chart needs a notes table on the server, which is not built yet." },
  ]},
  { name: "Instruments", items: [
    { type: "gaugepro", label: "Radial Gauge Pro", icon: Gauge, category: "Instruments", w: 4, h: 5, bind: "single",
      fields: [num("min", "Min", undefined, "0"), num("max", "Max", undefined, "100"), num("warn", "Warn ≥"), num("critical", "Critical ≥")] },
    { type: "kpitrend", label: "KPI Tile with Trend", icon: TrendingUp, category: "Instruments", w: 4, h: 3, bind: "single",
      fields: [{ key: "goodDirection", label: "A rise is", kind: "select", options: [{ value: "up", label: "Good (green)" }, { value: "down", label: "Bad (red)" }] }] },
    { type: "readout", label: "Digital Readout", icon: Binary, category: "Instruments", w: 4, h: 3, bind: "single",
      fields: [num("decimals", "Decimals", undefined, "1")] },
    { type: "thermopro", label: "Thermometer Pro", icon: Thermometer, category: "Instruments", w: 3, h: 6, bind: "single",
      fields: [num("min", "Min", undefined, "0"), num("max", "Max", undefined, "120"), num("limit", "High limit")] },
    { type: "liquidtank", label: "Liquid Tank", icon: Droplet, category: "Instruments", w: 3, h: 6, bind: "single",
      fields: [num("capacity", "Capacity", "The reading that means full.", "100"), num("lowLimit", "Low limit"), num("highLimit", "High limit")] },
    { type: "bullet", label: "Target Bullet", icon: Target, category: "Instruments", w: 6, h: 4, bind: "multi",
      bindHelp: "One row per series.", fields: [num("target", "Target"), num("max", "Scale max", undefined, "auto")] },
    { type: "counter", label: "Production Counter", icon: Hash, category: "Instruments", w: 4, h: 3, bind: "single" },
    { type: "shiftprogress", label: "Shift Progress", icon: Clock, category: "Instruments", w: 4, h: 4, bind: "single",
      fields: [
        { key: "shiftStart", label: "Shift start (HH:mm)", kind: "text", placeholder: "06:00" },
        { key: "shiftEnd", label: "Shift end (HH:mm)", kind: "text", placeholder: "14:00" },
        num("target", "Shift target"),
        { key: "countMode", label: "Count attribute is", kind: "select", options: [{ value: "counter", label: "A running total" }, { value: "interval", label: "Count per reading" }] },
      ] },
    { type: "energyring", label: "Energy Split Ring", icon: CircleDot, category: "Instruments", w: 4, h: 5, bind: "multi",
      bindHelp: "One series per section; the centre shows the total." },
  ]},
  { name: "Equipment", items: [
    { type: "pump", label: "Pump / Motor", icon: Fan, category: "Equipment", w: 3, h: 5, bind: "single",
      fields: [num("runAbove", "Running above", "Speed above this counts as running.", "0"), num("maxSpeed", "Max speed", undefined, "1500"), num("critical", "Fault at ≥")] },
    { type: "fan", label: "Fan / Blower", icon: Wind, category: "Equipment", w: 3, h: 5, bind: "single",
      fields: [num("runAbove", "Running above", undefined, "0"), num("maxSpeed", "Max speed", undefined, "1500")] },
    { type: "pipe", label: "Pipe Flow", icon: Waves, category: "Equipment", w: 6, h: 3, bind: "single",
      fields: [num("maxFlow", "Max flow", "Flow at which the animation runs fastest.", "100")] },
    { type: "valve", label: "Valve Position", icon: CircleSlash2, category: "Equipment", w: 3, h: 4, bind: "single",
      bindHelp: "Position in percent open (0 to 100)." },
    { type: "thermalprofile", label: "Thermal Profile", icon: Flame, category: "Equipment", w: 6, h: 4, bind: "multi",
      bindHelp: "One series per zone, in machine order.", fields: [num("min", "Colour scale min", undefined, "20"), num("max", "Colour scale max", undefined, "200")] },
    { type: "spectrum", label: "Vibration Spectrum", icon: AudioWaveform, category: "Equipment", w: 6, h: 4, bind: "multi",
      bindHelp: "One series per frequency band. With a single series, its recent history is shown as bars." },
    { type: "iso10816", label: "Vibration Severity (ISO 10816)", icon: Vibrate, category: "Equipment", w: 4, h: 5, bind: "single",
      bindHelp: "Vibration velocity in mm/s (RMS).",
      fields: [{ key: "machineClass", label: "Machine class", kind: "select", options: [
        { value: "I", label: "Class I: small machines (< 15 kW)" },
        { value: "II", label: "Class II: medium (15 to 75 kW)" },
        { value: "III", label: "Class III: large, rigid foundation" },
        { value: "IV", label: "Class IV: large, soft foundation" },
      ] }],
      need: "Needs vibration velocity in mm/s RMS. Acceleration (g) readings are not comparable to the ISO zones." },
  ]},
  { name: "Plant Status", items: [
    { type: "machinegrid", label: "Machine Status Grid", icon: LayoutGrid, category: "Plant Status", w: 6, h: 4, bind: "multi",
      bindHelp: "One series per machine (for example its speed or status). Tiles are named after each series' asset.",
      fields: [num("runAbove", "Running above", "At or below this a machine shows as stopped.", "0"), num("warn", "Warn ≥"), num("critical", "Critical ≥")] },
    { type: "gridpro", label: "Data Grid Pro", icon: Table2, category: "Plant Status", w: 6, h: 5, bind: "multi",
      bindHelp: "One row per series, with its latest value, range and trend.", fields: [num("decimals", "Decimals", undefined, "auto")] },
    { type: "statetimeline", label: "State Timeline", icon: GanttChart, category: "Plant Status", w: 6, h: 4, bind: "multi",
      bindHelp: "One lane per series, coloured by state over time.",
      fields: [num("runAbove", "Running above", undefined, "0"), num("warn", "Warn ≥"), num("critical", "Fault ≥")] },
    { type: "connectivity", label: "Device Connectivity", icon: Wifi, category: "Plant Status", w: 4, h: 5, bind: "scope",
      bindHelp: "Lists the chosen asset and the assets below it (up to 12).",
      fields: [num("staleSec", "Stale after (seconds)", undefined, "60"), num("offlineSec", "Offline after (seconds)", undefined, "300")] },
    { type: "floorplan", label: "Floor Plan Map", icon: Map, category: "Plant Status", w: 6, h: 6, bind: "multi",
      bindHelp: "One series per machine pin.",
      fields: [
        { key: "layoutUrl", label: "Layout image URL", kind: "text", placeholder: "/api/uploads/…", help: "Upload the plant layout in Asset Hub → Media Library and paste its URL here." },
        { key: "pins", label: "Pin positions (one per line: x%, y%)", kind: "textarea", placeholder: "20, 35\n45, 35\n70, 60", help: "In the same order as the series. Missing lines are placed automatically." },
        num("warn", "Warn ≥"), num("critical", "Critical ≥"),
      ],
      need: "Needs a layout image and a pin position per machine, entered above." },
    { type: "sitemap", label: "Multi-site Map", icon: Globe2, category: "Plant Status", w: 6, h: 5, bind: "none",
      need: "Shows each project (root asset) as a site, coloured by its open alarms, on a schematic layout. A real geographic map needs a location per site and internet map tiles, which are not built." },
  ]},
  { name: "Alarms & Operations", items: [
    { type: "ticker", label: "Event Ticker", icon: ScrollText, category: "Alarms & Operations", w: 12, h: 2, bind: "scope" },
    { type: "alarmpanel", label: "Alarm Action Panel", icon: BellRing, category: "Alarms & Operations", w: 5, h: 5, bind: "scope" },
    { type: "pareto", label: "Alarm Pareto", icon: ListOrdered, category: "Alarms & Operations", w: 6, h: 5, bind: "scope",
      bindHelp: "Counts alarms raised in the widget's time range." },
    { type: "mtbf", label: "MTBF / MTTR", icon: Timer, category: "Alarms & Operations", w: 4, h: 4, bind: "scope",
      bindHelp: "Worked out from alarm history in the widget's time range: each alarm counts as a failure, from raised to cleared.",
      need: "Uses alarms as failures. If alarms do not match real breakdowns, these numbers will not either." },
  ]},
  { name: "Analytics", items: [
    { type: "oeerings", label: "OEE Rings", icon: Medal, category: "Analytics", w: 4, h: 5, bind: "multi",
      bindHelp: "Primary metric = Availability %, overlay 1 = Performance %, overlay 2 = Quality %.",
      fields: [num("target", "OEE target %", undefined, "85")],
      need: "Needs Availability, Performance and Quality in percent. Performance and Quality need production and good counts from the machine, which devices do not send yet." },
    { type: "oeemachine", label: "OEE by Machine", icon: Factory, category: "Analytics", w: 6, h: 5, bind: "multi",
      bindHelp: "One OEE % series per machine.", fields: [num("target", "OEE target %", undefined, "85")],
      need: "Needs an OEE % attribute per machine, which in turn needs production and good counts." },
    { type: "anomaly", label: "Anomaly Detection Chart", icon: Radar, category: "Analytics", w: 6, h: 5, bind: "single",
      fields: [num("window", "Rolling window (points)", undefined, "20"), num("sigma", "Band width (standard deviations)", undefined, "3")],
      need: "The normal band is a rolling average ± standard deviation worked out in the browser from the loaded range. A server job that learns each metric's normal band would catch more." },
    { type: "anomalyboard", label: "Anomaly Scoreboard", icon: ShieldAlert, category: "Analytics", w: 5, h: 5, bind: "multi",
      bindHelp: "One series per machine. Score = how many standard deviations the latest value is from the range average.",
      fields: [num("sigma", "Flag at (standard deviations)", undefined, "3")] },
    { type: "healthscore", label: "Machine Health Score", icon: HeartPulse, category: "Analytics", w: 4, h: 5, bind: "scope",
      bindHelp: "Pick one asset. The score comes from its open alarms and how fresh its data is." },
    { type: "rul", label: "Remaining Useful Life", icon: Hourglass, category: "Analytics", w: 6, h: 5, bind: "single",
      bindHelp: "A metric that drifts as the machine wears (vibration, temperature, pressure drop).",
      fields: [num("failureLimit", "Failure limit"), { key: "direction", label: "Wear makes the value", kind: "select", options: [{ value: "rising", label: "Rise" }, { value: "falling", label: "Fall" }] }],
      need: "Projects a straight-line trend from the loaded range to the failure limit. Needs a sensible failure limit per machine; a longer range gives a steadier estimate." },
    { type: "failrisk", label: "Failure Risk", icon: ShieldAlert, category: "Analytics", w: 5, h: 5, bind: "multi",
      bindHelp: "One series per machine. Risk combines closeness to the limits with how unusual the latest value is.",
      fields: [num("warn", "Warn ≥"), num("critical", "Critical ≥")],
      need: "Risk is a simple score from limits and recent behaviour, not a trained failure model." },
    { type: "riskmatrix", label: "Risk Matrix", icon: Grid3x3, category: "Analytics", w: 5, h: 5, bind: "multi",
      bindHelp: "One series per machine. Likelihood comes from the same score as Failure Risk.",
      fields: [num("warn", "Warn ≥"), num("critical", "Critical ≥"),
        { key: "impacts", label: "Impact per machine (1 to 5, comma separated)", kind: "text", placeholder: "5, 3, 2", help: "In series order. Missing values count as 3." }],
      need: "Needs an impact rating that you set per machine." },
  ]},
  { name: "Energy", items: [
    { type: "energycost", label: "Energy Cost", icon: IndianRupee, category: "Energy", w: 4, h: 4, bind: "single",
      fields: [
        MODE,
        { key: "currency", label: "Currency symbol", kind: "text", placeholder: "₹" },
        num("rate", "Off-peak rate per kWh"), num("peakRate", "Peak rate per kWh"),
        { key: "peakHours", label: "Peak hours (HH-HH)", kind: "text", placeholder: "18-22" },
      ],
      need: "Needs your electricity tariff (rates and peak hours), entered above." },
    { type: "co2", label: "CO₂ Emissions", icon: Leaf, category: "Energy", w: 4, h: 4, bind: "single",
      fields: [MODE, num("factor", "Grid factor (kg CO₂ per kWh)", undefined, "0.71"), num("target", "Target for the range (t CO₂)")],
      need: "Needs your grid emission factor and a target, entered above." },
    { type: "sec", label: "Specific Energy Consumption", icon: Scale, category: "Energy", w: 6, h: 4, bind: "multi",
      bindHelp: "Primary metric = energy (kWh), overlay 1 = production count (kg, metres, pieces).",
      fields: [MODE, { key: "perUnit", label: "Production unit", kind: "text", placeholder: "kg" }, num("target", "Target (kWh per unit)")],
      need: "Needs a production count from the machine, which devices do not send yet." },
    { type: "peakdemand", label: "Peak Demand Meter", icon: Zap, category: "Energy", w: 4, h: 5, bind: "single",
      bindHelp: "Real power in kW.", fields: [num("contractMax", "Contracted maximum (kW)")],
      need: "Needs real power in kW and your contracted maximum demand." },
    { type: "powerquality", label: "Power Quality", icon: Cable, category: "Energy", w: 5, h: 4, bind: "multi",
      bindHelp: "Primary metric = power factor. Overlays 1 to 3 = phase voltages (optional, for imbalance).",
      fields: [num("pfTarget", "Power factor target", undefined, "0.95"), num("imbalanceLimit", "Voltage imbalance limit %", undefined, "2")],
      need: "Needs power factor and three phase voltages from the energy meter." },
  ]},
  { name: "Process", items: [
    { type: "recipe", label: "Recipe Profile Tracker", icon: FlaskConical, category: "Process", w: 6, h: 5, bind: "single",
      fields: [
        { key: "plan", label: "Planned curve (minute:value, comma separated)", kind: "textarea", placeholder: "0:30, 15:30, 45:80, 75:80, 95:130, 155:130, 180:70" },
        { key: "steps", label: "Step names (comma separated, one per segment)", kind: "text", placeholder: "Fill, Heat, Dye, Heat, Hold, Cool" },
        { key: "batchStart", label: "Batch start", kind: "datetime", help: "Blank = start of the widget's time range." },
      ],
      need: "Needs the planned curve for the recipe and the batch start time, entered above." },
    { type: "goldenbatch", label: "Golden Batch Comparison", icon: Medal, category: "Process", w: 6, h: 5, bind: "single",
      fields: [
        { key: "refFrom", label: "Golden batch start", kind: "datetime" },
        { key: "refTo", label: "Golden batch end", kind: "datetime" },
        num("tolerance", "Tolerance (±)", undefined, "5"),
      ],
      need: "Needs the start and end time of the reference (golden) batch, entered above. The current batch is the widget's time range." },
  ]},
];

// Equipment and industry widgets (Sets 6–12 of the gallery) live in equip/defs.ts.
PRO_CATEGORIES.push(...EQUIP_CATEGORIES);

const BY_TYPE: Record<string, ProDef> = {};
for (const c of PRO_CATEGORIES) for (const it of c.items) BY_TYPE[it.type] = it;

export function proDef(type: string): ProDef | undefined { return BY_TYPE[type]; }
export const PRO_TYPES = Object.keys(BY_TYPE);
export const PRO_MULTI_TYPES = PRO_TYPES.filter((t) => BY_TYPE[t].bind === "multi");
export const PRO_SINGLE_TYPES = PRO_TYPES.filter((t) => BY_TYPE[t].bind === "single");
export const PRO_SCOPE_TYPES = PRO_TYPES.filter((t) => BY_TYPE[t].bind === "scope");
