/**
 * Plant Status and Alarms & Operations: multi-machine views and alarm tools.
 * Alarm data comes from the same server endpoints the Alarms page uses, so the
 * server's role and project rules apply unchanged.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useListAssets, useAcknowledgeAlarm } from "@workspace/api-client-react";
import { apiFetch } from "@/lib/auth-api";
import { useCurrentUser } from "@/contexts/UserContext";
import { useOpenAlarms, OPEN_ALARMS_KEY, type OpenAlarm } from "@/hooks/useOpenAlarms";
import { getFromTo } from "../timeRange";
import {
  type ProProps, COL, n, clamp, valuesOf, lastOf, fmtNum, nameOf, SampleChip, NeedNote, Empty, useSize, thresholdColor,
} from "./common";

const SEV_COL: Record<string, string> = { critical: COL.bad, high: COL.bad, medium: COL.warn, low: COL.primary, info: COL.neutral };
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** The chosen asset and everything below it (null = every asset). */
function useScope(assetId?: string): { scope: Set<string> | null; assets: any[] } {
  const { data } = useListAssets();
  const assets = (data as any[] | undefined) ?? [];
  const scope = useMemo(() => {
    if (!assetId) return null;
    const s = new Set<string>([assetId]);
    let grew = true;
    while (grew) { grew = false; for (const a of assets) if (a.parentId && s.has(a.parentId) && !s.has(a.id)) { s.add(a.id); grew = true; } }
    return s;
  }, [assetId, assets]);
  return { scope, assets };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(iv); }, [ms]);
  return now;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Machine Status Grid ───────────────────────────────────────────────────────
export function MachineGrid(p: ProProps) {
  const { assets } = useScope();
  const isSample = !p.bound;
  const runAbove = n(p.c.runAbove, 0)!, warn = n(p.c.warn), crit = n(p.c.critical);
  const assetName = (id?: string) => assets.find((a) => a.id === id)?.name;
  const tiles = isSample
    ? [["Soft Flow 1", 1180], ["Soft Flow 2", 1210], ["Jet Dyer", 1490], ["Stenter", 0], ["Dryer", 860], ["Compactor", 940]].map(([l, v]) => ({ label: String(l), v: Number(v) as number | null }))
    : p.keys.map((k, i) => ({ label: assetName(p.meta[k]?.assetId) ?? nameOf(p, k, i), v: lastOf(p.rows, k) }));
  const wv = isSample ? 1300 : warn, cv = isSample ? 1450 : crit;
  return (
    <div className="relative h-full w-full p-1 overflow-auto">
      <SampleChip show={isSample} />
      <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
        {tiles.map((t, i) => {
          const stopped = t.v == null || t.v <= runAbove;
          const col = t.v == null ? COL.neutral : stopped ? COL.neutral : thresholdColor(t.v, wv, cv, COL.ok);
          const state = t.v == null ? "No data" : stopped ? "Stopped" : col === COL.bad ? "Critical" : col === COL.warn ? "Warning" : "Running";
          return (
            <div key={i} className="relative rounded-md border p-2 overflow-hidden pro-ease" style={{ borderColor: `${col}66`, background: `${col}14` }}>
              {col === COL.bad && <span className="absolute inset-0 rounded-md border-2 pro-pulse" style={{ borderColor: COL.bad }} />}
              <div className="flex items-center gap-1.5">
                <span className="relative flex w-2 h-2">
                  {!stopped && <span className="absolute inset-0 rounded-full pro-ping" style={{ background: col }} />}
                  <span className="relative w-2 h-2 rounded-full" style={{ background: col }} />
                </span>
                <span className="text-[11px] font-medium truncate">{t.label}</span>
              </div>
              <p className="text-sm font-bold tabular-nums mt-1">{fmtNum(t.v)}</p>
              <p className="text-[10px]" style={{ color: col }}>{state}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Data Grid Pro ─────────────────────────────────────────────────────────────
function Spark({ vals, col }: { vals: number[]; col: string }) {
  if (vals.length < 2) return <span />;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const d = vals.map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * 60).toFixed(1)},${(16 - ((v - lo) / span) * 14).toFixed(1)}`).join(" ");
  return <svg width={60} height={18}><path d={d} fill="none" stroke={col} strokeWidth={1.4} /></svg>;
}
export function GridPro(p: ProProps) {
  const [sort, setSort] = useState<{ k: "name" | "last" | "chg"; dir: 1 | -1 }>({ k: "name", dir: 1 });
  const isSample = !p.bound;
  const dec = n(p.c.decimals) ?? undefined;
  let rows = isSample
    ? ["Soft Flow 1", "Soft Flow 2", "Jet Dyer", "Stenter", "Dryer"].map((name, i) => { const vals = Array.from({ length: 20 }, (_, j) => 60 + i * 9 + 8 * Math.sin(j / 3 + i)); return { name, vals, unit: "°C" }; })
    : p.keys.map((k, i) => ({ name: nameOf(p, k, i), vals: valuesOf(p.rows, k).map((x) => x.v), unit: p.meta[k]?.unit ?? "" }));
  const calc = rows.map((r) => {
    const last = r.vals.length ? r.vals[r.vals.length - 1] : null;
    const first = r.vals[0];
    return { ...r, last, min: r.vals.length ? Math.min(...r.vals) : null, max: r.vals.length ? Math.max(...r.vals) : null, chg: last != null && first ? ((last - first) / Math.abs(first)) * 100 : null };
  }).sort((a, b) => {
    const av = sort.k === "name" ? a.name : (a[sort.k] ?? -Infinity), bv = sort.k === "name" ? b.name : (b[sort.k] ?? -Infinity);
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
  });
  rows = calc;
  const head = (k: "name" | "last" | "chg", label: string, cls = "") => (
    <th className={`py-1 px-1.5 font-medium cursor-pointer select-none ${cls}`} onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>{label}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>
  );
  return (
    <div className="relative h-full w-full overflow-auto text-xs">
      <SampleChip show={isSample} />
      <table className="w-full">
        <thead className="sticky top-0 bg-card"><tr className="text-muted-foreground border-b border-border text-left">
          {head("name", "Name")}{head("last", "Latest", "text-right")}<th className="px-1.5 text-right font-medium">Min</th><th className="px-1.5 text-right font-medium">Max</th>{head("chg", "Change", "text-right")}<th className="px-1.5 font-medium">Trend</th>
        </tr></thead>
        <tbody>
          {calc.map((r, i) => (
            <tr key={r.name + i} className="border-b border-border hover:bg-muted/40 pro-slide-in" style={{ animationDelay: `${i * 40}ms` }}>
              <td className="py-1 px-1.5 truncate max-w-[10rem]">{r.name}</td>
              <td className="px-1.5 text-right tabular-nums font-semibold">{fmtNum(r.last, dec)} <span className="text-muted-foreground font-normal">{r.unit}</span></td>
              <td className="px-1.5 text-right tabular-nums text-muted-foreground">{fmtNum(r.min, dec)}</td>
              <td className="px-1.5 text-right tabular-nums text-muted-foreground">{fmtNum(r.max, dec)}</td>
              <td className="px-1.5 text-right tabular-nums" style={{ color: r.chg == null ? undefined : r.chg >= 0 ? COL.ok : COL.bad }}>{r.chg == null ? "—" : `${r.chg >= 0 ? "+" : ""}${r.chg.toFixed(1)}%`}</td>
              <td className="px-1.5"><Spark vals={r.vals.slice(-30)} col={COL.primary} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── State Timeline ────────────────────────────────────────────────────────────
export function StateTimeline(p: ProProps) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const isSample = !p.bound;
  const runAbove = n(p.c.runAbove, 0)!, warn = n(p.c.warn), crit = n(p.c.critical);
  const stateOf = (v: number) => (crit != null && v >= crit ? "fault" : warn != null && v >= warn ? "warn" : v > runAbove ? "run" : "stop");
  const COLS: Record<string, string> = { run: COL.ok, warn: COL.warn, fault: COL.bad, stop: COL.neutral };
  const LABEL: Record<string, string> = { run: "Running", warn: "Warning", fault: "Fault", stop: "Stopped" };
  const now = Date.now();
  const lanes = isSample
    ? ["Soft Flow 1", "Jet Dyer", "Stenter", "Dryer"].map((name, i) => ({ name, pts: Array.from({ length: 48 }, (_, j) => ({ ts: now - (48 - j) * 900_000, v: ((j + i * 7) % 17 < 3) ? 0 : ((j * (i + 2)) % 23 === 0 ? 99 : 50) })) }))
    : p.keys.map((k, i) => ({ name: nameOf(p, k, i), pts: valuesOf(p.rows, k).map(({ ts, v }) => ({ ts, v })) }));
  const sCrit = isSample ? 90 : crit;
  const st = (v: number) => (isSample ? (sCrit != null && v >= sCrit ? "fault" : v > 0 ? "run" : "stop") : stateOf(v));
  const t0 = Math.min(...lanes.flatMap((l) => l.pts.map((x) => x.ts)), now - 3_600_000), t1 = now;
  const labelW = 84, span = t1 - t0 || 1, x = (ts: number) => labelW + ((ts - t0) / span) * (w - labelW - 4);
  return (
    <div ref={ref} className="relative h-full w-full flex flex-col gap-1 p-1 overflow-auto">
      <SampleChip show={isSample} />
      {lanes.map((l, li) => {
        const segs: { s: string; a: number; b: number }[] = [];
        l.pts.forEach((pt, i) => {
          const s = st(pt.v), end = l.pts[i + 1]?.ts ?? t1;
          const last = segs[segs.length - 1];
          if (last && last.s === s) last.b = end; else segs.push({ s, a: pt.ts, b: end });
        });
        const runPct = segs.filter((s) => s.s === "run").reduce((a, s) => a + (s.b - s.a), 0) / span * 100;
        return (
          <div key={li} className="relative h-6 shrink-0">
            <span className="absolute left-0 top-0 text-[10px] truncate leading-6" style={{ width: labelW - 6 }}>{l.name}</span>
            <svg width={w} height={24} className="absolute inset-0">
              <rect x={labelW} y={4} width={Math.max(0, w - labelW - 4)} height={16} rx={3} fill={COL.track} />
              {segs.map((s, i) => (
                <rect key={i} x={x(s.a)} y={4} width={Math.max(1, x(s.b) - x(s.a))} height={16} fill={COLS[s.s]} opacity={hover && hover !== `${li}-${i}` ? 0.6 : 1}
                  onMouseEnter={() => setHover(`${li}-${i}`)} onMouseLeave={() => setHover(null)} className="pro-slide-in" style={{ animationDelay: `${li * 60}ms` }}>
                  <title>{`${l.name}: ${LABEL[s.s]} ${new Date(s.a).toLocaleTimeString()}–${new Date(s.b).toLocaleTimeString()}`}</title>
                </rect>
              ))}
            </svg>
            <span className="absolute right-1 top-0 text-[9px] leading-6 text-white/90 font-semibold drop-shadow">{runPct.toFixed(0)}% run</span>
          </div>
        );
      })}
      <div className="flex gap-3 text-[10px] text-muted-foreground pl-1 shrink-0">{Object.keys(COLS).map((k) => <span key={k} className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm inline-block" style={{ background: COLS[k] }} />{LABEL[k]}</span>)}</div>
    </div>
  );
}

// ── Device Connectivity ───────────────────────────────────────────────────────
export function Connectivity(p: ProProps) {
  const { canModule } = useCurrentUser();
  const { scope, assets } = useScope(p.c.assetId);
  const now = useNow(1000);
  const list = (scope ? assets.filter((a) => scope.has(a.id)) : assets.filter((a) => a.identifier)).slice(0, 12);
  const results = useQueries({
    queries: list.map((a) => ({
      queryKey: ["asset-health", a.id],
      enabled: canModule("assets"),
      refetchInterval: 30_000,
      queryFn: async () => { const r = await apiFetch(`/api/assets/${a.id}/health`); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<{ lastSeen: string | null }>; },
    })),
  });
  const stale = (n(p.c.staleSec, 60) ?? 60) * 1000, offline = (n(p.c.offlineSec, 300) ?? 300) * 1000;
  if (!list.length) return <Empty>No assets to list. Pick a data source in Edit Widget.</Empty>;
  const rows = list.map((a, i) => {
    const seen = results[i]?.data?.lastSeen ? new Date(results[i].data!.lastSeen!).getTime() : null;
    const age = seen == null ? null : now - seen;
    const col = age == null ? COL.neutral : age > offline ? COL.bad : age > stale ? COL.warn : COL.ok;
    return { a, age, col };
  }).sort((x, y) => (y.age ?? Infinity) - (x.age ?? Infinity));
  const online = rows.filter((r) => r.col === COL.ok).length;
  return (
    <div className="relative h-full w-full flex flex-col text-xs">
      <p className="text-[10px] text-muted-foreground px-1 pb-1 shrink-0"><b className="text-foreground">{online}</b> of {rows.length} reporting</p>
      <div className="flex-1 overflow-auto">
        {rows.map(({ a, age, col }) => (
          <div key={a.id} className="flex items-center gap-2 px-1 py-1 border-b border-border">
            <span className="relative flex w-2 h-2 shrink-0">
              {col === COL.ok && <span className="absolute inset-0 rounded-full pro-ping" style={{ background: col }} />}
              <span className="relative w-2 h-2 rounded-full" style={{ background: col }} />
            </span>
            <span className="truncate flex-1" title={a.identifier}>{a.name}</span>
            <span className="tabular-nums font-mono text-[11px]" style={{ color: col }}>{age == null ? "never" : ago(age)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Floor Plan Map ────────────────────────────────────────────────────────────
export function FloorPlan(p: ProProps) {
  const [hover, setHover] = useState<number | null>(null);
  const { assets } = useScope();
  const isSample = !p.bound;
  const warn = n(p.c.warn), crit = n(p.c.critical);
  const coords = String(p.c.pins ?? "").split("\n").map((l) => l.split(",").map((s) => Number(s.trim()))).map((xy) => (xy.length >= 2 && !isNaN(xy[0]) && !isNaN(xy[1]) ? [clamp(xy[0], 0, 100), clamp(xy[1], 0, 100)] : null));
  const pins = isSample
    ? [[18, 35, "Soft Flow 1", 72], [34, 35, "Soft Flow 2", 75], [50, 35, "Jet Dyer", 96], [74, 30, "Stenter", 64], [74, 70, "Dryer", 0], [24, 74, "Boiler", 81], [48, 74, "Compactor", 70]].map(([x, y, l, v]) => ({ x: Number(x), y: Number(y), label: String(l), v: Number(v) as number | null }))
    : p.keys.map((k, i) => {
        const xy = coords[i] ?? [10 + ((i % 5) * 20), 20 + Math.floor(i / 5) * 25];
        return { x: xy[0], y: xy[1], label: assets.find((a) => a.id === p.meta[k]?.assetId)?.name ?? nameOf(p, k, i), v: lastOf(p.rows, k) };
      });
  const wv = isSample ? 85 : warn, cv = isSample ? 95 : crit;
  const url = String(p.c.layoutUrl ?? "").trim();
  return (
    <div className="relative h-full w-full overflow-hidden rounded-md" style={{ background: "hsl(var(--muted) / 0.4)" }}>
      <SampleChip show={isSample} />
      {url ? <img src={url} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none" draggable={false} />
        : (
          // Placeholder layout until a real plan image is set. HTML boxes, not a
          // stretched SVG, so the labels keep their shape at any widget size.
          <div className="absolute inset-[4%] border border-border rounded-sm">
            {[[3, 12, 55, 36, "Dye house"], [63, 8, 34, 82, "Finishing"], [3, 56, 55, 36, "Utilities"]].map(([x, y, ww, hh, l]) => (
              <div key={String(l)} className="absolute bg-card border border-border rounded-sm" style={{ left: `${x}%`, top: `${y}%`, width: `${ww}%`, height: `${hh}%` }}>
                <span className="absolute top-0.5 left-1 text-[9px] text-muted-foreground">{String(l)}</span>
              </div>
            ))}
          </div>
        )}
      {pins.map((pin, i) => {
        const col = pin.v == null ? COL.neutral : pin.v <= 0 ? COL.warn : thresholdColor(pin.v, wv, cv, COL.ok);
        return (
          <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${pin.x}%`, top: `${pin.y}%` }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {col === COL.bad && <span className="absolute -inset-2 rounded-full pro-ping" style={{ background: col }} />}
            <span className="relative block w-3.5 h-3.5 rounded-full border-2 border-background shadow" style={{ background: col }} />
            {hover === i && (
              <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-5 whitespace-nowrap rounded-md border border-border bg-popover text-popover-foreground px-2 py-1 text-[11px] shadow">
                <b>{pin.label}</b> · {fmtNum(pin.v)} {p.meta[p.keys[i]]?.unit ?? ""}
              </div>
            )}
          </div>
        );
      })}
      {isSample && <NeedNote text="Needs a layout image and a pin position per machine (Edit Widget)." />}
    </div>
  );
}

// ── Multi-site Map (schematic) ────────────────────────────────────────────────
export function SiteMap(_p: ProProps) {
  const { assets } = useScope();
  const { enabled, alarms } = useOpenAlarms();
  const roots = assets.filter((a) => !a.parentId);
  const rootOf = useMemo(() => {
    const byId = new Map(assets.map((a) => [a.id, a]));
    return (id?: string) => { let cur = id ? byId.get(id) : undefined; const seen = new Set<string>(); while (cur?.parentId && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parentId); } return cur?.id; };
  }, [assets]);
  const per = new Map<string, OpenAlarm[]>();
  for (const a of alarms) { const r = rootOf(a.assetId); if (r) (per.get(r) ?? per.set(r, []).get(r)!).push(a); }
  if (!roots.length) return <Empty>No projects yet</Empty>;
  const cols = Math.ceil(Math.sqrt(roots.length * 1.6));
  return (
    <div className="relative h-full w-full overflow-hidden rounded-md">
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        {Array.from({ length: 22 }, (_, i) => Array.from({ length: 14 }, (_, j) => { const x = 4 + i * 4.4, y = 6 + j * 6.6, nx = x / 100 - 0.5, ny = y / 100 - 0.5; return nx * nx * 1.3 + ny * ny < 0.17 ? <circle key={`${i}-${j}`} cx={x} cy={y} r={0.55} fill={COL.border} /> : null; }))}
      </svg>
      {roots.map((r, i) => {
        const list = per.get(r.id) ?? [];
        const worst = list.reduce<string | null>((w, a) => (w == null || (SEV_RANK[a.severity] ?? 9) < (SEV_RANK[w] ?? 9) ? a.severity : w), null);
        const col = !enabled ? COL.neutral : worst ? SEV_COL[worst] : COL.ok;
        const x = 12 + ((i % cols) + 0.5) * (76 / cols) + ((Math.floor(i / cols) % 2) * 6), y = 18 + Math.floor(i / cols) * (64 / Math.max(1, Math.ceil(roots.length / cols)));
        return (
          <div key={r.id} className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5" style={{ left: `${x}%`, top: `${y}%` }} title={`${r.name}: ${list.length} open alarm${list.length === 1 ? "" : "s"}`}>
            <span className="relative flex w-3 h-3">
              {worst && <span className="absolute -inset-1.5 rounded-full pro-ping" style={{ background: col }} />}
              <span className="relative w-3 h-3 rounded-full" style={{ background: col }} />
              {list.length > 0 && <span className="absolute -top-3 -right-3 text-[9px] font-bold text-white rounded-full px-1" style={{ background: COL.bad }}>{list.length}</span>}
            </span>
            <span className="text-[11px] font-medium whitespace-nowrap">{r.name}</span>
          </div>
        );
      })}
      <p className="absolute bottom-1 left-2 text-[9px] text-muted-foreground">Schematic layout · a geographic map is not built yet</p>
    </div>
  );
}

// ── Event Ticker ──────────────────────────────────────────────────────────────
export function Ticker(p: ProProps) {
  const { enabled, alarms } = useOpenAlarms();
  const { scope } = useScope(p.c.assetId);
  if (!enabled) return <Empty>You do not have access to alarms.</Empty>;
  const list = alarms.filter((a) => !scope || (a.assetId && scope.has(a.assetId))).slice(0, 30);
  if (!list.length) return <div className="h-full flex items-center gap-2 px-3 text-xs"><span className="w-2 h-2 rounded-full" style={{ background: COL.ok }} /> No open alarms</div>;
  const items = list.map((a) => (
    <span key={a.id} className="inline-flex items-center gap-1.5 mr-8 text-xs">
      <span className={`w-2 h-2 rounded-full ${a.status === "active" ? "pro-pulse" : ""}`} style={{ background: SEV_COL[a.severity] }} />
      <b>{a.name}</b><span className="text-muted-foreground">· {a.assetName} · {new Date(a.triggeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
    </span>
  ));
  const dur = Math.max(15, list.length * 6);
  return (
    <div className="h-full w-full flex items-center overflow-hidden whitespace-nowrap" style={{ maskImage: "linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)" }}>
      <div className="inline-flex pro-scroll" style={{ ["--pro-dur" as any]: `${dur}s` }}>{items}{items}</div>
    </div>
  );
}

// ── Alarm Action Panel ────────────────────────────────────────────────────────
export function AlarmPanel(p: ProProps) {
  const { enabled, alarms } = useOpenAlarms();
  const { canAction } = useCurrentUser();
  const { scope } = useScope(p.c.assetId);
  const qc = useQueryClient();
  const ack = useAcknowledgeAlarm();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  if (!enabled) return <Empty>You do not have access to alarms.</Empty>;
  const canAck = canAction("acknowledge_alarms", "alarms");
  const list = alarms.filter((a) => !scope || (a.assetId && scope.has(a.assetId))).slice(0, 50);
  if (!list.length) return <Empty>No open alarms</Empty>;
  return (
    <div className="relative h-full w-full flex flex-col gap-1 overflow-auto p-0.5">
      {err && <p className="text-[11px] px-2 py-1 rounded bg-destructive/10 text-destructive shrink-0">{err}</p>}
      {list.map((a, i) => {
        const acked = a.status === "acknowledged" || done.has(a.id);
        return (
          <div key={a.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 pro-slide-in pro-ease" style={{ animationDelay: `${i * 40}ms`, opacity: acked ? 0.55 : 1, borderLeft: `3px solid ${SEV_COL[a.severity]}` }}>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate">{a.name} <span className="font-normal text-muted-foreground">· {a.assetName}</span></p>
              <p className="text-[10px] text-muted-foreground truncate">{a.severity} · {new Date(a.triggeredAt).toLocaleString()}{a.message ? ` · ${a.message}` : ""}</p>
            </div>
            {acked ? <span className="text-[10px] text-muted-foreground shrink-0">Acknowledged</span>
              : canAck ? (
                <button type="button" disabled={ack.isPending} className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-border hover:border-primary hover:text-primary disabled:opacity-50"
                  onClick={() => { setErr(null); ack.mutate({ id: a.id }, {
                    onSuccess: () => { setDone((s) => new Set(s).add(a.id)); qc.invalidateQueries({ queryKey: OPEN_ALARMS_KEY }); },
                    onError: () => setErr("Could not acknowledge the alarm. Try again, or check your access."),
                  }); }}>Acknowledge</button>
              ) : <span className="text-[10px] text-muted-foreground shrink-0" title="Operator role or higher is required">View only</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Alarm history (shared by Pareto and MTBF) ─────────────────────────────────
interface HistRow { id: string; alarmId: string; assetId: string; assetName: string; name: string; severity: string; triggeredAt: string; clearedAt?: string | null }
function useAlarmHistory(p: ProProps) {
  const { canModule } = useCurrentUser();
  const enabled = canModule("alarms");
  const { from, to } = getFromTo(p.timeCfg as any);
  // Rounded to the minute so the query key does not change on every render.
  const fromKey = from.slice(0, 16), toKey = to.slice(0, 16);
  const q = useQuery({
    queryKey: ["alarm-history-widget", p.c.assetId ?? "", fromKey, toKey, p.refreshNonce ?? 0],
    enabled,
    refetchInterval: p.refreshSec > 0 ? Math.max(30, p.refreshSec) * 1000 : 60_000,
    queryFn: async () => {
      const qs = new URLSearchParams({ from, to, limit: "2000" });
      const r = await apiFetch(`/api/alarms/history?${qs}`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<HistRow[]>;
    },
  });
  const { scope } = useScope(p.c.assetId);
  const rows = (q.data ?? []).filter((r) => !scope || scope.has(r.assetId));
  return { enabled, rows, loading: q.isLoading, error: q.isError };
}

// ── Alarm Pareto ──────────────────────────────────────────────────────────────
export function Pareto(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const { enabled, rows, loading, error } = useAlarmHistory(p);
  if (!enabled) return <Empty>You do not have access to alarms.</Empty>;
  if (error) return <Empty>Could not load alarm history.</Empty>;
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!items.length) return <Empty>{loading ? "Loading…" : "No alarms in this range"}</Empty>;
  const total = items.reduce((s, x) => s + x[1], 0);
  const top = 14, bot = h - 34, left = 26, right = w - 30, bw = (right - left) / items.length;
  const maxC = items[0][1];
  let cum = 0;
  const line: [number, number][] = items.map(([, c], i) => { cum += c; return [left + bw * (i + 0.5), bot - (cum / total) * (bot - top)]; });
  return (
    <div ref={ref} className="relative h-full w-full">
      <svg width={w} height={h} className="block">
        {[0, 0.5, 1].map((f) => <text key={f} x={right + 4} y={bot - f * (bot - top) + 3} fontSize={8} fill={COL.muted}>{f * 100}%</text>)}
        <line x1={left} x2={right} y1={bot - 0.8 * (bot - top)} y2={bot - 0.8 * (bot - top)} stroke={COL.warn} strokeDasharray="3 3" opacity={0.6} />
        {items.map(([name, c], i) => {
          const bh = (c / maxC) * (bot - top);
          return (
            <g key={name}>
              <rect x={left + bw * i + 3} y={bot - bh} width={Math.max(2, bw - 6)} height={bh} rx={2} fill={COL.primary} className="pro-ease"><title>{`${name}: ${c}`}</title></rect>
              <text x={left + bw * (i + 0.5)} y={bot - bh - 3} fontSize={9} textAnchor="middle" fill={COL.fg}>{c}</text>
              <text x={left + bw * (i + 0.5)} y={bot + 11} fontSize={8} textAnchor="middle" fill={COL.muted}>{name.length > Math.max(6, bw / 5.5) ? name.slice(0, Math.max(5, Math.floor(bw / 5.5) - 1)) + "…" : name}</text>
            </g>
          );
        })}
        <path d={line.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ")} fill="none" stroke={COL.warn} strokeWidth={2} />
        {line.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill={COL.warn} />)}
        <text x={left} y={h - 6} fontSize={9} fill={COL.muted}>{total} alarms · top {items.length} causes · line = cumulative share</text>
      </svg>
    </div>
  );
}

// ── MTBF / MTTR ───────────────────────────────────────────────────────────────
export function Mtbf(p: ProProps) {
  const { enabled, rows, loading, error } = useAlarmHistory(p);
  if (!enabled) return <Empty>You do not have access to alarms.</Empty>;
  if (error) return <Empty>Could not load alarm history.</Empty>;
  const { from, to } = getFromTo(p.timeCfg as any);
  const spanH = (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
  const failures = rows.length;
  const repaired = rows.filter((r) => r.clearedAt);
  const repairH = repaired.map((r) => (new Date(r.clearedAt!).getTime() - new Date(r.triggeredAt).getTime()) / 3_600_000).filter((x) => x >= 0);
  const downH = repairH.reduce((s, x) => s + x, 0);
  const mtbf = failures ? Math.max(0, spanH - downH) / failures : null;
  const mttr = repairH.length ? downH / repairH.length : null;
  const avail = mtbf != null && mttr != null ? (mtbf / (mtbf + mttr)) * 100 : null;
  const fmtH = (x: number | null) => (x == null ? "—" : x >= 48 ? `${(x / 24).toFixed(1)} d` : x >= 1 ? `${x.toFixed(1)} h` : `${Math.round(x * 60)} min`);
  return (
    <div className="relative h-full w-full grid grid-cols-2 gap-2 p-1 content-center">
      {loading && <span className="absolute top-1 right-1 text-[9px] text-muted-foreground">Loading…</span>}
      <div className="rounded-md bg-muted/40 p-2"><p className="text-[10px] text-muted-foreground">MTBF (time between failures)</p><p className="text-xl font-bold tabular-nums" style={{ color: COL.ok }}>{fmtH(mtbf)}</p></div>
      <div className="rounded-md bg-muted/40 p-2"><p className="text-[10px] text-muted-foreground">MTTR (time to repair)</p><p className="text-xl font-bold tabular-nums" style={{ color: COL.warn }}>{fmtH(mttr)}</p></div>
      <div className="rounded-md bg-muted/40 p-2"><p className="text-[10px] text-muted-foreground">Failures in range</p><p className="text-lg font-bold tabular-nums">{failures}</p></div>
      <div className="rounded-md bg-muted/40 p-2"><p className="text-[10px] text-muted-foreground">Availability</p><p className="text-lg font-bold tabular-nums">{avail == null ? "—" : `${avail.toFixed(1)}%`}</p></div>
    </div>
  );
}
