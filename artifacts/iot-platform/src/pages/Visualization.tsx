import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as echarts from "echarts";
import { useListAssets } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, subHours, subDays } from "date-fns";
import {
  Plus, Download, X, Search, Maximize2, Minimize2, Copy, Trash2, RefreshCw,
  LineChart as LineIcon, AreaChart as AreaIcon, BarChart3, ScatterChart as ScatterIcon,
  PieChart as PieIcon, Radar as RadarIcon, Gauge as GaugeIcon, Activity, Sparkles, BarChart2, Grid3x3, Share2,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  ScatterChart, Scatter, ZAxis, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, RadialBarChart, RadialBar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Brush, ReferenceLine,
} from "recharts";

const PARAM_COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#6366f1", "#14b8a6"];

type ChartType = string;

const CHART_TYPES: { type: ChartType; label: string; icon: React.ElementType }[] = [
  { type: "line", label: "Line Chart", icon: LineIcon },
  { type: "multiaxis", label: "Multi-Axis Trend", icon: LineIcon },
  { type: "area", label: "Area Chart", icon: AreaIcon },
  { type: "bar", label: "Bar Chart", icon: BarChart3 },
  { type: "scatter", label: "Scatter Plot", icon: ScatterIcon },
  { type: "bubble", label: "Bubble Chart", icon: ScatterIcon },
  { type: "pie", label: "Pie Chart", icon: PieIcon },
  { type: "donut", label: "Donut Chart", icon: PieIcon },
  { type: "radar", label: "Radar Chart", icon: RadarIcon },
  { type: "histogram", label: "Histogram", icon: BarChart3 },
  { type: "gauge", label: "Gauge", icon: GaugeIcon },
];
// ECharts-backed types (advanced analytics).
const ECHART_TYPES: { type: ChartType; label: string; icon: React.ElementType }[] = [
  { type: "heatmap", label: "Heatmap", icon: Grid3x3 },
  { type: "boxplot", label: "Box Plot", icon: BarChart3 },
  { type: "correlation", label: "Correlation Matrix", icon: Grid3x3 },
  { type: "treemap", label: "Treemap", icon: Grid3x3 },
  { type: "sankey", label: "Sankey Diagram", icon: Share2 },
  { type: "pareto", label: "Pareto Chart", icon: BarChart3 },
  { type: "control", label: "Control Chart (SPC)", icon: LineIcon },
  { type: "calendar", label: "Calendar Heatmap", icon: Grid3x3 },
  { type: "fft", label: "FFT Spectrum", icon: Activity },
];
const ECHART_SET = new Set(ECHART_TYPES.map((t) => t.type));
const ALL_TYPES = [...CHART_TYPES, ...ECHART_TYPES];
const COMING_SOON = ["Gantt Chart", "Timeline", "AI Prediction Chart"];

// ── ECharts wrapper (no external React binding — avoids peer issues) ──
function EChart({ option }: { option: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current);
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);
  useEffect(() => { chart.current?.setOption(option, true); }, [option]);
  return <div ref={ref} className="w-full h-full" />;
}

interface Graph {
  id: string; name: string; color: string;
  type: ChartType; assetId: string; params: string[];
  yMode: "multi" | "single" | "normalized";
  agg: "avg" | "max" | "min" | "last";
  threshold: string;
  overlays: { thresholds: boolean; alarms: boolean; ai: boolean; health: boolean; rul: boolean; maintenance: boolean };
}

const TIME_RANGES = [
  { label: "1 hour", hours: 1 }, { label: "6 hours", hours: 6 }, { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 }, { label: "30 days", hours: 24 * 30 },
];

let gid = 1;
function newGraph(type: ChartType, assetId: string, color: string): Graph {
  return {
    id: `g${gid++}`, name: ALL_TYPES.find((c) => c.type === type)?.label ?? "Graph", color,
    type, assetId, params: [], yMode: "multi", agg: "avg", threshold: "",
    overlays: { thresholds: false, alarms: true, ai: false, health: false, rul: false, maintenance: false },
  };
}

export default function Visualization() {
  const { data: assetsData } = useListAssets();
  const allAssets = (assetsData as any[] | undefined) ?? [];

  const [graphs, setGraphs] = useState<Graph[]>([]);
  const [activeId, setActiveId] = useState("");
  const [rangeHours, setRangeHours] = useState(24);
  const [addOpen, setAddOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [metricsByAsset, setMetricsByAsset] = useState<Record<string, string[]>>({});
  const [series, setSeries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const active = graphs.find((g) => g.id === activeId) ?? null;

  useEffect(() => {
    if (graphs.length === 0 && allAssets.length > 0) {
      const g = newGraph("multiaxis", allAssets[0].id, PARAM_COLORS[0]);
      g.name = "Trend 1";
      setGraphs([g]); setActiveId(g.id);
    }
  }, [assetsData]); // eslint-disable-line

  useEffect(() => {
    const aid = active?.assetId;
    if (!aid || metricsByAsset[aid]) return;
    fetch(`/api/telemetry/${aid}/metrics`).then((r) => (r.ok ? r.json() : [])).then((m) => {
      setMetricsByAsset((prev) => ({ ...prev, [aid]: Array.isArray(m) ? m : [] }));
    }).catch(() => {});
  }, [active?.assetId]); // eslint-disable-line

  const availableParams = active ? (metricsByAsset[active.assetId] ?? []) : [];

  useEffect(() => {
    if (active && active.params.length === 0 && availableParams.length > 0) {
      patch(active.id, { params: availableParams.slice(0, Math.min(4, availableParams.length)) });
    }
  }, [availableParams, active?.id]); // eslint-disable-line

  const fetchData = useCallback(async () => {
    if (!active || active.params.length === 0) { setSeries([]); return; }
    setLoading(true);
    try {
      const from = (rangeHours <= 24 ? subHours(new Date(), rangeHours) : subDays(new Date(), rangeHours / 24)).toISOString();
      const byTs: Record<string, any> = {};
      for (const metric of active.params) {
        const params = new URLSearchParams({ metric, from, limit: "2000" });
        const res = await fetch(`/api/telemetry/${active.assetId}?${params}`);
        const rows: any[] = res.ok ? await res.json() : [];
        for (const r of rows) {
          const ts = new Date(r.timestamp).getTime();
          if (!byTs[ts]) byTs[ts] = { ts, time: format(new Date(r.timestamp), rangeHours <= 24 ? "HH:mm" : "MM/dd HH:mm") };
          const v = Number(r.value);
          if (!isNaN(v)) byTs[ts][metric] = v;
        }
      }
      setSeries(Object.values(byTs).sort((a, b) => a.ts - b.ts));
    } finally { setLoading(false); }
  }, [active?.assetId, active?.params, rangeHours]); // eslint-disable-line

  useEffect(() => { fetchData(); }, [fetchData]);

  function patch(id: string, p: Partial<Graph>) {
    setGraphs((prev) => prev.map((g) => (g.id === id ? { ...g, ...p } : g)));
  }
  function addGraph(type: ChartType) {
    const g = newGraph(type, active?.assetId ?? allAssets[0]?.id ?? "", PARAM_COLORS[graphs.length % PARAM_COLORS.length]);
    g.name = `${ALL_TYPES.find((c) => c.type === type)?.label} ${graphs.length + 1}`;
    setGraphs((prev) => [...prev, g]); setActiveId(g.id); setAddOpen(false);
  }
  function duplicate(id: string) {
    const src = graphs.find((g) => g.id === id); if (!src) return;
    const g = { ...src, id: `g${gid++}`, name: `${src.name} (copy)` };
    setGraphs((prev) => [...prev, g]); setActiveId(g.id);
  }
  function closeGraph(id: string) {
    setGraphs((prev) => {
      const next = prev.filter((g) => g.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? "");
      return next;
    });
  }
  function exportCsv() {
    if (!active || series.length === 0) return;
    const header = ["time", ...active.params].join(",");
    const rows = series.map((r) => [r.time, ...active.params.map((p) => r[p] ?? "")].join(","));
    const url = URL.createObjectURL(new Blob([[header, ...rows].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `${active.name}_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  function toggleParam(p: string) {
    if (!active) return;
    const has = active.params.includes(p);
    patch(active.id, { params: has ? active.params.filter((x) => x !== p) : [...active.params, p] });
  }

  const stats = useMemo(() => {
    const s: Record<string, { avg: number; max: number; min: number; last: number; n: number }> = {};
    if (!active) return s;
    for (const p of active.params) {
      const vals = series.map((r) => r[p]).filter((v) => v != null) as number[];
      if (vals.length) s[p] = { avg: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals), min: Math.min(...vals), last: vals[vals.length - 1], n: vals.length };
    }
    return s;
  }, [series, active?.params]);

  const plotData = useMemo(() => {
    if (!active || active.yMode !== "normalized") return series;
    const ranges: Record<string, { min: number; max: number }> = {};
    for (const p of active.params) { const st = stats[p]; if (st) ranges[p] = { min: st.min, max: st.max }; }
    return series.map((row) => {
      const o: any = { ts: row.ts, time: row.time };
      for (const p of active.params) {
        const v = row[p]; const r = ranges[p];
        o[p] = v != null && r && r.max > r.min ? ((v - r.min) / (r.max - r.min)) * 100 : v;
      }
      return o;
    });
  }, [series, active?.yMode, active?.params, stats]);

  const paramColor = (p: string) => PARAM_COLORS[(active?.params.indexOf(p) ?? 0) % PARAM_COLORS.length];
  const thresholdNum = active && active.overlays.thresholds && active.threshold ? Number(active.threshold) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="px-6 py-3 border-b border-border flex items-center gap-2">
        <BarChart2 className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold leading-tight">Visualization</h1>
          <p className="text-xs text-muted-foreground">Analyze and visualize your industrial data</p>
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!active || series.length === 0}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> Add Graph</Button>
      </div>

      <div className="px-6 py-2.5 border-b border-border flex items-end gap-4 flex-wrap bg-muted/20">
        <Field label="Asset">
          <Select value={active?.assetId ?? ""} onValueChange={(v) => active && patch(active.id, { assetId: v, params: [] })}>
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="Select asset" /></SelectTrigger>
            <SelectContent>{allAssets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Time Range">
          <Select value={String(rangeHours)} onValueChange={(v) => setRangeHours(Number(v))}>
            <SelectTrigger className="h-9 w-36 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{TIME_RANGES.map((t) => <SelectItem key={t.label} value={String(t.hours)}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Parameters"><span className="h-9 inline-flex items-center text-sm text-muted-foreground">{active?.params.length ?? 0} selected</span></Field>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-9" onClick={fetchData}><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></Button>
      </div>

      <div className="px-4 pt-2 border-b border-border flex items-center gap-1 overflow-x-auto">
        {graphs.map((g) => (
          <div key={g.id} onClick={() => setActiveId(g.id)}
            className={cn("flex items-center gap-2 px-3 py-2 rounded-t-md cursor-pointer text-sm border-b-2 -mb-px shrink-0",
              activeId === g.id ? "border-primary text-foreground font-medium bg-card" : "border-transparent text-muted-foreground hover:bg-muted/40")}>
            <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />
            {g.name}
            <button onClick={(e) => { e.stopPropagation(); closeGraph(g.id); }} className="hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button onClick={() => setAddOpen(true)} className="px-2.5 py-2 text-muted-foreground hover:text-primary shrink-0"><Plus className="w-4 h-4" /></button>
      </div>

      {!active ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center"><BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" /><p className="text-sm">Add a graph to start analyzing.</p>
            <Button size="sm" className="mt-3" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4 mr-1" /> Add Graph</Button></div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-60 border-r border-border overflow-y-auto p-4 space-y-4 shrink-0 bg-card">
            <p className="text-sm font-semibold">Graph Settings</p>
            <Setting label="Graph Type">
              <Select value={active.type} onValueChange={(v) => patch(active.id, { type: v as ChartType })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ALL_TYPES.map((c) => <SelectItem key={c.type} value={c.type} className="text-xs">{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </Setting>
            <Setting label="Y Axis">
              <Select value={active.yMode} onValueChange={(v) => patch(active.id, { yMode: v as any })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="multi" className="text-xs">Multiple Y Axis</SelectItem>
                  <SelectItem value="single" className="text-xs">Single Y Axis</SelectItem>
                  <SelectItem value="normalized" className="text-xs">Normalized (0–100%)</SelectItem>
                </SelectContent>
              </Select>
            </Setting>
            <Setting label="Aggregation">
              <Select value={active.agg} onValueChange={(v) => patch(active.id, { agg: v as any })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="avg" className="text-xs">Average</SelectItem>
                  <SelectItem value="max" className="text-xs">Max</SelectItem>
                  <SelectItem value="min" className="text-xs">Min</SelectItem>
                  <SelectItem value="last" className="text-xs">Last</SelectItem>
                </SelectContent>
              </Select>
            </Setting>

            <div>
              <p className="text-xs font-medium mb-1.5">Parameters ({active.params.length}/{availableParams.length})</p>
              <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                {availableParams.length === 0 ? <p className="text-xs text-muted-foreground">No telemetry for this asset.</p> :
                  availableParams.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={active.params.includes(p)} onChange={() => toggleParam(p)} />
                      <span className="w-2 h-2 rounded-full" style={{ background: active.params.includes(p) ? paramColor(p) : "#cbd5e1" }} />
                      <span className="truncate">{p}</span>
                    </label>
                  ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium mb-1.5">Overlays</p>
              <div className="space-y-1.5">
                <OverlayToggle label="Threshold line" on={active.overlays.thresholds} set={(v) => patch(active.id, { overlays: { ...active.overlays, thresholds: v } })} />
                {active.overlays.thresholds && (
                  <Input value={active.threshold} onChange={(e) => patch(active.id, { threshold: e.target.value })} placeholder="value" className="h-7 text-xs" />
                )}
                <OverlayToggle label="Alarm overlay" on={active.overlays.alarms} set={(v) => patch(active.id, { overlays: { ...active.overlays, alarms: v } })} />
                <OverlayToggle label="AI anomaly" demo on={active.overlays.ai} set={(v) => patch(active.id, { overlays: { ...active.overlays, ai: v } })} />
                <OverlayToggle label="Health Index" demo on={active.overlays.health} set={(v) => patch(active.id, { overlays: { ...active.overlays, health: v } })} />
                <OverlayToggle label="RUL" demo on={active.overlays.rul} set={(v) => patch(active.id, { overlays: { ...active.overlays, rul: v } })} />
                <OverlayToggle label="Maintenance" demo on={active.overlays.maintenance} set={(v) => patch(active.id, { overlays: { ...active.overlays, maintenance: v } })} />
              </div>
            </div>
          </div>

          <div className={cn("flex-1 flex flex-col overflow-hidden", fullscreen && "fixed inset-0 z-50 bg-background")}>
            <div className="px-4 py-2 border-b border-border flex items-center gap-2">
              <span className="text-sm font-semibold flex-1 truncate">{active.name}</span>
              <Select value={active.type} onValueChange={(v) => patch(active.id, { type: v as ChartType })}>
                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ALL_TYPES.map((c) => <SelectItem key={c.type} value={c.type} className="text-xs">{c.label}</SelectItem>)}</SelectContent>
              </Select>
              <button title="Duplicate" onClick={() => duplicate(active.id)} className="p-1.5 rounded hover:bg-muted text-muted-foreground"><Copy className="w-4 h-4" /></button>
              <button title="Export" onClick={exportCsv} className="p-1.5 rounded hover:bg-muted text-muted-foreground"><Download className="w-4 h-4" /></button>
              <button title="Fullscreen" onClick={() => setFullscreen((f) => !f)} className="p-1.5 rounded hover:bg-muted text-muted-foreground">{fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</button>
              <button title="Delete" onClick={() => closeGraph(active.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {active.params.length === 0 ? (
                <Placeholder text="Select parameters on the left to plot." />
              ) : series.length === 0 ? (
                <Placeholder text={loading ? "Loading telemetry…" : "No data in this time range."} />
              ) : (
                <div className="h-[420px]">
                  {ECHART_SET.has(active.type)
                    ? <EChartView graph={active} data={series} stats={stats} paramColor={paramColor} assetName={allAssets.find((a) => a.id === active.assetId)?.name ?? active.assetId} />
                    : <ChartView graph={active} data={plotData} stats={stats} paramColor={paramColor} thresholdNum={thresholdNum} />}
                </div>
              )}

              {active.params.length > 0 && Object.keys(stats).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
                  {active.params.filter((p) => stats[p]).map((p) => (
                    <div key={p} className="rounded-lg border border-border p-3" style={{ borderLeftColor: paramColor(p), borderLeftWidth: 3 }}>
                      <p className="text-xs font-medium truncate" style={{ color: paramColor(p) }}>{p}</p>
                      <p className="text-xl font-bold tabular-nums">{stats[p].avg.toFixed(2)} <span className="text-[10px] text-muted-foreground font-normal">avg</span></p>
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                        <span>{stats[p].max.toFixed(2)} max</span><span>{stats[p].min.toFixed(2)} min</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="w-56 border-l border-border overflow-y-auto p-4 space-y-3 shrink-0 bg-card">
            <p className="text-sm font-semibold">Filters</p>
            <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" /><Input placeholder="Search…" className="pl-8 h-8 text-xs" /></div>
            <FilterSelect label="Alarm Status" options={["All", "Active", "Cleared"]} />
            <FilterSelect label="Data Quality" options={["All", "Good", "Bad", "Uncertain"]} />
            <FilterSelect label="Maintenance Status" options={["All", "In maintenance", "Operational"]} demo />
            <FilterSelect label="Shift" options={["All", "A", "B", "C"]} demo />
            <FilterSelect label="Gateway" options={["All"]} demo />
            <FilterSelect label="Protocol" options={["All", "MQTT", "REST", "OPC-UA"]} demo />
          </div>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Add Graph</DialogTitle></DialogHeader>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto">
            {ALL_TYPES.map((c) => (
              <button key={c.type} onClick={() => addGraph(c.type)}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors">
                <c.icon className="w-6 h-6 text-primary" />
                <span className="text-xs text-center">{c.label}</span>
              </button>
            ))}
            {COMING_SOON.map((c) => (
              <div key={c} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-dashed border-border opacity-50 cursor-not-allowed">
                <Sparkles className="w-6 h-6 text-muted-foreground" />
                <span className="text-xs text-center">{c}</span>
                <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground">soon</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChartView({ graph, data, stats, paramColor, thresholdNum }: {
  graph: Graph; data: any[]; stats: Record<string, any>; paramColor: (p: string) => string; thresholdNum: number | null;
}) {
  const params = graph.params;
  const axis = (p: string) => graph.yMode === "multi" ? p : "L";
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.6} />;
  const xa = <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} minTickGap={30} />;
  const overlay = thresholdNum != null
    ? <ReferenceLine y={thresholdNum} yAxisId={graph.yMode === "multi" ? params[0] : "L"} stroke="#ef4444" strokeDasharray="4 4" />
    : null;

  if (graph.type === "line" || graph.type === "multiaxis" || graph.type === "area") {
    const Chart: any = graph.type === "area" ? AreaChart : LineChart;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          {grid}{xa}
          {graph.yMode === "multi"
            ? params.map((p, i) => <YAxis key={p} yAxisId={p} orientation={i % 2 ? "right" : "left"} tick={{ fontSize: 9, fill: paramColor(p) }} width={38} />)
            : <YAxis yAxisId="L" tick={{ fontSize: 10 }} width={44} domain={graph.yMode === "normalized" ? [0, 100] : ["auto", "auto"]} />}
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} /><Legend wrapperStyle={{ fontSize: 11 }} />{overlay}
          {params.map((p) => graph.type === "area"
            ? <Area key={p} yAxisId={axis(p)} type="monotone" dataKey={p} stroke={paramColor(p)} fill={paramColor(p)} fillOpacity={0.15} strokeWidth={1.8} dot={false} isAnimationActive={false} />
            : <Line key={p} yAxisId={axis(p)} type="monotone" dataKey={p} stroke={paramColor(p)} strokeWidth={1.8} dot={false} isAnimationActive={false} />)}
          <Brush dataKey="time" height={20} stroke="hsl(var(--primary))" travellerWidth={8} />
        </Chart>
      </ResponsiveContainer>
    );
  }
  if (graph.type === "bar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          {grid}{xa}<YAxis tick={{ fontSize: 10 }} width={44} /><Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} /><Legend wrapperStyle={{ fontSize: 11 }} />
          {thresholdNum != null && <ReferenceLine y={thresholdNum} stroke="#ef4444" strokeDasharray="4 4" />}
          {params.map((p) => <Bar key={p} dataKey={p} fill={paramColor(p)} isAnimationActive={false} />)}
          <Brush dataKey="time" height={20} stroke="hsl(var(--primary))" travellerWidth={8} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (graph.type === "scatter" || graph.type === "bubble") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          {grid}<XAxis dataKey="time" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={44} />
          {graph.type === "bubble" && <ZAxis dataKey="z" range={[20, 200]} />}
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} /><Legend wrapperStyle={{ fontSize: 11 }} />
          {params.map((p) => (
            <Scatter key={p} name={p} data={data.map((r) => ({ time: r.time, y: r[p], z: Math.abs(r[p] ?? 0) }))} dataKey="y" fill={paramColor(p)} isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }
  if (graph.type === "pie" || graph.type === "donut") {
    const pieData = params.filter((p) => stats[p]).map((p) => ({ name: p, value: Math.abs(stats[p][graph.agg] ?? stats[p].avg) }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="80%" innerRadius={graph.type === "donut" ? "55%" : 0} isAnimationActive={false}>
            {pieData.map((d) => <Cell key={d.name} fill={paramColor(d.name)} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} /><Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (graph.type === "radar") {
    const radarData = params.filter((p) => stats[p]).map((p) => ({ param: p, value: stats[p][graph.agg] ?? stats[p].avg }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={radarData}><PolarGrid /><PolarAngleAxis dataKey="param" tick={{ fontSize: 10 }} /><PolarRadiusAxis tick={{ fontSize: 9 }} />
          <Radar dataKey="value" stroke={graph.color} fill={graph.color} fillOpacity={0.4} isAnimationActive={false} /><Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
        </RadarChart>
      </ResponsiveContainer>
    );
  }
  if (graph.type === "histogram") {
    const p = params[0];
    const vals = data.map((r) => r[p]).filter((v) => v != null) as number[];
    if (vals.length === 0) return <Placeholder text="No data." />;
    const min = Math.min(...vals), max = Math.max(...vals), bins = 12, w = (max - min) / bins || 1;
    const hist = Array.from({ length: bins }, (_, i) => ({ bin: (min + i * w).toFixed(1), count: 0 }));
    vals.forEach((v) => { const idx = Math.min(bins - 1, Math.floor((v - min) / w)); hist[idx].count++; });
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={hist} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          {grid}<XAxis dataKey="bin" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 10 }} width={40} /><Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
          <Bar dataKey="count" fill={paramColor(p)} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (graph.type === "gauge") {
    const p = params[0]; const st = stats[p];
    const val = st ? st.last : 0; const max = st && st.max ? st.max * 1.2 : 100;
    const gd = [{ name: p, value: val, fill: paramColor(p) }];
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <ResponsiveContainer width="100%" height="80%">
          <RadialBarChart innerRadius="70%" outerRadius="100%" data={gd} startAngle={210} endAngle={-30}>
            <PolarAngleAxis type="number" domain={[0, max]} tick={false} />
            <RadialBar dataKey="value" cornerRadius={8} background isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <p className="text-2xl font-bold -mt-8">{val.toFixed(2)}</p>
        <p className="text-xs text-muted-foreground">{p}</p>
      </div>
    );
  }
  return null;
}

// ── ECharts analytics views ──
function EChartView({ graph, data, stats, paramColor, assetName }: {
  graph: Graph; data: any[]; stats: Record<string, any>; paramColor: (p: string) => string; assetName: string;
}) {
  const option = useMemo(() => buildEchartOption(graph, data, stats, paramColor, assetName), [graph, data, stats, assetName]); // eslint-disable-line
  if (graph.params.length === 0) return <Placeholder text="Select parameters on the left." />;
  return <EChart option={option} />;
}

function q(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length); if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n, mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const d = Math.sqrt(da * db); return d ? num / d : 0;
}
function dft(v: number[]): number[] {
  const N = v.length, half = Math.floor(N / 2), mag: number[] = [];
  const mean = v.reduce((s, x) => s + x, 0) / (N || 1), c = v.map((x) => x - mean);
  for (let k = 0; k < half; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const ang = -2 * Math.PI * k * n / N; re += c[n] * Math.cos(ang); im += c[n] * Math.sin(ang); }
    mag.push(Math.sqrt(re * re + im * im) / N);
  }
  return mag;
}

function buildEchartOption(graph: Graph, data: any[], stats: Record<string, any>, paramColor: (p: string) => string, assetName: string): any {
  const params = graph.params;
  const t = graph.type;

  if (t === "heatmap") {
    const xs = data.map((r) => r.time); const pts: any[] = []; let mn = Infinity, mx = -Infinity;
    data.forEach((r, xi) => params.forEach((p, yi) => { const v = r[p]; if (v != null) { pts.push([xi, yi, v]); mn = Math.min(mn, v); mx = Math.max(mx, v); } }));
    return { tooltip: { position: "top" }, grid: { left: 100, right: 20, top: 10, bottom: 70 }, xAxis: { type: "category", data: xs, axisLabel: { fontSize: 9 } }, yAxis: { type: "category", data: params, axisLabel: { fontSize: 10 } }, visualMap: { min: isFinite(mn) ? mn : 0, max: isFinite(mx) ? mx : 1, calculable: true, orient: "horizontal", left: "center", bottom: 5, inRange: { color: ["#dbeafe", "#3b82f6", "#1e3a8a"] } }, series: [{ type: "heatmap", data: pts }] };
  }
  if (t === "boxplot") {
    const boxes = params.map((p) => { const v = data.map((r) => r[p]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? [q(v, 0), q(v, 0.25), q(v, 0.5), q(v, 0.75), q(v, 1)] : [0, 0, 0, 0, 0]; });
    return { tooltip: {}, grid: { left: 50, right: 20, top: 10, bottom: 70 }, xAxis: { type: "category", data: params, axisLabel: { rotate: 30, fontSize: 9 } }, yAxis: { type: "value" }, series: [{ type: "boxplot", data: boxes, itemStyle: { color: "#bfdbfe", borderColor: "#1e40af" } }] };
  }
  if (t === "correlation") {
    const pts: any[] = [];
    params.forEach((a, i) => params.forEach((b, j) => { const va: number[] = [], vb: number[] = []; data.forEach((r) => { if (r[a] != null && r[b] != null) { va.push(r[a]); vb.push(r[b]); } }); pts.push([i, j, +pearson(va, vb).toFixed(2)]); }));
    return { tooltip: { position: "top" }, grid: { left: 100, right: 20, top: 10, bottom: 90 }, xAxis: { type: "category", data: params, axisLabel: { rotate: 30, fontSize: 9 } }, yAxis: { type: "category", data: params, axisLabel: { fontSize: 9 } }, visualMap: { min: -1, max: 1, calculable: true, orient: "horizontal", left: "center", bottom: 5, inRange: { color: ["#ef4444", "#f1f5f9", "#3b82f6"] } }, series: [{ type: "heatmap", data: pts, label: { show: true, fontSize: 9 } }] };
  }
  if (t === "treemap") {
    return { tooltip: {}, series: [{ type: "treemap", roam: false, label: { fontSize: 11 }, data: params.filter((p) => stats[p]).map((p) => ({ name: p, value: Math.abs(stats[p][graph.agg] ?? stats[p].avg), itemStyle: { color: paramColor(p) } })) }] };
  }
  if (t === "sankey") {
    const nodes = [{ name: assetName }, ...params.filter((p) => stats[p]).map((p) => ({ name: p }))];
    const links = params.filter((p) => stats[p]).map((p) => ({ source: assetName, target: p, value: Math.abs(stats[p].avg) || 0.001 }));
    return { tooltip: { trigger: "item" }, series: [{ type: "sankey", data: nodes, links, emphasis: { focus: "adjacency" }, lineStyle: { color: "gradient", opacity: 0.4 }, label: { fontSize: 10 } }] };
  }
  if (t === "pareto") {
    const sorted = params.filter((p) => stats[p]).map((p) => ({ p, v: Math.abs(stats[p][graph.agg] ?? stats[p].avg) })).sort((a, b) => b.v - a.v);
    const total = sorted.reduce((s, x) => s + x.v, 0) || 1; let cum = 0; const cumPct = sorted.map((x) => { cum += x.v; return +(cum / total * 100).toFixed(1); });
    return { tooltip: { trigger: "axis" }, grid: { left: 50, right: 50, top: 20, bottom: 70 }, xAxis: { type: "category", data: sorted.map((x) => x.p), axisLabel: { rotate: 30, fontSize: 9 } }, yAxis: [{ type: "value" }, { type: "value", max: 100, axisLabel: { formatter: "{value}%" } }], series: [{ type: "bar", data: sorted.map((x) => +x.v.toFixed(2)), itemStyle: { color: "#3b82f6" } }, { type: "line", yAxisIndex: 1, data: cumPct, itemStyle: { color: "#ef4444" }, smooth: true }] };
  }
  if (t === "control") {
    const p = params[0]; const v = data.map((r) => r[p]).filter((x) => x != null);
    const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1); const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length || 1));
    return { tooltip: { trigger: "axis" }, grid: { left: 50, right: 20, top: 20, bottom: 50 }, xAxis: { type: "category", data: data.map((r) => r.time), axisLabel: { fontSize: 9 } }, yAxis: { type: "value" }, series: [{ type: "line", data: data.map((r) => r[p] ?? null), itemStyle: { color: paramColor(p) }, showSymbol: false, markLine: { symbol: "none", label: { formatter: "{b}", fontSize: 9 }, data: [{ yAxis: mean, name: "Mean", lineStyle: { color: "#22c55e" } }, { yAxis: mean + 3 * sd, name: "UCL", lineStyle: { color: "#ef4444", type: "dashed" } }, { yAxis: mean - 3 * sd, name: "LCL", lineStyle: { color: "#ef4444", type: "dashed" } }] } }] };
  }
  if (t === "calendar") {
    const p = params[0]; const byDay: Record<string, number[]> = {};
    data.forEach((r) => { const d = new Date(r.ts); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; if (r[p] != null) (byDay[k] = byDay[k] || []).push(r[p]); });
    const days = Object.keys(byDay).sort(); const vals = days.map((k) => [k, +(byDay[k].reduce((a, b) => a + b, 0) / byDay[k].length).toFixed(2)]);
    const nums = vals.map((x) => x[1] as number);
    const range = days.length ? [days[0], days[days.length - 1]] : new Date().toISOString().slice(0, 10);
    return { tooltip: {}, visualMap: { min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 1, calculable: true, orient: "horizontal", left: "center", top: 0, inRange: { color: ["#dbeafe", "#3b82f6", "#1e3a8a"] } }, calendar: { top: 70, left: 40, right: 20, cellSize: ["auto", 16], range }, series: [{ type: "heatmap", coordinateSystem: "calendar", data: vals }] };
  }
  if (t === "fft") {
    const p = params[0]; let v = data.map((r) => r[p]).filter((x) => x != null);
    if (v.length > 256) { const step = Math.ceil(v.length / 256); v = v.filter((_, i) => i % step === 0); }
    const mag = dft(v);
    return { tooltip: { trigger: "axis" }, grid: { left: 50, right: 20, top: 20, bottom: 40 }, xAxis: { type: "category", data: mag.map((_, i) => i), name: "freq bin", axisLabel: { fontSize: 9 } }, yAxis: { type: "value", name: "magnitude" }, series: [{ type: "line", data: mag.map((m) => +m.toFixed(3)), areaStyle: {}, showSymbol: false, itemStyle: { color: paramColor(p) } }] };
  }
  return {};
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>{children}</div>;
}
function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}
function OverlayToggle({ label, on, set, demo }: { label: string; on: boolean; set: (v: boolean) => void; demo?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs flex items-center gap-1">{label}{demo && <span className="text-[8px] px-1 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">demo</span>}</span>
      <Switch checked={on} onCheckedChange={set} className="scale-75" />
    </div>
  );
}
function FilterSelect({ label, options, demo }: { label: string; options: string[]; demo?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs flex items-center gap-1">{label}{demo && <span className="text-[8px] px-1 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">demo</span>}</Label>
      <Select defaultValue={options[0]}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
function Placeholder({ text }: { text: string }) {
  return <div className="h-[420px] flex flex-col items-center justify-center text-muted-foreground"><Activity className="w-10 h-10 mb-3 opacity-20" /><p className="text-sm">{text}</p></div>;
}
