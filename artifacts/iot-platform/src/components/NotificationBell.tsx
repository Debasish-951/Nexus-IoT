import { useState, useCallback, useRef, useEffect } from "react";
import { Bell, AlertCircle, AlertTriangle, Info, CheckCircle2, X, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useWsEvents } from "@/hooks/useWsEvents";

interface AlarmNotification {
  id: string;
  event: "triggered" | "cleared";
  ruleName: string;
  metric: string;
  value: number;
  threshold: number | null;
  operator: string | null;
  severity: string;
  assetName: string;
  timestamp: string;
  read: boolean;
}

const SEVERITY_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; border: string }> = {
  critical: { icon: AlertCircle,   color: "text-red-600",    bg: "bg-red-50",    border: "border-red-200" },
  high:     { icon: AlertTriangle, color: "text-orange-500", bg: "bg-orange-50", border: "border-orange-200" },
  medium:   { icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200" },
  low:      { icon: Info,          color: "text-blue-500",   bg: "bg-blue-50",   border: "border-blue-200" },
  info:     { icon: Info,          color: "text-blue-400",   bg: "bg-blue-50",   border: "border-blue-100" },
};

function formatValue(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<AlarmNotification[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleAlarm = useCallback((raw: unknown) => {
    const ev = raw as AlarmNotification & { alarmId: string };
    setNotifications((prev) => {
      const n: AlarmNotification = {
        id: ev.alarmId ?? `${Date.now()}`,
        event: ev.event,
        ruleName: ev.ruleName,
        metric: ev.metric,
        value: ev.value,
        threshold: ev.threshold,
        operator: ev.operator,
        severity: ev.severity,
        assetName: ev.assetName,
        timestamp: ev.timestamp ?? new Date().toISOString(),
        read: false,
      };
      return [n, ...prev].slice(0, 50);
    });
  }, []);

  useWsEvents({ alarm: handleAlarm });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  function dismiss(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  function handleOpen() {
    setOpen((o) => !o);
    if (!open) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        className={cn(
          "relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors",
          open && "bg-muted"
        )}
        title="Alarm notifications"
      >
        <Bell className="w-4 h-4 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              Alarm Notifications
            </h3>
            {notifications.length > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-border/50">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                No alarm notifications yet
              </div>
            ) : (
              notifications.map((n) => {
                const cfg = n.event === "cleared"
                  ? { icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50", border: "border-green-100" }
                  : (SEVERITY_CONFIG[n.severity] ?? SEVERITY_CONFIG.info);
                const Icon = cfg.icon;

                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group relative",
                      !n.read && "bg-primary/[0.03]"
                    )}
                  >
                    <div className={cn("mt-0.5 shrink-0 p-1.5 rounded-full", cfg.bg)}>
                      <Icon className={cn("w-3.5 h-3.5", cfg.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold leading-tight">
                          {n.event === "cleared" ? "Alarm cleared" : (
                            <span>
                              <span className="capitalize">{n.severity}</span> alarm triggered
                            </span>
                          )}
                        </p>
                        {!n.read && (
                          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary mt-1" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-medium mt-0.5 truncate">{n.ruleName}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        <span className="font-mono">{n.assetName}</span>
                        {" · "}
                        <span className="font-mono">{n.metric} = {formatValue(n.value)}</span>
                        {n.threshold != null && n.event !== "cleared" && (
                          <> (thr {n.operator} {formatValue(n.threshold)})</>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 mt-1">
                        {formatDistanceToNow(new Date(n.timestamp), { addSuffix: true })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {notifications.length > 0 && (
            <div className="border-t border-border px-4 py-2">
              <button
                onClick={() => setNotifications([])}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Clear all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
