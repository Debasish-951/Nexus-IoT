import { useState, useEffect, useCallback, useRef } from "react";
import { useGetDashboardSummary, useGetRecentTelemetry, useGetAlarmStats, useListAssets } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetRecentTelemetryQueryKey, getGetDashboardSummaryQueryKey, getGetAlarmStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  Blocks, Bell, Wifi, Users, Activity, Clock, TrendingUp, AlertTriangle,
  CheckCircle2, AlertCircle, Minus, RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useWsEvents } from "@/hooks/useWsEvents";

interface TelemetryEvent {
  assetId: string;
  assetName: string;
  metrics: Record<string, unknown>;
  timestamp: string;
}

interface LiveReading {
  id: string;
  assetId: string;
  deviceId: string;
  metric: string;
  value: unknown;
  timestamp: string;
}

function StatCard({ icon: Icon, label, value, sub, color = "text-primary", loading }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
  color?: string; loading?: boolean;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">{label}</p>
            {loading ? <Skeleton className="h-7 w-16 mt-1" /> : <p className="text-2xl font-bold">{value}</p>}
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={cn("p-2 rounded-lg bg-primary/10", color)}><Icon className="w-4 h-4" /></div>
        </div>
      </CardContent>
    </Card>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#22c55e", info: "#3b82f6",
};

// ── Asset Health Card ─────────────────────────────────────────────────────────
interface AssetHealth {
  assetId: string; assetName: string; health: "ok" | "alarm" | "stale";
  freshnessPct: number | null; activeAlarms: number;
  lastSeen: string | null; totalAttributes: number;
  dynamicAttributes: number; freshAttributes: number;
  keyMetrics: Array<{ name: string; value: unknown; uom: string | null; quality: string | null; timestamp: string | null }>;
}

function HealthBadge({ health }: { health: string }) {
  if (health === "ok")    return <span className="flex items-center gap-1 text-xs font-medium text-green-600"><CheckCircle2 className="w-3.5 h-3.5" />Healthy</span>;
  if (health === "alarm") return <span className="flex items-center gap-1 text-xs font-medium text-red-500"><AlertCircle className="w-3.5 h-3.5" />Alarm</span>;
  return <span className="flex items-center gap-1 text-xs font-medium text-yellow-600"><Minus className="w-3.5 h-3.5" />Stale</span>;
}

function AssetHealthCard({ assetId, assetName, triggerRefresh }: { assetId: string; assetName: string; triggerRefresh?: number }) {
  const [health, setHealth] = useState<AssetHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`/api/assets/${assetId}/health`);
      if (res.ok) setHealth(await res.json());
    } finally { setLoading(false); }
  }, [assetId]);

  useEffect(() => {
    fetchHealth();
    const iv = setInterval(fetchHealth, 30_000);
    return () => clearInterval(iv);
  }, [fetchHealth]);

  useEffect(() => {
    if (triggerRefresh) fetchHealth();
  }, [triggerRefresh, fetchHealth]);

  const borderColor = health?.health === "ok" ? "border-green-200 dark:border-green-900"
    : health?.health === "alarm" ? "border-red-200 dark:border-red-900"
    : "border-yellow-200 dark:border-yellow-900";

  return (
    <Card className={cn("shadow-sm border-l-2", borderColor)}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{assetName}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{assetId.slice(0, 8)}…</p>
          </div>
          {loading ? <Skeleton className="h-4 w-16" /> : health ? <HealthBadge health={health.health} /> : null}
        </div>

        {loading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : health ? (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>
                {health.activeAlarms > 0
                  ? <span className="text-red-500 font-medium">{health.activeAlarms} active alarm{health.activeAlarms !== 1 ? "s" : ""}</span>
                  : "No active alarms"}
              </span>
              {health.freshnessPct !== null && (
                <span>{health.freshnessPct}% fresh</span>
              )}
            </div>
            {health.lastSeen && (
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(health.lastSeen), { addSuffix: true })}
              </p>
            )}
            {health.keyMetrics.length > 0 && (
              <div className="grid grid-cols-2 gap-1">
                {health.keyMetrics.slice(0, 4).map((m) => (
                  <div key={m.name} className="bg-muted/50 rounded px-1.5 py-1">
                    <p className="text-xs text-muted-foreground truncate">{m.name}</p>
                    <p className="text-xs font-mono font-medium truncate">
                      {m.value != null ? String(typeof m.value === "object" ? JSON.stringify(m.value) : m.value) : "—"}
                      {m.uom && <span className="text-muted-foreground ml-0.5">{m.uom}</span>}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const qc = useQueryClient();
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [liveReadings, setLiveReadings] = useState<LiveReading[]>([]);
  const [healthRefreshTick, setHealthRefreshTick] = useState(0);
  const liveReadingsRef = useRef<LiveReading[]>([]);

  const { data: summary } = useGetDashboardSummary();
  const { data: recentTelemetry } = useGetRecentTelemetry({ limit: 15 });
  const { data: alarmStats } = useGetAlarmStats();
  const { data: assets } = useListAssets();

  const handleTelemetry = useCallback((raw: unknown) => {
    const event = raw as TelemetryEvent;
    setLastRefresh(new Date());

    const newReadings: LiveReading[] = Object.entries(event.metrics).map(([metric, value]) => ({
      id: `${event.assetId}-${metric}-${Date.now()}`,
      assetId: event.assetId,
      deviceId: event.assetName,
      metric,
      value,
      timestamp: event.timestamp,
    }));

    liveReadingsRef.current = [...newReadings, ...liveReadingsRef.current].slice(0, 15);
    setLiveReadings([...liveReadingsRef.current]);
    setHealthRefreshTick((t) => t + 1);

    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetAlarmStatsQueryKey() });
  }, [qc]);

  const handleBrokerStatus = useCallback(() => {
    setLastRefresh(new Date());
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }, [qc]);

  const wsStatus = useWsEvents({ telemetry: handleTelemetry, broker_status: handleBrokerStatus });

  const alarmChartData = alarmStats ? [
    { name: "Critical", count: (alarmStats as any).critical ?? 0, fill: SEVERITY_COLORS.critical },
    { name: "High",     count: (alarmStats as any).high     ?? 0, fill: SEVERITY_COLORS.high },
    { name: "Medium",   count: (alarmStats as any).medium   ?? 0, fill: SEVERITY_COLORS.medium },
    { name: "Low",      count: (alarmStats as any).low      ?? 0, fill: SEVERITY_COLORS.low },
    { name: "Info",     count: (alarmStats as any).info     ?? 0, fill: SEVERITY_COLORS.info },
  ] : [];

  const s = summary as any;
  const storedTelemetry = recentTelemetry as any[] | undefined;
  const assetList = (assets as any[] | undefined) ?? [];

  const displayTelemetry = liveReadings.length > 0 ? liveReadings : (storedTelemetry ?? []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">System overview and real-time status</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
            wsStatus === "connected"
              ? "bg-green-50 text-green-700 border-green-200"
              : wsStatus === "reconnecting"
              ? "bg-yellow-50 text-yellow-700 border-yellow-200"
              : "bg-muted text-muted-foreground border-border",
          )}>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              wsStatus === "connected" ? "bg-green-500 animate-pulse" :
              wsStatus === "reconnecting" ? "bg-yellow-500" : "bg-gray-400",
            )} />
            {wsStatus === "connected" ? "Live" : wsStatus === "reconnecting" ? "Reconnecting…" : "Connecting…"}
          </span>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="w-3 h-3" />
            Updated {format(lastRefresh, "HH:mm:ss")}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard icon={Blocks} label="Total Assets"    value={s?.totalAssets ?? 0} loading={!s} color="text-primary" />
        <StatCard icon={Bell}   label="Active Alarms"   value={s?.activeAlarms ?? 0} sub={`${s?.criticalAlarms ?? 0} critical`} loading={!s} color="text-destructive" />
        <StatCard icon={AlertTriangle} label="Critical" value={s?.criticalAlarms ?? 0} loading={!s} color="text-destructive" />
        <StatCard icon={Wifi}   label="Brokers"         value={s?.connectedBrokers ?? 0} sub="connected" loading={!s} color="text-chart-2" />
        <StatCard icon={Users}  label="Users"           value={s?.totalUsers ?? 0} loading={!s} color="text-chart-5" />
        <StatCard icon={TrendingUp} label="Telemetry Rate" value={`${((s?.telemetryRate as number) ?? 0).toFixed(1)}/min`} loading={!s} color="text-chart-3" />
      </div>

      {/* Asset Health Grid */}
      {assetList.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Blocks className="w-4 h-4 text-primary" /> Asset Health
            </h2>
            <span className="text-xs text-muted-foreground">Updates on new telemetry</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {assetList.map((a: any) => (
              <AssetHealthCard
                key={a.id}
                assetId={a.id}
                assetName={a.name}
                triggerRefresh={healthRefreshTick}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Recent Telemetry */}
        <Card className="lg:col-span-3 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Recent Telemetry
              {liveReadings.length > 0 && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                  live
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-auto max-h-72">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Device</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Metric</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Value</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {!storedTelemetry && liveReadings.length === 0
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          {[20, 24, 12, 20].map((w, j) => <td key={j} className="px-4 py-2"><Skeleton className={`h-3 w-${w}`} /></td>)}
                        </tr>
                      ))
                    : displayTelemetry.length === 0
                    ? (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No telemetry data yet</td></tr>
                      )
                    : displayTelemetry.map((rec: any, idx: number) => (
                        <tr key={rec.id ?? idx} className={cn(
                          "border-b border-border/50 hover:bg-muted/30 transition-colors",
                          liveReadings.some((l) => l.id === rec.id) && "bg-green-50/60",
                        )}>
                          <td className="px-4 py-2 font-mono text-xs text-foreground/70">{rec.deviceId ?? String(rec.assetId ?? "").slice(0, 8)}</td>
                          <td className="px-4 py-2 font-medium">{rec.metric}</td>
                          <td className="px-4 py-2 font-mono">{typeof rec.value === "object" ? JSON.stringify(rec.value) : String(rec.value ?? "-")}</td>
                          <td className="px-4 py-2 text-muted-foreground">{format(new Date(rec.timestamp), "HH:mm:ss")}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Alarm Stats */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-destructive" /> Active Alarms by Severity
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {!alarmStats ? <Skeleton className="h-40 w-full" /> : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={alarmChartData} barSize={28}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} cursor={{ fill: "rgba(0,0,0,0.05)" }} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {alarmChartData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {s?.lastIngestionAt && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          Last ingestion: {format(new Date(s.lastIngestionAt), "MMM d, yyyy HH:mm:ss")}
        </p>
      )}
    </div>
  );
}
