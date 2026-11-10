import { useCallback, useEffect, useRef, useState } from "react";
import {
  useListAlarms,
  useAcknowledgeAlarm,
  getListAlarmsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Bell, CheckCircle2, Search, Filter } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";
import { useProjectScope } from "@/hooks/useProjectScope";
import { useWsEvents } from "@/hooks/useWsEvents";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
  info: "bg-blue-100 text-blue-700 border-blue-200",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-red-50 text-red-600 border-red-200",
  acknowledged: "bg-yellow-50 text-yellow-700 border-yellow-200",
  cleared: "bg-green-50 text-green-700 border-green-200",
};

export default function Alarms() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canAction } = useCurrentUser();
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const { data: alarms } = useListAlarms({
    ...(severity ? { severity: severity as any } : {}),
    ...(status ? { status: status as any } : {}),
  });

  const acknowledge = useAcknowledgeAlarm();
  const { inScope } = useProjectScope();

  // Refresh on live alarm events. A burst (batch ingest) coalesces into one refetch.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAlarmEvent = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void qc.invalidateQueries({ queryKey: getListAlarmsQueryKey() });
    }, 400);
  }, [qc]);
  useWsEvents({ alarm: handleAlarmEvent });
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  // Only the open project's alarms.
  const alarmList = ((alarms as any[] | undefined) ?? []).filter((a) => inScope(a.assetId, { strict: true }));
  const filtered = search
    ? alarmList.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()) || a.assetName.toLowerCase().includes(search.toLowerCase()))
    : alarmList;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Bell className="w-5 h-5 text-primary" />Alarm List</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} alarm(s)</p>
        </div>
      </div>
      <ReadOnlyBanner permission="acknowledge_alarms" message="cannot acknowledge alarms. Operator role or higher is required." />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search alarms..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs w-52" data-testid="alarm-search" />
        </div>
        <Select value={severity || "all"} onValueChange={(v) => setSeverity(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 text-xs w-36" data-testid="alarm-severity-filter">
            <Filter className="w-3.5 h-3.5 mr-1.5" /><SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 text-xs w-36" data-testid="alarm-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="cleared">Cleared</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Asset</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Severity</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Class</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Triggered</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Message</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {!alarms ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 8 }).map((__, j) => (<td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground"><Bell className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No alarms found</p></td></tr>
            ) : (
              filtered.map((alarm: any) => (
                <tr key={alarm.id} className={cn("border-b border-border/50 hover:bg-muted/30 transition-colors", alarm.severity === "critical" && alarm.status === "active" ? "bg-red-50/30" : "")} data-testid={`alarm-row-${alarm.id}`}>
                  <td className="px-4 py-3 font-medium">{alarm.name}</td>
                  <td className="px-4 py-3 text-primary">{alarm.assetName}</td>
                  <td className="px-4 py-3"><span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", SEVERITY_STYLES[alarm.severity] ?? "bg-muted")}>{alarm.severity}</span></td>
                  <td className="px-4 py-3"><span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", STATUS_STYLES[alarm.status] ?? "bg-muted")}>{alarm.status}</span></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{alarm.alarmClass ?? "-"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{format(new Date(alarm.triggeredAt), "MM/dd HH:mm:ss")}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">{alarm.message ?? "-"}</td>
                  <td className="px-4 py-3">
                    {alarm.status === "active" && canAction("acknowledge_alarms", "alarms") && (
                      <Button size="sm" variant="outline" className="h-6 text-xs"
                        onClick={() => acknowledge.mutate({ id: alarm.id }, { onSuccess: () => { toast({ title: "Alarm acknowledged" }); qc.invalidateQueries({ queryKey: getListAlarmsQueryKey() }); } })}
                        data-testid={`ack-alarm-${alarm.id}`}
                      ><CheckCircle2 className="w-3 h-3 mr-1" /> Ack</Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
