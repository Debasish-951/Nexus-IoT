import { useState, useEffect, useCallback, useRef } from "react";
import { useGetDashboardSummary, useGetRecentTelemetry, useGetAlarmStats, useListAssets } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDashboardSummaryQueryKey, getGetAlarmStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Blocks, Bell, Activity, Clock, AlertTriangle,
  CheckCircle2, AlertCircle, Minus, RefreshCw,
  Zap, ShieldAlert, TrendingUp, ArrowRight, Wifi,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useWsEvents } from "@/hooks/useWsEvents";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

interface ActiveAlarm {
  id: string;
  name: string;
  assetName: string;
  severity: string;
  status: string;
  message: string;
  triggeredAt: string;
}

interface AssetHealth {
  assetId: string; assetName: string; health: "ok" | "alarm" | "stale";
  freshnessPct: number | null; activeAlarms: number;
  lastSeen: string | null; totalAttributes: number;
  dynamicAttributes: number; freshAttributes: number;
  keyMetrics: Array<{ name: string; value: unknown; uom: string | null; quality: string | null; timestamp: string | null }>;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEVERITY_STYLES: Record<string, { badge: string; dot: string }> = {
  critical: { badge: "bg-red-100 text-red-700 border-red-200",       dot: "bg-red-500" },
  high:     { badge: "bg-orange-100 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  medium:   { badge: "bg-yellow-100 text-yellow-700 border-yellow-200", dot: "bg-yellow-500" },
  low:      { badge: "bg-green-100 text-green-700 border-green-200",   dot: "bg-green-500" },
  info:     { badge: "bg-blue-100 text-blue-700 border-blue-200",      dot: "bg-blue-500" },
};

// ── Status Banner ─────────────────────────────────────────────────────────────
function StatusBanner({ critical, total, wsStatus }: { critical: number; total: number; wsStatus: string }) {
  const [, navigate] = useLocation();
  if (critical > 0) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              {critical} Critical Alarm{critical !== 1 ? "s" : ""} Active
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {total} total active alarm{total !== 1 ? "s" : ""} — immediate attention required
            </p>
          </div>
        </div>
        <Button size="sm" variant="destructive" className="shrink-0 text-xs h-7 gap-1.5" onClick={() => navigate("/alarms")}>
          View Alarms <ArrowRight className="w-3 h-3" />
        </Button>
      </div>
    );
  }
  if (total > 0) {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-orange-800">{total} Active Alarm{total !== 1 ? "s" : ""}</p>
            <p className="text-xs text-orange-600 mt-0.5">No critical alarms — review and acknowledge pending alarms</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="shrink-0 text-xs h-7 gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-100" onClick={() => navigate("/alarms")}>
          Review <ArrowRight className="w-3 h-3" />
        </Button>
      </div>
    );
  }
  return (
    <div className={cn("rounded-lg border px-4 py-3 flex items-center gap-3",
      wsStatus === "connected" ? "border-green-200 bg-green-50" : "border-border bg-muted/30")}>
      <CheckCircle2 className={cn("w-5 h-5 shrink-0", wsStatus === "connected" ? "text-green-600" : "text-muted-foreground")} />
      <div>
        <p className={cn("text-sm font-semibold", wsStatus === "connected" ? "text-green-800" : "text-foreground")}>
          All Systems Operational
        </p>
        <p className={cn("text-xs mt-0.5", wsStatus === "connected" ? "text-green-600" : "text-muted-foreground")}>
          No active alarms · {wsStatus === "connected" ? "Live data connected" : "Connecting to live feed…"}
        </p>
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, variant = "default", loading, onClick }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
  variant?: "default" | "danger" | "warning" | "success" | "neutral";
  loading?: boolean; onClick?: () => void;
}) {
  const styles = {
    default: { card: "", icon: "text-primary bg-primary/10", value: "" },
    danger:  { card: "border-red-200 bg-red-50/30", icon: "text-red-600 bg-red-100", value: "text-red-700" },
    warning: { card: "border-orange-200 bg-orange-50/30", icon: "text-orange-600 bg-orange-100", value: "text-orange-700" },
    success: { card: "border-green-200 bg-green-50/30", icon: "text-green-600 bg-green-100", value: "" },
    neutral: { card: "", icon: "text-muted-foreground bg-muted", value: "" },
  };
  const s = styles[variant];
  return (
    <Card className={cn("shadow-sm transition-all", s.card, onClick && "cursor-pointer hover:shadow-md")} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">{label}</p>
            {loading ? <Skeleton className="h-7 w-16 mt-1" /> : (
              <p className={cn("text-2xl font-bold tabular-nums", s.value)}>{value}</p>
            )}
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={cn("p-2 rounded-lg shrink-0", s.icon)}><Icon className="w-4 h-4" /></div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Active Alarm Row ──────────────────────────────────────────────────────────
function AlarmRow({ alarm, onAcknowledge }: { alarm: ActiveAlarm; onAcknowledge: (id: string) => void }) {
  const sty = SEVERITY_STYLES[alarm.severity] ?? SEVERITY_STYLES.info;
  return (
    <div className="flex items-center gap-3 py-2.5 px-4 border-b border-border/50 hover:bg-muted/20 transition-colors last:border-0">
      <span className={cn("w-2 h-2 rounded-full shrink-0", sty.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{alarm.name}</span>
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4 border capitalize shrink-0", sty.badge)}>
            {alarm.severity}
          </Badge>
          {alarm.status === "acknowledged" && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">ack'd</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">{alarm.assetName}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(alarm.triggeredAt), { addSuffix: true })}
          </span>
        </div>
        {alarm.message && (
          <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{alarm.message}</p>
        )}
      </div>
      {alarm.status === "active" && (
        <Button size="sm" variant="outline" className="h-6 text-[11px] shrink-0 px-2"
          onClick={() => onAcknowledge(alarm.id)}>
          Ack
        </Button>
      )}
    </div>
  );
}

// ── Asset Health Card ─────────────────────────────────────────────────────────
function HealthBadge({ health }: { health: string }) {
  if (health === "ok")    return <span className="flex items-center gap-1 text-xs font-medium text-green-600"><CheckCircle2 className="w-3.5 h-3.5" />Healthy</span>;
  if (health === "alarm") return <span className="flex items-center gap-1 text-xs font-medium text-red-500"><AlertCircle className="w-3.5 h-3.5" />Alarm</span>;
  return <span className="flex items-center gap-1 text-xs font-medium text-yellow-600"><Minus className="w-3.5 h-3.5" />Stale</span>;
}

function AssetHealthCard({ assetId, assetName, triggerRefresh }: { assetId: string; assetName: string; triggerRefresh?: number }) {
  const [health, setHealth] = useState<AssetHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [, navigate] = useLocation();

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/assets/${assetId}/health`);
      if (res.ok) setHealth(await res.json());
    } finally { setLoading(false); }
  }, [assetId]);

  useEffect(() => {
    fetchHealth();
    const iv = setInterval(fetchHealth, 30_000);
    return () => clearInterval(iv);
  }, [fetchHealth]);

  useEffect(() => { if (triggerRefresh) fetchHealth(); }, [triggerRefresh, fetchHealth]);

  const borderColor = health?.health === "ok" ? "border-l-green-400"
    : health?.health === "alarm" ? "border-l-red-400"
    : "border-l-yellow-400";

  return (
    <Card className={cn("shadow-sm border-l-2 cursor-pointer hover:shadow-md transition-all", borderColor)}
      onClick={() => navigate("/assets")}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between mb-1.5">
          <p className="text-sm font-semibold truncate flex-1 pr-2">{assetName}</p>
          {loading ? <Skeleton className="h-4 w-16 shrink-0" /> : health ? <HealthBadge health={health.health} /> : null}
        </div>

        {loading ? (
          <div className="space-y-1.5 mt-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : health ? (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>
                {health.activeAlarms > 0
                  ? <span className="text-red-500 font-medium">{health.activeAlarms} alarm{health.activeAlarms !== 1 ? "s" : ""}</span>
                  : <span className="text-green-600">No alarms</span>}
              </span>
              {health.freshnessPct !== null && (
                <span className={cn(health.freshnessPct < 50 ? "text-yellow-600" : "text-muted-foreground")}>
                  {health.freshnessPct}% fresh
                </span>
              )}
            </div>
            {health.lastSeen && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
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
  const [, navigate] = useLocation();
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [liveReadings, setLiveReadings] = useState<LiveReading[]>([]);
  const [healthRefreshTick, setHealthRefreshTick] = useState(0);
  const [activeAlarms, setActiveAlarms] = useState<ActiveAlarm[]>([]);
  const [alarmsLoading, setAlarmsLoading] = useState(true);
  const liveReadingsRef = useRef<LiveReading[]>([]);

  const { data: summary } = useGetDashboardSummary();
  const { data: recentTelemetry } = useGetRecentTelemetry({ limit: 12 });
  const { data: assets } = useListAssets();

  const s = summary as any;
  const assetList = (assets as any[] | undefined) ?? [];
  const storedTelemetry = recentTelemetry as any[] | undefined;

  // Fetch active alarms directly
  const fetchAlarms = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/alarms?limit=20`);
      if (res.ok) {
        const data: ActiveAlarm[] = await res.json();
        const sorted = data
          .filter((a) => a.status === "active" || a.status === "acknowledged")
          .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
        setActiveAlarms(sorted);
      }
    } finally { setAlarmsLoading(false); }
  }, []);

  useEffect(() => {
    fetchAlarms();
    const iv = setInterval(fetchAlarms, 30_000);
    return () => clearInterval(iv);
  }, [fetchAlarms]);

  async function acknowledgeAlarm(id: string) {
    await fetch(`${BASE}/api/alarms/${id}/acknowledge`, { method: "POST" });
    fetchAlarms();
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }

  const handleTelemetry = useCallback((raw: unknown) => {
    const event = raw as TelemetryEvent;
    setLastRefresh(new Date());
    const newReadings: LiveReading[] = Object.entries(event.metrics).map(([metric, value]) => ({
      id: `${event.assetId}-${metric}-${Date.now()}`,
      assetId: event.assetId,
      deviceId: event.assetName,
      metric, value,
      timestamp: event.timestamp,
    }));
    liveReadingsRef.current = [...newReadings, ...liveReadingsRef.current].slice(0, 12);
    setLiveReadings([...liveReadingsRef.current]);
    setHealthRefreshTick((t) => t + 1);
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }, [qc]);

  const handleAlarm = useCallback(() => {
    fetchAlarms();
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetAlarmStatsQueryKey() });
  }, [fetchAlarms, qc]);

  const handleBrokerStatus = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }, [qc]);

  const wsStatus = useWsEvents({ telemetry: handleTelemetry, alarm: handleAlarm, broker_status: handleBrokerStatus });

  const criticalAlarms = activeAlarms.filter((a) => a.severity === "critical" && a.status === "active");
  const totalActive = activeAlarms.filter((a) => a.status === "active").length;
  const assetsInAlarm = [...new Set(activeAlarms.filter(a => a.status === "active").map(a => a.assetName))].length;
  const displayTelemetry = liveReadings.length > 0 ? liveReadings : (storedTelemetry ?? []);

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Operations Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time status · what is happening right now</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
            wsStatus === "connected" ? "bg-green-50 text-green-700 border-green-200"
              : wsStatus === "reconnecting" ? "bg-yellow-50 text-yellow-700 border-yellow-200"
              : "bg-muted text-muted-foreground border-border",
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full",
              wsStatus === "connected" ? "bg-green-500 animate-pulse" :
              wsStatus === "reconnecting" ? "bg-yellow-500" : "bg-gray-400")} />
            {wsStatus === "connected" ? "● Live" : wsStatus === "reconnecting" ? "Reconnecting…" : "Connecting…"}
          </span>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="w-3 h-3" />
            {format(lastRefresh, "HH:mm:ss")}
          </div>
        </div>
      </div>

      {/* ── Status Banner ────────────────────────────────────────────────── */}
      <StatusBanner critical={criticalAlarms.length} total={totalActive} wsStatus={wsStatus} />

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={ShieldAlert}
          label="Critical Alarms"
          value={s?.criticalAlarms ?? 0}
          sub="require immediate action"
          variant={s?.criticalAlarms > 0 ? "danger" : "success"}
          loading={!s}
          onClick={() => navigate("/alarms")}
        />
        <KpiCard
          icon={Bell}
          label="Active Alarms"
          value={totalActive}
          sub={`${assetsInAlarm} asset${assetsInAlarm !== 1 ? "s" : ""} affected`}
          variant={totalActive > 0 ? "warning" : "success"}
          loading={alarmsLoading}
          onClick={() => navigate("/alarms")}
        />
        <KpiCard
          icon={Blocks}
          label="Assets Monitored"
          value={s?.totalAssets ?? 0}
          sub={`${assetsInAlarm} in alarm state`}
          variant="default"
          loading={!s}
          onClick={() => navigate("/assets")}
        />
        <KpiCard
          icon={Zap}
          label="Ingest Rate"
          value={`${((s?.telemetryRate as number) ?? 0).toFixed(1)}/min`}
          sub={s?.connectedBrokers ? `${s.connectedBrokers} broker${s.connectedBrokers !== 1 ? "s" : ""} connected` : "no brokers"}
          variant={s?.connectedBrokers > 0 ? "default" : "neutral"}
          loading={!s}
        />
      </div>

      {/* ── Active Alarms + Live Feed ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Active Alarms panel */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="pb-0 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Bell className="w-4 h-4 text-destructive" />
                Active Alarms
                {totalActive > 0 && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                    {totalActive}
                  </span>
                )}
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground px-2"
                onClick={() => navigate("/alarms")}>
                All <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 mt-3">
            {alarmsLoading ? (
              <div className="space-y-0 px-4 pb-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="py-2.5 border-b border-border/50"><Skeleton className="h-4 w-full mb-1.5" /><Skeleton className="h-3 w-2/3" /></div>)}
              </div>
            ) : activeAlarms.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-green-700">No active alarms</p>
                <p className="text-xs text-muted-foreground mt-1">All systems are within normal operating parameters</p>
              </div>
            ) : (
              <div className="max-h-72 overflow-auto">
                {activeAlarms.slice(0, 8).map((alarm) => (
                  <AlarmRow key={alarm.id} alarm={alarm} onAcknowledge={acknowledgeAlarm} />
                ))}
                {activeAlarms.length > 8 && (
                  <button className="w-full text-xs text-muted-foreground hover:text-foreground py-2.5 text-center border-t border-border hover:bg-muted/30 transition-colors"
                    onClick={() => navigate("/alarms")}>
                    +{activeAlarms.length - 8} more alarms → View all
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live Telemetry Feed */}
        <Card className="lg:col-span-3 shadow-sm">
          <CardHeader className="pb-0 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Live Data Feed
                {liveReadings.length > 0 && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 animate-pulse">
                    live
                  </span>
                )}
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground px-2"
                onClick={() => navigate("/live")}>
                Full Feed <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0 mt-3">
            <div className="overflow-auto max-h-72">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50 sticky top-0">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Asset</th>
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
                    ? <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No telemetry data yet. Start ingesting data to see it here.</td></tr>
                    : displayTelemetry.map((rec: any, idx: number) => (
                        <tr key={rec.id ?? idx} className={cn(
                          "border-b border-border/50 hover:bg-muted/30 transition-colors",
                          liveReadings.some((l) => l.id === rec.id) && "bg-green-50/60 dark:bg-green-950/20",
                        )}>
                          <td className="px-4 py-2 font-medium text-foreground/80 truncate max-w-[120px]">
                            {rec.deviceId ?? String(rec.assetId ?? "").slice(0, 8)}
                          </td>
                          <td className="px-4 py-2 text-foreground/70 truncate max-w-[120px]">{rec.metric}</td>
                          <td className="px-4 py-2 font-mono font-medium">{typeof rec.value === "object" ? JSON.stringify(rec.value) : String(rec.value ?? "-")}</td>
                          <td className="px-4 py-2 text-muted-foreground">{format(new Date(rec.timestamp), "HH:mm:ss")}</td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Asset Health Grid ─────────────────────────────────────────────── */}
      {assetList.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Asset Health Overview
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground hidden sm:block">Click an asset to view details</span>
              <span className="text-xs text-muted-foreground">Updates on new telemetry</span>
            </div>
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

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      {s?.lastIngestionAt && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Wifi className="w-3 h-3" />
          Last ingestion: {format(new Date(s.lastIngestionAt), "MMM d, yyyy HH:mm:ss")}
        </p>
      )}
    </div>
  );
}
