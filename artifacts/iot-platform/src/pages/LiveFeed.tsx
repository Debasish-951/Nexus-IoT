import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useListAssets, useGetDashboardSummary, useGetRecentTelemetry, getGetRecentTelemetryQueryKey } from "@workspace/api-client-react";
import { useWsEvents } from "@/hooks/useWsEvents";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Activity, Wifi, WifiOff, Filter, Download, Search, Box, AlarmClock, AlertTriangle,
  Radio, Cpu, BrainCircuit, TrendingUp, ChevronLeft, ChevronRight, Bell,
} from "lucide-react";
import { AreaChart, Area, BarChart, Bar, ResponsiveContainer } from "recharts";
import { useThemePalette, type ThemePalette } from "@/hooks/useTheme";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const STALE_MS = 30_000;
const MAX_EVENTS = 1000;

// Palette now comes from useThemePalette() so this page follows the app theme.
// It was a fixed light-only object, which is why Live Feed stayed white while
// everything else went dark: the colours are applied as inline styles, and
// inline styles cannot carry a Tailwind `dark:` variant.

interface SensorRow { id: string; ts: number; assetId: string; assetName: string; sensor: string; value: number; }
interface AssetLatest { assetId: string; assetName: string; metrics: Record<string, number>; lastSeen: number; }
interface AlarmRow { id: string; name: string; assetName: string; severity: string; status: string; message: string; triggeredAt: string; }
interface ActivityRow { id: string; action: string; category: string; detail: string | null; targetName: string | null; timestamp: string; }
interface Health { health: "ok" | "alarm" | "stale"; freshnessPct: number | null; activeAlarms: number; }

// Takes the palette explicitly — it is module-scope, so it cannot call the hook.
const sevColor = (C: ThemePalette, s: string) =>
  s === "critical" ? C.red : s === "high" ? C.amber : s === "medium" ? C.amber : C.blue;

export default function LiveFeed() {
  const C = useThemePalette();
  const [, navigate] = useLocation();
  const { data: assetsData } = useListAssets();
  const { data: summaryData } = useGetDashboardSummary();
  const { data: recentData } = useGetRecentTelemetry({ limit: 100 }, { query: { queryKey: getGetRecentTelemetryQueryKey({ limit: 100 }), refetchInterval: 8000 } });
  const allAssets = (assetsData as any[] | undefined) ?? [];
  const summary = (summaryData as any) ?? {};

  const [events, setEvents] = useState<SensorRow[]>([]);
  const [latest, setLatest] = useState<Record<string, AssetLatest>>({});
  const [alarms, setAlarms] = useState<AlarmRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, Health>>({});
  const [devices, setDevices] = useState<number>(0);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [liveActive, setLiveActive] = useState(false);
  const [rateSeries, setRateSeries] = useState<{ v: number }[]>(Array.from({ length: 24 }, () => ({ v: 0 })));
  const [search, setSearch] = useState("");
  const [filterAsset, setFilterAsset] = useState("");
  const [page, setPage] = useState(0);

  const tsRef = useRef<number[]>([]);

  // ── fetchers ──
  const fetchAlarms = useCallback(() => {
    fetch(`${BASE}/api/alarms?status=active`).then((r) => (r.ok ? r.json() : [])).then((d) => setAlarms(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  const fetchActivities = useCallback(() => {
    fetch(`${BASE}/api/activity-log?limit=8`).then((r) => (r.ok ? r.json() : { entries: [] })).then((d) => setActivities(d.entries ?? [])).catch(() => {});
  }, []);
  const fetchDevices = useCallback(() => {
    fetch(`${BASE}/api/ingest/seen-devices`).then((r) => (r.ok ? r.json() : [])).then((d) => setDevices(Array.isArray(d) ? d.length : 0)).catch(() => {});
  }, []);
  const fetchHealth = useCallback((ids: string[]) => {
    Promise.all(ids.slice(0, 12).map(async (id) => {
      try { const r = await fetch(`${BASE}/api/assets/${id}/health`); return r.ok ? [id, await r.json()] as const : null; } catch { return null; }
    })).then((es) => { const m: Record<string, Health> = {}; for (const e of es) if (e) m[e[0]] = e[1]; setHealthMap(m); });
  }, []);

  useEffect(() => { fetchAlarms(); fetchActivities(); fetchDevices(); }, [fetchAlarms, fetchActivities, fetchDevices]);
  useEffect(() => { if (allAssets.length) fetchHealth(allAssets.map((a) => a.id)); }, [assetsData]); // eslint-disable-line
  useEffect(() => {
    const iv = setInterval(() => { fetchAlarms(); fetchActivities(); if (allAssets.length) fetchHealth(allAssets.map((a) => a.id)); }, 20_000);
    return () => clearInterval(iv);
  }, [assetsData]); // eslint-disable-line

  // rolling messages/sec sampler (every 1s → bucket count)
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      const inWindow = tsRef.current.filter((t) => now - t < 1000).length;
      tsRef.current = tsRef.current.filter((t) => now - t < 60_000);
      setLiveActive(tsRef.current.some((t) => now - t < 8000));
      setRateSeries((prev) => [...prev.slice(-23), { v: inWindow }]);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const handleTelemetry = useCallback((data: any) => {
    if (!data?.assetId || !data?.metrics) return;
    const now = Date.now();
    const assetName = data.assetName ?? data.assetId;
    const numeric: Record<string, number> = {};
    const rows: SensorRow[] = [];
    for (const [k, v] of Object.entries(data.metrics)) {
      const n = typeof v === "number" ? v : Number(v);
      if (!isNaN(n)) { numeric[k] = n; rows.push({ id: `${now}-${k}-${Math.random().toString(36).slice(2, 6)}`, ts: now, assetId: data.assetId, assetName, sensor: k, value: n }); }
    }
    tsRef.current.push(now);
    setEvents((prev) => [...rows, ...prev].slice(0, MAX_EVENTS));
    setLatest((prev) => ({ ...prev, [data.assetId]: { assetId: data.assetId, assetName, metrics: { ...(prev[data.assetId]?.metrics ?? {}), ...numeric }, lastSeen: now } }));
  }, []);
  const handleAlarm = useCallback(() => fetchAlarms(), [fetchAlarms]);
  const handleActivity = useCallback(() => fetchActivities(), [fetchActivities]);
  const status = useWsEvents({ telemetry: handleTelemetry, alarm: handleAlarm, activity_log: handleActivity });
  useEffect(() => { setWsStatus(status); }, [status]);

  // Seed Asset Status + Sensor Feed from stored telemetry so recent data shows
  // immediately (not just live WS events received while the page is open).
  useEffect(() => {
    const rows = (recentData as any[] | undefined) ?? [];
    if (!rows.length) return;
    const nameOf = (r: any) => allAssets.find((a) => a.id === r.assetId)?.name ?? r.deviceId ?? r.assetId;
    setEvents((prev) => {
      if (prev.length) return prev;
      return rows.map((r) => ({
        id: r.id ?? `${r.assetId}-${r.metric}-${r.timestamp}`,
        ts: new Date(r.timestamp).getTime(), assetId: r.assetId, assetName: nameOf(r),
        sensor: r.metric, value: Number(r.value),
      })).filter((e) => !isNaN(e.value));
    });
    setLatest((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const v = Number(r.value); if (isNaN(v)) continue;
        const ts = new Date(r.timestamp).getTime();
        if (!next[r.assetId]) next[r.assetId] = { assetId: r.assetId, assetName: nameOf(r), metrics: {}, lastSeen: ts };
        if (!(r.metric in next[r.assetId].metrics)) next[r.assetId].metrics[r.metric] = v; // newest row wins (rows are desc)
        next[r.assetId].lastSeen = Math.max(next[r.assetId].lastSeen, ts);
      }
      return next;
    });
  }, [recentData, assetsData]); // eslint-disable-line

  async function acknowledge(id: string) {
    await fetch(`${BASE}/api/alarms/${id}/acknowledge`, { method: "POST" }).catch(() => {});
    fetchAlarms();
  }

  // ── derived ──
  const liveAssets = Object.values(latest).filter((a) => Date.now() - a.lastSeen < STALE_MS);
  const activeAlarms = alarms.filter((a) => a.status === "active");
  const criticalCount = activeAlarms.filter((a) => a.severity === "critical").length;
  const warningCount = activeAlarms.filter((a) => a.severity !== "critical").length;
  const msgsPerSec = rateSeries[rateSeries.length - 1]?.v ?? 0;
  // Count only root/device-owning assets — children share the parent's device.
  const rootAssets = allAssets.filter((a) => !a.parentId);
  const totalAssets = rootAssets.length;
  // Connected devices = distinct device ids actually linked to an asset (ignores
  // orphan seen-devices that transmitted but were never turned into an asset).
  const linkedDevices = new Set(allAssets.map((a) => a.identifier).filter(Boolean)).size;

  // "Live" = live WS events in last 8s, OR freshest stored telemetry within 15s
  // (covers the case where WS isn't delivering but data is actively ingesting).
  const newestTs = useMemo(() => {
    const rows = (recentData as any[] | undefined) ?? [];
    let m = 0; for (const r of rows) { const t = new Date(r.timestamp).getTime(); if (t > m) m = t; }
    return m;
  }, [recentData]);
  const live = liveActive || (newestTs > 0 && Date.now() - newestTs < 15000);

  const statusOf = (assetId: string): { label: string; color: string } => {
    const h = healthMap[assetId];
    const hasAlarm = activeAlarms.some((a) => a.assetName && allAssets.find((x) => x.id === assetId)?.name === a.assetName);
    if (hasAlarm || h?.health === "alarm") return { label: criticalCount > 0 ? "Critical" : "Warning", color: criticalCount > 0 ? C.red : C.amber };
    if (h?.health === "stale" || Date.now() - (latest[assetId]?.lastSeen ?? 0) > STALE_MS) return { label: "Offline", color: C.dim };
    return { label: "Running", color: C.green };
  };

  // asset status cards = most recently active assets (up to 3)
  const statusCards = Object.values(latest).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 3);

  // health ranking
  const ranked = allAssets
    .map((a) => ({ a, pct: healthMap[a.id]?.freshnessPct ?? null }))
    .filter((x) => x.pct != null)
    .sort((x, y) => (y.pct! - x.pct!));
  const topHealthy = ranked.slice(0, 3);
  const needsAttention = [...ranked].reverse().slice(0, 3);

  // sensor feed filter + paging
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) =>
      (!filterAsset || e.assetId === filterAsset) &&
      (!q || e.assetName.toLowerCase().includes(q) || e.sensor.toLowerCase().includes(q)));
  }, [events, search, filterAsset]);
  const PAGE = 8;
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));

  function exportCsv() {
    const header = "time,asset,sensor,value";
    const rows = filtered.map((e) => `${new Date(e.ts).toISOString()},${e.assetName},${e.sensor},${e.value}`);
    const url = URL.createObjectURL(new Blob([[header, ...rows].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `sensor_feed_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4" style={{ background: C.bg }}>
      <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/data-explorer"))}
        className="flex items-center gap-1 text-sm hover:opacity-70" style={{ color: C.dim }}>
        <ChevronLeft className="w-4 h-4" /> Back
      </button>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold" style={{ color: C.text }}>Live Operations Center</h1>
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: live ? `${C.green}22` : `${C.dim}22`, color: live ? C.green : C.dim }}>
            {live ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {live && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: C.green }} />}
            {live ? "Live" : "No live data"}
          </span>
        </div>
        <span className="text-xs" style={{ color: C.dim }}>Real-time monitoring of assets and sensors</span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Kpi icon={Box} label="Assets Online" value={liveAssets.length} sub={`/ ${totalAssets} total assets`} color={C.green} series={rateSeries} chart="area" />
        <Kpi icon={Cpu} label="Connected Devices" value={linkedDevices} sub="devices linked to assets" color={C.violet} series={rateSeries} chart="area" />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-4">
          {/* Live Asset Status */}
          <Panel title="Live Asset Status" right={<ViewAll onClick={() => navigate("/assets")} />}>
            {statusCards.length === 0 ? (
              <Empty text="Waiting for live asset data…" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3">
                {statusCards.map((a) => {
                  const st = statusOf(a.assetId);
                  const hi = healthMap[a.assetId]?.freshnessPct ?? null;
                  const metricEntries = Object.entries(a.metrics).slice(0, 4);
                  return (
                    <div key={a.assetId} className="rounded-xl p-3" style={{ background: C.soft, border: `1px solid ${C.border}` }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold truncate" style={{ color: C.text }}>{a.assetName}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${st.color}22`, color: st.color }}>{st.label}</span>
                      </div>
                      <div className="space-y-1">
                        {metricEntries.map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between text-xs">
                            <span className="truncate" style={{ color: C.dim }}>{k}</span>
                            <span className="font-mono font-medium" style={{ color: C.text }}>{Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                      {hi != null && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-[10px] mb-0.5"><span style={{ color: C.dim }}>Health Index</span><span style={{ color: C.text }}>{Math.round(hi)}%</span></div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.border }}>
                            <div className="h-full rounded-full" style={{ width: `${hi}%`, background: hi >= 70 ? C.green : hi >= 40 ? C.amber : C.red }} />
                          </div>
                        </div>
                      )}
                      <p className="text-[10px] mt-2" style={{ color: C.faint }}>Updated {Math.max(0, Math.round((Date.now() - a.lastSeen) / 1000))}s ago</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Live Sensor Feed */}
          <Panel title="Live Sensor Feed" right={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: C.dim }} />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search sensor, asset…"
                  className="h-7 w-44 rounded border pl-7 pr-2 text-xs" style={{ background: C.soft, color: C.text, borderColor: C.border }} />
              </div>
              <select value={filterAsset} onChange={(e) => { setFilterAsset(e.target.value); setPage(0); }}
                className="h-7 rounded border px-2 text-xs" style={{ background: C.soft, color: C.text, borderColor: C.border }}>
                <option value="">All assets</option>
                {Object.values(latest).map((a) => <option key={a.assetId} value={a.assetId}>{a.assetName}</option>)}
              </select>
              <button onClick={exportCsv} className="flex items-center gap-1 h-7 px-2 rounded border text-xs" style={{ background: C.soft, color: C.muted, borderColor: C.border }}>
                <Download className="w-3 h-3" /> Export
              </button>
            </div>
          }>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: C.dim, borderBottom: `1px solid ${C.border}` }}>
                    <th className="text-left px-3 py-2 font-medium">Time</th>
                    <th className="text-left px-3 py-2 font-medium">Asset</th>
                    <th className="text-left px-3 py-2 font-medium">Sensor</th>
                    <th className="text-left px-3 py-2 font-medium">Value</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-10 text-center" style={{ color: C.faint }}>No sensor data yet — start ingesting telemetry.</td></tr>
                  ) : pageRows.map((e) => (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td className="px-3 py-2 font-mono" style={{ color: C.faint }}>{format(new Date(e.ts), "HH:mm:ss")}</td>
                      <td className="px-3 py-2" style={{ color: C.text }}>{e.assetName}</td>
                      <td className="px-3 py-2" style={{ color: C.muted }}>{e.sensor}</td>
                      <td className="px-3 py-2 font-mono" style={{ color: C.cyan }}>{Math.abs(e.value) < 1 ? e.value.toFixed(3) : e.value.toFixed(2)}</td>
                      <td className="px-3 py-2"><span className="flex items-center gap-1.5" style={{ color: C.green }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: C.green }} />Normal</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-3 py-2 text-[11px]" style={{ color: C.dim, borderTop: `1px solid ${C.border}` }}>
              <span>Showing {filtered.length === 0 ? 0 : page * PAGE + 1}–{Math.min((page + 1) * PAGE, filtered.length)} of {filtered.length}</span>
              <div className="flex items-center gap-1">
                <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="p-1 rounded disabled:opacity-30" style={{ color: C.muted }}><ChevronLeft className="w-3.5 h-3.5" /></button>
                <span>{page + 1}/{pageCount}</span>
                <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="p-1 rounded disabled:opacity-30" style={{ color: C.muted }}><ChevronRight className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </Panel>

          {/* Health ranking + Event timeline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Panel title="Asset Health Ranking" right={<ViewAll onClick={() => navigate("/assets")} />}>
              <div className="p-3 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-medium mb-2" style={{ color: C.green }}>Top Healthy Assets</p>
                  {topHealthy.length === 0 ? <p className="text-xs" style={{ color: C.faint }}>—</p> : topHealthy.map((x, i) => (
                    <Rank key={x.a.id} i={i + 1} name={x.a.name} pct={Math.round(x.pct!)} color={C.green} />
                  ))}
                </div>
                <div>
                  <p className="text-[11px] font-medium mb-2" style={{ color: C.red }}>Needs Attention</p>
                  {needsAttention.length === 0 ? <p className="text-xs" style={{ color: C.faint }}>—</p> : needsAttention.map((x, i) => (
                    <Rank key={x.a.id} i={i + 1} name={x.a.name} pct={Math.round(x.pct!)} color={x.pct! < 50 ? C.red : C.amber} />
                  ))}
                </div>
              </div>
            </Panel>

            <Panel title="Live Event Timeline" right={<ViewAll onClick={() => navigate("/activity-log")} />}>
              <div className="p-3 space-y-2.5">
                {activities.length === 0 ? <Empty text="No recent events" /> : activities.slice(0, 6).map((e, i) => (
                  <div key={e.id} className="flex items-center gap-2.5 text-xs">
                    <span className="font-mono shrink-0" style={{ color: C.faint }}>{format(new Date(e.timestamp), "HH:mm")}</span>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: [C.green, C.amber, C.cyan, C.violet, C.blue][i % 5] }} />
                    <span className="truncate" style={{ color: C.text }}>{e.detail ?? `${e.action}${e.targetName ? ` — ${e.targetName}` : ""}`}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── KPI card ──
function Kpi({ icon: Icon, label, value, sub, color, series, chart }: {
  icon: React.ElementType; label: string; value: number; sub: string; color: string; series?: { v: number }[]; chart?: "area" | "bar";
}) {
  const C = useThemePalette();
  return (
    <div className="rounded-xl p-4 relative overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${color}` }}>
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: C.dim }}>{label}</span>
        <span className="p-1.5 rounded-lg" style={{ background: `${color}1f`, color }}><Icon className="w-4 h-4" /></span>
      </div>
      <p className="text-3xl font-bold tabular-nums mt-1.5" style={{ color: C.text }}>{value.toLocaleString()}</p>
      <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{sub}</p>
      {series && chart && (
        <div className="h-8 mt-2 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            {chart === "area" ? (
              <AreaChart data={series}><Area type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} dot={false} /></AreaChart>
            ) : (
              <BarChart data={series}><Bar dataKey="v" fill={color} radius={[1, 1, 0, 0]} isAnimationActive={false} /></BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Panel({ title, right, demo, children }: { title: string; right?: React.ReactNode; demo?: boolean; children: React.ReactNode }) {
  const C = useThemePalette();
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: C.text }}>{title}</span>
          {demo && <span className="text-[9px] px-1.5 py-px rounded uppercase tracking-wide" style={{ background: `${C.violet}22`, color: C.violet }}>demo</span>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ViewAll({ onClick }: { onClick: () => void }) {
  const C = useThemePalette();
  return (
    <button onClick={onClick} className="text-xs hover:underline" style={{ color: C.cyan }}>
      View all
    </button>
  );
}

function Empty({ text }: { text: string }) {
  const C = useThemePalette();
  return <div className="flex flex-col items-center justify-center py-10 text-center"><Activity className="w-8 h-8 mb-2 opacity-20" style={{ color: C.dim }} /><p className="text-xs" style={{ color: C.faint }}>{text}</p></div>;
}

function Rank({ i, name, pct, color }: { i: number; name: string; pct: number; color: string }) {
  const C = useThemePalette();
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[10px] w-3" style={{ color: C.faint }}>{i}</span>
      <span className="text-xs flex-1 truncate" style={{ color: C.text }}>{name}</span>
      <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: C.border }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
      <span className="text-[10px] font-mono w-8 text-right" style={{ color }}>{pct}%</span>
    </div>
  );
}
