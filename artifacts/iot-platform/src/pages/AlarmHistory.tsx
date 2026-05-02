import { useState } from "react";
import { useListAlarmHistory } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Search, AlertCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const SEVERITY_PRIORITY: Record<string, number> = {
  critical: 900, high: 600, medium: 400, low: 200, info: 100,
};

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />;
  if (severity === "high")     return <span className="w-3 h-3 inline-flex items-center justify-center text-orange-500 font-bold text-[9px] shrink-0">◇</span>;
  if (severity === "medium")   return <span className="w-3 h-3 inline-flex items-center justify-center text-yellow-500 font-bold text-[9px] shrink-0">◇</span>;
  return <Clock className="w-3 h-3 text-blue-400 shrink-0" />;
}

const STATE_CONFIG: Record<string, { label: string; rowCls: string; barCls: string; textCls: string }> = {
  active: {
    label:   "Unacknowledged",
    rowCls:  "bg-red-50 dark:bg-red-950/25 hover:bg-red-100/70 dark:hover:bg-red-950/35",
    barCls:  "border-l-[3px] border-l-red-500",
    textCls: "text-red-700 dark:text-red-400 font-medium",
  },
  acknowledged: {
    label:   "Acknowledged",
    rowCls:  "bg-yellow-50 dark:bg-yellow-950/20 hover:bg-yellow-100/60",
    barCls:  "border-l-[3px] border-l-yellow-500",
    textCls: "text-yellow-700 dark:text-yellow-400 font-medium",
  },
  cleared: {
    label:   "Returned to normal una…",
    rowCls:  "bg-green-50 dark:bg-green-950/20 hover:bg-green-100/60 dark:hover:bg-green-950/30",
    barCls:  "border-l-[3px] border-l-green-500",
    textCls: "text-green-700 dark:text-green-400 font-medium",
  },
};

export default function AlarmHistory() {
  const { data: history } = useListAlarmHistory({ limit: 200 });
  const [search, setSearch]         = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus]     = useState("all");

  const historyList = (history as any[] | undefined) ?? [];
  const filtered = historyList.filter((h) => {
    if (filterSeverity !== "all" && h.severity !== filterSeverity) return false;
    if (filterStatus   !== "all" && h.status   !== filterStatus)   return false;
    if (search && !h.name?.toLowerCase().includes(search.toLowerCase()) &&
        !h.assetName?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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
        {/* Legend */}
        <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-[2px] bg-red-200 dark:bg-red-800 border-l-2 border-red-500" />
            Unacknowledged
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-[2px] bg-yellow-100 dark:bg-yellow-800/40 border-l-2 border-yellow-500" />
            Acknowledged
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-[2px] bg-green-100 dark:bg-green-800/40 border-l-2 border-green-500" />
            Returned to Normal
          </span>
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
          <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Severity" /></SelectTrigger>
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
          <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="State" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="active">Unacknowledged</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="cleared">Returned to Normal</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-border shadow-sm">
        <table className="w-full text-xs border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-muted/80 dark:bg-muted/40 border-b border-border sticky top-0 z-10">
              <th className="w-8 px-3 py-2.5"></th>
              {[
                "Event Time", "Alarm Name", "Asset", "Condition",
                "State", "Priority", "Severity", "Message",
              ].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 font-semibold text-foreground/80 whitespace-nowrap">
                  {h} <span className="ml-0.5 opacity-30">↑↓</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!history ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className={cn("border-b border-border/20", i % 2 === 0 ? "bg-red-50/30" : "bg-green-50/30")}>
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
                const cfg = STATE_CONFIG[h.status] ?? STATE_CONFIG.active;
                const priority = SEVERITY_PRIORITY[h.severity] ?? 0;
                return (
                  <tr
                    key={h.id}
                    className={cn(
                      "border-b border-border/20 transition-colors cursor-default",
                      cfg.rowCls,
                      cfg.barCls,
                    )}
                  >
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" className="rounded w-3 h-3 cursor-pointer" />
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-foreground/80">
                      {format(new Date(h.triggeredAt), "yyyy-MM-dd HH:mm:ss.SSS")}
                    </td>
                    <td className="px-3 py-2 font-medium text-primary hover:underline cursor-pointer max-w-[160px] truncate">
                      {h.name}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[100px]">
                      {h.assetName ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono uppercase text-foreground/60 text-[11px]">
                      {h.alarmClass ? String(h.alarmClass).slice(0, 6) : "—"}
                    </td>
                    <td className={cn("px-3 py-2", cfg.textCls)}>
                      {cfg.label}
                    </td>
                    <td className="px-3 py-2 flex items-center gap-1">
                      <SeverityIcon severity={h.severity} />
                      <span className="capitalize text-foreground/80">{h.severity}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-foreground/60">{priority}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate" title={h.message ?? ""}>
                      {h.message ?? ""}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {historyList.length} alarm events
      </p>
    </div>
  );
}
