import { useState, useCallback, useEffect } from "react";
import { useListAssets, useListAssetAttributes } from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Brush,
} from "recharts";
import { BarChart2, Download, RefreshCw, Plus, X, TrendingUp } from "lucide-react";
import { format, subMinutes, subHours, subDays } from "date-fns";
import { cn } from "@/lib/utils";

const TIME_RANGES = [
  { label: "1 min", hours: 1 / 60 },
  { label: "5 min", hours: 5 / 60 },
  { label: "15 min", hours: 15 / 60 },
  { label: "30 min", hours: 30 / 60 },
  { label: "1 h", hours: 1 },
  { label: "6 h", hours: 6 },
  { label: "24 h", hours: 24 },
  { label: "7 d", hours: 24 * 7 },
  { label: "30 d", hours: 24 * 30 },
  { label: "1 year", hours: 24 * 365 },
  { label: "Custom", hours: -1 },
];

const COLORS = ["#3b82f6","#22c55e","#f97316","#a855f7","#ef4444","#14b8a6","#eab308","#6366f1","#ec4899","#84cc16"];

interface Series { assetId: string; assetName: string; metric: string; label: string; color: string; }

export default function DataExplorer() {
  const [rangeHours, setRangeHours] = useState(24);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [series, setSeries] = useState<Series[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  // Selector state
  const [selAsset, setSelAsset] = useState("");
  const [selMetric, setSelMetric] = useState("");

  const { data: assets } = useListAssets();
  const { data: attributes } = useListAssetAttributes(selAsset, { query: { enabled: !!selAsset, queryKey: ["asset-attributes", selAsset] } });

  const assetList = (assets as any[] | undefined) ?? [];
  const attrList  = (attributes as any[] | undefined) ?? [];
  const metricKeyOf = (a: any) => a.sourceMetric?.split(".").pop() ?? a.tagName?.split(".").pop() ?? a.name;
  const metricOptions = attrList.filter((a: any) => metricKeyOf(a)).map((a: any) => ({ key: metricKeyOf(a), label: a.name }));

  const fetchSeries = useCallback(async () => {
    if (series.length === 0) return;
    setLoading(true);
    try {
      const from = rangeHours === -1 && customFrom
        ? new Date(customFrom).toISOString()
        : (rangeHours < 1 ? subMinutes(new Date(), rangeHours * 60).toISOString() : rangeHours <= 24
          ? subHours(new Date(), rangeHours).toISOString()
          : subDays(new Date(), rangeHours / 24).toISOString());
      const allRows: any[] = [];
      for (const s of series) {
        const params = new URLSearchParams({ metric: s.metric, from, limit: "2000" });
        const res = await fetch(`/api/telemetry/${s.assetId}?${params}`);
        const rows: any[] = res.ok ? await res.json() : [];
        if (rows.length > 0) {
          allRows.push(...rows.map((r) => ({ ...r, _key: `${s.assetId}::${s.metric}` })));
        } else {
          const agg = await fetch(`/api/system/aggregate?${new URLSearchParams({ assetId: s.assetId, metric: s.metric, from, to: new Date().toISOString(), bucket: "1h", limit: "2000" })}`);
          const json = agg.ok ? await agg.json() : null;
          const aggRows = (json?.data ?? []).map((r: any) => ({
            timestamp: r.bucket,
            value: r.avg_val ?? r.max_val ?? r.min_val ?? null,
            _key: `${s.assetId}::${s.metric}`,
          }));
          allRows.push(...aggRows);
        }
      }
      const byTs: Record<number, any> = {};
      for (const row of allRows) {
        const ts = new Date(row.timestamp).getTime();
        if (!byTs[ts]) {
          byTs[ts] = {
            ts,
            time: format(new Date(row.timestamp),
              rangeHours <= 1 ? "HH:mm:ss" : rangeHours <= 24 ? "HH:mm" : "MM/dd HH:mm"),
          };
        }
        const v = Number(row.value);
        if (!isNaN(v)) byTs[ts][row._key] = v;
      }
      setChartData(Object.values(byTs).sort((a, b) => a.ts - b.ts));
      setLastFetch(new Date());
    } finally { setLoading(false); }
  }, [series, rangeHours, customFrom, customTo]);

  useEffect(() => { fetchSeries(); }, [fetchSeries]);

  function addSeries() {
    if (!selAsset || !selMetric) return;
    const asset = assetList.find((a: any) => a.id === selAsset);
    if (!asset) return;
    const label = `${asset.name} › ${metricOptions.find((m) => m.key === selMetric)?.label ?? selMetric}`;
    if (series.some((s) => s.label === label)) return;
    const color = COLORS[series.length % COLORS.length];
    setSeries((prev) => [...prev, { assetId: selAsset, assetName: asset.name, metric: selMetric, label, color }]);
    setSelMetric("");
  }

  function removeSeries(label: string) { setSeries((prev) => prev.filter((s) => s.label !== label)); }

  function exportCsv() {
    if (chartData.length === 0) return;
    const keys = series.map((s) => `${s.assetId}::${s.metric}`);
    const header = ["time", ...keys].join(",");
    const rows = chartData.map((row) => [row.time, ...keys.map((k) => row[k] ?? "")].join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `explorer_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" /> Data Explorer
          </h1>
          <p className="text-sm text-muted-foreground">
            Query and visualize telemetry across any asset and metric combination
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {lastFetch && <><RefreshCw className="w-3 h-3" />Updated {format(lastFetch, "HH:mm:ss")}</>}
        </div>
      </div>

      {/* Add series panel */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3 shadow-sm">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Series</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Asset</p>
            <Select value={selAsset} onValueChange={(v) => { setSelAsset(v); setSelMetric(""); }}>
              <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="Select asset…" /></SelectTrigger>
              <SelectContent>{assetList.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Metric</p>
            <Select value={selMetric} onValueChange={setSelMetric} disabled={!selAsset || metricOptions.length === 0}>
              <SelectTrigger className="h-8 text-xs w-44">
                <SelectValue placeholder={!selAsset ? "Pick asset first" : metricOptions.length === 0 ? "No numeric attrs" : "Select metric…"} />
              </SelectTrigger>
              <SelectContent>{metricOptions.map(({ key, label }) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-8" onClick={addSeries} disabled={!selAsset || !selMetric}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Series
          </Button>
        </div>

        {/* Active series chips */}
        {series.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {series.map((s) => (
              <div key={`${s.assetId}::${s.metric}`} className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 pl-2 pr-1 py-0.5 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span>{s.label}</span>
                <button onClick={() => removeSeries(s.label)} className="text-muted-foreground hover:text-destructive ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Time range + controls */}
      <div className="flex items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Select value={String(rangeHours)} onValueChange={(v) => setRangeHours(Number(v))}>
            <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Range" /></SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map(({ label, hours }) => (
                <SelectItem key={label} value={String(hours)}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rangeHours === -1 && (
            <>
              <Input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 text-xs w-44" />
              <Input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 text-xs w-44" />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchSeries} disabled={loading || series.length === 0}
            className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground disabled:opacity-40">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportCsv} disabled={chartData.length === 0}>
            <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 rounded-lg border border-border bg-card p-4 shadow-sm min-h-64">
        {series.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <TrendingUp className="w-12 h-12 mb-3 opacity-15" />
            <p className="text-sm font-medium">Add a series to begin</p>
            <p className="text-xs mt-1 opacity-60">Select an asset and metric above, then click Add Series</p>
          </div>
        ) : loading && chartData.length === 0 ? (
          <Skeleton className="h-full w-full" />
        ) : chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <TrendingUp className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">No data found. Try a larger range or another metric.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Brush dataKey="time" height={20} stroke="hsl(var(--border))" fill="hsl(var(--muted))" travellerWidth={6}
                style={{ fontSize: 9 }} />
              {series.map((s) => (
                <Line key={s.label} type="monotone" dataKey={s.label}
                  stroke={s.color} strokeWidth={2}
                  dot={chartData.length < 100} activeDot={{ r: 4 }}
                  connectNulls={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Stats row */}
      {chartData.length > 0 && series.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {series.map((s) => {
            const key = `${s.assetId}::${s.metric}`;
            const vals = chartData.map((r) => r[key]).filter((v) => v != null) as number[];
            if (vals.length === 0) return null;
            return (
              <div key={key} className="rounded-lg border border-border bg-muted/30 p-3" style={{ borderLeftColor: s.color, borderLeftWidth: 3 }}>
                <p className="text-xs font-medium truncate mb-1.5">{s.label}</p>
                <div className="grid grid-cols-2 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">Last</span><span className="font-mono">{vals[vals.length-1].toFixed(3)}</span>
                  <span className="text-muted-foreground">Min</span><span className="font-mono">{Math.min(...vals).toFixed(3)}</span>
                  <span className="text-muted-foreground">Max</span><span className="font-mono">{Math.max(...vals).toFixed(3)}</span>
                  <span className="text-muted-foreground">Avg</span><span className="font-mono">{(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(3)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{vals.length} pts</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
