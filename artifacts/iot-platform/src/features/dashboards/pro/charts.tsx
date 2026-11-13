/**
 * Charts Pro: improved charts that sit beside the original Line/Bar/Area/Donut,
 * plus history-based charts (today vs yesterday, calendar heatmap, range band,
 * waterfall, forecast, shift notes).
 */
import { useId, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Line, Bar, BarChart, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceArea, ReferenceLine, ReferenceDot, PieChart, Pie, Cell, Legend,
} from "recharts";
import { useTelemetrySeries } from "../useWidgetData";
import {
  type ProProps, COL, n, valuesOf, lastOf, mean, std, linFit, fmtNum, useData, nameOf, colorOf, SampleChip, NeedNote, Empty,
  useSize, pathOf, scale, extent, sample,
} from "./common";

const TIP = {
  isAnimationActive: false,
  contentStyle: { fontSize: 11, background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))", border: "1px solid hsl(var(--popover-border))", borderRadius: 6, padding: "6px 10px" },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
} as const;
const AX = { tick: { fontSize: 9 }, stroke: "hsl(var(--muted-foreground))" } as const;
const ANIM = { isAnimationActive: true, animationDuration: 700 } as const;

// ── Line Chart Pro ────────────────────────────────────────────────────────────
export function LinePro(p: ProProps) {
  const gid = useId().replace(/:/g, "");
  const { rows, keys, isSample } = useData(p, 2);
  const lo = n(p.c.lo), hi = n(p.c.hi);
  const k0 = keys[0];
  const v0 = valuesOf(rows, k0);
  const max = v0.length ? v0.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const min = v0.length ? v0.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  return (
    <div className="relative h-full w-full">
      <SampleChip show={isSample} />
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 14, right: 12, left: -14, bottom: 0 }}>
          <defs>
            {keys.map((k, i) => (
              <linearGradient key={k} id={`${gid}${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorOf(p, k, i)} stopOpacity={0.35} />
                <stop offset="100%" stopColor={colorOf(p, k, i)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={COL.border} opacity={0.5} vertical={false} />
          <XAxis dataKey="t" {...AX} minTickGap={24} /><YAxis {...AX} domain={["auto", "auto"]} />
          <Tooltip {...TIP} />
          {lo != null && hi != null && <ReferenceArea y1={lo} y2={hi} fill={COL.ok} fillOpacity={0.08} stroke={COL.ok} strokeOpacity={0.3} strokeDasharray="3 3" ifOverflow="extendDomain" />}
          {keys.length > 1 && <Legend verticalAlign="bottom" height={18} iconSize={9} wrapperStyle={{ fontSize: 10 }} />}
          {keys.map((k, i) => (
            <Area key={k} type="monotone" dataKey={k} name={nameOf(p, k, i)} stroke={colorOf(p, k, i)} strokeWidth={2} fill={`url(#${gid}${k})`} dot={false} connectNulls {...ANIM} />
          ))}
          {max && <ReferenceDot x={max.t} y={max.v} r={3.5} fill={COL.bad} stroke="none" label={{ value: `max ${fmtNum(max.v)}`, position: "top", fontSize: 9, fill: COL.muted }} />}
          {min && min !== max && <ReferenceDot x={min.t} y={min.v} r={3.5} fill={COL.primary} stroke="none" label={{ value: `min ${fmtNum(min.v)}`, position: "top", fontSize: 9, fill: COL.muted }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Bar Chart Pro ─────────────────────────────────────────────────────────────
export function BarPro(p: ProProps) {
  const gid = useId().replace(/:/g, "");
  const { rows: all, keys, isSample } = useData(p, 1, 60, 25, 12);
  // Few enough bars to read: 24 for one series, 12 groups for several.
  const rows = all.slice(keys.length > 1 ? -12 : -24);
  const target = n(p.c.target, isSample ? 70 : null);
  return (
    <div className="relative h-full w-full">
      <SampleChip show={isSample} />
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 14, right: 12, left: -14, bottom: 0 }}>
          <defs>
            {keys.map((k, i) => (
              <linearGradient key={k} id={`${gid}${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorOf(p, k, i)} stopOpacity={1} />
                <stop offset="100%" stopColor={colorOf(p, k, i)} stopOpacity={0.45} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={COL.border} opacity={0.5} vertical={false} />
          <XAxis dataKey="t" {...AX} minTickGap={16} /><YAxis {...AX} />
          <Tooltip {...TIP} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
          {keys.length > 1 && <Legend verticalAlign="bottom" height={18} iconSize={9} wrapperStyle={{ fontSize: 10 }} />}
          {target != null && <ReferenceLine y={target} stroke={COL.warn} strokeDasharray="4 3" ifOverflow="extendDomain" label={{ value: `target ${target}`, position: "insideTopRight", fontSize: 9, fill: COL.warn }} />}
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} name={nameOf(p, k, i)} fill={`url(#${gid}${k})`} radius={[4, 4, 0, 0]} {...ANIM}>
              {keys.length === 1 && rows.map((r, j) => <Cell key={j} fill={target != null && r[k] > target ? COL.warn : `url(#${gid}${k})`} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Stacked Area Pro ──────────────────────────────────────────────────────────
export function StackAreaPro(p: ProProps) {
  const gid = useId().replace(/:/g, "");
  const { rows, keys, isSample } = useData(p, 3, 30, 10);
  return (
    <div className="relative h-full w-full">
      <SampleChip show={isSample} />
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 10, right: 12, left: -14, bottom: 0 }}>
          <defs>
            {keys.map((k, i) => (
              <linearGradient key={k} id={`${gid}${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorOf(p, k, i)} stopOpacity={0.85} />
                <stop offset="100%" stopColor={colorOf(p, k, i)} stopOpacity={0.35} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={COL.border} opacity={0.5} vertical={false} />
          <XAxis dataKey="t" {...AX} minTickGap={24} /><YAxis {...AX} />
          <Tooltip {...TIP} />
          <Legend verticalAlign="bottom" height={18} iconSize={9} wrapperStyle={{ fontSize: 10 }} />
          {keys.map((k, i) => (
            <Area key={k} type="monotone" dataKey={k} name={nameOf(p, k, i)} stackId="s" stroke={colorOf(p, k, i)} strokeWidth={1.5} fill={`url(#${gid}${k})`} connectNulls {...ANIM} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Donut Pro ─────────────────────────────────────────────────────────────────
export function DonutPro(p: ProProps) {
  const [hover, setHover] = useState<number | null>(null);
  const isSample = !p.bound;
  const slices = isSample
    ? [42, 28, 18, 12].map((v, i) => ({ name: ["Dyeing", "Drying", "Utilities", "Other"][i], value: v, fill: colorOf(p, `x${i}`, i) }))
    : p.keys.map((k, i) => ({ name: nameOf(p, k, i), value: lastOf(p.rows, k) ?? 0, fill: colorOf(p, k, i) })).filter((s) => s.value > 0);
  if (!slices.length) return <Empty>No positive values to chart</Empty>;
  const total = slices.reduce((s, x) => s + x.value, 0);
  const shown = hover != null ? slices[hover] : null;
  const unit = p.meta[p.keys[0]]?.unit ?? "";
  return (
    <div className="relative h-full w-full">
      <SampleChip show={isSample} />
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2} cornerRadius={4} stroke="none"
            onMouseEnter={(_, i) => setHover(i)} onMouseLeave={() => setHover(null)} {...ANIM}>
            {slices.map((s, i) => <Cell key={i} fill={s.fill} opacity={hover == null || hover === i ? 1 : 0.35} style={{ transition: "opacity .2s" }} />)}
          </Pie>
          <Legend verticalAlign="bottom" height={18} iconSize={9} wrapperStyle={{ fontSize: 10 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 bottom-5 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[10px] text-muted-foreground truncate max-w-[50%]">{shown ? shown.name : "Total"}</span>
        <span className="text-lg font-bold tabular-nums">{fmtNum(shown ? shown.value : total)}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">{unit}</span></span>
        {shown && <span className="text-[10px] text-muted-foreground">{((shown.value / total) * 100).toFixed(1)}%</span>}
      </div>
    </div>
  );
}

// ── Live Trend Stream ─────────────────────────────────────────────────────────
export function Stream(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const { rows, keys, isSample } = useData(p, 1, 60, 15, 60);
  const lo = n(p.c.lo, isSample ? 45 : null), hi = n(p.c.hi, isSample ? 75 : null);
  const view = rows.slice(-60);
  const all = keys.flatMap((k) => valuesOf(view, k).map((x) => x.v)).concat(lo != null ? [lo] : [], hi != null ? [hi] : []);
  const [y0, y1] = extent(all, 0.12);
  const top = 18, bot = h - 6, left = 6, right = w - 58;
  const sy = scale(y0, y1, bot, top);
  const sx = scale(0, Math.max(1, view.length - 1), left, right);
  const last = lastOf(view, keys[0]);
  const out = last != null && ((hi != null && last > hi) || (lo != null && last < lo));
  return (
    <div ref={ref} className="relative h-full w-full">
      <SampleChip show={isSample} />
      <svg width={w} height={h} className="block">
        {lo != null && hi != null && <rect x={left} y={sy(hi)} width={right - left} height={Math.max(0, sy(lo) - sy(hi))} fill={COL.ok} opacity={0.08} />}
        {hi != null && <line x1={left} x2={right} y1={sy(hi)} y2={sy(hi)} stroke={COL.bad} strokeDasharray="4 3" opacity={0.6} />}
        {lo != null && <line x1={left} x2={right} y1={sy(lo)} y2={sy(lo)} stroke={COL.bad} strokeDasharray="4 3" opacity={0.6} />}
        {keys.map((k, i) => {
          const pts: [number, number][] = [];
          view.forEach((r, j) => { if (r[k] != null) pts.push([sx(j), sy(r[k])]); });
          if (!pts.length) return null;
          const [hx, hy] = pts[pts.length - 1];
          const col = colorOf(p, k, i);
          return (
            <g key={k}>
              <path d={pathOf(pts)} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 3px ${col})` }} />
              <circle cx={hx} cy={hy} r={9} fill={col} className="pro-ping" opacity={0.4} />
              <circle cx={hx} cy={hy} r={3.5} fill={col} />
            </g>
          );
        })}
        <text x={right + 6} y={top + 14} fontSize={16} fontWeight={700} fill={out ? COL.bad : COL.fg}>{fmtNum(last)}</text>
        <text x={right + 6} y={top + 28} fontSize={9} fill={COL.muted}>{p.meta[keys[0]]?.unit ?? ""}</text>
        {out && <text x={right + 6} y={top + 42} fontSize={9} fill={COL.bad} className="pro-pulse">out of band</text>}
      </svg>
    </div>
  );
}

// ── Today vs Yesterday ────────────────────────────────────────────────────────
function midnight(offsetDays: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}
export function TodayVs(p: ProProps) {
  const today0 = midnight(0), yest0 = midnight(-1);
  const tcfg = useMemo(() => ({ customFrom: today0, granularity: "15m" }), [today0]);
  const ycfg = useMemo(() => ({ customFrom: yest0, customTo: today0, granularity: "15m" }), [yest0, today0]);
  const live = !!(p.c.assetId && p.c.tag);
  const T = useTelemetrySeries(live ? p.c.assetId : undefined, p.c.tag, tcfg, p.refreshSec, p.refreshNonce).data;
  const Y = useTelemetrySeries(live ? p.c.assetId : undefined, p.c.tag, ycfg, p.refreshSec, p.refreshNonce).data;
  const isSample = !live;
  const slot = (ts: number) => { const d = new Date(ts); return d.getHours() * 4 + Math.floor(d.getMinutes() / 15); };
  const data = Array.from({ length: 96 }, (_, i) => ({ t: `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`, today: null as number | null, yesterday: null as number | null }));
  if (isSample) {
    const nowSlot = slot(Date.now());
    const a = sample(96, 1, 50, 18), b = sample(96, 1.25, 46, 18);
    data.forEach((d, i) => { d.yesterday = b[i]; if (i <= nowSlot) d.today = a[i]; });
  } else {
    T.forEach((x) => { data[slot(x.ts)].today = x.v; });
    Y.forEach((x) => { data[slot(x.ts)].yesterday = x.v; });
  }
  if (live && !T.length && !Y.length) return <Empty>No data today or yesterday</Empty>;
  const nowSlot = slot(Date.now());
  const tVals = data.slice(0, nowSlot + 1).map((d) => d.today).filter((v): v is number => v != null);
  const yVals = data.slice(0, nowSlot + 1).map((d) => d.yesterday).filter((v): v is number => v != null);
  const tAvg = mean(tVals), yAvg = mean(yVals);
  const diff = yVals.length && yAvg ? ((tAvg - yAvg) / Math.abs(yAvg)) * 100 : null;
  const unit = p.meta.s0?.unit ?? "";
  return (
    <div className="relative h-full w-full flex flex-col">
      <SampleChip show={isSample} />
      <div className="flex items-baseline gap-3 px-1 shrink-0">
        <span className="text-lg font-bold tabular-nums">{fmtNum(tVals.length ? tAvg : null)}<span className="text-[10px] text-muted-foreground ml-0.5">{unit} avg today</span></span>
        {diff != null && <span className="text-xs font-semibold" style={{ color: diff >= 0 ? COL.warn : COL.ok }}>{diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}% vs same time yesterday</span>}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COL.border} opacity={0.5} vertical={false} />
            <XAxis dataKey="t" {...AX} interval={11} /><YAxis {...AX} />
            <Tooltip {...TIP} />
            <Legend verticalAlign="bottom" height={18} iconSize={9} wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="yesterday" name="Yesterday" stroke={COL.neutral} strokeDasharray="4 3" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            <Area type="monotone" dataKey="today" name="Today" stroke={COL.primary} fill={COL.primary} fillOpacity={0.15} strokeWidth={2} dot={false} connectNulls {...ANIM} />
            <ReferenceLine x={data[nowSlot]?.t} stroke={COL.muted} strokeDasharray="2 2" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Calendar Heatmap (last 7 days × 24 hours) ─────────────────────────────────
export function CalHeat(p: ProProps) {
  const cfg = useMemo(() => ({ rangeMinutes: 10080, granularity: "1h" }), []);
  const live = !!(p.c.assetId && p.c.tag);
  const { data } = useTelemetrySeries(live ? p.c.assetId : undefined, p.c.tag, cfg, p.refreshSec, p.refreshNonce);
  const [hover, setHover] = useState<{ d: number; h: number; v: number | null } | null>(null);
  const isSample = !live;
  const grid: (number | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
  const day0 = new Date(); day0.setHours(0, 0, 0, 0); day0.setDate(day0.getDate() - 6);
  if (isSample) {
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) grid[d][h] = 40 + 30 * Math.sin((h - 6) / 24 * Math.PI * 2) * (d < 5 ? 1 : 0.4) + ((d * 7 + h * 3) % 9);
  } else {
    for (const x of data) {
      const dt = new Date(x.ts);
      const d = Math.floor((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() - day0.getTime()) / 86_400_000);
      if (d >= 0 && d < 7) grid[d][dt.getHours()] = x.v;
    }
  }
  if (live && !data.length) return <Empty>No data in the last 7 days</Empty>;
  const vals = grid.flat().filter((v): v is number => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const days = Array.from({ length: 7 }, (_, d) => new Date(day0.getTime() + d * 86_400_000).toLocaleDateString(undefined, { weekday: "short" }));
  const unit = p.meta.s0?.unit ?? "";
  return (
    <div className="relative h-full w-full flex flex-col gap-1 p-1">
      <SampleChip show={isSample} />
      <div className="flex-1 min-h-0 grid gap-[2px]" style={{ gridTemplateColumns: "28px repeat(24, minmax(0,1fr))", gridTemplateRows: "repeat(7, minmax(0,1fr)) 12px" }}>
        {grid.map((row, d) => [
          <span key={`l${d}`} className="text-[9px] text-muted-foreground self-center">{days[d]}</span>,
          ...row.map((v, h) => (
            <div key={`${d}-${h}`} className="rounded-[2px] pro-ease" onMouseEnter={() => setHover({ d, h, v })} onMouseLeave={() => setHover(null)}
              style={{ background: v == null ? "hsl(var(--muted))" : `rgba(59,130,246,${0.12 + ((v - lo) / span) * 0.88})`, outline: hover?.d === d && hover?.h === h ? `1px solid ${COL.fg}` : undefined }} />
          )),
        ])}
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-[8px] text-muted-foreground text-center">{h % 6 === 0 ? h : ""}</span>)}
      </div>
      <p className="text-[10px] text-muted-foreground h-3 shrink-0">
        {hover ? `${days[hover.d]} ${String(hover.h).padStart(2, "0")}:00 · ${hover.v == null ? "no data" : `${fmtNum(hover.v)} ${unit}`}` : `Low ${fmtNum(lo)} · high ${fmtNum(hi)} ${unit}`}
      </p>
    </div>
  );
}

// ── Range Band (min / average / max per bucket) ───────────────────────────────
export function RangeBand(p: ProProps) {
  const { rows, keys, isSample } = useData(p, 1, 50, 12, 240);
  const bucketMs = (n(p.c.bucketMinutes, 60) ?? 60) * 60_000;
  const vals = valuesOf(rows, keys[0]);
  const groups = new Map<number, number[]>();
  for (const x of vals) { const b = Math.floor(x.ts / bucketMs) * bucketMs; (groups.get(b) ?? groups.set(b, []).get(b)!).push(x.v); }
  let data = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([b, vs]) => ({
    t: new Date(b).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    range: [Math.min(...vs), Math.max(...vs)] as [number, number], avg: mean(vs),
  }));
  if (isSample) {
    data = Array.from({ length: 16 }, (_, i) => { const m = 50 + 12 * Math.sin(i / 2.5); return { t: `${String(i + 6).padStart(2, "0")}:00`, range: [m - 6 - (i % 3), m + 7 + (i % 4)] as [number, number], avg: m }; });
  }
  return (
    <div className="relative h-full w-full">
      <SampleChip show={isSample} />
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 12, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COL.border} opacity={0.5} vertical={false} />
          <XAxis dataKey="t" {...AX} minTickGap={20} /><YAxis {...AX} domain={["auto", "auto"]} />
          <Tooltip {...TIP} formatter={(v: any) => (Array.isArray(v) ? `${fmtNum(v[0])} – ${fmtNum(v[1])}` : fmtNum(Number(v)))} />
          <Legend verticalAlign="bottom" height={18} iconSize={9} wrapperStyle={{ fontSize: 10 }} />
          <Area type="monotone" dataKey="range" name="Min – max" stroke="none" fill={COL.primary} fillOpacity={0.2} {...ANIM} />
          <Line type="monotone" dataKey="avg" name="Average" stroke={COL.primary} strokeWidth={2} dot={{ r: 2 }} {...ANIM} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Waterfall ─────────────────────────────────────────────────────────────────
export function Waterfall(p: ProProps) {
  const isSample = !p.bound;
  const steps = isSample
    ? [["Start", 120], ["Dyeing", 46], ["Drying", 31], ["Losses", -12], ["Recovery", -8]].map(([name, v]) => ({ name: String(name), v: Number(v) }))
    : p.keys.map((k, i) => ({ name: nameOf(p, k, i), v: lastOf(p.rows, k) ?? 0 }));
  let run = 0;
  const data = steps.map((s) => { const base = s.v >= 0 ? run : run + s.v; run += s.v; return { name: s.name, base, size: Math.abs(s.v), v: s.v, kind: s.v >= 0 ? "up" : "down" }; });
  data.push({ name: "Total", base: Math.min(0, run), size: Math.abs(run), v: run, kind: "total" });
  return (
    <div className="relative h-full w-full">
      <SampleChip show={isSample} />
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 14, right: 12, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COL.border} opacity={0.5} vertical={false} />
          <XAxis dataKey="name" {...AX} interval={0} /><YAxis {...AX} />
          <Tooltip {...TIP} formatter={(_v: any, _n: any, item: any) => [fmtNum(item?.payload?.v), item?.payload?.name]} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="size" stackId="w" radius={[3, 3, 3, 3]} {...ANIM} label={{ position: "top", fontSize: 9, fill: COL.muted, formatter: (v: any) => fmtNum(Number(v)) }}>
            {data.map((d, i) => <Cell key={i} fill={d.kind === "total" ? COL.primary : d.kind === "up" ? COL.ok : COL.bad} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Forecast ──────────────────────────────────────────────────────────────────
/**
 * Straight-line trend plus an hour-of-day pattern (when the history covers at
 * least a day), fitted to the loaded range. The band is ±2 residual standard
 * deviations, widening with distance from now.
 */
export function Forecast(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const isSample = !p.bound;
  const hist = isSample
    ? sample(48, 1, 600, 220).map((v, i) => ({ ts: Date.now() - (48 - i) * 3_600_000, v }))
    : valuesOf(p.rows, p.keys[0]).map(({ ts, v }) => ({ ts, v }));
  if (hist.length < 6) return <Empty>Needs at least 6 data points to forecast</Empty>;
  const horizon = Math.max(1, Math.min(500, n(p.c.horizon, 24) ?? 24));
  const step = (hist[hist.length - 1].ts - hist[0].ts) / (hist.length - 1) || 3_600_000;
  const xs = hist.map((_, i) => i), ys = hist.map((x) => x.v);
  const { a, b } = linFit(xs, ys);
  const coversDay = hist[hist.length - 1].ts - hist[0].ts >= 86_400_000;
  const hourAdj = new Map<number, number>();
  if (coversDay) {
    const byH = new Map<number, number[]>();
    hist.forEach((x, i) => { const hr = new Date(x.ts).getHours(); (byH.get(hr) ?? byH.set(hr, []).get(hr)!).push(x.v - (a + b * i)); });
    byH.forEach((v, hr) => hourAdj.set(hr, mean(v)));
  }
  const model = (i: number, ts: number) => a + b * i + (hourAdj.get(new Date(ts).getHours()) ?? 0);
  const resid = std(hist.map((x, i) => x.v - model(i, x.ts)));
  const fc = Array.from({ length: horizon }, (_, k) => {
    const i = hist.length + k, ts = hist[hist.length - 1].ts + (k + 1) * step;
    const m = model(i, ts), u = 2 * resid * Math.sqrt(1 + (k + 1) / hist.length);
    return { ts, m, lo: m - u, hi: m + u };
  });
  const total = hist.length + horizon;
  const [y0, y1] = extent([...ys, ...fc.map((f) => f.lo), ...fc.map((f) => f.hi)]);
  const top = 16, bot = h - 16, left = 8, right = w - 8;
  const sx = scale(0, total - 1, left, right), sy = scale(y0, y1, bot, top);
  const nowX = sx(hist.length - 1);
  const nowPt: [number, number] = [nowX, sy(ys[ys.length - 1])];
  const upper = fc.map((f, k) => [sx(hist.length + k), sy(f.hi)] as [number, number]);
  const lower = fc.map((f, k) => [sx(hist.length + k), sy(f.lo)] as [number, number]).reverse();
  const unit = p.meta.s0?.unit ?? "";
  return (
    <div ref={ref} className="relative h-full w-full">
      <SampleChip show={isSample} />
      <svg width={w} height={h} className="block">
        <path d={`${pathOf([nowPt, ...upper, ...lower])} Z`} fill="#A78BFA" fillOpacity={0.22} className="pro-pulse" style={{ animationDuration: "3s" }} />
        <path d={pathOf(hist.map((x, i) => [sx(i), sy(x.v)]))} fill="none" stroke={COL.primary} strokeWidth={2} />
        <path d={pathOf([[nowX, sy(ys[ys.length - 1])], ...fc.map((f, k) => [sx(hist.length + k), sy(f.m)] as [number, number])])} fill="none" stroke="#A78BFA" strokeWidth={2} strokeDasharray="5 3" className="pro-dash" style={{ ["--pro-dur" as any]: "3s" }} />
        <line x1={nowX} x2={nowX} y1={top - 6} y2={bot} stroke={COL.muted} strokeDasharray="2 2" />
        <text x={nowX - 4} y={h - 4} fontSize={9} fill={COL.muted} textAnchor="end">now</text>
        <text x={left} y={11} fontSize={9} fill={COL.muted}>history</text>
        <text x={right} y={11} fontSize={9} fill="#A78BFA" textAnchor="end">next {horizon} pts · end ≈ {fmtNum(fc[fc.length - 1].m)} {unit}</text>
      </svg>
      {isSample && <NeedNote text="Sample data. Bind a metric to project its own history." />}
    </div>
  );
}

// ── Shift Notes ───────────────────────────────────────────────────────────────
export function ShiftNotes(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const isSample = !p.bound;
  const pts = isSample
    ? sample(60, 1, 50, 12).map((v, i) => ({ ts: Date.now() - (60 - i) * 600_000, v }))
    : valuesOf(p.rows, p.keys[0]).map(({ ts, v }) => ({ ts, v }));
  if (!pts.length) return <Empty>No data in selected range</Empty>;
  const raw = String(p.c.notes ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  let notes = raw.map((l) => { const [when, ...rest] = l.split("|"); return { ts: new Date(when.trim().replace(" ", "T")).getTime(), text: rest.join("|").trim() || "Note" }; })
    .filter((x) => !isNaN(x.ts));
  if (isSample && !notes.length) notes = [{ ts: pts[14].ts, text: "Filter changed" }, { ts: pts[40].ts, text: "Speed reduced" }];
  const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts;
  const visible = notes.filter((x) => x.ts >= t0 && x.ts <= t1);
  const [y0, y1] = extent(pts.map((x) => x.v));
  const top = 44, bot = h - 14, left = 8, right = w - 8;
  const sx = scale(t0, t1, left, right), sy = scale(y0, y1, bot, top);
  const valAt = (ts: number) => pts.reduce((b, x) => (Math.abs(x.ts - ts) < Math.abs(b.ts - ts) ? x : b)).v;
  return (
    <div ref={ref} className="relative h-full w-full">
      <SampleChip show={isSample} />
      <svg width={w} height={h} className="block">
        <path d={pathOf(pts.map((x) => [sx(x.ts), sy(x.v)]))} fill="none" stroke={COL.primary} strokeWidth={2} />
        {visible.map((nt, i) => {
          const x = sx(nt.ts), y = sy(valAt(nt.ts)), ly = 6 + (i % 2) * 18;
          const tw = Math.min(160, nt.text.length * 5.6 + 12), bx = Math.max(2, Math.min(w - tw - 2, x - tw / 2));
          return (
            <g key={i} className="pro-slide-in" style={{ animationDelay: `${i * 120}ms` }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <line x1={x} x2={x} y1={ly + 14} y2={y} stroke={COL.warn} strokeDasharray="2 2" />
              <rect x={bx} y={ly} width={tw} height={14} rx={3} fill={COL.warn} opacity={hover === i ? 0.35 : 0.18} />
              <text x={bx + 6} y={ly + 10} fontSize={9} fill={COL.warn}>{nt.text.length > 28 ? nt.text.slice(0, 27) + "…" : nt.text}</text>
              <circle cx={x} cy={y} r={3.5} fill={COL.warn} />
            </g>
          );
        })}
        <text x={right} y={h - 2} fontSize={9} fill={COL.muted} textAnchor="end">{visible.length} note{visible.length === 1 ? "" : "s"} in range · add notes in Edit Widget</text>
      </svg>
    </div>
  );
}
