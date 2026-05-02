import { useGetDashboardSummary, useGetRecentTelemetry, useGetAlarmStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Blocks, Bell, Wifi, Users, Activity, Clock, TrendingUp, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-primary",
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  loading?: boolean;
}) {
  return (
    <Card className="shadow-sm" data-testid={`stat-card-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">{label}</p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p className="text-2xl font-bold text-foreground">{value}</p>
            )}
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-primary/10 ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
  info: "#3b82f6",
};

export default function Dashboard() {
  const { data: summary } = useGetDashboardSummary();
  const { data: recentTelemetry } = useGetRecentTelemetry({ limit: 15 });
  const { data: alarmStats } = useGetAlarmStats();

  const alarmChartData = alarmStats
    ? [
        { name: "Critical", count: (alarmStats as any).critical ?? 0, fill: SEVERITY_COLORS.critical },
        { name: "High", count: (alarmStats as any).high ?? 0, fill: SEVERITY_COLORS.high },
        { name: "Medium", count: (alarmStats as any).medium ?? 0, fill: SEVERITY_COLORS.medium },
        { name: "Low", count: (alarmStats as any).low ?? 0, fill: SEVERITY_COLORS.low },
        { name: "Info", count: (alarmStats as any).info ?? 0, fill: SEVERITY_COLORS.info },
      ]
    : [];

  const s = summary as any;
  const telemetry = recentTelemetry as any[] | undefined;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">System overview and real-time status</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard icon={Blocks} label="Total Assets" value={s?.totalAssets ?? 0} loading={!s} color="text-primary" />
        <StatCard icon={Bell} label="Active Alarms" value={s?.activeAlarms ?? 0} sub={`${s?.criticalAlarms ?? 0} critical`} loading={!s} color="text-destructive" />
        <StatCard icon={AlertTriangle} label="Critical" value={s?.criticalAlarms ?? 0} loading={!s} color="text-destructive" />
        <StatCard icon={Wifi} label="Brokers" value={s?.connectedBrokers ?? 0} sub="connected" loading={!s} color="text-chart-2" />
        <StatCard icon={Users} label="Users" value={s?.totalUsers ?? 0} loading={!s} color="text-chart-5" />
        <StatCard icon={TrendingUp} label="Telemetry Rate" value={`${((s?.telemetryRate as number) ?? 0).toFixed(1)}/min`} loading={!s} color="text-chart-3" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Recent Telemetry */}
        <Card className="lg:col-span-3 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Recent Telemetry
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
                  {!telemetry ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="px-4 py-2"><Skeleton className="h-3 w-20" /></td>
                        <td className="px-4 py-2"><Skeleton className="h-3 w-24" /></td>
                        <td className="px-4 py-2"><Skeleton className="h-3 w-12" /></td>
                        <td className="px-4 py-2"><Skeleton className="h-3 w-20" /></td>
                      </tr>
                    ))
                  ) : telemetry.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No telemetry data yet</td>
                    </tr>
                  ) : (
                    telemetry.map((rec: any) => (
                      <tr key={rec.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`telemetry-row-${rec.id}`}>
                        <td className="px-4 py-2 font-mono text-xs text-foreground/70">{rec.deviceId ?? String(rec.assetId).slice(0, 8)}</td>
                        <td className="px-4 py-2 font-medium">{rec.metric}</td>
                        <td className="px-4 py-2 font-mono">
                          {typeof rec.value === "object" ? JSON.stringify(rec.value) : String(rec.value ?? "-")}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
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

        {/* Alarm Stats */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-destructive" />
              Active Alarms by Severity
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {!alarmStats ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={alarmChartData} barSize={28}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} cursor={{ fill: "rgba(0,0,0,0.05)" }} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {alarmChartData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
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
