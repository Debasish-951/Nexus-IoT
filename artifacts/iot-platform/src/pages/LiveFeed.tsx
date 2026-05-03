import { useState, useEffect, useRef, useCallback } from "react";
import { useListAssets } from "@workspace/api-client-react";
import { useWsEvents } from "@/hooks/useWsEvents";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Activity, Wifi, WifiOff, Filter, Trash2,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus,
  Zap, Radio, BarChart2, Clock,
} from "lucide-react";

// ── Colour palette ─────────────────────────────────────────────────────────────
const ASSET_COLORS = [
  "#06b6d4","#10b981","#a855f7","#f59e0b",
  "#ef4444","#818cf8","#ec4899","#f97316","#22d3ee","#84cc16",
];

// ── Types ──────────────────────────────────────────────────────────────────────
interface TelemetryEvent {
  id: string;
  assetId: string;
  assetName: string;
  metrics: Record<string, number>;
  timestamp: string;
  receivedAt: number;
}

interface MetricState {
  value: number;
  prev: number | null;
  lastSeen: number;
  count: number;
}

interface AssetMetrics {
  assetId: string;
  assetName: string;
  color: string;
  metrics: Record<string, MetricState>;
  lastSeen: number;
  eventCount: number;
}

const MAX_EVENTS = 200;
const STALE_MS   = 30_000; // 30s without update → stale

// ── Metric tile ────────────────────────────────────────────────────────────────
function MetricTile({ name, state, flash }: { name: string; state: MetricState; flash: boolean }) {
  const delta = state.prev !== null ? state.value - state.prev : null;
  const dir = delta === null ? 0 : delta > 0 ? 1 : delta < 0 ? -1 : 0;
  return (
    <div className={cn(
      "rounded-lg p-2.5 border transition-all duration-300",
      flash ? "border-cyan-400/60 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.2)]" : "border-white/8 bg-white/4",
    )}>
      <p className="text-[9px] font-mono truncate mb-1" style={{ color: "#64748b" }}>{name}</p>
      <div className="flex items-end gap-1">
        <span className="text-sm font-bold tabular-nums" style={{ color: "#e2e8f0" }}>
          {typeof state.value === "number"
            ? Math.abs(state.value) >= 1000
              ? state.value.toLocaleString(undefined, { maximumFractionDigits: 1 })
              : state.value.toFixed(Math.abs(state.value) < 0.01 ? 6 : Math.abs(state.value) < 1 ? 4 : 2)
            : "—"}
        </span>
        {dir !== 0 && (
          <span className={cn("text-[10px] mb-0.5", dir > 0 ? "text-green-400" : "text-red-400")}>
            {dir > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
          </span>
        )}
      </div>
      <p className="text-[8px] mt-0.5" style={{ color: "#475569" }}>{state.count} recv</p>
    </div>
  );
}

// ── Asset panel ─────────────────────────────────────────────────────────────────
function AssetPanel({ am, flashMetrics, expanded, onToggle }: {
  am: AssetMetrics; flashMetrics: Set<string>; expanded: boolean; onToggle: () => void;
}) {
  const isStale = Date.now() - am.lastSeen > STALE_MS;
  const metricEntries = Object.entries(am.metrics).sort(([a],[b]) => a.localeCompare(b));
  const shortAgo = Date.now() - am.lastSeen;
  const agoStr = shortAgo < 5000 ? "just now" : shortAgo < 60000 ? `${Math.round(shortAgo/1000)}s ago` : `${Math.round(shortAgo/60000)}m ago`;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111827", border: `1px solid #1f2d45` }}>
      {/* Header */}
      <button className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/4 transition-colors text-left"
        onClick={onToggle}>
        <div className="w-2 h-2 rounded-full shrink-0 transition-all"
          style={{ background: am.color, boxShadow: isStale ? "none" : `0 0 8px ${am.color}` }} />
        <span className="text-xs font-semibold flex-1 truncate" style={{ color: "#e2e8f0" }}>{am.assetName}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: isStale ? "#1f2d45" : `${am.color}22`, color: isStale ? "#475569" : am.color }}>
          {isStale ? "stale" : "live"}
        </span>
        <span className="text-[9px] mr-1" style={{ color: "#475569" }}>{agoStr}</span>
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "#1f2d45", color: "#64748b" }}>
          {metricEntries.length}M · {am.eventCount}E
        </span>
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" style={{ color: "#64748b" }} />
                  : <ChevronRight className="w-3 h-3 shrink-0" style={{ color: "#64748b" }} />}
      </button>

      {/* Metrics grid */}
      {expanded && (
        <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
          {metricEntries.map(([name, state]) => (
            <MetricTile key={name} name={name} state={state}
              flash={flashMetrics.has(`${am.assetId}::${name}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Event log row ──────────────────────────────────────────────────────────────
function EventRow({ ev, color }: { ev: TelemetryEvent; color: string }) {
  const [open, setOpen] = useState(false);
  const metricEntries = Object.entries(ev.metrics);
  return (
    <div className="border-b transition-colors hover:bg-white/3" style={{ borderColor: "#1f2d45" }}>
      <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left" onClick={() => setOpen(o => !o)}>
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="font-mono text-[9px] shrink-0 tabular-nums" style={{ color: "#475569" }}>
          {format(new Date(ev.receivedAt), "HH:mm:ss.SSS")}
        </span>
        <span className="text-xs font-semibold truncate max-w-[120px]" style={{ color: "#e2e8f0" }}>{ev.assetName}</span>
        <div className="flex-1 flex gap-1 min-w-0 overflow-hidden">
          {metricEntries.slice(0, 4).map(([k, v]) => (
            <span key={k} className="text-[9px] font-mono px-1 rounded shrink-0" style={{ background: "#1f2d45", color: "#06b6d4" }}>
              {k}: <span style={{ color: "#e2e8f0" }}>{typeof v === "number" ? v.toFixed(3) : String(v)}</span>
            </span>
          ))}
          {metricEntries.length > 4 && (
            <span className="text-[9px] shrink-0" style={{ color: "#475569" }}>+{metricEntries.length - 4} more</span>
          )}
        </div>
        {open ? <ChevronDown className="w-3 h-3 shrink-0" style={{ color: "#475569" }} />
              : <ChevronRight className="w-3 h-3 shrink-0" style={{ color: "#475569" }} />}
      </button>
      {open && (
        <div className="px-3 pb-2.5 flex flex-wrap gap-1">
          {metricEntries.map(([k, v]) => (
            <span key={k} className="text-[9px] font-mono px-1.5 py-0.5 rounded border" style={{ background: "#0b0f1a", borderColor: "#1f2d45", color: "#94a3b8" }}>
              <span style={{ color: "#64748b" }}>{k}</span>: <span style={{ color: "#06b6d4" }}>{typeof v === "number" ? v : String(v)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function LiveFeed() {
  const { data: assetsData } = useListAssets();
  const allAssets = (assetsData as any[] | undefined) ?? [];

  const [events,      setEvents]      = useState<TelemetryEvent[]>([]);
  const [assetMap,    setAssetMap]    = useState<Record<string, AssetMetrics>>({});
  const [flashSet,    setFlashSet]    = useState<Set<string>>(new Set());
  const [filterAsset, setFilterAsset] = useState<string>("");
  const [expanded,    setExpanded]    = useState<Record<string, boolean>>({});
  const [eventsPerMin,setEventsPerMin]= useState(0);
  const [totalEvents, setTotalEvents] = useState(0);
  const [wsStatus,    setWsStatus]    = useState<"connecting"|"connected"|"reconnecting">("connecting");

  // Color assignment per asset
  const colorMapRef = useRef<Record<string, string>>({});
  function getColor(assetId: string): string {
    if (!colorMapRef.current[assetId]) {
      const idx = Object.keys(colorMapRef.current).length;
      colorMapRef.current[assetId] = ASSET_COLORS[idx % ASSET_COLORS.length];
    }
    return colorMapRef.current[assetId];
  }

  // Events per minute calculation
  const recentTimestamps = useRef<number[]>([]);
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      recentTimestamps.current = recentTimestamps.current.filter(t => now - t < 60_000);
      setEventsPerMin(recentTimestamps.current.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleTelemetry = useCallback((data: any) => {
    if (!data?.assetId || !data?.metrics) return;
    const ev: TelemetryEvent = {
      id: crypto.randomUUID(),
      assetId: data.assetId,
      assetName: data.assetName ?? data.assetId,
      metrics: data.metrics,
      timestamp: data.timestamp ?? new Date().toISOString(),
      receivedAt: Date.now(),
    };
    recentTimestamps.current.push(Date.now());
    setTotalEvents(n => n + 1);
    setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS));

    const color = getColor(ev.assetId);
    setAssetMap(prev => {
      const existing = prev[ev.assetId];
      const updatedMetrics: Record<string, MetricState> = { ...(existing?.metrics ?? {}) };
      for (const [k, v] of Object.entries(ev.metrics)) {
        const num = typeof v === "number" ? v : Number(v);
        if (!isNaN(num)) {
          updatedMetrics[k] = {
            value: num,
            prev: existing?.metrics[k]?.value ?? null,
            lastSeen: Date.now(),
            count: (existing?.metrics[k]?.count ?? 0) + 1,
          };
        }
      }
      return {
        ...prev,
        [ev.assetId]: {
          assetId: ev.assetId,
          assetName: ev.assetName,
          color,
          metrics: updatedMetrics,
          lastSeen: Date.now(),
          eventCount: (existing?.eventCount ?? 0) + 1,
        },
      };
    });

    // Flash new metric keys
    const flashKeys = Object.keys(ev.metrics).map(k => `${ev.assetId}::${k}`);
    setFlashSet(new Set(flashKeys));
    setTimeout(() => setFlashSet(new Set()), 800);

    // Auto-expand new assets
    setExpanded(prev => ev.assetId in prev ? prev : { ...prev, [ev.assetId]: true });
  }, []);

  const status = useWsEvents({ telemetry: handleTelemetry });
  useEffect(() => { setWsStatus(status); }, [status]);

  const assetEntries = Object.values(assetMap).sort((a, b) => b.lastSeen - a.lastSeen);
  const filteredEvents = filterAsset ? events.filter(e => e.assetId === filterAsset) : events;
  const liveAssetCount = assetEntries.filter(a => Date.now() - a.lastSeen < STALE_MS).length;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#0b0f1a" }}>

      {/* ── Top bar ── */}
      <div className="shrink-0 px-4 py-3 flex items-center gap-3 flex-wrap"
        style={{ background: "#111827", borderBottom: "1px solid #1f2d45" }}>
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4" style={{ color: "#06b6d4" }} />
          <span className="text-sm font-bold" style={{ color: "#e2e8f0" }}>Live Telemetry Feed</span>
        </div>

        {/* WS status */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium"
          style={{
            background: wsStatus === "connected" ? "#10b98122" : "#f59e0b22",
            color: wsStatus === "connected" ? "#10b981" : "#f59e0b",
            border: `1px solid ${wsStatus === "connected" ? "#10b98144" : "#f59e0b44"}`,
          }}>
          {wsStatus === "connected"
            ? <><Wifi className="w-3 h-3" /><span className="animate-pulse w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /></>
            : <WifiOff className="w-3 h-3" />}
          {wsStatus}
        </div>

        <div className="flex items-center gap-4 ml-2">
          <Stat label="Events/min" value={eventsPerMin} color="#06b6d4" />
          <Stat label="Live assets" value={liveAssetCount} color="#10b981" />
          <Stat label="Total received" value={totalEvents} color="#818cf8" />
          <Stat label="Metrics tracked" value={Object.values(assetMap).reduce((s,a)=>s+Object.keys(a.metrics).length,0)} color="#f59e0b" />
        </div>

        <div className="flex-1" />

        {/* Asset filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5" style={{ color: "#64748b" }} />
          <select value={filterAsset} onChange={e => setFilterAsset(e.target.value)}
            className="h-7 rounded border px-2 text-xs"
            style={{ background: "#161e2e", color: "#e2e8f0", borderColor: "#2d3f5a" }}>
            <option value="">All assets</option>
            {assetEntries.map(a => <option key={a.assetId} value={a.assetId}>{a.assetName}</option>)}
          </select>
        </div>

        {events.length > 0 && (
          <button onClick={() => { setEvents([]); setTotalEvents(0); recentTimestamps.current = []; }}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs"
            style={{ background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444" }}>
            <Trash2 className="w-3 h-3" /> Clear log
          </button>
        )}
      </div>

      {/* ── Body: two panes ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Asset metric panels ── */}
        <div className="w-[55%] flex flex-col overflow-hidden"
          style={{ borderRight: "1px solid #1f2d45" }}>
          <div className="px-3 py-2 shrink-0 flex items-center gap-2"
            style={{ borderBottom: "1px solid #1f2d45" }}>
            <BarChart2 className="w-3.5 h-3.5" style={{ color: "#06b6d4" }} />
            <span className="text-xs font-semibold" style={{ color: "#94a3b8" }}>Asset Metric Panels</span>
            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded" style={{ background: "#1f2d45", color: "#64748b" }}>
              {assetEntries.length} asset{assetEntries.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {assetEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Radio className="w-12 h-12 mb-3 opacity-20" style={{ color: "#64748b" }} />
                <p className="text-sm font-semibold mb-1" style={{ color: "#64748b" }}>Waiting for live data…</p>
                <p className="text-xs max-w-xs" style={{ color: "#475569" }}>
                  Start the Payload Simulator or send data from Node-RED using POST /api/ingest/payload
                </p>
              </div>
            ) : (
              (filterAsset ? assetEntries.filter(a => a.assetId === filterAsset) : assetEntries).map(am => (
                <AssetPanel key={am.assetId} am={am} flashMetrics={flashSet}
                  expanded={expanded[am.assetId] ?? true}
                  onToggle={() => setExpanded(prev => ({ ...prev, [am.assetId]: !prev[am.assetId] }))} />
              ))
            )}
          </div>
        </div>

        {/* ── Right: Event log ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-2 shrink-0 flex items-center gap-2"
            style={{ borderBottom: "1px solid #1f2d45" }}>
            <Activity className="w-3.5 h-3.5" style={{ color: "#a855f7" }} />
            <span className="text-xs font-semibold" style={{ color: "#94a3b8" }}>Event Stream</span>
            {wsStatus === "connected" && (
              <span className="flex items-center gap-1 text-[9px] ml-1" style={{ color: "#10b981" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />LIVE
              </span>
            )}
            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded" style={{ background: "#1f2d45", color: "#64748b" }}>
              {filteredEvents.length}/{MAX_EVENTS}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Zap className="w-10 h-10 mb-3 opacity-20" style={{ color: "#64748b" }} />
                <p className="text-xs" style={{ color: "#475569" }}>Events will appear here as data arrives</p>
              </div>
            ) : (
              filteredEvents.map(ev => (
                <EventRow key={ev.id} ev={ev} color={getColor(ev.assetId)} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom status bar ── */}
      <div className="shrink-0 px-4 py-1 flex items-center gap-3"
        style={{ background: "#111827", borderTop: "1px solid #1f2d45" }}>
        <span className="text-[9px]" style={{ color: "#475569" }}>
          <Clock className="w-2.5 h-2.5 inline mr-1" />
          Buffer: {MAX_EVENTS} events max · Stale after {STALE_MS/1000}s
        </span>
        <span style={{ color: "#1f2d45" }}>·</span>
        <span className="text-[9px]" style={{ color: "#475569" }}>
          Data flows in via WebSocket — no polling required
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <p className="text-sm font-bold tabular-nums" style={{ color }}>{value}</p>
      <p className="text-[9px]" style={{ color: "#475569" }}>{label}</p>
    </div>
  );
}
