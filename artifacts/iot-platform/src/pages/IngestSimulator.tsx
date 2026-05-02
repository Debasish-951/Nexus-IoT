import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetRecentTelemetry,
  getGetRecentTelemetryQueryKey,
  getListAlarmsQueryKey,
  getGetAlarmStatsQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Play, Square, Send, RefreshCw, Zap, ChevronRight,
  CheckCircle2, XCircle, Clock, Activity, Cpu, TrendingUp,
  Bell, BellOff,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ── Chart colour palette ──────────────────────────────────────────────────────
const CHART_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
];

// ── Preset payloads ──────────────────────────────────────────────────────────
const PRESETS = [
  {
    id: "rf-dryer",
    label: "RF Dryer (Energy)",
    description: "Energy meter readings from the RF dryer device",
    deviceId: "rf-dryer",
    metrics: {
      energy_meter_kwh: 4659.16,
      interval_kwh: 0.72,
      daily_cum_kwh: 52.49,
      wtd_cum_kwh: 124.60,
      mtd_cum_kwh: 1201.35,
      ytd_cum_kwh: 5451.70,
    } as Record<string, number>,
    randomize: (base: Record<string, number>): Record<string, number> => ({
      energy_meter_kwh: +(base.energy_meter_kwh + Math.random() * 0.8 - 0.1).toFixed(2),
      interval_kwh: +(Math.random() * 1.5).toFixed(3),
      daily_cum_kwh: +(base.daily_cum_kwh + Math.random() * 0.5).toFixed(2),
      wtd_cum_kwh: +(base.wtd_cum_kwh + Math.random() * 0.5).toFixed(2),
      mtd_cum_kwh: +(base.mtd_cum_kwh + Math.random() * 0.5).toFixed(2),
      ytd_cum_kwh: +(base.ytd_cum_kwh + Math.random() * 0.5).toFixed(2),
    }),
  },
  {
    id: "extrudr",
    label: "Extruder (Process)",
    description: "Temperature and pressure from the extruder",
    deviceId: "extrudr",
    metrics: {
      temperature: 185.4,
      pressure: 12.3,
      rpm: 120,
      torque: 450,
      throughput_kg_h: 85.2,
    } as Record<string, number>,
    randomize: (base: Record<string, number>): Record<string, number> => ({
      temperature: +(base.temperature + (Math.random() * 6 - 3)).toFixed(1),
      pressure: +(base.pressure + (Math.random() * 0.8 - 0.4)).toFixed(2),
      rpm: Math.round(base.rpm + (Math.random() * 10 - 5)),
      torque: Math.round(base.torque + (Math.random() * 20 - 10)),
      throughput_kg_h: +(base.throughput_kg_h + (Math.random() * 4 - 2)).toFixed(1),
    }),
  },
  {
    id: "sensorgrow",
    label: "Sensorgrow (IoT Sensor)",
    description: "Generic sensor node telemetry",
    deviceId: "sensorgrow",
    metrics: {
      temperature: 24.5,
      humidity: 62.3,
      co2_ppm: 412,
      lux: 1850,
    } as Record<string, number>,
    randomize: (base: Record<string, number>): Record<string, number> => ({
      temperature: +(base.temperature + (Math.random() * 2 - 1)).toFixed(1),
      humidity: +(base.humidity + (Math.random() * 4 - 2)).toFixed(1),
      co2_ppm: Math.round(base.co2_ppm + (Math.random() * 20 - 10)),
      lux: Math.round(base.lux + (Math.random() * 200 - 100)),
    }),
  },
  {
    id: "energy_analytics",
    label: "Energy Analytics",
    description: "Power quality monitoring",
    deviceId: "energy_analytics",
    metrics: {
      voltage_l1: 230.4,
      voltage_l2: 229.8,
      voltage_l3: 231.2,
      current_l1: 12.3,
      active_power_kw: 8.45,
      power_factor: 0.92,
    } as Record<string, number>,
    randomize: (base: Record<string, number>): Record<string, number> => ({
      voltage_l1: +(base.voltage_l1 + (Math.random() * 4 - 2)).toFixed(1),
      voltage_l2: +(base.voltage_l2 + (Math.random() * 4 - 2)).toFixed(1),
      voltage_l3: +(base.voltage_l3 + (Math.random() * 4 - 2)).toFixed(1),
      current_l1: +(base.current_l1 + (Math.random() * 2 - 1)).toFixed(2),
      active_power_kw: +(base.active_power_kw + (Math.random() * 1 - 0.5)).toFixed(3),
      power_factor: +(Math.min(1, Math.max(0.8, base.power_factor + (Math.random() * 0.04 - 0.02)))).toFixed(3),
    }),
  },
];

// ── Types ────────────────────────────────────────────────────────────────────
interface AlarmEvent {
  ruleId: string;
  ruleName: string;
  metric: string;
  value: number;
  threshold: number | null;
  operator: string | null;
  severity: string;
  event: "triggered" | "cleared";
  alarmId: string;
}

interface LogEntry {
  id: string;
  ts: Date;
  preset: string;
  payload: object;
  status: "success" | "error";
  response: object;
  durationMs: number;
  alarmEvents: AlarmEvent[];
}

type ChartPoint = Record<string, number | string>;

// ── Sub-components ───────────────────────────────────────────────────────────
function JsonEditor({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full font-mono text-xs resize-none border rounded-md p-3 bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring",
          "min-h-[280px] leading-relaxed",
          error ? "border-destructive focus:ring-destructive" : "border-border"
        )}
        spellCheck={false}
      />
      {error && (
        <p className="text-xs text-destructive mt-1 flex items-center gap-1">
          <XCircle className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  info: "bg-slate-400",
};

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const triggered = entry.alarmEvents.filter((e) => e.event === "triggered");
  const cleared   = entry.alarmEvents.filter((e) => e.event === "cleared");
  return (
    <div className={cn(
      "border-b border-border/50 text-xs",
      entry.status === "error" ? "bg-red-50/30 dark:bg-red-950/20" : "",
      triggered.length > 0 ? "bg-orange-50/30 dark:bg-orange-950/20" : "",
    )}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setExpanded((o) => !o)}
      >
        <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform text-muted-foreground", expanded && "rotate-90")} />
        {entry.status === "success"
          ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-500" />
          : <XCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />}
        <span className="font-mono text-muted-foreground">{format(entry.ts, "HH:mm:ss.SSS")}</span>
        <span className="font-medium text-foreground flex-1 truncate">{entry.preset}</span>
        {triggered.length > 0 && (
          <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400 font-medium shrink-0">
            <Bell className="w-3 h-3" />
            {triggered.length} alarm{triggered.length > 1 ? "s" : ""}
          </span>
        )}
        {cleared.length > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground shrink-0">
            <BellOff className="w-3 h-3" />
            {cleared.length} cleared
          </span>
        )}
        <span className="text-muted-foreground">{entry.durationMs}ms</span>
        <Badge
          variant={entry.status === "success" ? "outline" : "destructive"}
          className="text-xs h-4 px-1"
        >
          {entry.status}
        </Badge>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Alarm events */}
          {entry.alarmEvents.length > 0 && (
            <div>
              <p className="text-muted-foreground font-medium mb-1.5">Alarm Events</p>
              <div className="space-y-1">
                {entry.alarmEvents.map((ae) => (
                  <div
                    key={ae.alarmId}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1.5 text-xs border",
                      ae.event === "triggered"
                        ? "border-orange-300/60 bg-orange-50/50 dark:border-orange-700/40 dark:bg-orange-950/30"
                        : "border-border/50 bg-muted/30"
                    )}
                  >
                    {ae.event === "triggered"
                      ? <Bell className="w-3 h-3 text-orange-500 shrink-0" />
                      : <BellOff className="w-3 h-3 text-muted-foreground shrink-0" />}
                    <span
                      className={cn("w-1.5 h-1.5 rounded-full shrink-0", SEVERITY_COLORS[ae.severity] ?? "bg-slate-400")}
                    />
                    <span className="font-medium">{ae.ruleName}</span>
                    <span className="text-muted-foreground">—</span>
                    <span className="font-mono">{ae.metric}</span>
                    <span className="text-muted-foreground">{ae.operator}</span>
                    <span className="font-mono font-semibold">{ae.threshold}</span>
                    <span className="text-muted-foreground">(got</span>
                    <span className={cn("font-mono font-semibold", ae.event === "triggered" ? "text-orange-600 dark:text-orange-400" : "text-green-600")}>
                      {ae.value}
                    </span>
                    <span className="text-muted-foreground">)</span>
                    <Badge
                      variant="outline"
                      className={cn("ml-auto h-4 px-1 text-xs capitalize", ae.severity === "critical" ? "border-red-400 text-red-500" : ae.severity === "high" ? "border-orange-400 text-orange-500" : "")}
                    >
                      {ae.severity}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-muted-foreground font-medium mb-1">Payload</p>
              <pre className="bg-muted/60 rounded p-2 text-xs overflow-auto max-h-40 whitespace-pre-wrap">
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-muted-foreground font-medium mb-1">Response</p>
              <pre className="bg-muted/60 rounded p-2 text-xs overflow-auto max-h-40 whitespace-pre-wrap">
                {JSON.stringify(entry.response, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Custom tooltip for the chart
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-md shadow-md p-2.5 text-xs">
      <p className="font-mono text-muted-foreground mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.dataKey}:</span>
          <span className="font-semibold tabular-nums">{typeof p.value === "number" ? p.value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IngestSimulator() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [selectedPreset, setSelectedPreset] = useState(PRESETS[0]);
  const [currentMetrics, setCurrentMetrics] = useState<Record<string, number>>({ ...PRESETS[0].metrics });
  const [rawJson, setRawJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [autoSend, setAutoSend] = useState(false);
  const [intervalSecs, setIntervalSecs] = useState(3);
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [totalSent, setTotalSent] = useState(0);
  const [totalSuccess, setTotalSuccess] = useState(0);
  const [totalAlarmsTriggered, setTotalAlarmsTriggered] = useState(0);
  const intervalRef = useRef<number | null>(null);

  // Chart state
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());
  const MAX_CHART_POINTS = 40;

  const { data: recentTelemetry } = useGetRecentTelemetry({ limit: 12 });

  // Rebuild JSON whenever preset or metrics change (only when not auto-sending)
  useEffect(() => {
    if (autoSend) return;
    const payload = {
      deviceId: selectedPreset.deviceId,
      timestamp: new Date().toISOString(),
      metrics: currentMetrics,
    };
    setRawJson(JSON.stringify(payload, null, 2));
    setJsonError(null);
  }, [selectedPreset, currentMetrics, autoSend]);

  const addChartPoint = useCallback((metrics: Record<string, number>) => {
    const point: ChartPoint = { time: format(new Date(), "HH:mm:ss"), ...metrics };
    setChartData((prev) => [...prev, point].slice(-MAX_CHART_POINTS));
  }, []);

  const sendPayload = useCallback(
    async (payloadOverride?: object, metricsForChart?: Record<string, number>) => {
      let payload: object;
      if (payloadOverride) {
        payload = payloadOverride;
      } else {
        try {
          payload = JSON.parse(rawJson);
          setJsonError(null);
        } catch (e: unknown) {
          setJsonError(e instanceof Error ? e.message : String(e));
          return;
        }
      }

      const start = performance.now();
      setSending(true);
      try {
        const res = await fetch("/api/ingest/payload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        const durationMs = Math.round(performance.now() - start);

        const alarmEvents: AlarmEvent[] = data?.alarmEvents ?? [];
        const newlyTriggered = alarmEvents.filter((e: AlarmEvent) => e.event === "triggered");

        const entry: LogEntry = {
          id: crypto.randomUUID(),
          ts: new Date(),
          preset: selectedPreset.label,
          payload,
          status: res.ok ? "success" : "error",
          response: data,
          durationMs,
          alarmEvents,
        };

        setLog((l) => [entry, ...l].slice(0, 100));
        setTotalSent((n) => n + 1);
        if (res.ok) {
          setTotalSuccess((n) => n + 1);
          // Add point to chart (use provided metrics, or parse from payload)
          const chartMetrics = metricsForChart ?? (payload as any).metrics;
          if (chartMetrics && typeof chartMetrics === "object") {
            addChartPoint(chartMetrics as Record<string, number>);
          }
          // Handle alarm events
          if (newlyTriggered.length > 0) {
            setTotalAlarmsTriggered((n) => n + newlyTriggered.length);
            // Toast for each triggered alarm (max 3 to avoid spam)
            newlyTriggered.slice(0, 3).forEach((ae: AlarmEvent) => {
              toast({
                title: `🔔 Alarm triggered: ${ae.ruleName}`,
                description: `${ae.metric} ${ae.operator} ${ae.threshold} — current value: ${ae.value} (${ae.severity})`,
                variant: "destructive",
              });
            });
            // Refresh alarms list so the Alarms page shows the new entry
            qc.invalidateQueries({ queryKey: getListAlarmsQueryKey() });
            qc.invalidateQueries({ queryKey: getGetAlarmStatsQueryKey() });
          }
        }

        qc.invalidateQueries({ queryKey: getGetRecentTelemetryQueryKey({ limit: 12 }) });
      } catch (err: unknown) {
        const entry: LogEntry = {
          id: crypto.randomUUID(),
          ts: new Date(),
          preset: selectedPreset.label,
          payload,
          status: "error",
          response: { error: err instanceof Error ? err.message : String(err) },
          durationMs: Math.round(performance.now() - start),
          alarmEvents: [],
        };
        setLog((l) => [entry, ...l].slice(0, 100));
        setTotalSent((n) => n + 1);
      } finally {
        setSending(false);
      }
    },
    [rawJson, selectedPreset, qc, addChartPoint]
  );

  // Auto-send loop
  useEffect(() => {
    if (!autoSend) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const runTick = (metricsSnapshot: Record<string, number>) => {
      const newMetrics = selectedPreset.randomize(metricsSnapshot);
      setCurrentMetrics(newMetrics);
      const payload = {
        deviceId: selectedPreset.deviceId,
        timestamp: new Date().toISOString(),
        metrics: newMetrics,
      };
      sendPayload(payload, newMetrics);
      return newMetrics;
    };

    let latest = { ...currentMetrics };
    latest = runTick(latest);

    intervalRef.current = window.setInterval(() => {
      latest = runTick(latest);
    }, intervalSecs * 1000);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, intervalSecs, selectedPreset]);

  function handlePresetChange(id: string) {
    const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
    setSelectedPreset(preset);
    setCurrentMetrics({ ...preset.metrics });
    setAutoSend(false);
    setChartData([]);
    setHiddenLines(new Set());
  }

  function handleRandomize() {
    const newMetrics = selectedPreset.randomize(currentMetrics);
    setCurrentMetrics(newMetrics);
  }

  function toggleLine(key: string) {
    setHiddenLines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const metricKeys = Object.keys(selectedPreset.metrics);
  const successRate = totalSent > 0 ? Math.round((totalSuccess / totalSent) * 100) : 100;
  const telemetryList = (recentTelemetry as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Payload Simulator
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Send test Node-RED payloads to the ingest API and watch telemetry update live
          </p>
        </div>
        <div className="flex items-center gap-6 shrink-0">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{totalSent}</p>
            <p className="text-xs text-muted-foreground">Sent</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums text-green-600">{totalSuccess}</p>
            <p className="text-xs text-muted-foreground">OK</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{successRate}%</p>
            <p className="text-xs text-muted-foreground">Rate</p>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <p className={cn("text-2xl font-bold tabular-nums", totalAlarmsTriggered > 0 ? "text-orange-500" : "text-muted-foreground/60")}>
              {totalAlarmsTriggered}
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 justify-center">
              <Bell className="w-3 h-3" />
              Alarms
            </p>
          </div>
        </div>
      </div>

      {/* ── Main 2-panel grid ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Left */}
        <div className="xl:col-span-3 space-y-3">
          {/* Preset + metric chips */}
          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Device Preset</Label>
                  <Select value={selectedPreset.id} onValueChange={handlePresetChange}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRESETS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="font-medium">{p.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground font-mono">({p.deviceId})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={handleRandomize} disabled={autoSend}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Randomize
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{selectedPreset.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(currentMetrics).map(([k, v], i) => (
                  <div
                    key={k}
                    className="flex items-center gap-1.5 bg-muted/60 rounded px-2 py-1 text-xs font-mono border border-border/60"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="text-muted-foreground">{k}:</span>
                    <span className="font-semibold text-primary">{v}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* JSON editor */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Payload JSON
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <JsonEditor
                value={rawJson}
                onChange={(v) => {
                  setRawJson(v);
                  try { JSON.parse(v); setJsonError(null); }
                  catch (e: unknown) { setJsonError(e instanceof Error ? e.message : String(e)); }
                }}
                error={jsonError}
              />
            </CardContent>
          </Card>

          {/* Send controls */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-4 flex-wrap">
                <Button
                  onClick={() => sendPayload()}
                  disabled={sending || autoSend || !!jsonError}
                  className="min-w-28"
                >
                  {sending
                    ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Sending…</>
                    : <><Send className="w-4 h-4 mr-2" />Send Once</>
                  }
                </Button>

                <div className="h-6 w-px bg-border" />

                <div className="flex items-center gap-2">
                  <Switch checked={autoSend} onCheckedChange={setAutoSend} id="auto-send" />
                  <Label htmlFor="auto-send" className="text-sm cursor-pointer select-none">
                    {autoSend ? (
                      <span className="flex items-center gap-1.5 text-primary font-medium">
                        <Play className="w-3.5 h-3.5 animate-pulse" />
                        Auto-sending every {intervalSecs}s
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Auto-send</span>
                    )}
                  </Label>
                </div>

                <div className="flex items-center gap-3 flex-1 min-w-40">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <Slider
                    value={[intervalSecs]}
                    onValueChange={([v]) => setIntervalSecs(v)}
                    min={1} max={30} step={1}
                    disabled={autoSend}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground w-10 text-right">{intervalSecs}s</span>
                </div>

                {autoSend && (
                  <Button variant="destructive" size="sm" onClick={() => setAutoSend(false)}>
                    <Square className="w-3.5 h-3.5 mr-1.5" />
                    Stop
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right */}
        <div className="xl:col-span-2 space-y-3">
          {/* Live telemetry feed */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-primary" />
                Live Telemetry Feed
                {autoSend && (
                  <span className="ml-auto text-xs text-primary font-normal flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    Live
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-56">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 sticky top-0">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Device</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Metric</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Value</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!recentTelemetry ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          {Array.from({ length: 4 }).map((__, j) => (
                            <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-full" /></td>
                          ))}
                        </tr>
                      ))
                    ) : telemetryList.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                          No telemetry yet — send a payload!
                        </td>
                      </tr>
                    ) : (
                      telemetryList.map((rec: any) => (
                        <tr key={rec.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 font-mono text-foreground/60">{rec.deviceId ?? "—"}</td>
                          <td className="px-3 py-2 font-medium">{rec.metric}</td>
                          <td className="px-3 py-2 font-mono text-primary">
                            {typeof rec.value === "object" ? JSON.stringify(rec.value) : String(rec.value ?? "—")}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {format(new Date(rec.timestamp), "HH:mm:ss")}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Request log */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
                  Request Log
                </CardTitle>
                {log.length > 0 && (
                  <button
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => { setLog([]); setTotalSent(0); setTotalSuccess(0); setTotalAlarmsTriggered(0); }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-64">
                {log.length === 0 ? (
                  <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                    No requests yet — press Send Once or enable Auto-send
                  </div>
                ) : (
                  log.map((entry) => <LogRow key={entry.id} entry={entry} />)
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Live Trend Chart ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-0 pt-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
              Live Trend Chart
              {autoSend && (
                <span className="text-xs text-primary font-normal flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  Streaming
                </span>
              )}
              {chartData.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  — last {chartData.length} readings
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-3">
              {/* Metric toggles */}
              <div className="flex flex-wrap gap-1.5">
                {metricKeys.map((k, i) => (
                  <button
                    key={k}
                    onClick={() => toggleLine(k)}
                    className={cn(
                      "flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-all",
                      hiddenLines.has(k)
                        ? "border-border/40 text-muted-foreground/50 bg-muted/20 line-through"
                        : "border-border text-foreground bg-muted/40"
                    )}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: hiddenLines.has(k) ? "#94a3b8" : CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    {k}
                  </button>
                ))}
              </div>
              {chartData.length > 0 && (
                <button
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  onClick={() => setChartData([])}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-3">
          {chartData.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center gap-2 text-muted-foreground border-2 border-dashed border-border/40 rounded-lg">
              <TrendingUp className="w-8 h-8 opacity-20" />
              <p className="text-sm">Chart will appear here once you start sending payloads</p>
              <p className="text-xs opacity-60">Use Auto-send to see the data stream in real time</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  tickFormatter={(v: number) =>
                    Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
                  }
                />
                <Tooltip content={<ChartTooltip />} />
                {metricKeys.map((k, i) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={hiddenLines.has(k) ? 0 : 2}
                    dot={false}
                    activeDot={hiddenLines.has(k) ? false : { r: 3, strokeWidth: 0 }}
                    isAnimationActive={false}
                    hide={hiddenLines.has(k)}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── API Reference ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-semibold">API Reference &amp; Examples</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xs text-muted-foreground mb-3">
            Use these snippets to wire real Node-RED flows or test from the command line.
            Batch endpoint: <code className="bg-muted px-1 py-0.5 rounded font-mono">POST /api/ingest/batch</code>
          </p>
          <Tabs defaultValue="single">
            <TabsList className="h-7">
              <TabsTrigger value="single" className="text-xs h-6 px-3">Single Payload</TabsTrigger>
              <TabsTrigger value="batch" className="text-xs h-6 px-3">Batch Payload</TabsTrigger>
              <TabsTrigger value="node-red" className="text-xs h-6 px-3">Node-RED Function</TabsTrigger>
              <TabsTrigger value="curl" className="text-xs h-6 px-3">curl</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="mt-3">
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto leading-relaxed">{`POST /api/ingest/payload
Content-Type: application/json

{
  "deviceId": "rf-dryer",
  "timestamp": "2025-11-14T10:30:00+05:30",
  "metrics": {
    "energy_meter_kwh": 4659.16,
    "interval_kwh": 0.72,
    "daily_cum_kwh": 52.49
  }
}`}</pre>
            </TabsContent>

            <TabsContent value="batch" className="mt-3">
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto leading-relaxed">{`POST /api/ingest/batch
Content-Type: application/json

[
  {
    "deviceId": "rf-dryer",
    "timestamp": "2025-11-14T10:30:00Z",
    "metrics": { "energy_meter_kwh": 4659.16 }
  },
  {
    "deviceId": "extrudr",
    "timestamp": "2025-11-14T10:30:00Z",
    "metrics": { "temperature": 185.4, "pressure": 12.3 }
  }
]`}</pre>
            </TabsContent>

            <TabsContent value="node-red" className="mt-3">
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto leading-relaxed">{`// Node-RED — Function Node
// Place before an HTTP Request node pointed at POST /api/ingest/payload

const deviceId = msg.topic || "device-001";
const metrics = {};

if (msg.payload.energy_kwh !== undefined)
  metrics.energy_meter_kwh = msg.payload.energy_kwh;
if (msg.payload.temp !== undefined)
  metrics.temperature = msg.payload.temp;

msg.payload = {
  deviceId,
  timestamp: new Date().toISOString(),
  metrics,
};
msg.headers = { "Content-Type": "application/json" };
return msg;`}</pre>
            </TabsContent>

            <TabsContent value="curl" className="mt-3">
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto leading-relaxed">{`# Single payload
curl -s -X POST /api/ingest/payload \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceId": "rf-dryer",
    "metrics": { "energy_meter_kwh": 4660.0, "interval_kwh": 0.84 }
  }' | jq

# Batch
curl -s -X POST /api/ingest/batch \\
  -H "Content-Type: application/json" \\
  -d '[
    {"deviceId":"rf-dryer","metrics":{"energy_meter_kwh":4660}},
    {"deviceId":"extrudr","metrics":{"temperature":188.2}}
  ]' | jq`}</pre>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
