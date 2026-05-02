import { useState } from "react";
import { Activity, User2, Clock, Tag, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

interface ActivityLogEntry {
  id: string;
  action: string;
  category: string;
  actorName: string;
  actorRole: string;
  actorUsername: string | null;
  targetId: string | null;
  targetName: string | null;
  detail: string | null;
  timestamp: string;
}

interface ActivityLogResponse {
  entries: ActivityLogEntry[];
  total: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  alarm:       "Alarm",
  asset:       "Asset",
  user:        "User",
  broker:      "Broker",
  api_client:  "API Client",
  destination: "Destination",
  system:      "System",
};

const CATEGORY_COLORS: Record<string, string> = {
  alarm:       "bg-red-100 text-red-700 border-red-200",
  asset:       "bg-blue-100 text-blue-700 border-blue-200",
  user:        "bg-purple-100 text-purple-700 border-purple-200",
  broker:      "bg-orange-100 text-orange-700 border-orange-200",
  api_client:  "bg-cyan-100 text-cyan-700 border-cyan-200",
  destination: "bg-teal-100 text-teal-700 border-teal-200",
  system:      "bg-gray-100 text-gray-600 border-gray-200",
};

const ACTION_LABELS: Record<string, string> = {
  "alarm.acknowledged":   "Alarm acknowledged",
  "asset.created":        "Asset created",
  "asset.deleted":        "Asset deleted",
  "user.created":         "User created",
  "user.deleted":         "User deleted",
  "broker.created":       "Broker created",
  "broker.deleted":       "Broker deleted",
  "api_client.created":   "API client created",
  "api_client.deleted":   "API client deleted",
  "destination.created":  "Destination created",
  "destination.deleted":  "Destination deleted",
};

const ACTION_ICON_COLORS: Record<string, string> = {
  created:      "text-green-600",
  acknowledged: "text-blue-600",
  deleted:      "text-red-500",
};

const ROLE_COLORS: Record<string, string> = {
  admin:    "bg-purple-100 text-purple-700",
  engineer: "bg-blue-100 text-blue-700",
  operator: "bg-green-100 text-green-700",
  viewer:   "bg-gray-100 text-gray-600",
  system:   "bg-gray-100 text-gray-500",
};

const PAGE_SIZE = 25;

function actionVerb(action: string): string {
  if (action.endsWith(".deleted")) return "deleted";
  if (action.endsWith(".acknowledged")) return "acknowledged";
  return "created";
}

export default function ActivityLog() {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams();
  if (category && category !== "all") params.set("category", category);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));

  const { data, isLoading, refetch, isFetching } = useQuery<ActivityLogResponse>({
    queryKey: ["activity-log", category, page],
    queryFn: async () => {
      const res = await fetch(`/api/activity-log?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch activity log");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtered = search.trim()
    ? entries.filter(
        (e) =>
          e.actorName.toLowerCase().includes(search.toLowerCase()) ||
          (e.targetName ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (ACTION_LABELS[e.action] ?? e.action).toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Activity Log
          </h1>
          <p className="text-sm text-muted-foreground">
            Audit trail of platform actions — {total.toLocaleString()} event{total !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Input
            placeholder="Search by actor, target or action…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9"
          />
        </div>
        <Select
          value={category}
          onValueChange={(v) => { setCategory(v); setPage(0); }}
        >
          <SelectTrigger className="w-44 h-9">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[180px]">Time</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[120px]">Category</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actor</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[160px]">Detail</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.length === 0
              ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      {total === 0
                        ? "No activity recorded yet. Actions like alarm acknowledgements, asset changes, and user management will appear here."
                        : "No results match your filter."}
                    </td>
                  </tr>
                )
              : filtered.map((entry) => {
                  const verb = actionVerb(entry.action);
                  const iconColor = ACTION_ICON_COLORS[verb] ?? "text-gray-500";
                  return (
                    <tr key={entry.id} className="border-b hover:bg-muted/30 transition-colors">
                      {/* Time */}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <div title={format(new Date(entry.timestamp), "PPpp")} className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-foreground">
                            {format(new Date(entry.timestamp), "MMM d, HH:mm:ss")}
                          </span>
                          <span className="text-xs">
                            {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                          </span>
                        </div>
                      </td>
                      {/* Category */}
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
                          CATEGORY_COLORS[entry.category] ?? CATEGORY_COLORS.system,
                        )}>
                          <Tag className="w-3 h-3 mr-1" />
                          {CATEGORY_LABELS[entry.category] ?? entry.category}
                        </span>
                      </td>
                      {/* Action */}
                      <td className="px-4 py-3">
                        <span className={cn("font-medium", iconColor)}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                      </td>
                      {/* Target */}
                      <td className="px-4 py-3">
                        {entry.targetName ? (
                          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                            {entry.targetName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      {/* Actor */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xs">
                            {entry.actorName.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium">{entry.actorName}</span>
                            <span className={cn(
                              "inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium",
                              ROLE_COLORS[entry.actorRole] ?? ROLE_COLORS.system,
                            )}>
                              {entry.actorRole}
                            </span>
                          </div>
                        </div>
                      </td>
                      {/* Detail */}
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {entry.detail ?? "—"}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()} events
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
