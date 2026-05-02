import { useCallback } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { useWsEvents } from "@/hooks/useWsEvents";

interface AlarmEvent {
  event: "triggered" | "cleared";
  alarmId: string;
  ruleName: string;
  metric: string;
  value: number;
  threshold: number | null;
  operator: string | null;
  severity: string;
  assetId: string;
  assetName: string;
  timestamp: string;
}

const SEVERITY_CONFIG: Record<string, {
  icon: React.ElementType;
  bg: string;
  border: string;
  title: string;
  iconColor: string;
}> = {
  critical: {
    icon: AlertCircle,
    bg: "bg-red-50",
    border: "border-red-300",
    title: "text-red-800",
    iconColor: "text-red-600",
  },
  high: {
    icon: AlertTriangle,
    bg: "bg-orange-50",
    border: "border-orange-300",
    title: "text-orange-800",
    iconColor: "text-orange-500",
  },
  medium: {
    icon: AlertTriangle,
    bg: "bg-yellow-50",
    border: "border-yellow-300",
    title: "text-yellow-800",
    iconColor: "text-yellow-600",
  },
  low: {
    icon: Info,
    bg: "bg-blue-50",
    border: "border-blue-300",
    title: "text-blue-800",
    iconColor: "text-blue-500",
  },
  info: {
    icon: Info,
    bg: "bg-blue-50",
    border: "border-blue-200",
    title: "text-blue-700",
    iconColor: "text-blue-400",
  },
};

const DURATION: Record<string, number> = {
  critical: Infinity,
  high: 12_000,
  medium: 8_000,
  low: 5_000,
  info: 4_000,
};

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
}

export default function AlarmToastListener() {
  const handleAlarm = useCallback((raw: unknown) => {
    const ev = raw as AlarmEvent;

    if (ev.event === "triggered") {
      const cfg = SEVERITY_CONFIG[ev.severity] ?? SEVERITY_CONFIG.info;
      const Icon = cfg.icon;

      toast.custom(
        (id) => (
          <div
            className={`flex gap-3 items-start w-[360px] rounded-lg border shadow-lg px-4 py-3 ${cfg.bg} ${cfg.border}`}
            onClick={() => toast.dismiss(id)}
          >
            <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${cfg.iconColor}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold leading-tight ${cfg.title}`}>
                {ev.severity.charAt(0).toUpperCase() + ev.severity.slice(1)} alarm triggered
              </p>
              <p className="text-xs text-gray-700 mt-0.5 font-medium truncate">{ev.ruleName}</p>
              <p className="text-xs text-gray-500 mt-1">
                <span className="font-mono">{ev.assetName}</span>
                {" · "}
                <span className="font-mono">{ev.metric}</span>
                {" = "}
                <span className="font-mono font-semibold">{formatValue(ev.value)}</span>
                {ev.threshold != null && (
                  <> (threshold {ev.operator} {formatValue(ev.threshold)})</>
                )}
              </p>
            </div>
          </div>
        ),
        {
          duration: DURATION[ev.severity] ?? 8_000,
          id: `alarm-${ev.alarmId}`,
          position: "top-right",
        },
      );
    } else {
      toast.custom(
        (id) => (
          <div
            className="flex gap-3 items-start w-[360px] rounded-lg border border-green-300 shadow-lg px-4 py-3 bg-green-50"
            onClick={() => toast.dismiss(id)}
          >
            <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-green-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight text-green-800">Alarm cleared</p>
              <p className="text-xs text-gray-700 mt-0.5 font-medium truncate">{ev.ruleName}</p>
              <p className="text-xs text-gray-500 mt-1">
                <span className="font-mono">{ev.assetName}</span>
                {" · "}
                <span className="font-mono">{ev.metric}</span>
                {" = "}
                <span className="font-mono font-semibold">{formatValue(ev.value)}</span>
              </p>
            </div>
          </div>
        ),
        {
          duration: 5_000,
          id: `alarm-cleared-${ev.alarmId}`,
          position: "top-right",
        },
      );
    }
  }, []);

  useWsEvents({ alarm: handleAlarm });

  return null;
}
