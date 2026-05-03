import { useState, useCallback, useRef } from "react";
import { useListAlarmHistory } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useWsEvents } from "@/hooks/useWsEvents";
import {
  BookOpen, Search, AlertCircle, Clock, CheckCircle2,
  ArrowDownToLine, ShieldCheck, Radio,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

// ── Severity ──────────────────────────────────────────────────────────────────
const SEVERITY_PRIORITY: Record<string, number> = {
  critical: 900, high: 600, medium: 400, low: 200, info: 100,
};

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800",
    high:     "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800",
    medium:   "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-950/60 dark:text-yellow-300",
    low:      "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300",
    info:     "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300",
  };
  const icon =
    severity === "critical" ? <AlertCircle className="w-3 h-3" /> :
    severity === "high"     ? <AlertCircle className="w-3 h-3" /> :
    <Clock className="w-3 h-3" />;

  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide", map[severity] ?? map.info)}>
      {icon}{severity}
    </span>
  );
}

// ── Row state config ──────────────────────────────────────────────────────────
// Base config by status; severity overlays are applied on top for critical
const STATE_CONFIG: Record<string, {
  label: string; badge: string;
  rowCls: string; barCls: string; textCls: string;
  icon: React.ReactNode;
}> = {
  active: {
    label:   "Unacknowledged",
    badge:   "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/60 dark:text-red-300 dark:border-red-700",
    rowCls:  "bg-red-50/60 dark:bg-red-950/20 hover:bg-red-100/60 dark:hover:bg-red-950/30",
    barCls:  "border-l-[3px] border-l-red-500",
    textCls: "text-red-700 dark:text-red-400 font-semibold",
    icon:    <AlertCircle className="w-3.5 h-3.5 text-red-500" />,
  },
  acknowledged: {
    label:   "Acknowledged",
    badge:   "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-700",
    rowCls:  "bg-yellow-50/40 dark:bg-yellow-950/15 hover:bg-yellow-100/50",
    barCls:  "border-l-[3px] border-l-yellow-400",
    textCls: "text-yellow-700 dark:text-yellow-400 font-medium",
    icon:    <ShieldCheck className="w-3.5 h-3.5 text-yellow-500" />,
  },
  cleared: {
    label:   "Returned to Normal",
    badge:   "bg-green-100 text-green-700 border-green-300 dark:bg-green-950/60 dark:text-green-300 dark:border-green-700",
    rowCls:  "bg-green-50/40 dark:bg-green-950/15 hover:bg-green-100/50 dark:hover:bg-green-950/25",
    barCls:  "border-l-[3px] border-l-green-500",
    textCls: "text-green-700 dark:text-green-400 font-medium",
    icon:    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
  },
};

// Extra row overlay for critical severity + active
const CRITICAL_ROW_CLS = "bg-red-100/80 dark:bg-red-950/35 hover:bg-red-200/60 dark:hover:bg-red-950/45";
const CRITICAL_BAR_CLS = "border-l-[4px] border-l-red-600";

// ── Main component ────────────────────────────────────────────────────────────
export default function AlarmHistory() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: history, refetch } = useListAlarmHistory({ limit: 200 });

  const [search, setSearch]               = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus]     = useState("all");
  const [acknowledging, setAcknowledging]   = useState<Record<string, boolean>>({});

  // Live event counter — tracks new alarm events since last page focus
  const [liveCount, setLiveCount] = useState(0);
  const [lastEvent, setLastEvent] = useState<{ event: string; ruleName?: string; severity?: string } | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced refetch — coalesces rapid bursts (e.g. batch ingest) into one query
  const debouncedRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => { void refetch(); }, 400);
  }, [refetch]);

  const handleAlarmEvent = useCallback((raw: unknown) => {
    const ev = raw as { event: string; ruleName?: string; severity?: string; alarmId?: string };
    setLiveCount((n) => n + 1);
    setLastEvent(ev);
    debouncedRefetch();
    // Also keep the Alarms list in sync
    qc.invalidateQueries({ queryKey: ["listAlarms"] });
  }, [debouncedRefetch, qc]);

  const wsStatus = useWsEvents({ alarm: handleAlarmEvent });

  function clearLiveBadge() { setLiveCount(0); setLastEvent(null); }

  const historyList = (history as any[] | undefined) ?? [];
  const filtered = historyList.filter((h) => {
    if (filterSeverity !== "all" && h.severity !== filterSeverity) return false;
    if (filterStatus   !== "all" && h.status   !== filterStatus)   return false;
    if (search && !h.name?.toLowerCase().includes(search.toLowerCase()) &&
        !h.assetName?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function handleAcknowledge(historyId: string, name: string) {
    setAcknowledging((p) => ({ ...p, [historyId]: true }));
    try {
      const res = await fetch(`/api/alarms/history/${historyId}/acknowledge`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        toast({ title: "Error", description: err.error ?? "Could not acknowledge", variant: "destructive" });
        return;
      }
      toast({ title: "Alarm acknowledged", description: name });
      await refetch();
      qc.invalidateQueries({ queryKey: ["listAlarms"] });
    } catch (e: any) {
      toast({ title: "Network error", description: e.message, variant: "destructive" });
    } finally {
      setAcknowledging((p) => ({ ...p, [historyId]: false }));
    }
  }

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" /> Alarm History
          </h1>
          <p className="text-sm text-muted-foreground">
            Historical log of all alarm events — {filtered.length} records
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Live WS status + new-event badge */}
          <div className="flex items-center gap-2">
            <span className={cn(
              "inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border",
              wsStatus === "connected"
                ? "bg-green-50 border-green-300 text-green-700 dark:bg-green-950/30 dark:border-green-700 dark:text-green-400"
                : "bg-muted border-border text-muted-foreground"
            )}>
              <Radio className={cn("w-3 h-3", wsStatus === "connected" ? "text-green-500 animate-pulse" : "text-muted-foreground")} />
              {wsStatus === "connected" ? "Live" : wsStatus === "reconnecting" ? "Reconnecting…" : "Connecting…"}
            </span>

            {liveCount > 0 && (
              <button
                onClick={clearLiveBadge}
                title="New alarm events received — click to dismiss"
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border animate-pulse cursor-pointer",
                  lastEvent?.event === "triggered"
                    ? "bg-red-100 border-red-400 text-red-700 dark:bg-red-950/50 dark:border-red-600 dark:text-red-300"
                    : lastEvent?.event === "cleared"
                    ? "bg-green-100 border-green-400 text-green-700 dark:bg-green-950/50 dark:border-green-600 dark:text-green-300"
                    : "bg-yellow-100 border-yellow-400 text-yellow-700 dark:bg-yellow-950/50 dark:border-yellow-600 dark:text-yellow-300"
                )}
              >
                <AlertCircle className="w-3 h-3" />
                {liveCount} new event{liveCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>

          {/* Legend */}
          <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[2px] bg-red-200 dark:bg-red-900/50 border-l-2 border-red-500" />
              Unacknowledged
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[2px] bg-yellow-100 dark:bg-yellow-900/40 border-l-2 border-yellow-500" />
              Acknowledged
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[2px] bg-green-100 dark:bg-green-900/40 border-l-2 border-green-500" />
              Returned to Normal
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search alarm or asset…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs w-52"
          />
        </div>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="State" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="active">Unacknowledged</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="cleared">Returned to Normal</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} / {historyList.length} records
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-border shadow-sm">
        <table className="w-full text-xs border-collapse min-w-[960px]">
          <thead>
            <tr className="bg-muted/80 dark:bg-muted/40 border-b border-border sticky top-0 z-10">
              <th className="w-8 px-3 py-2.5"></th>
              <th className="text-left px-3 py-2.5 font-semibold text-foreground/80 whitespace-nowrap">Event Time</th>
              <th className="text-left px-3 py-2.5 font-semibold text-foreground/80">Alarm Name</th>
              <th className="text-left px-3 py-2.5 font-semibold text-foreground/80">Asset</th>
              <th className="text-left px-3 py-2.5 font-semibold text-foreground/80">Severity</th>
              <th className="text-left px-3 py-2.5 font-semibold text-foreground/80">Priority</th>
              <th className="text-left px-3 py-2.5 font-semibold text-foreground/80">State</th>
              <th className="text-left px-3 py-2.5 font-semibold text-foreground/80">Cleared / Ack. At</th>
              <th className="text-left px-3 py-2.5 font-semibold text-foreground/80 w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {!history ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className={cn("border-b border-border/20", i % 2 === 0 ? "bg-red-50/20" : "bg-green-50/20")}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5"><Skeleton className="h-3 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center text-muted-foreground">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">No alarm history found</p>
                  {(search || filterSeverity !== "all" || filterStatus !== "all") &&
                    <p className="text-xs mt-1 opacity-60">Try adjusting your filters</p>}
                </td>
              </tr>
            ) : (
              filtered.map((h: any) => {
                const isCriticalActive = h.severity === "critical" && h.status === "active";
                const cfg = STATE_CONFIG[h.status] ?? STATE_CONFIG.active;
                const rowCls = isCriticalActive ? CRITICAL_ROW_CLS : cfg.rowCls;
                const barCls = isCriticalActive ? CRITICAL_BAR_CLS : cfg.barCls;
                const priority = SEVERITY_PRIORITY[h.severity] ?? 0;
                const isAcking = !!acknowledging[h.id];

                return (
                  <tr
                    key={h.id}
                    className={cn(
                      "border-b border-border/20 transition-colors cursor-default",
                      rowCls, barCls,
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" className="rounded w-3 h-3 cursor-pointer" />
                    </td>

                    {/* Event Time */}
                    <td className="px-3 py-2.5 font-mono whitespace-nowrap text-foreground/80">
                      <div>{format(new Date(h.triggeredAt), "yyyy-MM-dd HH:mm:ss")}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(h.triggeredAt), { addSuffix: true })}
                      </div>
                    </td>

                    {/* Alarm Name */}
                    <td className="px-3 py-2.5 max-w-[180px]">
                      <div className={cn("font-semibold truncate", isCriticalActive ? "text-red-700 dark:text-red-400" : "text-primary")}>
                        {h.name}
                      </div>
                      {h.message && (
                        <div className="text-[10px] text-muted-foreground truncate max-w-[160px]" title={h.message}>
                          {h.message}
                        </div>
                      )}
                    </td>

                    {/* Asset */}
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {h.assetName ?? "—"}
                    </td>

                    {/* Severity badge */}
                    <td className="px-3 py-2.5">
                      <SeverityBadge severity={h.severity} />
                    </td>

                    {/* Priority */}
                    <td className="px-3 py-2.5 font-mono text-foreground/60 tabular-nums">
                      {priority}
                    </td>

                    {/* State */}
                    <td className="px-3 py-2.5">
                      <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-semibold", cfg.badge)}>
                        {cfg.icon}
                        {h.status === "cleared" ? "Returned to Normal" : cfg.label}
                      </span>
                    </td>

                    {/* Cleared / Ack At */}
                    <td className="px-3 py-2.5 font-mono text-muted-foreground text-[10px] whitespace-nowrap">
                      {h.status === "cleared" && h.clearedAt ? (
                        <div>
                          <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <ArrowDownToLine className="w-3 h-3 shrink-0" />
                            {format(new Date(h.clearedAt), "HH:mm:ss")}
                          </div>
                          <div className="text-[9px] text-muted-foreground">
                            {format(new Date(h.clearedAt), "yyyy-MM-dd")}
                          </div>
                        </div>
                      ) : h.status === "acknowledged" && h.acknowledgedAt ? (
                        <div>
                          <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                            <ShieldCheck className="w-3 h-3 shrink-0" />
                            {format(new Date(h.acknowledgedAt), "HH:mm:ss")}
                          </div>
                          <div className="text-[9px] text-muted-foreground">
                            {format(new Date(h.acknowledgedAt), "yyyy-MM-dd")}
                          </div>
                        </div>
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-3 py-2.5">
                      {h.status === "active" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 gap-1 border-yellow-400 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950/30"
                          onClick={() => handleAcknowledge(h.id, h.name)}
                          disabled={isAcking}
                        >
                          <ShieldCheck className="w-3 h-3" />
                          {isAcking ? "…" : "Acknowledge"}
                        </Button>
                      ) : h.status === "cleared" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400 font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          Resolved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">
                          <ShieldCheck className="w-3 h-3" />
                          Ack'd
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
