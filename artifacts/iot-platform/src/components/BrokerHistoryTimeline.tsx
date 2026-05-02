import { useGetBrokerHistory } from "@workspace/api-client-react";
import { CheckCircle2, XCircle, AlertCircle, Clock, Wifi } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  brokerId: string;
  brokerName: string;
}

const STATUS_CONFIG = {
  connected: {
    icon: CheckCircle2,
    iconClass: "text-green-500",
    dotClass: "bg-green-500",
    lineClass: "bg-green-200 dark:bg-green-900/40",
    bgClass: "bg-green-50 dark:bg-green-950/20",
    borderClass: "border-green-200 dark:border-green-800/40",
    label: "Connected",
  },
  disconnected: {
    icon: XCircle,
    iconClass: "text-gray-400",
    dotClass: "bg-gray-400",
    lineClass: "bg-gray-200 dark:bg-gray-700",
    bgClass: "bg-gray-50 dark:bg-gray-900/20",
    borderClass: "border-gray-200 dark:border-gray-700",
    label: "Disconnected",
  },
  error: {
    icon: AlertCircle,
    iconClass: "text-red-500",
    dotClass: "bg-red-500",
    lineClass: "bg-red-200 dark:bg-red-900/40",
    bgClass: "bg-red-50 dark:bg-red-950/20",
    borderClass: "border-red-200 dark:border-red-800/40",
    label: "Error",
  },
} as const;

function cfg(status: string) {
  return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.disconnected;
}

export default function BrokerHistoryTimeline({ brokerId, brokerName }: Props) {
  const { data: events, isLoading } = useGetBrokerHistory(brokerId, { limit: 50 });
  const list = (events as any[] | undefined) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="w-7 h-7 rounded-full shrink-0" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <Wifi className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No connection events recorded yet</p>
        <p className="text-xs mt-1 opacity-70">Events will appear here when the broker connects or disconnects</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* vertical spine */}
      <div className="absolute left-[13px] top-4 bottom-4 w-px bg-border" />

      <div className="space-y-0">
        {list.map((event: any, i: number) => {
          const c = cfg(event.status);
          const Icon = c.icon;
          const ts = new Date(event.timestamp);
          const isFirst = i === 0;

          return (
            <div key={event.id} className="relative flex items-start gap-3 pb-4">
              {/* dot on the spine */}
              <div className={cn(
                "relative z-10 w-7 h-7 rounded-full flex items-center justify-center shrink-0 border-2 border-background",
                isFirst ? c.dotClass : "bg-muted",
              )}>
                <Icon className={cn("w-3.5 h-3.5", isFirst ? "text-white" : c.iconClass)} />
              </div>

              {/* event card */}
              <div className={cn(
                "flex-1 rounded-lg border px-3 py-2.5 text-sm transition-all",
                isFirst ? cn(c.bgClass, c.borderClass) : "bg-card border-border/50",
              )}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-xs font-semibold",
                      isFirst ? c.iconClass : "text-foreground/80"
                    )}>
                      {c.label}
                    </span>
                    {isFirst && (
                      <span className="text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        latest
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                    <Clock className="w-3 h-3" />
                    <span title={format(ts, "yyyy-MM-dd HH:mm:ss z")}>
                      {formatDistanceToNow(ts, { addSuffix: true })}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {format(ts, "yyyy-MM-dd HH:mm:ss")}
                </p>

                {event.message && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 font-mono bg-red-50 dark:bg-red-950/20 rounded px-2 py-1">
                    {event.message}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {list.length >= 50 && (
        <p className="text-center text-xs text-muted-foreground py-2">
          Showing last 50 events
        </p>
      )}
    </div>
  );
}
