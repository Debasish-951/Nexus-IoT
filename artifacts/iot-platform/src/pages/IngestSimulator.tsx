import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetRecentTelemetry,
  getGetRecentTelemetryQueryKey,
  getListAlarmsQueryKey,
  getGetAlarmStatsQueryKey,
  useListAssets,
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
  Bell, BellOff, History, AlertTriangle,
  Plus, Trash2, Package, Sliders, Upload, FileSpreadsheet,
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
// Each preset exposes the data metrics for charting (randomize returns only data fields)
// and optionally a buildPayload() that overrides the default { deviceId, timestamp, metrics } envelope.
interface Preset {
  id: string;
  label: string;
  description: string;
  deviceId: string;
  metrics: Record<string, number>;
  randomize: (base: Record<string, number>) => Record<string, number>;
  buildPayload?: (metrics: Record<string, number>) => object;
}

const SENSORGROW_BASE_DATA: Record<string, number> = {
  vibration_rms_displacement_y: 0.000049,
  vibration_rms_velocity_x: 1.1,
  vibration_max_f_acceleration_x: 0.97,
  vibration_peak_to_peak_velocity_x: 6.6,
  vibration_max_velocity_z: 2.1,
  vibration_max_acceleration_y: 0.571429,
  vibration_derived_peak_displacement_z: 0.000069,
  vibration_peak_to_peak_acceleration_z: 0.832653,
  ultrasound: 53.167,
  temperature: 31.706,
  vibration_peak_to_peak_displacement_x: 0.00014,
  vibration_rms_velocity_z: 0.8,
  vibration_derived_peak_velocity_y: 1.1312,
  vibration_peak_to_peak_velocity_y: 3.8,
  radio_strength: 0,
  vibration_peak_to_peak_displacement_z: 0.000098,
  vibration_rms_acceleration_z: 0.10102,
  vibration_derived_peak_velocity_x: 1.5554,
  vibration_rms_acceleration_y: 0.15102,
  vibration_max_f_acceleration_y: 0.48,
  vibration_max_acceleration_z: 0.416327,
  vibration_max_velocity_y: 1.9,
  vibration_peak_to_peak_displacement_y: 0.000102,
  vibration_peak_to_peak_acceleration_x: 1.728571,
  vibration_derived_peak_velocity_z: 1.1312,
  vibration_derived_peak_displacement_x: 0.000099,
  vibration_derived_peak_displacement_y: 0.000069,
  vibration_derived_peak_acceleration_x: 0.278471,
  vibration_max_displacement_x: 0.00007,
  vibration_peak_to_peak_velocity_z: 4.2,
  vibration_max_displacement_z: 0.000049,
  vibration_rms_displacement_x: 0.00007,
  battery: 3,
  vibration_rms_velocity_y: 0.8,
  vibration_derived_peak_acceleration_z: 0.142843,
  runhours: 1654,
  vibration_max_velocity_x: 3.3,
  vibration_peak_to_peak_acceleration_y: 1.142857,
  vibration_max_displacement_y: 0.000051,
  vibration_rms_acceleration_x: 0.196939,
  vibration_max_acceleration_x: 0.864286,
  vibration_rms_displacement_z: 0.000049,
};

// ── Energy meter flat payload ─────────────────────────────────────────────────
const ENERGY_METER_BASE_DATA: Record<string, number> = {
  energy_meter_kwh: 4659.166,
  interval_kwh: 0.739,
  daily_cum_kwh: 32.16,
  wtd_cum_kwh: 319.97,
  mtd_cum_kwh: 968.86,
  ytd_cum_kwh: 4658.35,
};

const PRESETS: Preset[] = [
  {
    id: "energy-meter",
    label: "Energy Meter (Flat Payload)",
    description: "Energy meter payload with cumulative and interval metrics at root level. Create an asset with identifier='energy-meter-01' to receive this data.",
    deviceId: "energy-meter-01",
    metrics: { ...ENERGY_METER_BASE_DATA },
    randomize: (base) => ({
      ...base,
      energy_meter_kwh: +(base.energy_meter_kwh + Math.random() * 0.15 + 0.05).toFixed(3),
      interval_kwh: +(Math.random() * 0.4 + 0.5).toFixed(3),
      daily_cum_kwh: +(base.daily_cum_kwh + Math.random() * 0.25 + 0.1).toFixed(3),
      wtd_cum_kwh: +(base.wtd_cum_kwh + Math.random() * 0.3 + 0.2).toFixed(3),
      mtd_cum_kwh: +(base.mtd_cum_kwh + Math.random() * 0.6 + 0.3).toFixed(3),
      ytd_cum_kwh: +(base.ytd_cum_kwh + Math.random() * 0.15 + 0.05).toFixed(3),
    }),
    buildPayload: (metrics) => ({
      deviceId: "energy-meter-01",
      timestamp: new Date().toISOString().replace("T", " ").replace("Z", "+00:00"),
      timestampUnix: Date.now(),
      ...metrics,
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

interface ValidateResult {
  valid: boolean;
  deviceId: string;
  assetId: string | null;
  assetName: string | null;
  assetMatched: boolean;
  timestamp: string;
  payloadFormat: "flat" | "nested-data" | "nested-metrics" | "unknown";
  extractedMetrics: Record<string, unknown>;
  metricCount: number;
  warnings: string[];
}

interface LogEntry {
  id: string;
  ts: Date;
  preset: string;
  payload: object;
  status: "success" | "error";
  response: object;
  validateResult: ValidateResult | null;
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

const FORMAT_STYLES: Record<string, string> = {
  flat:            "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  "nested-data":   "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 border-violet-200 dark:border-violet-800",
  "nested-metrics":"bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border-teal-200 dark:border-teal-800",
  "nested-root":   "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300 border-orange-200 dark:border-orange-800",
  unknown:         "bg-muted text-muted-foreground border-border",
};

function FormatBadge({ fmt }: { fmt: string }) {
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0 rounded border font-mono text-[10px] leading-4", FORMAT_STYLES[fmt] ?? FORMAT_STYLES.unknown)}>
      {fmt}
    </span>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const triggered = entry.alarmEvents.filter((e) => e.event === "triggered");
  const cleared   = entry.alarmEvents.filter((e) => e.event === "cleared");
  const vr = entry.validateResult;
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
        <span className="font-mono text-muted-foreground shrink-0">{format(entry.ts, "HH:mm:ss.SSS")}</span>
        {vr && <FormatBadge fmt={vr.payloadFormat} />}
        {vr && (
          <span className={cn("shrink-0 text-[10px] font-mono", vr.assetMatched ? "text-green-600 dark:text-green-400" : "text-muted-foreground/60")}>
            {vr.assetMatched ? `✓ ${vr.assetName}` : "no asset"}
          </span>
        )}
        {vr && <span className="text-muted-foreground/60 text-[10px] shrink-0">{vr.metricCount}M</span>}
        <span className="font-medium text-foreground flex-1 truncate min-w-0">{entry.preset}</span>
        {triggered.length > 0 && (
          <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400 font-medium shrink-0">
            <Bell className="w-3 h-3" />
            {triggered.length}
          </span>
        )}
        {cleared.length > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground shrink-0">
            <BellOff className="w-3 h-3" />
            {cleared.length}
          </span>
        )}
        <span className="text-muted-foreground shrink-0">{entry.durationMs}ms</span>
        <Badge
          variant={entry.status === "success" ? "outline" : "destructive"}
          className="text-xs h-4 px-1 shrink-0"
        >
          {entry.status}
        </Badge>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Validate result */}
          {vr && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-2.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Validate Result</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span><span className="text-muted-foreground">Format:</span> <FormatBadge fmt={vr.payloadFormat} /></span>
                <span><span className="text-muted-foreground">Metrics:</span> <span className="font-mono font-semibold">{vr.metricCount}</span></span>
                <span><span className="text-muted-foreground">Asset:</span>{" "}
                  {vr.assetMatched
                    ? <span className="text-green-600 dark:text-green-400 font-medium">✓ {vr.assetName}</span>
                    : <span className="text-muted-foreground/60">not matched</span>}
                </span>
                <span><span className="text-muted-foreground">Timestamp:</span> <span className="font-mono text-[10px]">{vr.timestamp}</span></span>
              </div>
              {vr.warnings.length > 0 && (
                <div className="space-y-0.5">
                  {vr.warnings.map((w, i) => (
                    <p key={i} className="text-[10px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                      <span className="shrink-0 mt-0.5">⚠</span>{w}
                    </p>
                  ))}
                </div>
              )}
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Extracted metrics</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(vr.extractedMetrics).map(([k, v]) => (
                    <span key={k} className="font-mono text-[10px] bg-background border border-border/60 rounded px-1.5 py-0.5">
                      <span className="text-muted-foreground">{k}:</span> <span className="font-semibold">{String(v)}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
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
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", SEVERITY_COLORS[ae.severity] ?? "bg-slate-400")} />
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
                    <Badge variant="outline" className={cn("ml-auto h-4 px-1 text-xs capitalize", ae.severity === "critical" ? "border-red-400 text-red-500" : ae.severity === "high" ? "border-orange-400 text-orange-500" : "")}>
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
              <p className="text-muted-foreground font-medium mb-1">Ingest Response</p>
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

// ── HistoryRow — expandable row in the full-width Payload History table ──────
function HistoryRow({
  entry,
  vr,
  resp,
  triggered,
  cleared,
}: {
  entry: LogEntry;
  vr: ValidateResult | null;
  resp: any;
  triggered: AlarmEvent[];
  cleared: AlarmEvent[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className={cn(
          "border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer select-none",
          entry.status === "error" ? "bg-red-50/20 dark:bg-red-950/10" : "",
          triggered.length > 0 ? "bg-orange-50/20 dark:bg-orange-950/10" : "",
        )}
        onClick={() => setOpen((o) => !o)}
      >
        {/* Time */}
        <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
          {format(entry.ts, "HH:mm:ss.SSS")}
        </td>
        {/* Preset / Device */}
        <td className="px-3 py-2">
          <span className="font-medium truncate block max-w-[200px]">{entry.preset}</span>
          {vr && <span className="font-mono text-[10px] text-muted-foreground">{vr.deviceId}</span>}
        </td>
        {/* Format */}
        <td className="px-3 py-2">
          {vr
            ? <FormatBadge fmt={vr.payloadFormat} />
            : <span className="text-muted-foreground/40">—</span>}
        </td>
        {/* Metrics */}
        <td className="px-3 py-2 font-mono text-center">
          {vr
            ? <span className="font-semibold">{vr.metricCount}</span>
            : <span className="text-muted-foreground/40">—</span>}
        </td>
        {/* Asset */}
        <td className="px-3 py-2">
          {vr
            ? vr.assetMatched
              ? <span className="text-green-600 dark:text-green-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[110px]">{vr.assetName}</span>
                </span>
              : <span className="text-muted-foreground/50 flex items-center gap-1 text-[10px]">
                  <XCircle className="w-3 h-3 shrink-0" />
                  no asset
                </span>
            : <span className="text-muted-foreground/40">—</span>}
        </td>
        {/* Records written */}
        <td className="px-3 py-2 font-mono text-center">
          {resp?.recordsWritten != null
            ? <span className={cn("font-semibold", resp.recordsWritten > 0 ? "text-primary" : "text-muted-foreground/40")}>
                {resp.recordsWritten}
              </span>
            : <span className="text-muted-foreground/40">—</span>}
        </td>
        {/* Alarms */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            {triggered.length > 0 && (
              <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400 font-medium">
                <Bell className="w-3 h-3" />{triggered.length}
              </span>
            )}
            {cleared.length > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground text-[10px]">
                <BellOff className="w-3 h-3" />{cleared.length}
              </span>
            )}
            {triggered.length === 0 && cleared.length === 0 && (
              <span className="text-muted-foreground/30">—</span>
            )}
          </div>
        </td>
        {/* Duration */}
        <td className="px-3 py-2 font-mono text-muted-foreground text-right">
          {entry.durationMs}ms
        </td>
        {/* Status */}
        <td className="px-3 py-2">
          <Badge
            variant={entry.status === "success" ? "outline" : "destructive"}
            className="text-xs h-4 px-1"
          >
            {entry.status}
          </Badge>
        </td>
        {/* Expand chevron */}
        <td className="px-3 py-2 text-muted-foreground">
          <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
        </td>
      </tr>
      {/* Expanded detail row */}
      {open && (
        <tr className="border-b border-border/50 bg-muted/10">
          <td colSpan={10} className="px-4 py-3">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              {/* Validate detail */}
              {vr && (
                <div className="xl:col-span-1 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Validate Detail</p>
                  {vr.warnings.length > 0 && (
                    <div className="space-y-0.5">
                      {vr.warnings.map((w, i) => (
                        <p key={i} className="text-[10px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{w}
                        </p>
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Extracted metrics ({vr.metricCount})</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(vr.extractedMetrics).map(([k, v]) => (
                        <span key={k} className="font-mono text-[10px] bg-background border border-border/60 rounded px-1.5 py-0.5">
                          <span className="text-muted-foreground">{k}:</span>{" "}
                          <span className="font-semibold">{String(v)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Normalised ts: <span className="font-mono">{vr.timestamp}</span>
                  </p>
                </div>
              )}
              {/* Payload JSON */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Payload</p>
                <pre className="bg-muted/60 rounded p-2 text-[10px] overflow-auto max-h-36 whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(entry.payload, null, 2)}
                </pre>
              </div>
              {/* Ingest response */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Ingest Response</p>
                <pre className="bg-muted/60 rounded p-2 text-[10px] overflow-auto max-h-36 whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(entry.response, null, 2)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
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

// ══════════════════════════════════════════════════════════════════════════════
// ── Custom Asset Sender ───────────────────────────────────────────────────────
interface CustomMetricRow {
  id: string;
  name: string;
  min: number;
  max: number;
  value: number;
  step: number;
}

interface CustomLogEntry {
  id: string;
  ts: Date;
  assetName: string;
  deviceId: string;
  metrics: Record<string, number>;
  status: "success" | "error";
  durationMs: number;
  alarmEvents: AlarmEvent[];
}

function CustomAssetSender() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: assetsData } = useListAssets();
  const allAssets = (assetsData as any[] | undefined) ?? [];

  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [rows, setRows] = useState<CustomMetricRow[]>([
    { id: crypto.randomUUID(), name: "temperature", min: 20, max: 80, value: 35, step: 0.1 },
    { id: crypto.randomUUID(), name: "pressure",    min: 0,  max: 20, value: 8,  step: 0.01 },
  ]);
  const [autoSend, setAutoSend]     = useState(false);
  const [intervalSecs, setIntervalSecs] = useState(3);
  const [sending, setSending]       = useState(false);
  const [log, setLog]               = useState<CustomLogEntry[]>([]);
  const [totalSent, setTotalSent]   = useState(0);
  const [totalSuccess, setTotalSuccess] = useState(0);
  const [totalAlarms, setTotalAlarms]   = useState(0);
  const [chartData, setChartData]   = useState<ChartPoint[]>([]);
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());
  const intervalRef = useRef<number | null>(null);
  const MAX_CHART = 40;

  const selectedAsset = allAssets.find((a: any) => a.id === selectedAssetId);

  // Discover metrics from asset attributes when asset changes
  useEffect(() => {
    if (!selectedAssetId) return;
    fetch(`/api/assets/${selectedAssetId}/attributes`)
      .then(r => r.ok ? r.json() : null)
      .then((attrs: any[] | null) => {
        if (!attrs || attrs.length === 0) return;
        const dynamic = attrs.filter((a: any) => a.attributeType === "dynamic" || a.attributeType === "measurement");
        if (dynamic.length === 0) return;
        setRows(dynamic.map((a: any) => ({
          id: crypto.randomUUID(),
          name: a.name,
          min: a.minValue ?? 0,
          max: a.maxValue ?? 100,
          value: ((a.minValue ?? 0) + (a.maxValue ?? 100)) / 2,
          step: 0.01,
        })));
        toast({ title: `Discovered ${dynamic.length} metric attribute${dynamic.length>1?"s":""} for ${selectedAsset?.name ?? "asset"}` });
      })
      .catch(() => {/* silently ignore */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetId]);

  function addRow() {
    setRows(prev => [...prev, { id: crypto.randomUUID(), name: "", min: 0, max: 100, value: 50, step: 0.1 }]);
  }
  function removeRow(id: string) { setRows(prev => prev.filter(r => r.id !== id)); }
  function updateRow(id: string, patch: Partial<CustomMetricRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function randomizeValues() {
    setRows(prev => prev.map(r => ({
      ...r,
      value: +(r.min + Math.random() * (r.max - r.min)).toFixed(4),
    })));
  }

  const buildMetrics = useCallback((theRows: CustomMetricRow[]) =>
    Object.fromEntries(theRows.filter(r => r.name.trim()).map(r => [r.name.trim(), r.value])),
  []);

  const doSend = useCallback(async (metricsOverride?: Record<string, number>) => {
    if (!selectedAsset) { toast({ title: "Select an asset first", variant: "destructive" }); return; }
    const metrics = metricsOverride ?? buildMetrics(rows);
    if (Object.keys(metrics).length === 0) { toast({ title: "Add at least one metric", variant: "destructive" }); return; }

    const deviceId = selectedAsset.identifier || selectedAsset.id;
    const payload = { deviceId, timestamp: new Date().toISOString(), metrics };
    const start = performance.now();
    setSending(true);
    try {
      const res = await fetch("/api/ingest/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const dur = Math.round(performance.now() - start);
      const alarmEvents: AlarmEvent[] = data?.alarmEvents ?? [];
      const newlyTriggered = alarmEvents.filter((e: AlarmEvent) => e.event === "triggered");

      const entry: CustomLogEntry = {
        id: crypto.randomUUID(),
        ts: new Date(),
        assetName: selectedAsset.name,
        deviceId,
        metrics,
        status: res.ok ? "success" : "error",
        durationMs: dur,
        alarmEvents,
      };
      setLog(l => [entry, ...l].slice(0, 80));
      setTotalSent(n => n + 1);
      if (res.ok) {
        setTotalSuccess(n => n + 1);
        setChartData(prev => [...prev, { time: format(new Date(), "HH:mm:ss"), ...metrics }].slice(-MAX_CHART));
        if (newlyTriggered.length > 0) {
          setTotalAlarms(n => n + newlyTriggered.length);
          newlyTriggered.slice(0, 2).forEach((ae: AlarmEvent) => {
            toast({ title: `🔔 ${ae.ruleName}`, description: `${ae.metric} ${ae.operator} ${ae.threshold} (got ${ae.value})`, variant: "destructive" });
          });
          qc.invalidateQueries({ queryKey: getListAlarmsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetAlarmStatsQueryKey() });
        }
      }
      qc.invalidateQueries({ queryKey: getGetRecentTelemetryQueryKey({ limit: 12 }) });
    } catch (err) {
      const entry: CustomLogEntry = {
        id: crypto.randomUUID(), ts: new Date(),
        assetName: selectedAsset.name, deviceId, metrics,
        status: "error", durationMs: Math.round(performance.now() - start), alarmEvents: [],
      };
      setLog(l => [entry, ...l].slice(0, 80));
      setTotalSent(n => n + 1);
    } finally { setSending(false); }
  }, [selectedAsset, rows, buildMetrics, toast, qc]);

  // Auto-send loop
  useEffect(() => {
    if (!autoSend) {
      if (intervalRef.current !== null) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    const tick = () => {
      const jittered = Object.fromEntries(
        rows.filter(r => r.name.trim()).map(r => [
          r.name.trim(),
          +(r.min + Math.random() * (r.max - r.min)).toFixed(4),
        ])
      );
      doSend(jittered);
    };
    tick();
    intervalRef.current = window.setInterval(tick, intervalSecs * 1000);
    return () => { if (intervalRef.current !== null) { window.clearInterval(intervalRef.current); intervalRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, intervalSecs, selectedAssetId]);

  const metricNames = rows.filter(r => r.name.trim()).map(r => r.name.trim());
  const successRate = totalSent > 0 ? Math.round((totalSuccess / totalSent) * 100) : 100;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex items-center gap-6">
        {[
          { label: "Sent", value: totalSent, cls: "" },
          { label: "OK", value: totalSuccess, cls: "text-green-600" },
          { label: "Rate", value: `${successRate}%`, cls: "" },
          { label: "Alarms", value: totalAlarms, cls: totalAlarms > 0 ? "text-orange-500" : "text-muted-foreground/60" },
        ].map(s => (
          <div key={s.label} className="text-center">
            <p className={cn("text-2xl font-bold tabular-nums", s.cls)}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Left: asset + metric config */}
        <div className="xl:col-span-3 space-y-3">
          {/* Asset selector */}
          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Target Asset</Label>
                  <select
                    value={selectedAssetId}
                    onChange={e => { setSelectedAssetId(e.target.value); setAutoSend(false); setChartData([]); }}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">— choose an asset —</option>
                    {allAssets.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.identifier ? ` (${a.identifier})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedAsset && (
                  <div className="text-xs text-muted-foreground shrink-0 text-right">
                    <p className="font-medium text-foreground">{selectedAsset.name}</p>
                    <p className="font-mono">{selectedAsset.identifier || selectedAsset.id}</p>
                  </div>
                )}
              </div>
              {selectedAsset && (
                <p className="text-xs text-muted-foreground">
                  Payloads will be sent with <code className="bg-muted px-1 rounded font-mono">deviceId: "{selectedAsset.identifier || selectedAsset.id}"</code>.
                  The ingest pipeline will match this to the asset automatically.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Metric rows */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" /> Metric Configuration
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={randomizeValues} disabled={autoSend}>
                    <RefreshCw className="w-3 h-3 mr-1" /> Randomize
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addRow} disabled={autoSend}>
                    <Plus className="w-3 h-3 mr-1" /> Add Metric
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {rows.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No metrics configured — click Add Metric</p>
              )}
              {rows.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2 p-2 rounded border border-border/60 bg-muted/20">
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <input
                    value={row.name}
                    onChange={e => updateRow(row.id, { name: e.target.value })}
                    placeholder="metric_name"
                    className="flex-1 min-w-0 h-7 rounded border border-border bg-background px-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={autoSend}
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-muted-foreground w-6 text-right">{row.min}</span>
                    <input type="range" min={row.min} max={row.max} step={row.step}
                      value={row.value}
                      onChange={e => updateRow(row.id, { value: +e.target.value })}
                      className="w-24"
                      disabled={autoSend}
                    />
                    <span className="text-xs text-muted-foreground w-6">{row.max}</span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-primary w-16 text-right tabular-nums">
                    {row.value.toFixed(4)}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <input type="number" value={row.min} onChange={e => updateRow(row.id, { min: +e.target.value })}
                      className="w-14 h-6 rounded border border-border/60 bg-background px-1.5 text-xs text-center font-mono focus:outline-none"
                      placeholder="min" title="Min value" disabled={autoSend}
                    />
                    <span className="text-xs text-muted-foreground">–</span>
                    <input type="number" value={row.max} onChange={e => updateRow(row.id, { max: +e.target.value })}
                      className="w-14 h-6 rounded border border-border/60 bg-background px-1.5 text-xs text-center font-mono focus:outline-none"
                      placeholder="max" title="Max value" disabled={autoSend}
                    />
                  </div>
                  <button onClick={() => removeRow(row.id)} disabled={autoSend}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Payload preview */}
          <Card className="shadow-sm">
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payload Preview</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <pre className="bg-muted/40 rounded-md p-3 text-xs font-mono overflow-auto max-h-40 leading-relaxed">
                {JSON.stringify({
                  deviceId: selectedAsset?.identifier || selectedAsset?.id || "<select asset>",
                  timestamp: "<now>",
                  metrics: buildMetrics(rows),
                }, null, 2)}
              </pre>
            </CardContent>
          </Card>

          {/* Send controls */}
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-4 flex-wrap">
                <Button onClick={() => doSend()} disabled={sending || autoSend || !selectedAssetId} className="min-w-28">
                  {sending
                    ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Sending…</>
                    : <><Send className="w-4 h-4 mr-2" />Send Once</>}
                </Button>
                <div className="h-6 w-px bg-border" />
                <div className="flex items-center gap-2">
                  <Switch checked={autoSend} onCheckedChange={v => { if (!selectedAssetId && v) { toast({ title: "Select an asset first" }); return; } setAutoSend(v); }} id="custom-auto-send" />
                  <Label htmlFor="custom-auto-send" className="text-sm cursor-pointer select-none">
                    {autoSend
                      ? <span className="flex items-center gap-1.5 text-primary font-medium"><Play className="w-3.5 h-3.5 animate-pulse" />Auto-sending every {intervalSecs}s</span>
                      : <span className="text-muted-foreground">Auto-send</span>}
                  </Label>
                </div>
                <div className="flex items-center gap-3 flex-1 min-w-40">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <Slider value={[intervalSecs]} onValueChange={([v]) => setIntervalSecs(v)} min={1} max={30} step={1} disabled={autoSend} className="flex-1" />
                  <span className="text-xs text-muted-foreground w-10 text-right">{intervalSecs}s</span>
                </div>
                {autoSend && (
                  <Button variant="destructive" size="sm" onClick={() => setAutoSend(false)}>
                    <Square className="w-3.5 h-3.5 mr-1.5" />Stop
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: log */}
        <div className="xl:col-span-2 space-y-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-muted-foreground" /> Request Log
                </CardTitle>
                {log.length > 0 && (
                  <button className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => { setLog([]); setTotalSent(0); setTotalSuccess(0); setTotalAlarms(0); }}>
                    Clear
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[480px]">
                {log.length === 0 ? (
                  <div className="px-4 py-10 text-center text-xs text-muted-foreground">No requests yet — pick an asset and send</div>
                ) : (
                  log.map(entry => (
                    <div key={entry.id} className={cn("border-b border-border/50 px-3 py-2 text-xs flex items-center gap-2",
                      entry.status === "error" ? "bg-red-50/30 dark:bg-red-950/20" : "")}>
                      {entry.status === "success"
                        ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-500" />
                        : <XCircle    className="w-3.5 h-3.5 shrink-0 text-red-500" />}
                      <span className="font-mono text-muted-foreground shrink-0">{format(entry.ts, "HH:mm:ss.SSS")}</span>
                      <span className="font-medium truncate flex-1">{entry.assetName}</span>
                      <span className="font-mono text-primary shrink-0">{Object.keys(entry.metrics).length}M</span>
                      {entry.alarmEvents.filter(e => e.event === "triggered").length > 0 && (
                        <span className="text-orange-500 flex items-center gap-0.5 shrink-0">
                          <Bell className="w-3 h-3" />{entry.alarmEvents.filter(e => e.event === "triggered").length}
                        </span>
                      )}
                      <span className="text-muted-foreground shrink-0">{entry.durationMs}ms</span>
                      <Badge variant={entry.status === "success" ? "outline" : "destructive"} className="text-xs h-4 px-1 shrink-0">
                        {entry.status}
                      </Badge>
                    </div>
                  ))
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Trend chart */}
      {chartData.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-0 pt-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
                Live Trend
                {autoSend && <span className="text-xs text-primary font-normal flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />Streaming</span>}
              </CardTitle>
              <div className="flex items-center gap-2">
                {metricNames.map((k, i) => (
                  <button key={k} onClick={() => setHiddenLines(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; })}
                    className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-all",
                      hiddenLines.has(k) ? "border-border/40 text-muted-foreground/50 bg-muted/20 line-through" : "border-border text-foreground bg-muted/40")}>
                    <span className="w-2 h-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    {k}
                  </button>
                ))}
                <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setChartData([])}>Clear</button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-3">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={50} />
                <Tooltip content={<ChartTooltip />} />
                {metricNames.map((k, i) => (
                  <Line key={k} type="monotone" dataKey={k} stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={hiddenLines.has(k) ? 0 : 2} dot={false}
                    activeDot={hiddenLines.has(k) ? false : { r: 3, strokeWidth: 0 }}
                    isAnimationActive={false} hide={hiddenLines.has(k)} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── CSV Upload sender ─────────────────────────────────────────────────────────
// Parse a CSV file and push each row as a telemetry payload. deviceId is taken
// from the selected asset's identifier (guaranteeing the match) or a deviceId
// column in the file. Stream (one row per interval) or bulk (all at once).

// Minimal CSV parser with quoted-field support.
function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') q = true;
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseLine(l);
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = cells[i] ?? ""; });
    return o;
  });
  return { headers, rows };
}

function coerceCell(raw: string): number | string | null {
  const v = raw.trim();
  if (v === "") return null;
  const n = Number(v);
  return !isNaN(n) && /^-?\d*\.?\d+(e-?\d+)?$/i.test(v) ? n : v;
}

function CsvUploader() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: assetsData } = useListAssets();
  const allAssets = (assetsData as any[] | undefined) ?? [];
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [deviceCol, setDeviceCol] = useState("");      // CSV column used as deviceId (if no asset chosen)
  const [useNow, setUseNow] = useState(true);          // timestamp: now vs CSV timestamp column
  const [mode, setMode] = useState<"stream" | "bulk">("stream");
  const [intervalSecs, setIntervalSecs] = useState(10);

  const [pushing, setPushing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: number; fail: number } | null>(null);
  const stopRef = useRef(false);

  const selectedAsset = allAssets.find((a: any) => a.id === selectedAssetId);
  const hasTsCol = headers.some((h) => h.toLowerCase() === "timestamp");

  function onFile(file: File) {
    setParseError(null); setResult(null); setProgress(0);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: hs, rows: rs } = parseCsvText(String(reader.result ?? ""));
      if (hs.length === 0) { setParseError("CSV is empty or has no header row."); return; }
      setHeaders(hs); setRows(rs); setFileName(file.name);
      const guess = hs.find((h) => /^device[_ ]?id$/i.test(h)) ?? "";
      setDeviceCol(guess);
    };
    reader.onerror = () => setParseError("Could not read the file.");
    reader.readAsText(file);
  }

  function resolveDeviceId(row: Record<string, string>): string {
    if (selectedAsset) return selectedAsset.identifier || selectedAsset.id;
    return deviceCol ? (row[deviceCol] ?? "").trim() : "";
  }

  function buildPayload(row: Record<string, string>): Record<string, any> | null {
    const deviceId = resolveDeviceId(row);
    if (!deviceId) return null;
    const timestamp = (!useNow && row["timestamp"]) ? row["timestamp"] : new Date().toISOString();
    const payload: Record<string, any> = { deviceId, timestamp };
    for (const h of headers) {
      if (h === deviceCol || h.toLowerCase() === "timestamp") continue;
      const v = coerceCell(row[h] ?? "");
      if (v !== null) payload[h] = v;
    }
    return payload;
  }

  const metricCols = headers.filter((h) => h !== deviceCol && h.toLowerCase() !== "timestamp");

  async function pushAll() {
    if (rows.length === 0) return;
    if (!selectedAsset && !deviceCol) {
      toast({ title: "Choose a target asset or a deviceId column", variant: "destructive" });
      return;
    }
    setPushing(true); setResult(null); setProgress(0); stopRef.current = false;
    let ok = 0, fail = 0;
    for (let i = 0; i < rows.length; i++) {
      if (stopRef.current) break;
      const payload = buildPayload(rows[i]);
      if (!payload) { fail++; setProgress(i + 1); continue; }
      try {
        const res = await fetch("/api/ingest/payload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
      setProgress(i + 1);
      if (mode === "stream") {
        qc.invalidateQueries({ queryKey: getGetRecentTelemetryQueryKey({ limit: 12 }) });
        if (i < rows.length - 1) await new Promise((r) => setTimeout(r, intervalSecs * 1000));
      }
    }
    qc.invalidateQueries({ queryKey: getGetRecentTelemetryQueryKey({ limit: 12 }) });
    setResult({ ok, fail });
    setPushing(false);
    toast({ title: `Pushed ${ok} row${ok !== 1 ? "s" : ""}${fail ? `, ${fail} failed` : ""}`, variant: fail ? "destructive" : undefined });
  }

  return (
    <div className="space-y-4">
      {/* Upload card */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" /> Choose CSV file
            </Button>
            {fileName
              ? <span className="text-sm text-muted-foreground flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" />{fileName} · <span className="font-medium text-foreground">{rows.length}</span> rows</span>
              : <span className="text-sm text-muted-foreground">No file selected — CSV with a header row.</span>}
          </div>
          {parseError && <p className="text-xs text-destructive flex items-center gap-1.5"><XCircle className="w-3 h-3" />{parseError}</p>}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <>
          {/* Config card */}
          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-4">
              {/* Target asset */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Target Asset (its identifier becomes the deviceId)</Label>
                <select value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">— use deviceId column from CSV —</option>
                  {allAssets.map((a: any) => (
                    <option key={a.id} value={a.id}>{a.name}{a.identifier ? ` (${a.identifier})` : ""}</option>
                  ))}
                </select>
                {selectedAsset ? (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Every row sent with <code className="bg-muted px-1 rounded font-mono">deviceId: "{selectedAsset.identifier || selectedAsset.id}"</code> → links to this asset.
                  </p>
                ) : (
                  <div className="flex items-center gap-2 mt-2">
                    <Label className="text-xs text-muted-foreground">deviceId column:</Label>
                    <select value={deviceCol} onChange={(e) => setDeviceCol(e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                      <option value="">— none —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    {!deviceCol && <span className="text-xs text-amber-600 dark:text-amber-400">Pick an asset or a deviceId column.</span>}
                  </div>
                )}
              </div>

              {/* Detected columns */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Metric columns ({metricCols.length})</Label>
                <div className="flex flex-wrap gap-1.5">
                  {metricCols.map((h) => (
                    <span key={h} className="text-xs font-mono bg-muted/60 border border-border/60 rounded px-1.5 py-0.5">{h}</span>
                  ))}
                  {hasTsCol && <span className="text-xs font-mono bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5">timestamp</span>}
                </div>
              </div>

              {/* Mode + interval + timestamp */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-1 p-1 rounded-md" style={{ background: "hsl(var(--muted))" }}>
                  <button onClick={() => setMode("stream")} disabled={pushing}
                    className={cn("px-3 py-1 rounded text-xs font-medium transition-all", mode === "stream" ? "bg-background shadow-sm" : "text-muted-foreground")}>
                    Stream (1 row / {intervalSecs}s)
                  </button>
                  <button onClick={() => setMode("bulk")} disabled={pushing}
                    className={cn("px-3 py-1 rounded text-xs font-medium transition-all", mode === "bulk" ? "bg-background shadow-sm" : "text-muted-foreground")}>
                    Bulk (all at once)
                  </button>
                </div>
                {mode === "stream" && (
                  <div className="flex items-center gap-2 flex-1 min-w-40">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <Slider value={[intervalSecs]} onValueChange={([v]) => setIntervalSecs(v)} min={1} max={60} step={1} disabled={pushing} className="flex-1 max-w-48" />
                    <span className="text-xs text-muted-foreground w-10 text-right">{intervalSecs}s</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Switch checked={useNow} onCheckedChange={setUseNow} id="csv-use-now" disabled={pushing} />
                  <Label htmlFor="csv-use-now" className="text-xs cursor-pointer select-none">
                    {useNow ? "Timestamp = now" : hasTsCol ? "Use CSV timestamp" : "Timestamp = now (no ts column)"}
                  </Label>
                </div>
              </div>

              {/* Push controls */}
              <div className="flex items-center gap-3 flex-wrap">
                {!pushing ? (
                  <Button onClick={pushAll} disabled={rows.length === 0}>
                    <Send className="w-4 h-4 mr-2" /> Push {rows.length} row{rows.length !== 1 ? "s" : ""}
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={() => { stopRef.current = true; }}>
                    <Square className="w-4 h-4 mr-2" /> Stop
                  </Button>
                )}
                {(pushing || result) && (
                  <div className="flex items-center gap-2 flex-1 min-w-48">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${(progress / rows.length) * 100}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">{progress}/{rows.length}</span>
                  </div>
                )}
                {result && (
                  <span className="text-xs flex items-center gap-2">
                    <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{result.ok}</span>
                    {result.fail > 0 && <span className="text-red-500 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{result.fail}</span>}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Preview table */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview (first 5 rows)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      {headers.map((h) => (
                        <th key={h} className={cn("text-left px-3 py-2 font-medium whitespace-nowrap",
                          h === deviceCol ? "text-primary" : "text-muted-foreground")}>
                          {h}{h === deviceCol ? " (deviceId)" : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-b border-border/50">
                        {headers.map((h) => <td key={h} className="px-3 py-1.5 font-mono whitespace-nowrap">{r[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
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
    const payload = selectedPreset.buildPayload
      ? selectedPreset.buildPayload(currentMetrics)
      : { deviceId: selectedPreset.deviceId, timestamp: new Date().toISOString(), metrics: currentMetrics };
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
        // Fire validate + ingest in parallel
        const [ingestRes, validateRes] = await Promise.all([
          fetch("/api/ingest/payload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }),
          fetch("/api/ingest/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }),
        ]);

        const [data, validateData] = await Promise.all([
          ingestRes.json(),
          validateRes.json(),
        ]);

        const durationMs = Math.round(performance.now() - start);
        const alarmEvents: AlarmEvent[] = data?.alarmEvents ?? [];
        const newlyTriggered = alarmEvents.filter((e: AlarmEvent) => e.event === "triggered");

        const entry: LogEntry = {
          id: crypto.randomUUID(),
          ts: new Date(),
          preset: selectedPreset.label,
          payload,
          status: ingestRes.ok ? "success" : "error",
          response: data,
          validateResult: validateRes.ok ? (validateData as ValidateResult) : null,
          durationMs,
          alarmEvents,
        };

        setLog((l) => [entry, ...l].slice(0, 100));
        setTotalSent((n) => n + 1);
        if (ingestRes.ok) {
          setTotalSuccess((n) => n + 1);
          const rawPayload = payload as any;
          const chartMetrics = metricsForChart ?? rawPayload.metrics ?? rawPayload.data;
          if (chartMetrics && typeof chartMetrics === "object") {
            addChartPoint(chartMetrics as Record<string, number>);
          }
          if (newlyTriggered.length > 0) {
            setTotalAlarmsTriggered((n) => n + newlyTriggered.length);
            newlyTriggered.slice(0, 3).forEach((ae: AlarmEvent) => {
              toast({
                title: `🔔 Alarm triggered: ${ae.ruleName}`,
                description: `${ae.metric} ${ae.operator} ${ae.threshold} — current value: ${ae.value} (${ae.severity})`,
                variant: "destructive",
              });
            });
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
          validateResult: null,
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
      const payload = selectedPreset.buildPayload
        ? selectedPreset.buildPayload(newMetrics)
        : { deviceId: selectedPreset.deviceId, timestamp: new Date().toISOString(), metrics: newMetrics };
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

  const [simMode, setSimMode] = useState<"presets" | "custom" | "csv">("presets");

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
            Send test payloads to the ingest API and watch telemetry update live
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

      {/* ── Mode switcher ── */}
      <div className="flex items-center gap-1 p-1 rounded-lg w-fit" style={{ background: "hsl(var(--muted))" }}>
        <button
          onClick={() => { setSimMode("presets"); setAutoSend(false); }}
          className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all",
            simMode === "presets" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          <Zap className="w-3.5 h-3.5" /> Device Presets
        </button>
        <button
          onClick={() => { setSimMode("custom"); setAutoSend(false); }}
          className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all",
            simMode === "custom" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          <Package className="w-3.5 h-3.5" /> Custom Asset
        </button>
        <button
          onClick={() => { setSimMode("csv"); setAutoSend(false); }}
          className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all",
            simMode === "csv" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" /> CSV Upload
        </button>
      </div>

      {simMode === "custom" && <CustomAssetSender />}
      {simMode === "csv" && <CsvUploader />}

      {simMode === "presets" && (<>
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

      {/* ── Payload History ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-primary" />
              Payload History
              {log.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal">— last {log.length} sends</span>
              )}
            </CardTitle>
            <div className="flex items-center gap-3">
              {/* Format legend */}
              <div className="hidden sm:flex items-center gap-2">
                {(["flat", "nested-data", "nested-metrics"] as const).map((f) => (
                  <FormatBadge key={f} fmt={f} />
                ))}
              </div>
              {log.length > 0 && (
                <button
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => { setLog([]); setTotalSent(0); setTotalSuccess(0); setTotalAlarmsTriggered(0); }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {log.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              No payloads sent yet — press <span className="font-medium text-foreground">Send Once</span> or enable <span className="font-medium text-foreground">Auto-send</span>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50 sticky top-0 z-10">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">Time</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Preset / Device</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-32">Format</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-16">Metrics</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-36">Asset</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-20">Written</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-20">Alarms</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-16">Dur.</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-16">Status</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((entry) => {
                    const vr = entry.validateResult;
                    const resp = entry.response as any;
                    const triggered = entry.alarmEvents.filter((e) => e.event === "triggered");
                    const cleared   = entry.alarmEvents.filter((e) => e.event === "cleared");
                    return (
                      <HistoryRow key={entry.id} entry={entry} vr={vr} resp={resp} triggered={triggered} cleared={cleared} />
                    );
                  })}
                </tbody>
              </table>
            </div>
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
            Use these snippets to integrate any device or gateway via HTTP POST.
            Batch endpoint: <code className="bg-muted px-1 py-0.5 rounded font-mono">POST /api/ingest/batch</code>
          </p>
          <Tabs defaultValue="single">
            <TabsList className="h-7">
              <TabsTrigger value="single" className="text-xs h-6 px-3">Single Payload</TabsTrigger>
              <TabsTrigger value="batch" className="text-xs h-6 px-3">Batch Payload</TabsTrigger>
              <TabsTrigger value="python" className="text-xs h-6 px-3">Python</TabsTrigger>
              <TabsTrigger value="curl" className="text-xs h-6 px-3">curl</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="mt-3">
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto leading-relaxed">{`POST /api/ingest/payload
Content-Type: application/json

{
  "deviceId": "my-device-01",
  "timestamp": "2025-05-03T10:30:00+05:30",
  "chiller":  { "energy_kWh": 15.2, "load_percent": 82 },
  "solar":    { "generated_kWh": 8.3, "irradiance_Wm2": 750 }
}`}</pre>
            </TabsContent>

            <TabsContent value="batch" className="mt-3">
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto leading-relaxed">{`POST /api/ingest/batch
Content-Type: application/json

[
  {
    "deviceId": "gateway-01",
    "timestamp": "2025-05-03T10:30:00Z",
    "metrics": { "energy_kwh": 145.7, "temperature": 72.4 }
  },
  {
    "deviceId": "gateway-02",
    "timestamp": "2025-05-03T10:30:00Z",
    "metrics": { "pressure": 12.3, "flow_rate": 5.1 }
  }
]`}</pre>
            </TabsContent>

            <TabsContent value="python" className="mt-3">
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto leading-relaxed">{`import requests, datetime

INGEST_URL = "https://your-domain/api/ingest/payload"

payload = {
    "deviceId": "my-device-01",
    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "chiller":  { "energy_kWh": 15.2, "load_percent": 82 },
    "solar":    { "generated_kWh": 8.3, "irradiance_Wm2": 750 },
}

# Optional: authenticate with an API client token
headers = {
    "Content-Type": "application/json",
    # "Authorization": "Bearer YOUR_API_CLIENT_SECRET",
}

resp = requests.post(INGEST_URL, json=payload, headers=headers)
print(resp.json())`}</pre>
            </TabsContent>

            <TabsContent value="curl" className="mt-3">
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto leading-relaxed">{`# Single payload (nested sub-systems format)
curl -s -X POST /api/ingest/payload \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceId": "my-device-01",
    "chiller":  { "energy_kWh": 15.2, "load_percent": 82 },
    "solar":    { "generated_kWh": 8.3 }
  }' | jq

# With authentication token (from Security → API Clients)
curl -s -X POST /api/ingest/payload \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{"deviceId":"my-device-01","metrics":{"temperature":72.4}}' | jq`}</pre>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      </>)}
    </div>
  );
}
