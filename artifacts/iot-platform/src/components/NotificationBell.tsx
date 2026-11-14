import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info, HardDrive } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useWsEvents } from "@/hooks/useWsEvents";
import { OPEN_ALARMS_KEY, useOpenAlarms } from "@/hooks/useOpenAlarms";
import { useProjectScope } from "@/hooks/useProjectScope";
import { useCurrentUser } from "@/contexts/UserContext";
import { apiFetch } from "@/lib/auth-api";

interface SystemAlert { id: string; severity: string; title: string; message: string; status: string; raisedAt: string }
const SYSTEM_ALERTS_KEY = ["system/alerts"];

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
  // Storage / backup / pipeline alerts (Data Management) for those who may see that page.
  const { canModule, session } = useCurrentUser();
  const systemEnabled = canModule("reports") && !session?.restrictProjects;
  const systemQ = useQuery({
    queryKey: SYSTEM_ALERTS_KEY,
    queryFn: async () => {
      const r = await apiFetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/system/alerts`);
      return r.ok ? ((await r.json()) as SystemAlert[]) : [];
    },
    enabled: systemEnabled, refetchInterval: 120_000, retry: false,
  });
  const systemAlerts = (systemQ.data ?? []).filter((a) => a.status !== "cleared");
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

  useWsEvents({ alarm: handleAlarm, system_alerts: () => { void qc.invalidateQueries({ queryKey: SYSTEM_ALERTS_KEY }); } });
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
  if (!enabled && !systemEnabled) return null;

  const needingAction = (enabled ? alarms.filter((a) => a.status === "active").length : 0) + systemAlerts.filter((a) => a.status === "active").length;

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
            {systemAlerts.length > 0 && (
              <>
                <p className="px-4 pt-3 pb-1.5 text-xs font-semibold">System alerts ({systemAlerts.length})</p>
                {systemAlerts.map((a) => {
                  const cfg = SEVERITY_CONFIG[a.severity] ?? SEVERITY_CONFIG.info!;
                  return (
                    <Link key={a.id} href="/data-management" onClick={() => setOpen(false)} className="flex gap-2.5 px-4 py-2 border-t border-border/50 hover:bg-muted/50">
                      <HardDrive className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", cfg.color)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate" title={a.message}>{a.title}</p>
                        <p className="text-[11px] text-muted-foreground truncate">Data Management · {formatDistanceToNow(new Date(a.raisedAt), { addSuffix: true })}{a.status === "acknowledged" && " · acknowledged"}</p>
                      </div>
                    </Link>
                  );
                })}
              </>
            )}
            {enabled && <p className={cn("px-4 pt-3 pb-1.5 text-xs font-semibold", systemAlerts.length > 0 && "border-t border-border")}>Open alarms ({alarms.length})</p>}
            {enabled && alarms.length === 0 && <p className="px-4 pb-3 text-xs text-muted-foreground">No alarms are open.</p>}
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
            {enabled ? <Link href="/alarms" onClick={() => setOpen(false)} className="text-xs text-primary hover:underline">View all alarms</Link>
              : <Link href="/data-management" onClick={() => setOpen(false)} className="text-xs text-primary hover:underline">Open Data Management</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
