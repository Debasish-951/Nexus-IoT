import { useState, useEffect, useCallback, useMemo } from "react";
import { useListAssets } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import {
  Box, Bell, AlertTriangle, Wrench, FileText, User, Settings,
  Search, Activity as ActivityIcon, ChevronRight, Info, Maximize2, LayoutGrid,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useWsEvents } from "@/hooks/useWsEvents";
import { ViewSwitch } from "@/features/home/ViewSwitch";
import { Greeting } from "@/features/home/Greeting";
import { FEATURES } from "@/lib/features";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Pages reachable from global search (label → route).
const PAGES: { label: string; path: string }[] = [
  { label: "Dashboard", path: "/" }, { label: "Assets", path: "/assets" },
  { label: "Asset Templates", path: "/asset-templates" }, { label: "Media Library", path: "/media-library" },
  { label: "Live Feed", path: "/live" }, { label: "Data Insights", path: "/data-explorer" },
  { label: "Visualization", path: "/visualization" }, { label: "Analytics & KPI", path: "/analytics-kpi" },
  { label: "Alarms", path: "/alarms" }, { label: "Alarm History", path: "/alarm-history" },
  { label: "Alarm Rules", path: "/alarm-rules" }, { label: "Brokers", path: "/brokers" },
  { label: "Destinations", path: "/destinations" }, { label: "Connections", path: "/integrations" },
  { label: "Users", path: "/users" }, { label: "API Clients", path: "/api-clients" },
  ...(FEATURES.notificationChannels ? [{ label: "Notification Groups", path: "/notification-groups" }] : []),
  { label: "Reports", path: "/reports" },
  { label: "Data Management", path: "/data-management" }, { label: "Audit Log", path: "/activity-log" },
  { label: "Settings", path: "/settings" },
];

interface SearchResult { type: string; label: string; sub?: string; path: string; icon: React.ElementType }

// ── Types ───────────────────────────────────────────────────────────────────────
interface ActiveAlarm {
  id: string; name: string; assetId: string | null; assetName: string;
  severity: string; status: string; message: string; triggeredAt: string;
  alarmClass?: string | null;
}
interface AssetHealth {
  health: "ok" | "alarm" | "stale";
  freshnessPct: number | null; activeAlarms: number; lastSeen: string | null;
}
interface ActivityEntry {
  id: string; action: string; category: string;
  actorName: string; targetName: string | null; detail: string | null; timestamp: string;
}
type Bucket = "high" | "medium" | "low" | "missing";
interface AssetRow {
  assetId: string; name: string; bucket: Bucket; score: number | null;
}

// ── Severity ranking ──────────────────────────────────────────────────────────
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

// Map an asset's worst active-alarm severity + freshness into a health bucket + score.
function classify(worstSeverity: string | null, health: AssetHealth | null): { bucket: Bucket; score: number | null } {
  const stale = !health || health.health === "stale" || !health.lastSeen;
  if (stale) return { bucket: "missing", score: null };
  if (worstSeverity === "critical")           return { bucket: "high",   score: 20 };
  if (worstSeverity === "high")               return { bucket: "high",   score: 38 };
  if (worstSeverity === "medium")             return { bucket: "medium", score: 52 };
  if (worstSeverity === "low" || worstSeverity === "info") return { bucket: "medium", score: 68 };
  // No active alarm → healthy; use data freshness as the score floor.
  return { bucket: "low", score: Math.max(85, health?.freshnessPct ?? 95) };
}

const BUCKET_META: Record<Bucket | "total", { label: string; sub: string; text: string; bg: string; dot: string; bar: string }> = {
  high:    { label: "High",         sub: "Need for action",   text: "text-red-600",    bg: "bg-red-50",    dot: "bg-red-500",    bar: "bg-red-500" },
  medium:  { label: "Medium",       sub: "Need for action",   text: "text-orange-500", bg: "bg-orange-50", dot: "bg-orange-500", bar: "bg-orange-500" },
  low:     { label: "Low",          sub: "Good condition",    text: "text-green-600",  bg: "bg-green-50",  dot: "bg-green-500",  bar: "bg-green-500" },
  missing: { label: "Missing data", sub: "No recent data",    text: "text-slate-500",  bg: "bg-slate-100", dot: "bg-slate-400",  bar: "bg-slate-400" },
  total:   { label: "Total",        sub: "All assets",        text: "text-slate-800",  bg: "bg-slate-100", dot: "bg-slate-800",  bar: "bg-slate-800" },
};

// ── Health summary card ───────────────────────────────────────────────────────
function HealthCard({ b, count, onClick }: { b: Bucket | "total"; count: number; onClick?: () => void }) {
  const m = BUCKET_META[b];
  return (
    <Card className={cn("shadow-sm transition-all", onClick && "cursor-pointer hover:shadow-md")} onClick={onClick}>
      <CardContent className="p-4">
        <p className="text-sm font-semibold text-foreground">{m.label}</p>
        <p className="text-xs text-muted-foreground mb-3">{m.sub}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", m.dot)} />
            <span className={cn("text-3xl font-bold tabular-nums", m.text)}>{count}</span>
            <span className="text-xs text-muted-foreground mt-2">Assets</span>
          </div>
          <Info className="w-3.5 h-3.5 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Panel shell ───────────────────────────────────────────────────────────────
function Panel({ title, onMore, children }: { title: string; onMore?: () => void; children: React.ReactNode }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">{title}</h3>
          {onMore && <button onClick={onMore} className="text-muted-foreground hover:text-foreground"><ChevronRight className="w-4 h-4" /></button>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

const ACTIVITY_ICON: Record<string, React.ElementType> = {
  asset: Box, alarm: AlertTriangle, user: User, system: Settings, maintenance: Wrench, template: FileText,
};

// ── Main Dashboard ──────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: assets } = useListAssets();
  const assetList = (assets as any[] | undefined) ?? [];

  const [alarms, setAlarms] = useState<ActiveAlarm[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, AssetHealth>>({});
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  const fetchAlarms = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/alarms?status=active`);
      if (res.ok) setAlarms(await res.json());
    } catch {}
  }, []);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/activity-log?limit=8`);
      if (res.ok) { const d = await res.json(); setActivities(d.entries ?? []); }
    } catch {}
  }, []);

  const fetchHealth = useCallback(async (ids: string[]) => {
    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(`${BASE}/api/assets/${id}/health`);
        return res.ok ? [id, await res.json()] as const : null;
      } catch { return null; }
    }));
    const map: Record<string, AssetHealth> = {};
    for (const e of entries) if (e) map[e[0]] = e[1];
    setHealthMap(map);
  }, []);

  useEffect(() => { fetchAlarms(); fetchActivities(); }, [fetchAlarms, fetchActivities]);
  useEffect(() => { if (assetList.length) fetchHealth(assetList.map(a => a.id)); }, [assets]); // eslint-disable-line

  // Refresh on a timer + on live events.
  useEffect(() => {
    const iv = setInterval(() => {
      fetchAlarms(); fetchActivities();
      if (assetList.length) fetchHealth(assetList.map(a => a.id));
    }, 20_000);
    return () => clearInterval(iv);
  }, [assets]); // eslint-disable-line

  const handleEvent = useCallback(() => {
    fetchAlarms(); fetchActivities();
    if (assetList.length) fetchHealth(assetList.map(a => a.id));
  }, [assets]); // eslint-disable-line
  useWsEvents({ alarm: handleEvent, activity_log: fetchActivities, telemetry: () => {} });

  // Worst active-alarm severity per asset.
  const worstByAsset = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of alarms) {
      if (!a.assetId || a.status !== "active") continue;
      const cur = map[a.assetId];
      if (cur === undefined || SEVERITY_RANK[a.severity] < SEVERITY_RANK[cur]) map[a.assetId] = a.severity;
    }
    return map;
  }, [alarms]);

  // Classify every ROOT asset into a bucket. Child assets share their parent's
  // device (no telemetry of their own), so counting them would double-count.
  const rows: AssetRow[] = useMemo(() => assetList.filter(a => !a.parentId).map(a => {
    const { bucket, score } = classify(worstByAsset[a.id] ?? null, healthMap[a.id] ?? null);
    return { assetId: a.id, name: a.name, bucket, score };
  }), [assets, worstByAsset, healthMap]); // eslint-disable-line

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0, missing: 0 } as Record<Bucket, number>;
    for (const r of rows) c[r.bucket]++;
    return c;
  }, [rows]);
  const total = rows.length;

  const criticalAlarms = useMemo(() =>
    [...alarms].filter(a => a.status === "active")
      .sort((a, b) => (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || (new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()))
      .slice(0, 5),
  [alarms]);

  const requiringAction = useMemo(() =>
    rows.filter(r => r.bucket === "high" || r.bucket === "medium")
      .sort((a, b) => (a.score ?? 999) - (b.score ?? 999))
      .slice(0, 6),
  [rows]);

  // ── Global search across pages, assets, alarms, activities ──
  const searchResults: SearchResult[] | null = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const pages = PAGES.filter(p => p.label.toLowerCase().includes(q)).slice(0, 5)
      .map(p => ({ type: "Page", label: p.label, sub: p.path, path: p.path, icon: LayoutGrid }));
    const assetsR = assetList.filter((a: any) =>
      (a.name ?? "").toLowerCase().includes(q) || (a.identifier ?? "").toLowerCase().includes(q)).slice(0, 6)
      .map((a: any) => ({ type: "Asset", label: a.name, sub: a.identifier ?? undefined, path: "/assets", icon: Box }));
    const alarmsR = alarms.filter(a =>
      a.name.toLowerCase().includes(q) || (a.assetName ?? "").toLowerCase().includes(q)).slice(0, 6)
      .map(a => ({ type: "Alarm", label: a.name, sub: a.assetName, path: "/alarms", icon: AlertTriangle }));
    const actsR = activities.filter(e =>
      (e.detail ?? e.action ?? "").toLowerCase().includes(q) || (e.targetName ?? "").toLowerCase().includes(q)).slice(0, 5)
      .map(e => ({ type: "Activity", label: e.detail ?? e.action, sub: `by ${e.actorName}`, path: "/activity-log", icon: ActivityIcon }));
    return [...pages, ...assetsR, ...alarmsR, ...actsR];
  }, [search, assets, alarms, activities]); // eslint-disable-line

  function goToResult(r: SearchResult) {
    navigate(r.path);
    setSearch("");
    setSearchOpen(false);
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Greeting subtitle={alarms.length > 0
          ? <>Plant overview · <span className="text-orange-500 font-medium">
              {alarms.length} active alarm{alarms.length === 1 ? "" : "s"}
            </span></>
          : "Plant overview · nothing is waiting on you"} />
        <div className="flex items-center gap-3">
          {/* The way back to the banded Overview. This page is otherwise
              unchanged — the switch is the only addition. */}
          <ViewSwitch />
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={e => { if (e.key === "Enter" && searchResults?.length) goToResult(searchResults[0]); if (e.key === "Escape") setSearchOpen(false); }}
              placeholder="Search assets, alarms, pages…"
              className="h-9 w-64 pl-8 text-sm" />
            {searchOpen && searchResults && (
              <div className="absolute z-50 mt-1 w-80 right-0 max-h-96 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                {searchResults.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">No matches for “{search}”</div>
                ) : (
                  searchResults.map((r, i) => (
                    <button key={`${r.type}-${i}`}
                      onMouseDown={() => goToResult(r)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors border-b border-border/40 last:border-0">
                      <r.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{r.label}</p>
                        {r.sub && <p className="text-xs text-muted-foreground truncate">{r.sub}</p>}
                      </div>
                      <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted shrink-0">{r.type}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button onClick={toggleFullscreen} title="Toggle fullscreen"
            className="w-9 h-9 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors">
            <Maximize2 className="w-4 h-4" />
          </button>
          <button onClick={() => navigate("/alarms")} title="Active alarms"
            className="relative w-9 h-9 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors">
            <Bell className="w-4 h-4" />
            {alarms.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                {alarms.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Health summary cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <HealthCard b="high"    count={counts.high}    onClick={() => navigate("/alarms")} />
        <HealthCard b="medium"  count={counts.medium}  onClick={() => navigate("/alarms")} />
        <HealthCard b="low"     count={counts.low}     onClick={() => navigate("/assets")} />
        <HealthCard b="missing" count={counts.missing} onClick={() => navigate("/assets")} />
        <HealthCard b="total"   count={total}          onClick={() => navigate("/assets")} />
      </div>

      {/* ── Three panels ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recent Critical Alarms */}
        <Panel title="Recent Critical Alarms" onMore={() => navigate("/alarms")}>
          {criticalAlarms.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">No active alarms</div>
          ) : (
            <div>
              {criticalAlarms.map(a => {
                const crit = a.severity === "critical";
                return (
                  <div key={a.id} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border/50 last:border-0">
                    <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", crit ? "text-red-500" : "text-orange-500")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {a.assetName}{a.alarmClass ? ` · ${a.alarmClass}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                      {formatDistanceToNow(new Date(a.triggeredAt), { addSuffix: false })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Assets Requiring Immediate Action */}
        <Panel title="Assets Requiring Immediate Action" onMore={() => navigate("/assets")}>
          {requiringAction.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">No assets need attention</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/50">
                  <th className="text-left font-medium px-4 py-2">Asset</th>
                  <th className="text-left font-medium px-2 py-2">Health</th>
                  <th className="text-right font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {requiringAction.map(r => {
                  const m = BUCKET_META[r.bucket];
                  return (
                    <tr key={r.assetId} className="border-b border-border/50 last:border-0 hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate("/assets")}>
                      <td className="px-4 py-2.5 font-medium truncate max-w-[110px]">{r.name}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-xs w-8">{r.score != null ? `${r.score}%` : "—"}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[40px]">
                            <div className={cn("h-full rounded-full", m.bar)} style={{ width: `${r.score ?? 0}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full",
                          r.bucket === "high" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700")}>
                          {r.bucket === "high" ? "Critical" : "Warning"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        {/* Recent Activities */}
        <Panel title="Recent Activities" onMore={() => navigate("/activity-log")}>
          {activities.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">No recent activity</div>
          ) : (
            <div>
              {activities.slice(0, 6).map(e => {
                const Icon = ACTIVITY_ICON[e.category] ?? ActivityIcon;
                return (
                  <div key={e.id} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border/50 last:border-0">
                    <span className="p-1.5 rounded-md bg-muted shrink-0"><Icon className="w-3.5 h-3.5 text-muted-foreground" /></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{e.detail ?? `${e.action}${e.targetName ? ` — ${e.targetName}` : ""}`}</p>
                      <p className="text-xs text-muted-foreground truncate">by {e.actorName}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                      {formatDistanceToNow(new Date(e.timestamp), { addSuffix: false })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
