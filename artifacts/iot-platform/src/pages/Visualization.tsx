import { useState, useEffect, useCallback, useRef } from "react";
import { useListAssets, useListAssetAttributes } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Plus, Trash2, RefreshCw, Settings2, TrendingUp, TrendingDown,
  Minus, Activity, BarChart2, LayoutDashboard,
} from "lucide-react";
import { format, subHours } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const STORAGE_KEY = "ws-viz-widgets";

type ChartType = "line" | "area" | "bar" | "kpi";

interface Widget {
  id: string;
  title: string;
  chartType: ChartType;
  assetId: string;
  assetName: string;
  metric: string;
  rangeHours: number;
  color: string;
}

const PALETTE = [
  "#3b82f6","#22c55e","#f97316","#a855f7",
  "#ef4444","#14b8a6","#eab308","#ec4899",
];

const RANGES = [
  { label: "15 min", hours: 0.25 },
  { label: "1 h",   hours: 1 },
  { label: "6 h",   hours: 6 },
  { label: "24 h",  hours: 24 },
  { label: "7 d",   hours: 168 },
];

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiWidget({ widget, data }: { widget: Widget; data: any[] }) {
  const sorted = [...data].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const latest = sorted[0];
  const prev   = sorted[1];
  const val    = latest ? Number(latest.value) : null;
  const prevV  = prev   ? Number(prev.value)   : null;
  const delta  = val !== null && prevV !== null ? val - prevV : null;
  const TrendIcon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const trendColor = delta === null ? "text-muted-foreground" : delta > 0 ? "text-green-500" : delta < 0 ? "text-red-500" : "text-muted-foreground";

  return (
    <div className="flex flex-col items-center justify-center h-full gap-1 py-4">
      <div className="text-4xl font-bold tabular-nums" style={{ color: widget.color }}>
        {val !== null ? val.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}
      </div>
      {delta !== null && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trendColor}`}>
          <TrendIcon className="w-3.5 h-3.5" />
          {delta > 0 ? "+" : ""}{delta.toLocaleString(undefined, { maximumFractionDigits: 3 })}
        </div>
      )}
      {latest && (
        <p className="text-[11px] text-muted-foreground mt-1">
          {format(new Date(latest.timestamp), "HH:mm:ss")}
        </p>
      )}
      {data.length === 0 && <p className="text-xs text-muted-foreground">No data</p>}
    </div>
  );
}

// ── Chart Widget ──────────────────────────────────────────────────────────────
function ChartWidget({ widget, data }: { widget: Widget; data: any[] }) {
  const chartData = [...data]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((r) => ({
      t:     format(new Date(r.timestamp), widget.rangeHours <= 1 ? "HH:mm:ss" : widget.rangeHours <= 24 ? "HH:mm" : "MM/dd HH:mm"),
      value: Number(r.value),
    }));

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">No data in range</p>
      </div>
    );
  }

  const commonProps = {
    data: chartData,
    margin: { top: 4, right: 8, bottom: 0, left: 0 },
  };
  const axisProps = {
    stroke: "hsl(var(--muted-foreground))",
    fontSize: 10,
    tickLine: false,
    axisLine: false,
  };
  const tooltipStyle = {
    contentStyle: {
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 6,
      fontSize: 11,
      padding: "4px 8px",
    },
    labelStyle: { color: "hsl(var(--muted-foreground))", fontSize: 10 },
    cursor: { stroke: "hsl(var(--border))" },
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      {widget.chartType === "bar" ? (
        <BarChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="t" {...axisProps} />
          <YAxis {...axisProps} width={36} />
          <Tooltip {...tooltipStyle} />
          <Bar dataKey="value" fill={widget.color} radius={[2, 2, 0, 0]} maxBarSize={20} />
        </BarChart>
      ) : widget.chartType === "area" ? (
        <AreaChart {...commonProps}>
          <defs>
            <linearGradient id={`grad-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={widget.color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={widget.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="t" {...axisProps} />
          <YAxis {...axisProps} width={36} />
          <Tooltip {...tooltipStyle} />
          <Area dataKey="value" stroke={widget.color} fill={`url(#grad-${widget.id})`} strokeWidth={1.5} dot={false} />
        </AreaChart>
      ) : (
        <LineChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="t" {...axisProps} />
          <YAxis {...axisProps} width={36} />
          <Tooltip {...tooltipStyle} />
          <Line dataKey="value" stroke={widget.color} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

// ── Widget Card ───────────────────────────────────────────────────────────────
function WidgetCard({
  widget, onDelete, onEdit,
}: {
  widget: Widget;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [data, setData]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const from = subHours(new Date(), widget.rangeHours).toISOString();
      const params = new URLSearchParams({ metric: widget.metric, from, limit: "2000" });
      const r = await fetch(`${BASE}/api/telemetry/${widget.assetId}?${params}`, { credentials: "include" });
      if (r.ok) {
        setData(await r.json());
        setLastFetch(new Date());
      }
    } finally {
      setLoading(false);
    }
  }, [widget.assetId, widget.metric, widget.rangeHours]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh) {
      timerRef.current = setInterval(fetchData, 30_000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, fetchData]);

  const latest = data.length > 0 ? Number(data[data.length - 1]?.value ?? data[0]?.value) : null;

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-2 py-2.5 px-3 space-y-0 border-b border-border shrink-0">
        <Activity className="w-3.5 h-3.5 shrink-0" style={{ color: widget.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold truncate max-w-[120px]">{widget.title}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{widget.assetName}</Badge>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">{widget.metric}</Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">
              {RANGES.find((r) => r.hours === widget.rangeHours)?.label ?? `${widget.rangeHours}h`}
            </span>
            {latest !== null && widget.chartType !== "kpi" && (
              <span className="text-[10px] font-medium" style={{ color: widget.color }}>
                latest: {latest.toLocaleString(undefined, { maximumFractionDigits: 3 })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onEdit}>
            <Settings2 className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-2 min-h-0" style={{ height: widget.chartType === "kpi" ? 120 : 180 }}>
        {loading && data.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
        ) : widget.chartType === "kpi" ? (
          <KpiWidget widget={widget} data={data} />
        ) : (
          <ChartWidget widget={widget} data={data} />
        )}
      </CardContent>

      {lastFetch && (
        <div className="px-3 pb-1.5 flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">Updated {format(lastFetch, "HH:mm:ss")}</p>
          <div className="flex items-center gap-1">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-[0.6] origin-right" />
            <span className="text-[10px] text-muted-foreground">Auto</span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Widget Config Dialog ──────────────────────────────────────────────────────
function WidgetDialog({
  open, onOpenChange, initial, onSave, usedColors,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Widget | null;
  onSave: (w: Widget) => void;
  usedColors: string[];
}) {
  const nextColor = PALETTE.find((c) => !usedColors.includes(c)) ?? PALETTE[0];

  const [title, setTitle]         = useState(initial?.title ?? "");
  const [chartType, setChartType] = useState<ChartType>(initial?.chartType ?? "line");
  const [assetId, setAssetId]     = useState(initial?.assetId ?? "");
  const [assetName, setAssetName] = useState(initial?.assetName ?? "");
  const [metric, setMetric]       = useState(initial?.metric ?? "");
  const [rangeHours, setRangeHours] = useState(initial?.rangeHours ?? 1);
  const [color, setColor]         = useState(initial?.color ?? nextColor);

  const { data: assets } = useListAssets();
  const { data: attributes } = useListAssetAttributes(assetId, {
    query: { enabled: !!assetId, queryKey: ["viz-attrs", assetId] },
  });

  const assetList = (assets as any[] | undefined) ?? [];
  const attrList  = (attributes as any[] | undefined) ?? [];
  const metricAttrs = attrList.filter((a: any) =>
    ["dynamic", "metric", "runtime"].includes(a.type)
  );

  function handleSave() {
    if (!assetId || !metric) return;
    onSave({
      id:        initial?.id ?? crypto.randomUUID(),
      title:     title || `${assetName} / ${metric}`,
      chartType, assetId, assetName, metric, rangeHours, color,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Widget" : "Add Widget"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Title (optional)</Label>
            <Input className="h-8 text-xs" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto-generated if blank" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Chart Type</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {(["line","area","bar","kpi"] as ChartType[]).map((t) => (
                <button key={t} onClick={() => setChartType(t)}
                  className={`rounded border py-1.5 text-xs font-medium capitalize transition-colors ${
                    chartType === t ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted/60"
                  }`}>
                  {t === "kpi" ? "KPI" : t === "line" ? "Line" : t === "area" ? "Area" : "Bar"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Asset</Label>
            <Select value={assetId} onValueChange={(v) => {
              setAssetId(v);
              setAssetName(assetList.find((a: any) => a.id === v)?.name ?? "");
              setMetric("");
            }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select asset…" /></SelectTrigger>
              <SelectContent>
                {assetList.map((a: any) => <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Metric</Label>
            <Select value={metric} onValueChange={setMetric} disabled={!assetId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={assetId ? "Select metric…" : "Select asset first"} /></SelectTrigger>
              <SelectContent>
                {metricAttrs.map((a: any) => <SelectItem key={a.name} value={a.name} className="text-xs">{a.name}</SelectItem>)}
                {metricAttrs.length === 0 && assetId && (
                  <SelectItem value="_none" disabled className="text-xs text-muted-foreground">No dynamic/metric attributes</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Time Range</Label>
            <Select value={String(rangeHours)} onValueChange={(v) => setRangeHours(Number(v))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => <SelectItem key={r.hours} value={String(r.hours)} className="text-xs">{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Color</Label>
            <div className="flex gap-2 flex-wrap">
              {PALETTE.map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!assetId || !metric}>
            {initial ? "Update" : "Add Widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Visualization() {
  const [widgets, setWidgets] = useState<Widget[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editWidget, setEditWidget] = useState<Widget | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  }, [widgets]);

  function addOrUpdate(w: Widget) {
    setWidgets((prev) => {
      const idx = prev.findIndex((x) => x.id === w.id);
      return idx >= 0 ? prev.map((x, i) => i === idx ? w : x) : [...prev, w];
    });
  }

  function removeWidget(id: string) {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }

  const usedColors = widgets.map((w) => w.color);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border bg-card flex items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4 text-primary" />
            Visualization Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live time-series widgets powered by the telemetry database. Auto-refresh every 30 s.
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => { setEditWidget(null); setDialogOpen(true); }}>
          <Plus className="w-3.5 h-3.5" /> Add Widget
        </Button>
      </div>

      {/* Widget grid */}
      <div className="flex-1 overflow-auto p-4">
        {widgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <LayoutDashboard className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No widgets yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs">
              Add a widget to start visualizing your time-series data. Each widget connects directly to the telemetry database.
            </p>
            <Button size="sm" onClick={() => { setEditWidget(null); setDialogOpen(true); }}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add First Widget
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-auto">
            {widgets.map((w) => (
              <WidgetCard
                key={w.id}
                widget={w}
                onDelete={() => removeWidget(w.id)}
                onEdit={() => { setEditWidget(w); setDialogOpen(true); }}
              />
            ))}
          </div>
        )}
      </div>

      <WidgetDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditWidget(null); }}
        initial={editWidget}
        onSave={addOrUpdate}
        usedColors={usedColors}
      />
    </div>
  );
}
