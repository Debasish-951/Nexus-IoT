import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity, AlertTriangle, BrainCircuit, ChevronDown, ChevronLeft, ChevronRight, Download, Pause, Play,
  Radio, Search, ShieldAlert, Wifi, WifiOff, Box, Gauge, CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AssetScopePicker, useAssetTree } from "@/components/AssetScopePicker";
import { useProject } from "@/contexts/ProjectContext";
import { useCurrentUser } from "@/contexts/UserContext";
import { toCsv, downloadCsvText } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { useLiveData, type AssetLive, type LiveEvent, type LiveEventKind, type Reading } from "./useLiveData";
import { fmtDuration, fmtValue, looksStuck, ratePerMin, readable, splitMetric, type DataStatus } from "./status";

const STATUS_LABEL: Record<DataStatus, string> = { online: "Online", delayed: "Delayed", offline: "Offline", never: "No data yet", unknown: "Status unknown" };
const STATUS_DOT: Record<DataStatus, string> = { online: "bg-emerald-500", delayed: "bg-amber-500", offline: "bg-slate-400", never: "bg-slate-300 dark:bg-slate-600", unknown: "border border-dashed border-slate-400 bg-transparent" };
const LEVEL_TEXT = { ok: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", crit: "text-red-600 dark:text-red-400" } as const;
const TONE_DOT: Record<LiveEvent["tone"], string> = { red: "bg-red-500", amber: "bg-amber-500", green: "bg-emerald-500", blue: "bg-blue-500", grey: "bg-slate-400" };
/** Readings shown per machine group before "Show all". */
const GROUP_CAP = 40;

interface Row { asset: AssetLive; r: Reading; path: string[]; name: string; stuck: boolean; problem: boolean }

export default function LiveFeedPage() {
  const t = useT();
  const [, navigate] = useLocation();
  const live = useLiveData();
  const tree = useAssetTree();
  const { currentProjectId } = useProject();
  // The server refuses AI Advisor chat for project-restricted users (I-1), so the
  // button stays visible but disabled, with the reason.
  const { session, canModule } = useCurrentUser();
  const aiBlocked = !!session?.restrictProjects;
  // Hidden while the module or its feature switch (lib/features.ts) is off.
  const showLiveTwin = canModule("live_twin");
  const showAi = canModule("ai_advisor");
  const [scope, setScope] = useState<string>(() => currentProjectId || "all");
  const [machine, setMachine] = useState("");
  const [query, setQuery] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const now = live.now;

  // Assets inside the chosen project/asset.
  const scoped = useMemo(() => {
    if (scope === "all") return live.assets;
    const ids = new Set([scope, ...tree.descendants(scope).map((d) => d.a.id)]);
    return live.assets.filter((a) => ids.has(a.id));
  }, [live.assets, scope, tree]);
  // Assets that report data, or are meant to (have a device id).
  const reporting = scoped.filter((a) => a.identifier || a.readings.length || a.lastSeen);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const a of scoped) for (const r of a.readings) {
      const { path, reading } = splitMetric(r.metric);
      const stuck = looksStuck(r.hist);
      out.push({ asset: a, r, path, name: reading, stuck, problem: r.level === "warn" || r.level === "crit" || stuck });
    }
    return out;
  }, [scoped]);

  const counts = { online: 0, delayed: 0, offline: 0, never: 0, unknown: 0 } as Record<DataStatus, number>;
  for (const a of reporting) counts[a.status]++;
  const newestSeen = Math.max(0, ...scoped.map((a) => a.lastSeen));
  const receiving = counts.online > 0;
  const outOfLimits = rows.filter((x) => x.r.level === "warn" || x.r.level === "crit").length;
  const stuckCount = rows.filter((x) => x.stuck).length;
  const scopedIds = new Set(scoped.map((a) => a.id));
  const alarmsInScope = live.openAlarms.filter((a) => a.assetId && scopedIds.has(a.assetId));
  const critHigh = alarmsInScope.filter((a) => a.severity === "critical" || a.severity === "high").length;
  const msgsPerMin = live.rate[live.rate.length - 2]?.v ?? 0;

  // ── Needs attention now ──
  const attention = useMemo(() => {
    const items: { key: string; score: number; asset: AssetLive; icon: "alarm" | "limit" | "silent" | "fast"; title: string; detail: string; tone: "red" | "amber" | "grey" | "blue" }[] = [];
    for (const a of scoped) {
      const mine = alarmsInScope.filter((x) => x.assetId === a.id);
      if (mine.length) {
        const crit = mine.some((x) => x.severity === "critical" || x.severity === "high");
        items.push({ key: `al-${a.id}`, score: crit ? 100 : 80, asset: a, icon: "alarm", title: a.name, tone: crit ? "red" : "amber",
          detail: t("{n} open alarm(s): {names}", { n: mine.length, names: mine.slice(0, 2).map((x) => x.name).join(", ") }) });
      }
      if (a.status === "offline" || a.status === "delayed") {
        items.push({ key: `st-${a.id}`, score: a.status === "offline" ? 60 : 50, asset: a, icon: "silent", title: a.name, tone: a.status === "offline" ? "grey" : "amber",
          detail: a.status === "offline" ? t("Offline: no data for {d}", { d: fmtDuration(now - a.lastSeen, t) }) : t("Data delayed: last reading {d} ago", { d: fmtDuration(now - a.lastSeen, t) }) });
      }
    }
    for (const x of rows) {
      if (x.r.level === "crit" || x.r.level === "warn") {
        items.push({ key: `lv-${x.asset.id}-${x.r.metric}`, score: x.r.level === "crit" ? 90 : 70, asset: x.asset, icon: "limit", title: `${x.asset.name} · ${readable(x.name)}`,
          tone: x.r.level === "crit" ? "red" : "amber",
          detail: `${x.r.level === "crit" ? t("Over the alarm limit") : t("Over the warning limit")}: ${fmtValue(x.r.value, x.r.decimals)}${x.r.uom ? ` ${x.r.uom}` : ""}` });
      } else if (x.stuck) {
        items.push({ key: `sk-${x.asset.id}-${x.r.metric}`, score: 40, asset: x.asset, icon: "limit", title: `${x.asset.name} · ${readable(x.name)}`, tone: "amber",
          detail: t("Possibly stuck: the same value {n} times", { n: x.r.hist.length }) });
      }
    }
    // Fastest-changing readings: change per minute relative to the value's size.
    const fast = rows
      .map((x) => ({ x, rate: ratePerMin(x.r.hist) }))
      .filter((y) => y.rate != null)
      .map((y) => ({ ...y, rel: Math.abs(y.rate!) / Math.max(Math.abs(y.x.r.value), 1) }))
      .filter((y) => y.rel >= 0.02)
      .sort((p, q) => q.rel - p.rel)
      .slice(0, 5);
    for (const y of fast) {
      items.push({ key: `fs-${y.x.asset.id}-${y.x.r.metric}`, score: 30 + Math.min(9, y.rel * 10), asset: y.x.asset, icon: "fast", title: `${y.x.asset.name} · ${readable(y.x.name)}`, tone: "blue",
        detail: t("Changing fast: {v} per minute", { v: `${y.rate! > 0 ? "+" : ""}${fmtValue(y.rate!)}${y.x.r.uom ? ` ${y.x.r.uom}` : ""}` }) });
    }
    return items.sort((p, q) => q.score - p.score).slice(0, 12);
  }, [scoped, rows, alarmsInScope, now, t]);

  // ── Assets by machine (filters) ──
  const q = query.trim().toLowerCase();
  const mq = machine.trim().toLowerCase();
  const visibleRows = rows.filter((x) =>
    (!onlyProblems || x.problem) &&
    (!mq || x.path.join(" ").toLowerCase().includes(mq)) &&
    (!q || x.name.toLowerCase().includes(q) || readable(x.name).toLowerCase().includes(q)));
  const assetsShown = scoped.filter((a) =>
    visibleRows.some((x) => x.asset.id === a.id) ||
    (!q && !mq && (onlyProblems ? a.status === "offline" || a.status === "delayed" : !!(a.identifier || a.lastSeen))));

  function exportCsv() {
    const data = visibleRows.map((x) => [x.asset.name, x.path.join(" > "), x.name, x.r.value, x.r.uom ?? "",
      x.r.level === "crit" ? "alarm" : x.r.level === "warn" ? "warning" : x.stuck ? "possibly stuck" : x.r.level === "ok" ? "normal" : "", new Date(x.r.ts).toISOString()]);
    downloadCsvText(toCsv(["asset", "machine", "reading", "value", "unit", "status", "last_seen"], data), `live-values-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`);
  }

  const openAsset = (id: string) => navigate(`/assets/${id}`);
  const askAi = (a: AssetLive, about: string) =>
    navigate(`/ai-copilot?scope=${encodeURIComponent(a.id)}&q=${encodeURIComponent(t("Why is this happening on {asset}: {about}? What should we check?", { asset: a.name, about }))}`);

  return (
    <div className="h-full overflow-y-auto p-4 pr-6 pb-8 space-y-4">
      <button onClick={() => navigate("/")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> {t("Back")}
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold flex items-center gap-2"><Radio className="w-5 h-5 text-primary" /> {t("Live Operations Center")}</h1>
          <p className={cn("text-sm flex items-center gap-2", receiving ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
            <span className={cn("w-2 h-2 rounded-full", receiving ? "bg-emerald-500 animate-pulse" : "bg-slate-400")} />
            {receiving
              ? t("Receiving data · {n} assets · {r} readings/min · last message {d} ago", { n: counts.online, r: live.readingsPerMin, d: fmtDuration(now - newestSeen, t) })
              : newestSeen
                ? t("No data for {d}", { d: fmtDuration(now - newestSeen, t) })
                : live.ready ? t("No data received yet") : t("Loading…")}
          </p>
        </div>
        <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border",
          live.wsStatus === "connected" ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "text-amber-600 dark:text-amber-400 border-amber-500/30")}
          title={t("Live connection to the server, used for instant updates")}>
          {live.wsStatus === "connected" ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {live.wsStatus === "connected" ? t("Live connection") : live.wsStatus === "connecting" ? t("Connecting…") : t("Reconnecting…")}
        </span>
      </div>

      {/* Filters */}
      <Card className="p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="lf-scope" className="text-[11px] text-muted-foreground">{t("Project or asset")}</Label>
          <AssetScopePicker id="lf-scope" value={scope} onChange={setScope} allLabel={t("All assets")} className="h-8 text-xs w-56" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lf-machine" className="text-[11px] text-muted-foreground">{t("Machine")}</Label>
          <Input id="lf-machine" value={machine} onChange={(e) => setMachine(e.target.value)} placeholder={t("e.g. Spinning Machine")} className="h-8 w-48 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lf-search" className="text-[11px] text-muted-foreground">{t("Reading")}</Label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input id="lf-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search readings…")} className="h-8 w-48 pl-7 text-xs" />
          </div>
        </div>
        <div className="flex items-center gap-2 h-8">
          <Switch id="lf-problems" checked={onlyProblems} onCheckedChange={setOnlyProblems} />
          <Label htmlFor="lf-problems" className="text-xs">{t("Only problems")}</Label>
        </div>
        <Button size="sm" variant="outline" className="h-8 ml-auto gap-1.5" onClick={exportCsv} disabled={!visibleRows.length}>
          <Download className="w-3.5 h-3.5" /> {t("Export CSV")}
        </Button>
      </Card>

      {live.refresh.failed && (
        <p role="status" className="text-xs flex items-center gap-2 rounded-md border border-amber-500/30 px-3 py-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {live.refresh.retryAt > now
            ? t("Could not refresh data: the server is limiting requests. Status is shown as unknown; retrying in {d}.", { d: fmtDuration(live.refresh.retryAt - now) })
            : t("Could not refresh data from the server. Status is shown as unknown until it recovers.")}
        </p>
      )}

      {/* Status strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Box} label={t("Assets")}>
          <div className="flex items-baseline gap-3 text-sm">
            <Count n={counts.online} label={t("online")} dot="bg-emerald-500" />
            <Count n={counts.delayed} label={t("delayed")} dot="bg-amber-500" />
            <Count n={counts.offline} label={t("offline")} dot="bg-slate-400" />
          </div>
          {counts.never > 0 && <p className="text-[11px] text-muted-foreground mt-1">{t("{n} never reported", { n: counts.never })}</p>}
          {counts.unknown > 0 && <p className="text-[11px] text-muted-foreground mt-1">{t("{n} status unknown", { n: counts.unknown })}</p>}
        </Tile>
        {live.can.alarms ? (
          <Tile icon={ShieldAlert} label={t("Active alarms")}>
            <p className="text-2xl font-semibold tabular-nums">{alarmsInScope.length}</p>
            <p className={cn("text-[11px]", critHigh ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{t("{n} critical or high", { n: critHigh })}</p>
          </Tile>
        ) : (
          <Tile icon={ShieldAlert} label={t("Active alarms")}><p className="text-xs text-muted-foreground">{t("Needs access to Event Manager")}</p></Tile>
        )}
        <Tile icon={Activity} label={t("Messages per minute")}>
          <div className="flex items-end justify-between gap-2">
            <p className="text-2xl font-semibold tabular-nums">{msgsPerMin}</p>
            <Spark values={live.rate.map((x) => x.v)} className="w-28 h-8 text-primary" />
          </div>
          <p className="text-[11px] text-muted-foreground">{t("last 15 minutes")}</p>
        </Tile>
        <Tile icon={Gauge} label={t("Data quality")}>
          <p className="text-sm"><span className={cn("font-semibold tabular-nums", outOfLimits && "text-amber-600 dark:text-amber-400")}>{outOfLimits}</span> {t("outside alarm limits")}</p>
          <p className="text-sm"><span className={cn("font-semibold tabular-nums", stuckCount && "text-amber-600 dark:text-amber-400")}>{stuckCount}</span> {t("possibly stuck sensors")}</p>
        </Tile>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2 space-y-4 min-w-0">
          {/* Needs attention now */}
          <Card className="overflow-hidden">
            <div className="px-4 py-2.5 border-b flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /><h2 className="text-sm font-semibold">{t("Needs attention now")}</h2></div>
            {attention.length === 0 ? (
              <div className="px-4 py-6 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-4 h-4" /> {t("All clear")}</div>
            ) : (
              <ul className="divide-y">
                {attention.map((it) => (
                  <li key={it.key} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", TONE_DOT[it.tone])} />
                    <div className="flex-1 min-w-[200px]">
                      <p className="text-sm font-medium truncate">{it.title}</p>
                      <p className="text-xs text-muted-foreground">{it.detail}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openAsset(it.asset.id)}>{t("Open asset")}</Button>
                      {showLiveTwin && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate("/live-twin")}>{t("Live Twin")}</Button>}
                      {showAi && (
                        <span title={aiBlocked ? t("AI Advisor chat is not available yet for users limited to specific projects.") : undefined}>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" disabled={aiBlocked} onClick={() => askAi(it.asset, it.detail)}><BrainCircuit className="w-3.5 h-3.5" /> {t("Ask AI Advisor")}</Button>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Assets by machine */}
          <Card className="overflow-hidden">
            <div className="px-4 py-2.5 border-b flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("Assets by machine")}</h2>
              <span className="text-xs text-muted-foreground">{t("{n} readings", { n: visibleRows.length })}</span>
            </div>
            {assetsShown.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">{onlyProblems ? t("No problems in this selection.") : live.ready ? t("No live values for this selection yet.") : t("Loading…")}</p>
            ) : (
              <div className="divide-y">
                {assetsShown.map((a) => (
                  <AssetBlock key={a.id} asset={a} rows={visibleRows.filter((x) => x.asset.id === a.id)} now={now} forceOpen={!!(q || mq || onlyProblems)} />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Event stream */}
        <EventStream events={live.events} canAudit={live.can.audit} />
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1.5"><Icon className="w-3.5 h-3.5" /> {label}</p>
      {children}
    </Card>
  );
}

function Count({ n, label, dot }: { n: number; label: string; dot: string }) {
  return <span className="flex items-center gap-1"><span className={cn("w-2 h-2 rounded-full", dot)} /><span className="font-semibold tabular-nums">{n}</span><span className="text-xs text-muted-foreground">{label}</span></span>;
}

/** Tiny inline sparkline (SVG): cheap enough for hundreds of rows. */
function Spark({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <svg className={className} />;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - lo) / span) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface Node { name: string; key: string; children: Map<string, Node>; rows: Row[]; problems: number }

function buildTree(rows: Row[], assetId: string): Node {
  const root: Node = { name: "", key: assetId, children: new Map(), rows: [], problems: 0 };
  for (const x of rows) {
    let n = root;
    if (x.problem) n.problems++;
    for (const seg of x.path) {
      let c = n.children.get(seg);
      if (!c) { c = { name: seg, key: `${n.key}/${seg}`, children: new Map(), rows: [], problems: 0 }; n.children.set(seg, c); }
      n = c;
      if (x.problem) n.problems++;
    }
    n.rows.push(x);
  }
  return root;
}

function AssetBlock({ asset, rows, now, forceOpen }: { asset: AssetLive; rows: Row[]; now: number; forceOpen: boolean }) {
  const t = useT();
  const tree = useMemo(() => buildTree(rows, asset.id), [rows, asset.id]);
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? (forceOpen || tree.problems > 0);
  return (
    <div>
      <button className="w-full px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-left hover:bg-muted/40" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
        {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        <span className="font-medium text-sm">{asset.name}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className={cn("w-2 h-2 rounded-full", STATUS_DOT[asset.status])} />{t(STATUS_LABEL[asset.status])}</span>
        {asset.lastSeen > 0 && <span className="text-xs text-muted-foreground">{t("last reading {d} ago", { d: fmtDuration(now - asset.lastSeen, t) })}</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          {t("{n} readings", { n: rows.length })}{tree.problems ? <span className="text-amber-600 dark:text-amber-400"> · {t("{n} need attention", { n: tree.problems })}</span> : null}
        </span>
      </button>
      {isOpen && (
        <div className="pb-2">
          {rows.length === 0 ? <p className="px-11 py-2 text-xs text-muted-foreground">{t("No readings yet.")}</p> : <TreeNode node={tree} depth={0} forceOpen={forceOpen} now={now} />}
        </div>
      )}
    </div>
  );
}

function TreeNode({ node, depth, forceOpen, now }: { node: Node; depth: number; forceOpen: boolean; now: number }) {
  const t = useT();
  const [open, setOpen] = useState<boolean | null>(null);
  const [all, setAll] = useState(false);
  const isRoot = depth === 0;
  const isOpen = isRoot || (open ?? (forceOpen || node.problems > 0));
  const kids = [...node.children.values()].sort((a, b) => b.problems - a.problems || a.name.localeCompare(b.name));
  const rows = [...node.rows].sort((a, b) => Number(b.problem) - Number(a.problem) || a.name.localeCompare(b.name));
  const shown = all ? rows : rows.slice(0, GROUP_CAP);
  const pad = { paddingLeft: `${16 + depth * 16}px` };
  return (
    <div>
      {!isRoot && (
        <button className="w-full flex items-center gap-1.5 py-1 pr-4 text-left text-xs hover:bg-muted/40" style={pad} onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
          {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
          <span className="font-medium">{node.name}</span>
          <span className="text-muted-foreground">({countRows(node)})</span>
          {node.problems > 0 && <span className="text-amber-600 dark:text-amber-400">· {t("{n} need attention", { n: node.problems })}</span>}
        </button>
      )}
      {isOpen && (
        <>
          {kids.map((k) => <TreeNode key={k.key} node={k} depth={depth + 1} forceOpen={forceOpen} now={now} />)}
          {shown.map((x) => (
            <div key={x.r.metric} className="grid grid-cols-[minmax(0,1fr)_auto_96px] items-center gap-3 py-1 pr-4 text-xs" style={{ paddingLeft: `${36 + depth * 16}px` }} title={`${x.r.metric}\n${new Date(x.r.ts).toLocaleString()}`}>
              <span className="truncate">{readable(x.name)}{x.stuck && <span className="ml-1.5 text-amber-600 dark:text-amber-400">· {t("possibly stuck")}</span>}</span>
              <span className={cn("font-mono tabular-nums text-right", x.r.level ? LEVEL_TEXT[x.r.level] : "")}>
                {fmtValue(x.r.value, x.r.decimals)}{x.r.uom ? <span className="text-muted-foreground"> {x.r.uom}</span> : null}
              </span>
              <Spark values={x.r.hist.map((p) => p.v)} className={cn("w-24 h-5", x.r.level ? LEVEL_TEXT[x.r.level] : "text-primary/70")} />
            </div>
          ))}
          {rows.length > GROUP_CAP && !all && (
            <button className="py-1 text-xs text-primary hover:underline" style={{ paddingLeft: `${36 + depth * 16}px` }} onClick={() => setAll(true)}>
              {t("Show all {n}", { n: rows.length })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function countRows(n: Node): number {
  let c = n.rows.length;
  for (const k of n.children.values()) c += countRows(k);
  return c;
}

const KINDS: { k: LiveEventKind | "all"; label: string }[] = [
  { k: "all", label: "All" }, { k: "alarm", label: "Alarms" }, { k: "status", label: "Online / offline" },
  { k: "limit", label: "Limits" }, { k: "user", label: "User actions" },
];

function EventStream({ events, canAudit }: { events: LiveEvent[]; canAudit: boolean }) {
  const t = useT();
  const [kind, setKind] = useState<LiveEventKind | "all">("all");
  const [frozen, setFrozen] = useState<LiveEvent[] | null>(null);
  const list = frozen ?? events;
  const newWhilePaused = frozen ? events.filter((e) => !frozen.some((f) => f.id === e.id)).length : 0;
  const shown = list.filter((e) => kind === "all" || e.kind === kind);
  return (
    <Card className="overflow-hidden xl:sticky xl:top-0">
      <div className="px-4 py-2.5 border-b flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("Event stream")}</h2>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => setFrozen(frozen ? null : events)}>
          {frozen ? <><Play className="w-3.5 h-3.5" /> {t("Resume")}{newWhilePaused ? ` (${newWhilePaused})` : ""}</> : <><Pause className="w-3.5 h-3.5" /> {t("Pause")}</>}
        </Button>
      </div>
      <div className="px-3 py-2 flex flex-wrap gap-1 border-b">
        {KINDS.filter((x) => x.k !== "user" || canAudit).map((x) => (
          <button key={x.k} onClick={() => setKind(x.k)}
            className={cn("text-[11px] px-2 py-0.5 rounded-full border", kind === x.k ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
            {t(x.label)}
          </button>
        ))}
      </div>
      <div className="max-h-[640px] overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">{t("Events appear here as they happen: alarms, assets going online or offline, readings crossing limits and user actions.")}</p>
        ) : (
          <ul className="divide-y">
            {shown.map((e) => (
              <li key={e.id} className="px-4 py-2 flex gap-2.5">
                <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", TONE_DOT[e.tone])} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs">
                    <span className="font-medium">
                      {e.kind === "limit" ? readable(splitMetric(e.title).reading) : e.kind === "alarm" ? `${e.title || t("Alarm")}${e.severity ? ` (${t(e.severity)})` : ""}` : e.title}
                    </span>
                    {e.detail ? <span className="text-muted-foreground"> {e.detailIsData ? e.detail : t(e.detail)}</span> : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(e.at).toLocaleTimeString()}{e.assetName && e.kind !== "status" ? ` · ${e.assetName}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
