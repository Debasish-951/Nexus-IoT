import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useWsEvents } from "@/hooks/useWsEvents";
import { OPEN_ALARMS_KEY, useOpenAlarms } from "@/hooks/useOpenAlarms";
import { useProjectScope } from "@/hooks/useProjectScope";

const SEVERITY_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  critical: { icon: AlertCircle,   color: "text-red-500" },
  high:     { icon: AlertTriangle, color: "text-orange-500" },
  medium:   { icon: AlertTriangle, color: "text-yellow-500" },
  low:      { icon: Info,          color: "text-blue-500" },
  info:     { icon: Info,          color: "text-blue-400" },
};

/** Repeats of one rule, folded into a single line. */
interface RecentGroup {
  key: string;
  label: string;
  assetName: string;
  raised: number;
  cleared: number;
  lastEvent: string;
  lastAt: string;
}

const MAX_GROUPS = 20;
/** A burst of events triggers one reload, not one each. */
const REFRESH_DELAY_MS = 3_000;

export default function NotificationBell() {
  const { enabled, alarms } = useOpenAlarms();
  // The bell stays global across projects, so each alarm says which project it is in.
  const { whereLabel } = useProjectScope();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentGroup[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAlarm = useCallback((raw: unknown) => {
    const ev = raw as { event: string; ruleName?: string; metric?: string; assetName?: string; timestamp?: string };
    if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        void qc.invalidateQueries({ queryKey: OPEN_ALARMS_KEY });
      }, REFRESH_DELAY_MS);
    }
    if (ev.event !== "triggered" && ev.event !== "cleared") return;
    const key = `${ev.ruleName ?? ""}|${ev.metric ?? ""}|${ev.assetName ?? ""}`;
    setRecent((prev) => {
      const old = prev.find((g) => g.key === key);
      const next: RecentGroup = {
        key,
        label: ev.ruleName || ev.metric || "Alarm",
        assetName: ev.assetName ?? "",
        raised: (old?.raised ?? 0) + (ev.event === "triggered" ? 1 : 0),
        cleared: (old?.cleared ?? 0) + (ev.event === "cleared" ? 1 : 0),
        lastEvent: ev.event,
        lastAt: ev.timestamp ?? new Date().toISOString(),
      };
      return [next, ...prev.filter((g) => g.key !== key)].slice(0, MAX_GROUPS);
    });
  }, [qc]);

  useWsEvents({ alarm: handleAlarm });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Alarm data follows the Alarms module, the same rule as the Alarm List page.
  if (!enabled) return null;

  const needingAction = alarms.filter((a) => a.status === "active").length;

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn("relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors", open && "bg-muted")}
        title={`${needingAction} open alarm${needingAction === 1 ? "" : "s"}`}
      >
        <Bell className="w-4 h-4 text-muted-foreground" />
        {needingAction > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
            {needingAction > 9 ? "9+" : needingAction}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden">
          <div className="max-h-96 overflow-y-auto">
            <p className="px-4 pt-3 pb-1.5 text-xs font-semibold">Open alarms ({alarms.length})</p>
            {alarms.length === 0 && <p className="px-4 pb-3 text-xs text-muted-foreground">No alarms are open.</p>}
            {alarms.map((a) => {
              const cfg = SEVERITY_CONFIG[a.severity] ?? SEVERITY_CONFIG.info!;
              const Icon = cfg.icon;
              return (
                <div key={a.id} className="flex gap-2.5 px-4 py-2 border-t border-border/50">
                  <Icon className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", cfg.color)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" title={a.message ?? undefined}>{a.name || a.message || "Alarm"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {whereLabel(a.assetId, a.assetName)} · {formatDistanceToNow(new Date(a.triggeredAt), { addSuffix: true })}
                      {a.status === "acknowledged" && " · acknowledged"}
                    </p>
                  </div>
                </div>
              );
            })}

            {recent.length > 0 && (
              <>
                <p className="px-4 pt-3 pb-1.5 text-xs font-semibold border-t border-border">Recent activity</p>
                {recent.map((g) => (
                  <div key={g.key} className="flex gap-2.5 px-4 py-2 border-t border-border/50">
                    {g.lastEvent === "cleared"
                      ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-green-500" />
                      : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-orange-500" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate" title={g.label}>{g.label}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {g.raised} raised · {g.cleared} cleared · {formatDistanceToNow(new Date(g.lastAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="border-t border-border px-4 py-2">
            <Link href="/alarms" onClick={() => setOpen(false)} className="text-xs text-primary hover:underline">View all alarms</Link>
          </div>
        </div>
      )}
    </div>
  );
}
