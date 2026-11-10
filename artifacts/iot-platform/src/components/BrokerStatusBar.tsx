import { useState, useCallback, useRef, useEffect } from "react";
import { useListBrokers } from "@workspace/api-client-react";
import { Wifi, WifiOff, AlertCircle, ChevronDown, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useWsEvents } from "@/hooks/useWsEvents";
import { useCurrentUser } from "@/contexts/UserContext";

interface BrokerStatus {
  brokerId: string;
  brokerName: string;
  status: "connected" | "disconnected" | "error";
  timestamp: string;
}

interface BrokerEntry {
  id: string;
  name: string;
  status: string;
  lastChange: string | null;
}

const STATUS_CONFIG = {
  connected:    { color: "bg-green-500",  text: "text-green-600",  label: "Connected",    icon: Wifi },
  error:        { color: "bg-red-500",    text: "text-red-600",    label: "Error",         icon: AlertCircle },
  disconnected: { color: "bg-gray-400",   text: "text-gray-500",   label: "Disconnected",  icon: WifiOff },
} as const;

function statusCfg(s: string) {
  return STATUS_CONFIG[s as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.disconnected;
}

export default function BrokerStatusBar() {
  // Shown in the header of every page. Users without the Brokers module were
  // refused this request on every page load, and each refusal was logged as a
  // security event, so the query only runs when the server would allow it.
  const { canModule } = useCurrentUser();
  const allowed = canModule("brokers");
  const { data: brokersData } = useListBrokers({ query: { enabled: allowed } as never });
  const rawBrokers = (brokersData as any[] | undefined) ?? [];

  const [overrides, setOverrides] = useState<Record<string, BrokerStatus>>({});
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleBrokerStatus = useCallback((raw: unknown) => {
    const ev = raw as BrokerStatus;
    setOverrides((prev) => ({ ...prev, [ev.brokerId]: ev }));
  }, []);

  useWsEvents({ broker_status: handleBrokerStatus });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (rawBrokers.length === 0) return null;

  const brokers: BrokerEntry[] = rawBrokers.map((b: any) => {
    const ov = overrides[b.id];
    return {
      id: b.id,
      name: b.name,
      status: ov?.status ?? b.status ?? "disconnected",
      lastChange: ov?.timestamp ?? b.updatedAt ?? null,
    };
  });

  const connected = brokers.filter((b) => b.status === "connected").length;
  const errored   = brokers.filter((b) => b.status === "error").length;
  const total     = brokers.length;

  const summaryColor = errored > 0
    ? "text-red-600"
    : connected > 0
    ? "text-green-600"
    : "text-muted-foreground";

  const dotColor = errored > 0
    ? "bg-red-500"
    : connected > 0
    ? "bg-green-500 animate-pulse"
    : "bg-gray-400";

  if (!allowed) return null;
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors text-xs font-medium",
          open && "bg-muted"
        )}
        title="Broker connection status"
      >
        <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
        <span className={summaryColor}>
          {connected}/{total}
        </span>
        <Wifi className="w-3.5 h-3.5 text-muted-foreground" />
        <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-72 rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Wifi className="w-4 h-4 text-primary" />
              Broker Status
            </h3>
            <span className="text-xs text-muted-foreground">
              {connected} of {total} connected
            </span>
          </div>

          <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
            {brokers.map((broker) => {
              const cfg = statusCfg(broker.status);
              const Icon = cfg.icon;
              return (
                <div key={broker.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                    broker.status === "connected" ? "bg-green-100" :
                    broker.status === "error"     ? "bg-red-100"   : "bg-muted"
                  )}>
                    <Icon className={cn("w-4 h-4", cfg.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{broker.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.color)} />
                      <span className={cn("text-[11px] font-medium", cfg.text)}>{cfg.label}</span>
                    </div>
                  </div>
                  {broker.lastChange && (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 justify-end">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(broker.lastChange), { addSuffix: true })}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-4 py-2.5 border-t border-border bg-muted/20">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
              Status updates in real time via WebSocket
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
