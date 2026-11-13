/**
 * Analytics: OEE, anomaly detection, health, remaining useful life and risk.
 *
 * Everything here is worked out in the browser from data the platform already
 * has (telemetry series, alarms, asset health). The calculations are simple and
 * explainable on purpose; each widget's `need` text in defs.ts says what a
 * server-side model would add.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListAssets } from "@workspace/api-client-react";
import { apiFetch } from "@/lib/auth-api";
import { useCurrentUser } from "@/contexts/UserContext";
import { useOpenAlarms } from "@/hooks/useOpenAlarms";
import {
  type ProProps, COL, n, clamp, valuesOf, lastOf, mean, std, linFit, fmtNum, nameOf, SampleChip, NeedNote, Empty,
  useTween, useSize, pathOf, scale, extent, sample,
} from "./common";

// ── OEE Rings ─────────────────────────────────────────────────────────────────
export function OeeRings(p: ProProps) {
  const isSample = !p.bound;
  const [aK, pK, qK] = p.keys;
  const A = isSample ? 91 : aK ? lastOf(p.rows, aK) : null;
  const P = isSample ? 84 : pK ? lastOf(p.rows, pK) : null;
  const Q = isSample ? 97 : qK ? lastOf(p.rows, qK) : null;
  const oee = A != null && P != null && Q != null ? (A * P * Q) / 10000 : null;
  const target = n(p.c.target, 85)!;
  const to = useTween(oee);
  const rings = [
    { label: "Availability", v: A, col: "#3B82F6", r: 40 },
    { label: "Performance", v: P, col: "#A855F7", r: 31 },
    { label: "Quality", v: Q, col: "#22C55E", r: 22 },
  ];
  const missing = rings.filter((r) => r.v == null).map((r) => r.label);
  return (
    <div className="relative h-full w-full flex items-center justify-center gap-3">
      <SampleChip show={isSample} />
      <svg viewBox="0 0 100 100" className="h-full max-h-[200px]">
        {rings.map((r, i) => {
          const C = 2 * Math.PI * r.r, f = r.v == null ? 0 : clamp(r.v / 100, 0, 1);
          return (
            <g key={r.label}>
              <circle cx={50} cy={50} r={r.r} stroke={r.col} strokeOpacity={0.15} strokeWidth={7} fill="none" />
              <circle cx={50} cy={50} r={r.r} stroke={r.col} strokeWidth={7} fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - f)} transform="rotate(-90 50 50)" className="pro-ease" style={{ transitionDelay: `${i * 120}ms` }} />
            </g>
          );
        })}
        <text x={50} y={52} textAnchor="middle" fontSize={11} fontWeight={700} fill={oee != null && oee >= target ? COL.ok : oee != null ? COL.warn : COL.muted}>{to == null ? "—" : `${to.toFixed(0)}%`}</text>
        <text x={50} y={60} textAnchor="middle" fontSize={5} fill={COL.muted}>OEE</text>
      </svg>
      <div className="text-[11px] space-y-1">
        {rings.map((r) => <p key={r.label} className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full inline-block" style={{ background: r.col }} />{r.label} <b className="tabular-nums">{r.v == null ? "—" : `${r.v.toFixed(1)}%`}</b></p>)}
        <p className="text-muted-foreground">Target {target}%</p>
      </div>
      {(isSample || missing.length > 0) && <NeedNote text={isSample ? "Sample data. Bind Availability, Performance and Quality (%)." : `Not bound yet: ${missing.join(", ")}.`} />}
    </div>
  );
}

// ── OEE by Machine ────────────────────────────────────────────────────────────
export function OeeMachine(p: ProProps) {
  const { data } = useListAssets();
  const assets = (data as any[] | undefined) ?? [];
  const isSample = !p.bound;
  const target = n(p.c.target, 85)!;
  const items = isSample
    ? [["Soft Flow 1", 82], ["Soft Flow 2", 76], ["Jet Dyer", 88], ["Stenter", 61], ["Dryer", 71]].map(([l, v]) => ({ label: String(l), v: Number(v) as number | null }))
    : p.keys.map((k, i) => ({ label: assets.find((a) => a.id === p.meta[k]?.assetId)?.name ?? nameOf(p, k, i), v: lastOf(p.rows, k) }));
  const sorted = [...items].sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  return (
    <div className="relative h-full w-full flex flex-col justify-center gap-1.5 px-2 overflow-auto">
      <SampleChip show={isSample} />
      {sorted.map((it, i) => {
        const f = it.v == null ? 0 : clamp(it.v / 100, 0, 1);
        const col = it.v == null ? COL.neutral : it.v >= target ? COL.ok : it.v >= target - 15 ? COL.warn : COL.bad;
        return (
          <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(0,96px) 1fr 44px" }}>
            <span className="text-[11px] truncate">{it.label}</span>
            <div className="relative h-3.5 rounded-full bg-muted overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded-full pro-ease" style={{ width: `${f * 100}%`, background: col, transitionDelay: `${i * 70}ms` }} />
              <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-foreground/70" style={{ left: `${target}%` }} />
            </div>
            <span className="text-[11px] font-semibold tabular-nums text-right" style={{ color: col }}>{it.v == null ? "—" : `${it.v.toFixed(0)}%`}</span>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground text-right">│ target {target}%</p>
      {isSample && <NeedNote text="Sample data. Needs an OEE % attribute per machine." />}
    </div>
  );
}

// ── Anomaly Detection Chart ───────────────────────────────────────────────────
/** Rolling mean ± k·σ over the previous `window` points; a point outside is an anomaly. */
function band(vals: number[], win: number, k: number) {
  return vals.map((v, i) => {
    const prev = vals.slice(Math.max(0, i - win), i);
    // No verdict until there is enough history to judge against.
    if (prev.length < Math.max(5, Math.floor(win / 2))) return { v, m: null as number | null, lo: null as number | null, hi: null as number | null, out: false };
    const m = mean(prev), s = std(prev) || Math.abs(m) * 0.01 || 0.01;
    return { v, m, lo: m - k * s, hi: m + k * s, out: Math.abs(v - m) > k * s };
  });
}
export function Anomaly(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const isSample = !p.bound;
  let pts = isSample
    ? sample(80, 1, 50, 6).map((v, i) => ({ ts: Date.now() - (80 - i) * 60_000, t: "", v: i === 52 ? v + 22 : i === 67 ? v - 18 : v }))
    : valuesOf(p.rows, p.keys[0]);
  pts = pts.slice(-300);
  if (pts.length < 8) return <Empty>Needs at least 8 data points</Empty>;
  const win = Math.max(5, n(p.c.window, 20) ?? 20), k = n(p.c.sigma, 3) ?? 3;
  const b = band(pts.map((x) => x.v), win, k);
  const all = b.flatMap((x) => [x.v, x.lo ?? x.v, x.hi ?? x.v]);
  const [y0, y1] = extent(all);
  const top = 16, bot = h - 6, left = 6, right = w - 6;
  const sx = scale(0, pts.length - 1, left, right), sy = scale(y0, y1, bot, top);
  const withBand = b.map((x, i) => ({ ...x, i })).filter((x) => x.hi != null);
  const bandPath = withBand.length ? `${pathOf(withBand.map((x) => [sx(x.i), sy(x.hi!)]))} ${pathOf([...withBand].reverse().map((x) => [sx(x.i), sy(x.lo!)])).replace("M", "L")} Z` : "";
  const outs = b.map((x, i) => ({ ...x, i })).filter((x) => x.out);
  const unit = p.meta[p.keys[0]]?.unit ?? "";
  return (
    <div ref={ref} className="relative h-full w-full">
      <SampleChip show={isSample} />
      <svg width={w} height={h} className="block">
        {bandPath && <path d={bandPath} fill={COL.primary} fillOpacity={0.1} />}
        {withBand.length > 1 && <path d={pathOf(withBand.map((x) => [sx(x.i), sy(x.m!)]))} fill="none" stroke={COL.primary} strokeOpacity={0.4} strokeDasharray="3 3" />}
        <path d={pathOf(b.map((x, i) => [sx(i), sy(x.v)]))} fill="none" stroke={COL.primary} strokeWidth={1.6} />
        {outs.map((x) => (
          <g key={x.i} onMouseEnter={() => setHover(x.i)} onMouseLeave={() => setHover(null)}>
            <circle cx={sx(x.i)} cy={sy(x.v)} r={10} fill={COL.bad} className="pro-ping" />
            <circle cx={sx(x.i)} cy={sy(x.v)} r={4} fill={COL.bad} stroke={COL.card} strokeWidth={1.5} />
          </g>
        ))}
        {hover != null && (
          <text x={Math.min(right - 4, sx(hover) + 8)} y={Math.max(top + 10, sy(b[hover].v) - 8)} fontSize={10} fill={COL.fg} textAnchor={sx(hover) > w * 0.7 ? "end" : "start"} style={{ paintOrder: "stroke", stroke: COL.card, strokeWidth: 3 }}>
            {fmtNum(b[hover].v)} {unit} (expected {fmtNum(b[hover].m)})
          </text>
        )}
        <text x={left} y={11} fontSize={9} fill={outs.length ? COL.bad : COL.muted}>{outs.length} anomal{outs.length === 1 ? "y" : "ies"} · band ±{k}σ over {win} points</text>
      </svg>
    </div>
  );
}

// ── Anomaly Scoreboard ────────────────────────────────────────────────────────
function zScore(vals: number[]): number | null {
  if (vals.length < 6) return null;
  const hist = vals.slice(0, -1), last = vals[vals.length - 1];
  const s = std(hist);
  return s ? Math.abs(last - mean(hist)) / s : 0;
}
export function AnomalyBoard(p: ProProps) {
  const { data } = useListAssets();
  const assets = (data as any[] | undefined) ?? [];
  const isSample = !p.bound;
  const flag = n(p.c.sigma, 3) ?? 3;
  const items = isSample
    ? [["Jet Dyer", 4.2], ["Stenter", 2.4], ["Soft Flow 2", 1.1], ["Dryer", 0.6], ["Boiler", 0.3]].map(([l, z]) => ({ label: String(l), z: Number(z) as number | null }))
    : p.keys.map((k, i) => ({ label: assets.find((a) => a.id === p.meta[k]?.assetId)?.name ?? nameOf(p, k, i), z: zScore(valuesOf(p.rows, k).map((x) => x.v)) }));
  const sorted = [...items].sort((a, b) => (b.z ?? -1) - (a.z ?? -1));
  return (
    <div className="relative h-full w-full flex flex-col gap-1 p-1 overflow-auto">
      <SampleChip show={isSample} />
      {sorted.map((it, i) => {
        const col = it.z == null ? COL.neutral : it.z >= flag ? COL.bad : it.z >= flag * 0.66 ? COL.warn : COL.ok;
        const f = it.z == null ? 0 : clamp(it.z / (flag * 1.5), 0, 1);
        return (
          <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 pro-slide-in" style={{ background: `${col}12`, animationDelay: `${i * 50}ms` }}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${col === COL.bad ? "pro-pulse" : ""}`} style={{ background: col }} />
            <span className="text-[11px] flex-1 truncate">{it.label}</span>
            <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full pro-ease" style={{ width: `${f * 100}%`, background: col }} /></div>
            <span className="text-[11px] font-semibold tabular-nums w-10 text-right" style={{ color: col }}>{it.z == null ? "—" : `${it.z.toFixed(1)}σ`}</span>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground mt-auto">Flagged at {flag}σ from the range average</p>
    </div>
  );
}

// ── Machine Health Score ──────────────────────────────────────────────────────
/** 100, minus 15 per open alarm (25 if critical/high), scaled by data freshness. */
export function HealthScore(p: ProProps) {
  const { canModule } = useCurrentUser();
  const { alarms } = useOpenAlarms();
  const assetId: string | undefined = p.c.assetId;
  const q = useQuery({
    queryKey: ["asset-health", assetId],
    enabled: !!assetId && canModule("assets"),
    refetchInterval: 30_000,
    queryFn: async () => { const r = await apiFetch(`/api/assets/${assetId}/health`); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<{ assetName: string; freshnessPct: number | null; activeAlarms: number; lastSeen: string | null }>; },
  });
  const isSample = !assetId;
  const mine = alarms.filter((a) => a.assetId === assetId);
  const penalty = mine.reduce((s, a) => s + (a.severity === "critical" || a.severity === "high" ? 25 : 15), 0);
  const fresh = q.data?.freshnessPct;
  const score = isSample ? 78 : q.data ? clamp(Math.round((100 - penalty) * (fresh == null ? 1 : 0.5 + fresh / 200)), 0, 100) : null;
  const ts = useTween(score);
  if (!isSample && q.isError) return <Empty>Could not load this asset's health.</Empty>;
  const col = score == null ? COL.neutral : score >= 80 ? COL.ok : score >= 50 ? COL.warn : COL.bad;
  const R = 38, C = 2 * Math.PI * R * 0.75;
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center gap-1">
      <SampleChip show={isSample} />
      <svg viewBox="0 0 100 86" className="flex-1 min-h-0 w-full">
        <circle cx={50} cy={50} r={R} stroke={COL.track} strokeWidth={8} fill="none" strokeDasharray={`${C} 999`} transform="rotate(135 50 50)" strokeLinecap="round" />
        <circle cx={50} cy={50} r={R} stroke={col} strokeWidth={8} fill="none" strokeDasharray={`${C * ((ts ?? 0) / 100)} 999`} transform="rotate(135 50 50)" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${col})` }} />
        <g transform="translate(50 44)">
          <path d="M0,6 C-12,-4 -8,-14 0,-8 C8,-14 12,-4 0,6 Z" fill={col} className="pro-pulse" style={{ animationDuration: score != null && score < 50 ? "0.6s" : "1.4s" }} transform="scale(0.8)" />
        </g>
        <text x={50} y={66} textAnchor="middle" fontSize={15} fontWeight={700} fill={col}>{ts == null ? "—" : Math.round(ts)}</text>
      </svg>
      <p className="text-[10px] text-muted-foreground text-center px-2">
        {isSample ? "Example machine" : `${q.data?.assetName ?? ""} · ${mine.length} open alarm${mine.length === 1 ? "" : "s"} · data ${fresh == null ? "n/a" : `${fresh}% fresh`}`}
      </p>
    </div>
  );
}

// ── Remaining Useful Life ─────────────────────────────────────────────────────
export function Rul(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const isSample = !p.bound;
  const pts = isSample
    ? Array.from({ length: 40 }, (_, i) => ({ ts: Date.now() - (40 - i) * 86_400_000, v: 2 + 0.004 * i * i + Math.sin(i) * 0.15 }))
    : valuesOf(p.rows, p.keys[0]).map(({ ts, v }) => ({ ts, v }));
  const limit = n(p.c.failureLimit, isSample ? 9.5 : null);
  const rising = p.c.direction !== "falling";
  if (pts.length < 6) return <Empty>Needs at least 6 data points</Empty>;
  if (limit == null) return <Empty>Set a failure limit in Edit Widget</Empty>;
  const t0 = pts[0].ts;
  const recent = pts.slice(-Math.max(6, Math.floor(pts.length / 2)));
  const { a, b } = linFit(recent.map((x) => (x.ts - t0) / 3_600_000), recent.map((x) => x.v));
  const nowH = (pts[pts.length - 1].ts - t0) / 3_600_000;
  const heading = rising ? b > 0 : b < 0;
  const crossH = heading && b !== 0 ? (limit - a) / b : null;
  const remainH = crossH != null ? crossH - nowH : null;
  const reached = rising ? pts[pts.length - 1].v >= limit : pts[pts.length - 1].v <= limit;
  const endH = remainH != null && remainH > 0 ? Math.min(crossH!, nowH * 3) : nowH * 1.3;
  const [y0, y1] = extent([...pts.map((x) => x.v), limit]);
  const top = 30, bot = h - 14, left = 8, right = w - 8;
  const sx = scale(0, endH, left, right), sy = scale(y0, y1, bot, top);
  const fmtRem = (hrs: number) => (hrs >= 48 ? `${Math.round(hrs / 24)} days` : `${Math.round(hrs)} hours`);
  const col = reached ? COL.bad : remainH == null ? COL.ok : remainH < 24 * 7 ? COL.bad : remainH < 24 * 30 ? COL.warn : COL.ok;
  return (
    <div ref={ref} className="relative h-full w-full">
      <SampleChip show={isSample} />
      <svg width={w} height={h} className="block">
        <line x1={left} x2={right} y1={sy(limit)} y2={sy(limit)} stroke={COL.bad} strokeDasharray="4 3" />
        <text x={right} y={sy(limit) - 3} fontSize={9} fill={COL.bad} textAnchor="end">failure limit {limit}</text>
        <path d={pathOf(pts.map((x) => [sx((x.ts - t0) / 3_600_000), sy(x.v)]))} fill="none" stroke={COL.primary} strokeWidth={1.8} />
        {heading && <path d={pathOf([[sx(nowH), sy(a + b * nowH)], [sx(endH), sy(a + b * endH)]])} fill="none" stroke={col} strokeWidth={1.8} strokeDasharray="5 3" className="pro-dash" style={{ ["--pro-dur" as any]: "2.5s" }} />}
        {crossH != null && crossH <= endH + 0.001 && <circle cx={sx(crossH)} cy={sy(limit)} r={5} fill={COL.bad} className="pro-pulse" />}
        <text x={left} y={14} fontSize={15} fontWeight={700} fill={col}>{reached ? "Limit reached" : remainH == null || remainH <= 0 ? "No wear trend" : `≈ ${fmtRem(remainH)} left`}</text>
        <text x={left} y={25} fontSize={9} fill={COL.muted}>straight-line projection of the recent trend</text>
      </svg>
    </div>
  );
}

// ── Failure Risk and Risk Matrix ──────────────────────────────────────────────
/** 0–100: how close the latest value is to the limits, raised if it is also unusual. */
function riskOf(vals: number[], warn: number | null, crit: number | null): number | null {
  if (!vals.length) return null;
  const last = vals[vals.length - 1];
  let base = 20;
  if (crit != null && warn != null && crit > warn) base = clamp(((last - warn) / (crit - warn)) * 60 + 40, 0, 100);
  else if (crit != null) base = clamp((last / (crit || 1)) * 80, 0, 100);
  const z = zScore(vals) ?? 0;
  return clamp(Math.round(base + Math.min(30, z * 8)), 0, 100);
}
function useRiskItems(p: ProProps, sampleSet: [string, number][]) {
  const { data } = useListAssets();
  const assets = (data as any[] | undefined) ?? [];
  const { alarms } = useOpenAlarms();
  const warn = n(p.c.warn), crit = n(p.c.critical);
  if (!p.bound) return sampleSet.map(([label, r]) => ({ label, risk: r as number | null, alarms: r > 70 ? 2 : 0 }));
  return p.keys.map((k, i) => {
    const assetId = p.meta[k]?.assetId;
    const open = alarms.filter((a) => a.assetId === assetId).length;
    const r = riskOf(valuesOf(p.rows, k).map((x) => x.v), warn, crit);
    return { label: assets.find((a) => a.id === assetId)?.name ?? nameOf(p, k, i), risk: r == null ? null : clamp(r + open * 10, 0, 100), alarms: open };
  });
}
export function FailRisk(p: ProProps) {
  const items = useRiskItems(p, [["Jet Dyer", 82], ["Stenter", 57], ["Soft Flow 2", 34], ["Dryer", 18]]);
  const sorted = [...items].sort((a, b) => (b.risk ?? -1) - (a.risk ?? -1));
  return (
    <div className="relative h-full w-full flex flex-col gap-1.5 p-1 overflow-auto">
      <SampleChip show={!p.bound} />
      {sorted.map((it, i) => {
        const col = it.risk == null ? COL.neutral : it.risk >= 70 ? COL.bad : it.risk >= 40 ? COL.warn : COL.ok;
        return (
          <div key={i} className="rounded-md border border-border p-2 pro-slide-in" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium truncate">{it.label}</span>
              <span className="font-bold tabular-nums" style={{ color: col }}>{it.risk == null ? "—" : `${it.risk}%`}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1"><div className="h-full rounded-full pro-ease" style={{ width: `${it.risk ?? 0}%`, background: col }} /></div>
            {it.alarms > 0 && <p className="text-[10px] mt-0.5" style={{ color: COL.bad }}>{it.alarms} open alarm{it.alarms === 1 ? "" : "s"}</p>}
          </div>
        );
      })}
      {!p.bound && <NeedNote text="Sample data. Risk is a simple score from limits and recent behaviour, not a trained model." />}
    </div>
  );
}
export function RiskMatrix(p: ProProps) {
  const items = useRiskItems(p, [["Jet Dyer", 82], ["Stenter", 57], ["Soft Flow 2", 34], ["Dryer", 18]]);
  const impacts = String(p.c.impacts ?? (p.bound ? "" : "5,4,2,3")).split(",").map((s) => clamp(Math.round(Number(s.trim()) || 3), 1, 5));
  const cellCol = (l: number, im: number) => { const s = l * im; return s >= 15 ? COL.bad : s >= 8 ? COL.warn : COL.ok; };
  const placed = items.map((it, i) => ({ ...it, l: it.risk == null ? null : clamp(Math.ceil(it.risk / 20), 1, 5), im: impacts[i] ?? 3 }));
  return (
    <div className="relative h-full w-full flex gap-1 p-1">
      <SampleChip show={!p.bound} />
      <div className="flex flex-col justify-center"><span className="text-[9px] text-muted-foreground -rotate-90 whitespace-nowrap">Likelihood →</span></div>
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex-1 grid grid-cols-5 grid-rows-5 gap-[3px]">
          {Array.from({ length: 25 }, (_, idx) => {
            const l = 5 - Math.floor(idx / 5), im = (idx % 5) + 1;
            const here = placed.filter((x) => x.l === l && x.im === im);
            return (
              <div key={idx} className="relative rounded-sm flex flex-wrap items-center justify-center gap-0.5 p-0.5" style={{ background: `${cellCol(l, im)}${here.length ? "55" : "22"}` }}>
                {here.map((x, j) => <span key={j} className="text-[9px] font-semibold px-1 rounded bg-card/90 truncate max-w-full pro-slide-in" title={`${x.label}: risk ${x.risk}%, impact ${x.im}`}>{x.label.split(" ").map((w: string) => w[0]).join("").slice(0, 3)}</span>)}
              </div>
            );
          })}
        </div>
        <p className="text-[9px] text-muted-foreground text-center">Impact →</p>
      </div>
      {!p.bound && <NeedNote text="Sample data. Set an impact rating per machine in Edit Widget." />}
    </div>
  );
}
