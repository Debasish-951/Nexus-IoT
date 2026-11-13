/**
 * Energy and Process widgets. Energy figures are worked out from the bound
 * energy attribute over the widget's time range, using the tariff and factors
 * entered in Edit Widget; nothing is assumed when a setting is missing.
 */
import { useMemo } from "react";
import { useTelemetrySeries } from "../useWidgetData";
import { getFromTo } from "../timeRange";
import {
  type ProProps, COL, n, clamp, valuesOf, lastOf, mean, fmtNum, SampleChip, NeedNote, Empty,
  useTween, useSize, pathOf, scale, extent, energyUsed, sample,
} from "./common";

function inPeak(hour: number, spec: unknown): boolean {
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(String(spec ?? "").trim());
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a <= b ? hour >= a && hour < b : hour >= a || hour < b;
}

/** kWh split into peak and off-peak hours. */
function splitEnergy(pts: { ts: number; v: number }[], mode: string | undefined, peakHours: unknown) {
  let peak = 0, off = 0;
  pts.forEach((x, i) => {
    const used = mode === "interval" ? x.v : i ? Math.max(0, x.v - pts[i - 1].v) : 0;
    if (inPeak(new Date(x.ts).getHours(), peakHours)) peak += used; else off += used;
  });
  return { peak, off };
}

// ── Energy Cost ───────────────────────────────────────────────────────────────
export function EnergyCost(p: ProProps) {
  const isSample = !p.bound;
  const cur = String(p.c.currency || "₹");
  const rate = n(p.c.rate, isSample ? 6.1 : null), peakRate = n(p.c.peakRate) ?? rate;
  const pts = isSample ? [] : valuesOf(p.rows, p.keys[0]).map(({ ts, v }) => ({ ts, v }));
  const { peak, off } = isSample ? { peak: 1640, off: 2510 } : splitEnergy(pts, p.c.energyMode, p.c.peakHours);
  const cost = rate == null ? null : off * rate + peak * (isSample ? 9.4 : peakRate ?? rate);
  const tc = useTween(cost);
  const hours = pts.length > 1 ? (pts[pts.length - 1].ts - pts[0].ts) / 3_600_000 : isSample ? 14.5 : 0;
  const perH = cost != null && hours > 0 ? cost / hours : null;
  const tot = peak + off;
  if (!isSample && rate == null) return <Empty>Enter your tariff (rate per kWh) in Edit Widget</Empty>;
  return (
    <div className="relative h-full w-full flex flex-col justify-center gap-1.5 px-2">
      <SampleChip show={isSample} />
      <p className="text-[10px] text-muted-foreground">Energy cost in range</p>
      <p className="text-3xl font-bold tabular-nums leading-none">{cur}{tc == null ? "—" : Math.round(tc).toLocaleString()}</p>
      <p className="text-[11px] text-muted-foreground">{fmtNum(tot, 0)} kWh{perH != null && <> · ≈ {cur}{Math.round(perH).toLocaleString()}/h</>}</p>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
        <div className="pro-ease" style={{ width: `${tot ? (peak / tot) * 100 : 0}%`, background: COL.warn }} />
        <div className="pro-ease" style={{ width: `${tot ? (off / tot) * 100 : 0}%`, background: COL.primary }} />
      </div>
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <span><b style={{ color: COL.warn }}>■</b> Peak {fmtNum(peak, 0)} kWh</span>
        <span><b style={{ color: COL.primary }}>■</b> Off-peak {fmtNum(off, 0)} kWh</span>
      </div>
      {isSample && <NeedNote text="Sample data. Needs an energy attribute and your tariff." />}
    </div>
  );
}

// ── CO₂ Emissions ─────────────────────────────────────────────────────────────
export function Co2(p: ProProps) {
  const isSample = !p.bound;
  const factor = n(p.c.factor, 0.71)!;
  const target = n(p.c.target, isSample ? 186 : null);
  const pts = isSample ? [] : valuesOf(p.rows, p.keys[0]).map((x) => x.v);
  const kwh = isSample ? 151_000 : energyUsed(pts, p.c.energyMode);
  const t = (kwh * factor) / 1000;
  const tt = useTween(t);
  const f = target ? clamp(t / target, 0, 1.2) : null;
  const col = f == null ? COL.primary : f > 1 ? COL.bad : f > 0.85 ? COL.warn : COL.ok;
  return (
    <div className="relative h-full w-full flex flex-col justify-center gap-2 px-2">
      <SampleChip show={isSample} />
      <div className="flex items-end gap-2">
        <svg viewBox="0 0 24 24" className="w-7 h-7 shrink-0" style={{ color: col }}><path fill="currentColor" d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66l.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8" className="pro-glow" /></svg>
        <p className="text-3xl font-bold tabular-nums leading-none">{tt == null ? "—" : tt.toFixed(1)}<span className="text-sm font-medium text-muted-foreground ml-1">t CO₂</span></p>
      </div>
      <p className="text-[11px] text-muted-foreground">{fmtNum(kwh, 0)} kWh × {factor} kg/kWh</p>
      {target != null && (
        <>
          <div className="relative h-3 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full pro-ease" style={{ width: `${clamp(f ?? 0, 0, 1) * 100}%`, background: col }} /></div>
          <p className="text-[11px] font-semibold" style={{ color: col }}>{Math.round((f ?? 0) * 100)}% of the {target} t target{f != null && f > 1 ? " · over target" : ""}</p>
        </>
      )}
      {isSample && <NeedNote text="Sample data. Needs an energy attribute, grid factor and target." />}
    </div>
  );
}

// ── Specific Energy Consumption ───────────────────────────────────────────────
export function Sec(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const isSample = !p.bound || p.keys.length < 2;
  const unit = String(p.c.perUnit || "kg");
  const target = n(p.c.target, isSample ? 2.4 : null);
  let secVal: number | null = null;
  let trend: number[] = [];
  if (isSample) { trend = sample(20, 2, 2.6, 0.35); secVal = trend[trend.length - 1]; }
  else {
    const e = valuesOf(p.rows, p.keys[0]), pr = valuesOf(p.rows, p.keys[1]);
    const kwh = energyUsed(e.map((x) => x.v), p.c.energyMode), prod = energyUsed(pr.map((x) => x.v), "counter");
    secVal = prod > 0 ? kwh / prod : null;
    // Per-bucket SEC for the trend, 12 equal slices of the range.
    const slices = 12, t0 = p.rows[0]?.ts ?? 0, t1 = p.rows[p.rows.length - 1]?.ts ?? 0, step = (t1 - t0) / slices || 1;
    for (let s = 0; s < slices; s++) {
      const a = t0 + s * step, b = a + step;
      const ek = energyUsed(e.filter((x) => x.ts >= a && x.ts <= b).map((x) => x.v), p.c.energyMode);
      const pk = energyUsed(pr.filter((x) => x.ts >= a && x.ts <= b).map((x) => x.v), "counter");
      if (pk > 0) trend.push(ek / pk);
    }
  }
  const tv = useTween(secVal);
  const lo = target ? target * 0.6 : 0, hi = target ? target * 1.6 : Math.max(1, ...(trend.length ? trend : [1])) * 1.3;
  const fa = (v: number) => Math.PI + clamp((v - lo) / (hi - lo || 1), 0, 1) * Math.PI;
  const cx = 62, cy = h - 30, r = Math.min(48, h * 0.42);
  const col = tv == null || target == null ? COL.primary : tv <= target ? COL.ok : tv <= target * 1.25 ? COL.warn : COL.bad;
  const x0 = cx + r + 24;
  const [y0, y1] = extent(trend.concat(target != null ? [target] : []));
  const sx = scale(0, Math.max(1, trend.length - 1), x0, w - 8), sy = scale(y0, y1, h - 16, 18);
  return (
    <div ref={ref} className="relative h-full w-full">
      <SampleChip show={isSample} />
      <svg width={w} height={h} className="block">
        {target != null && [[lo, target, COL.ok], [target, target * 1.25, COL.warn], [target * 1.25, hi, COL.bad]].map(([a, b, c], i) => (
          <path key={i} d={`M${cx + r * Math.cos(fa(a as number))},${cy + r * Math.sin(fa(a as number))} A${r},${r} 0 0 1 ${cx + r * Math.cos(fa(b as number))},${cy + r * Math.sin(fa(b as number))}`} stroke={c as string} strokeOpacity={0.55} strokeWidth={9} fill="none" />
        ))}
        {target == null && <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} stroke={COL.track} strokeWidth={9} fill="none" />}
        {tv != null && <line x1={cx} y1={cy} x2={cx + (r - 8) * Math.cos(fa(tv))} y2={cy + (r - 8) * Math.sin(fa(tv))} stroke={COL.fg} strokeWidth={2.5} strokeLinecap="round" />}
        <circle cx={cx} cy={cy} r={4} fill={COL.fg} />
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize={15} fontWeight={700} fill={col}>{tv == null ? "—" : tv.toFixed(2)}</text>
        <text x={cx} y={cy + 28} textAnchor="middle" fontSize={8} fill={COL.muted}>kWh per {unit}</text>
        {trend.length > 1 && <path d={pathOf(trend.map((v, i) => [sx(i), sy(v)]))} fill="none" stroke={COL.primary} strokeWidth={1.6} />}
        {target != null && trend.length > 1 && <line x1={x0} x2={w - 8} y1={sy(target)} y2={sy(target)} stroke={COL.ok} strokeDasharray="3 3" />}
        {trend.length > 1 && <text x={x0} y={11} fontSize={9} fill={COL.muted}>trend{target != null ? ` · target ${target}` : ""}</text>}
      </svg>
      {isSample && <NeedNote text={p.bound ? "Bind the production count as overlay 1." : "Sample data. Needs energy and a production count."} />}
    </div>
  );
}

// ── Peak Demand Meter ─────────────────────────────────────────────────────────
export function PeakDemand(p: ProProps) {
  const isSample = !p.bound;
  const vals = isSample ? sample(30, 3, 820, 160) : valuesOf(p.rows, p.keys[0]).map((x) => x.v);
  const now = vals.length ? vals[vals.length - 1] : null;
  const peak = vals.length ? Math.max(...vals) : null;
  const max = n(p.c.contractMax, isSample ? 1100 : null);
  const tv = useTween(now);
  if (!isSample && max == null) return <Empty>Enter your contracted maximum (kW) in Edit Widget</Empty>;
  const scaleMax = Math.max(max ?? 0, peak ?? 0) * 1.15 || 1;
  const f = (v: number) => clamp(v / scaleMax, 0, 1);
  const near = now != null && max != null && now >= max * 0.9, over = now != null && max != null && now > max;
  const col = over ? COL.bad : near ? COL.warn : COL.primary;
  return (
    <div className="relative h-full w-full flex items-stretch gap-3 p-2">
      <SampleChip show={isSample} />
      <div className="relative w-12 rounded-md bg-muted overflow-hidden shrink-0">
        {max != null && <div className="absolute inset-x-0" style={{ bottom: `${f(max * 0.9) * 100}%`, height: `${(f(max) - f(max * 0.9)) * 100}%`, background: `${COL.warn}40` }} />}
        <div className={`absolute inset-x-0 bottom-0 rounded-md pro-ease ${near ? "pro-pulse" : ""}`} style={{ height: `${f(tv ?? 0) * 100}%`, background: col }} />
        {peak != null && <div className="absolute inset-x-0 h-0.5 bg-foreground/60" style={{ bottom: `${f(peak) * 100}%` }} title={`Peak ${fmtNum(peak, 0)} kW`} />}
        {max != null && <div className="absolute -inset-x-1 h-0.5" style={{ bottom: `${f(max) * 100}%`, background: COL.bad }} />}
      </div>
      <div className="flex flex-col justify-center gap-0.5 min-w-0">
        <p className="text-2xl font-bold tabular-nums leading-none">{fmtNum(tv, 0)} <span className="text-xs font-normal text-muted-foreground">kW</span></p>
        <p className="text-[11px] text-muted-foreground">peak in range {fmtNum(peak, 0)} kW</p>
        {max != null && <p className="text-[11px]" style={{ color: COL.bad }}>contract {fmtNum(max, 0)} kW</p>}
        <p className="text-[11px] font-semibold" style={{ color: col }}>{over ? "Over contract: penalty applies" : near ? "Close to the limit" : max != null && now != null ? `${fmtNum(max - now, 0)} kW headroom` : ""}</p>
      </div>
    </div>
  );
}

// ── Power Quality ─────────────────────────────────────────────────────────────
function Dial({ frac, col, value, label }: { frac: number; col: string; value: string; label: string }) {
  const R = 36, C = 2 * Math.PI * R, arc = C * 0.75;
  return (
    <div className="flex-1 h-full flex flex-col items-center min-w-0">
      <svg viewBox="0 0 100 86" className="w-full flex-1 min-h-0">
        <circle cx={50} cy={50} r={R} stroke={COL.track} strokeWidth={8} fill="none" strokeDasharray={`${arc} ${C}`} transform="rotate(135 50 50)" strokeLinecap="round" />
        <circle cx={50} cy={50} r={R} stroke={col} strokeWidth={8} fill="none" strokeDasharray={`${arc * clamp(frac, 0, 1)} ${C}`} transform="rotate(135 50 50)" strokeLinecap="round" className="pro-ease" />
        <text x={50} y={55} textAnchor="middle" fontSize={15} fontWeight={700} fill={COL.fg}>{value}</text>
      </svg>
      <p className="text-[10px] text-muted-foreground text-center shrink-0 truncate max-w-full">{label}</p>
    </div>
  );
}
export function PowerQuality(p: ProProps) {
  const isSample = !p.bound;
  const pf = isSample ? 0.93 : lastOf(p.rows, p.keys[0]);
  const volts = isSample ? [231, 229, 236] : p.keys.slice(1, 4).map((k) => lastOf(p.rows, k)).filter((v): v is number => v != null);
  const avg = volts.length ? mean(volts) : 0;
  const imb = volts.length >= 2 && avg ? (Math.max(...volts.map((v) => Math.abs(v - avg))) / avg) * 100 : null;
  const pfT = n(p.c.pfTarget, 0.95)!, imbL = n(p.c.imbalanceLimit, 2)!;
  const tpf = useTween(pf), timb = useTween(imb);
  return (
    <div className="relative h-full w-full flex items-stretch gap-2 px-1 py-1">
      <SampleChip show={isSample} />
      <Dial frac={tpf == null ? 0 : (tpf - 0.7) / 0.3} col={pf == null ? COL.neutral : pf >= pfT ? COL.ok : pf >= pfT - 0.05 ? COL.warn : COL.bad} value={tpf == null ? "—" : tpf.toFixed(2)} label={`Power factor (≥ ${pfT})`} />
      <Dial frac={timb == null ? 0 : timb / (imbL * 2)} col={imb == null ? COL.neutral : imb <= imbL ? COL.ok : imb <= imbL * 1.5 ? COL.warn : COL.bad} value={timb == null ? "—" : `${timb.toFixed(1)}%`} label={imb == null ? "Imbalance: bind phase voltages" : `Voltage imbalance (≤ ${imbL}%)`} />
      {isSample && <NeedNote text="Sample data. Needs power factor and phase voltages." />}
    </div>
  );
}

// ── Recipe Profile Tracker ────────────────────────────────────────────────────
const SAMPLE_PLAN = "0:30, 15:30, 45:80, 75:80, 95:130, 155:130, 180:70, 200:70";
function parsePlan(s: unknown): [number, number][] {
  return String(s ?? "").split(",").map((x) => x.split(":").map((y) => Number(y.trim()))).filter((xy) => xy.length === 2 && !isNaN(xy[0]) && !isNaN(xy[1])).map((xy) => [xy[0], xy[1]] as [number, number]).sort((a, b) => a[0] - b[0]);
}
export function Recipe(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const isSample = !p.bound;
  const plan = parsePlan(p.c.plan || (isSample ? SAMPLE_PLAN : ""));
  if (plan.length < 2) return <Empty>Enter the planned curve in Edit Widget (minute:value pairs)</Empty>;
  const steps = String(p.c.steps || (isSample ? "Fill, Heat 1, Dye 80°, Heat 2, Hold 130°, Cool, Rinse" : "")).split(",").map((s) => s.trim()).filter(Boolean);
  const startTs = isSample ? Date.now() - 98 * 60_000 : p.c.batchStart ? new Date(p.c.batchStart).getTime() : new Date(getFromTo(p.timeCfg as any).from).getTime();
  const planAt = (m: number) => { for (let i = 1; i < plan.length; i++) if (m <= plan[i][0]) { const [t0, v0] = plan[i - 1], [t1, v1] = plan[i]; return v0 + ((v1 - v0) * (m - t0)) / (t1 - t0 || 1); } return plan[plan.length - 1][1]; };
  const actual = isSample
    ? Array.from({ length: 98 }, (_, m) => ({ m, v: planAt(m - 2) + Math.sin(m) * 1.5 }))
    : valuesOf(p.rows, p.keys[0]).filter((x) => x.ts >= startTs).map((x) => ({ m: (x.ts - startTs) / 60_000, v: x.v }));
  const end = plan[plan.length - 1][0];
  const nowM = isSample ? 98 : (Date.now() - startTs) / 60_000;
  const segIdx = Math.max(0, plan.findIndex(([t]) => t > nowM) - 1);
  const stepName = nowM > end ? "Finished" : steps[segIdx] ?? `Step ${segIdx + 1}`;
  const last = actual[actual.length - 1];
  const dev = last ? last.v - planAt(last.m) : null;
  const [y0, y1] = extent([...plan.map((x) => x[1]), ...actual.map((x) => x.v)]);
  const top = 30, bot = h - 14, left = 8, right = w - 8;
  const sx = scale(0, Math.max(end, nowM), left, right), sy = scale(y0, y1, bot, top);
  const left_m = Math.max(0, end - nowM);
  return (
    <div ref={ref} className="relative h-full w-full">
      <SampleChip show={isSample} />
      <svg width={w} height={h} className="block">
        {plan.slice(1).map(([t], i) => i === segIdx && nowM <= end ? <rect key={i} x={sx(plan[i][0])} y={top - 4} width={sx(t) - sx(plan[i][0])} height={bot - top + 4} fill={COL.primary} opacity={0.07} /> : null)}
        <path d={pathOf(plan.map(([t, v]) => [sx(t), sy(v)]))} fill="none" stroke="#A78BFA" strokeOpacity={0.6} strokeWidth={6} strokeLinejoin="round" />
        {actual.length > 1 && <path d={pathOf(actual.map((x) => [sx(x.m), sy(x.v)]))} fill="none" stroke={COL.primary} strokeWidth={2} />}
        {nowM <= end && <line x1={sx(nowM)} x2={sx(nowM)} y1={top - 4} y2={bot} stroke={COL.muted} strokeDasharray="2 2" />}
        {last && <circle cx={sx(last.m)} cy={sy(last.v)} r={4} fill={COL.primary} className="pro-pulse" />}
        <text x={left} y={13} fontSize={11} fontWeight={600} fill={COL.fg}>Step: {stepName}</text>
        <text x={left} y={25} fontSize={9} fill={COL.muted}>{nowM > end ? "Batch complete" : `${Math.floor(left_m / 60)}h ${String(Math.floor(left_m % 60)).padStart(2, "0")}m left`} · planned (purple) vs actual</text>
        {dev != null && <text x={right} y={13} fontSize={11} fontWeight={600} textAnchor="end" fill={Math.abs(dev) > 5 ? COL.warn : COL.ok}>{dev >= 0 ? "+" : ""}{dev.toFixed(1)} {p.meta[p.keys[0]]?.unit ?? ""}</text>}
      </svg>
      {isSample && <NeedNote text="Sample data. Needs the planned curve and batch start time." />}
    </div>
  );
}

// ── Golden Batch Comparison ───────────────────────────────────────────────────
export function GoldenBatch(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const live = !!(p.c.assetId && p.c.tag && p.c.refFrom && p.c.refTo);
  const refCfg = useMemo(() => ({ customFrom: p.c.refFrom, customTo: p.c.refTo }), [p.c.refFrom, p.c.refTo]);
  const ref_ = useTelemetrySeries(live ? p.c.assetId : undefined, p.c.tag, refCfg, 0, p.refreshNonce).data;
  const isSample = !live || !p.bound;
  const tol = n(p.c.tolerance, isSample ? 4 : 5)!;
  const gold = isSample
    ? Array.from({ length: 100 }, (_, i) => ({ m: i * 2, v: 40 + 50 * (1 - Math.exp(-i / 25)) - (i > 75 ? (i - 75) * 1.2 : 0) }))
    : ref_.map((x) => ({ m: (x.ts - ref_[0].ts) / 60_000, v: x.v }));
  const curRaw = isSample ? [] : valuesOf(p.rows, p.keys[0]);
  const cur = isSample
    ? gold.slice(0, 64).map((g, i) => ({ m: g.m, v: g.v + (i > 45 ? 9 * Math.sin(((i - 45) / 20) * Math.PI) : 0) + Math.sin(i * 1.7) }))
    : curRaw.map((x) => ({ m: (x.ts - curRaw[0].ts) / 60_000, v: x.v }));
  if (live && !ref_.length) return <Empty>No data for the golden batch time window</Empty>;
  if (!gold.length) return <Empty>Set the golden batch start and end in Edit Widget</Empty>;
  const goldAt = (m: number) => { let best = gold[0]; for (const g of gold) if (Math.abs(g.m - m) < Math.abs(best.m - m)) best = g; return best.v; };
  const endM = Math.max(gold[gold.length - 1].m, cur[cur.length - 1]?.m ?? 0);
  const [y0, y1] = extent([...gold.map((g) => g.v + tol), ...gold.map((g) => g.v - tol), ...cur.map((c) => c.v)]);
  const top = 18, bot = h - 8, left = 8, right = w - 8;
  const sx = scale(0, endM, left, right), sy = scale(y0, y1, bot, top);
  const outCount = cur.filter((c) => Math.abs(c.v - goldAt(c.m)) > tol).length;
  return (
    <div ref={ref} className="relative h-full w-full">
      <SampleChip show={isSample} />
      <svg width={w} height={h} className="block">
        <path d={`${pathOf(gold.map((g) => [sx(g.m), sy(g.v + tol)]))} ${pathOf([...gold].reverse().map((g) => [sx(g.m), sy(g.v - tol)])).replace("M", "L")} Z`} fill="#EAB308" fillOpacity={0.1} />
        <path d={pathOf(gold.map((g) => [sx(g.m), sy(g.v)]))} fill="none" stroke="#EAB308" strokeWidth={1.5} strokeDasharray="5 3" />
        {cur.slice(1).map((c, i) => {
          const prev = cur[i], out = Math.abs(c.v - goldAt(c.m)) > tol;
          return (
            <g key={i}>
              {out && <line x1={sx(c.m)} x2={sx(c.m)} y1={sy(c.v)} y2={sy(goldAt(c.m))} stroke={COL.bad} strokeOpacity={0.3} strokeWidth={Math.max(1, sx(c.m) - sx(prev.m))} />}
              <line x1={sx(prev.m)} y1={sy(prev.v)} x2={sx(c.m)} y2={sy(c.v)} stroke={out ? COL.bad : COL.primary} strokeWidth={2} />
            </g>
          );
        })}
        {cur.length > 0 && <circle cx={sx(cur[cur.length - 1].m)} cy={sy(cur[cur.length - 1].v)} r={4} fill={COL.primary} className="pro-pulse" />}
        <text x={left} y={11} fontSize={9} fill={outCount ? COL.bad : COL.muted}>Current batch vs golden (dashed) · ±{tol} band · {outCount} point{outCount === 1 ? "" : "s"} outside</text>
      </svg>
      {isSample && <NeedNote text="Sample data. Needs the golden batch start and end times." />}
    </div>
  );
}
