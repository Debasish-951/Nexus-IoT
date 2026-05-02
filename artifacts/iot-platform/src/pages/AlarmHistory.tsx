import { useListAlarmHistory } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

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

export default function AlarmHistory() {
  const { data: history } = useListAlarmHistory({ limit: 50 });
  const historyList = (history as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" />Alarm History</h1>
        <p className="text-sm text-muted-foreground">Historical log of all alarm events</p>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Asset</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Severity</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Triggered</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Cleared</th>
            </tr>
          </thead>
          <tbody>
            {!history ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 6 }).map((__, j) => (<td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>))}
                </tr>
              ))
            ) : historyList.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No alarm history</p></td></tr>
            ) : (
              historyList.map((h: any) => (
                <tr key={h.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`history-row-${h.id}`}>
                  <td className="px-4 py-3 font-medium">{h.name}</td>
                  <td className="px-4 py-3 text-primary">{h.assetName}</td>
                  <td className="px-4 py-3"><span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", SEVERITY_STYLES[h.severity] ?? "bg-muted")}>{h.severity}</span></td>
                  <td className="px-4 py-3"><span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", STATUS_STYLES[h.status] ?? "bg-muted")}>{h.status}</span></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{format(new Date(h.triggeredAt), "yyyy-MM-dd HH:mm:ss")}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{h.clearedAt ? format(new Date(h.clearedAt), "yyyy-MM-dd HH:mm:ss") : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
