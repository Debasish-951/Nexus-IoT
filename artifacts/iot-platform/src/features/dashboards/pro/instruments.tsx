/**
 * Instruments and Equipment: single-reading marks drawn as SVG with animated
 * transitions (gauge, tank, thermometer, pump, fan, pipe, valve, …).
 */
import { useId } from "react";
import {
  type ProProps, COL, n, clamp, valuesOf, lastOf, mean, fmtNum, useData, nameOf, colorOf, SampleChip, Empty,
  useTween, useSize, pathOf, scale, extent, thresholdColor, energyUsed, hhmm,
} from "./common";

/** Latest value of the primary series, or a sample value when unbound. */
function primary(p: ProProps, sampleValue: number) {
  const isSample = !p.bound;
  const key = p.keys[0];
  const v = isSample ? sampleValue : lastOf(p.rows, key);
  return { v, isSample, unit: p.meta[key]?.unit ?? "", name: p.meta[key]?.label ?? "" };
}

// ── Radial Gauge Pro ──────────────────────────────────────────────────────────
export function GaugePro(p: ProProps) {
  const { v, isSample, unit, name } = primary(p, 72);
  const min = n(p.c.min, 0)!, max = n(p.c.max, 100)!;
  const warn = n(p.c.warn, isSample ? 75 : null), crit = n(p.c.critical, isSample ? 90 : null);
  const tv = useTween(v);
  const frac = (x: number) => clamp((x - min) / (max - min || 1), 0, 1);
  const A0 = 135, SWEEP = 270, R = 40, CX = 50, CY = 52;
  const pt = (f: number, r = R) => { const a = ((A0 + f * SWEEP) * Math.PI) / 180; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; };
  const arc = (f0: number, f1: number, r = R) => { const [x0, y0] = pt(f0, r), [x1, y1] = pt(f1, r); return `M${x0},${y0} A${r},${r} 0 ${(f1 - f0) * SWEEP > 180 ? 1 : 0} 1 ${x1},${y1}`; };
  const col = thresholdColor(v, warn, crit);
  const fv = tv == null ? 0 : frac(tv);
  const [nx, ny] = pt(fv, R - 12);
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center">
      <SampleChip show={isSample} />
      <svg viewBox="0 0 100 92" className="w-full flex-1 min-h-0">
        <path d={arc(0, 1)} stroke={COL.track} strokeWidth={8} fill="none" strokeLinecap="round" />
        {warn != null && <path d={arc(frac(warn), crit != null ? frac(crit) : 1, R + 7)} stroke={COL.warn} strokeWidth={2} fill="none" />}
        {crit != null && <path d={arc(frac(crit), 1, R + 7)} stroke={COL.bad} strokeWidth={2} fill="none" />}
        {fv > 0.001 && <path d={arc(0, fv)} stroke={col} strokeWidth={8} fill="none" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 2px ${col})` }} />}
        {Array.from({ length: 11 }, (_, i) => { const [a, b] = pt(i / 10, R - 6), [c, d] = pt(i / 10, R - (i % 5 === 0 ? 10 : 8)); return <line key={i} x1={a} y1={b} x2={c} y2={d} stroke={COL.muted} strokeWidth={0.6} />; })}
        <line x1={CX} y1={CY} x2={nx} y2={ny} stroke={COL.fg} strokeWidth={1.6} strokeLinecap="round" />
        <circle cx={CX} cy={CY} r={3} fill={COL.fg} />
        <text x={CX} y={CY + 22} textAnchor="middle" fontSize={12} fontWeight={700} fill={col} style={{ paintOrder: "stroke", stroke: COL.card, strokeWidth: 3 }}>{fmtNum(tv)}</text>
        <text x={CX} y={CY + 30} textAnchor="middle" fontSize={5} fill={COL.muted}>{unit}</text>
        <text x={pt(0)[0]} y={pt(0)[1] + 9} textAnchor="middle" fontSize={5} fill={COL.muted}>{min}</text>
        <text x={pt(1)[0]} y={pt(1)[1] + 9} textAnchor="middle" fontSize={5} fill={COL.muted}>{max}</text>
      </svg>
      {name && <p className="text-[10px] text-muted-foreground truncate max-w-full -mt-1">{name}</p>}
    </div>
  );
}

// ── KPI Tile with Trend ───────────────────────────────────────────────────────
export function KpiTrend(p: ProProps) {
  const gid = useId().replace(/:/g, "");
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const { rows, keys, isSample } = useData(p, 1, 420, 60, 30);
  const vals = valuesOf(rows, keys[0]).map((x) => x.v);
  const tv = useTween(vals.length ? vals[vals.length - 1] : null);
  if (!vals.length) return <Empty>No data in selected range</Empty>;
  const last = vals[vals.length - 1], first = vals[0];
  const delta = first ? ((last - first) / Math.abs(first)) * 100 : null;
  const goodUp = p.c.goodDirection !== "down";
  const good = delta == null ? true : (delta >= 0) === goodUp;
  const [y0, y1] = extent(vals);
  const sy = scale(y0, y1, h - 2, h * 0.45), sx = scale(0, vals.length - 1, 0, w);
  const line = vals.map((v, i) => [sx(i), sy(v)] as [number, number]);
  const unit = p.meta[keys[0]]?.unit ?? "";
  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden">
      <SampleChip show={isSample} />
      <svg width={w} height={h} className="absolute inset-0">
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COL.primary} stopOpacity={0.3} /><stop offset="100%" stopColor={COL.primary} stopOpacity={0} /></linearGradient></defs>
        <path d={`${pathOf(line)} L${w},${h} L0,${h} Z`} fill={`url(#${gid})`} />
        <path d={pathOf(line)} fill="none" stroke={COL.primary} strokeWidth={1.5} />
      </svg>
      <div className="relative p-2">
        <p className="text-[10px] text-muted-foreground truncate">{nameOf(p, keys[0], 0)}</p>
        <p className="text-2xl font-bold tabular-nums leading-tight">{fmtNum(tv)}<span className="text-xs font-normal text-muted-foreground ml-1">{unit}</span></p>
        {delta != null && <p className="text-[11px] font-semibold" style={{ color: good ? COL.ok : COL.bad }}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% <span className="font-normal text-muted-foreground">over range</span></p>}
      </div>
    </div>
  );
}

// ── Digital Readout ───────────────────────────────────────────────────────────
export function Readout(p: ProProps) {
  const { v, isSample, unit, name } = primary(p, 1482.6);
  const dec = n(p.c.decimals, 1)!;
  const tv = useTween(v, 500);
  const col = p.c.color || "#22D3EE";
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center rounded-md" style={{ background: "#05080d" }}>
      <SampleChip show={isSample} />
      <p className="pro-led tabular-nums font-bold leading-none" style={{ color: col, fontSize: "clamp(20px, 9cqw, 56px)", textShadow: `0 0 8px ${col}` }}>
        {tv == null ? "----" : tv.toFixed(dec)}
      </p>
      <p className="text-[10px] mt-1 uppercase tracking-widest" style={{ color: col, opacity: 0.7 }}>{[unit, name].filter(Boolean).join(" · ")}</p>
    </div>
  );
}

// ── Thermometer Pro ───────────────────────────────────────────────────────────
export function ThermoPro(p: ProProps) {
  const { v, isSample, unit } = primary(p, 68);
  const min = n(p.c.min, 0)!, max = n(p.c.max, 120)!, limit = n(p.c.limit, isSample ? 90 : null);
  const tv = useTween(v);
  const f = (x: number) => clamp((x - min) / (max - min || 1), 0, 1);
  const top = 8, bot = 92, tubeH = bot - top;
  const col = limit != null && v != null && v >= limit ? COL.bad : v != null && limit != null && v >= limit * 0.9 ? COL.warn : "#F97316";
  const fillY = bot - (tv == null ? 0 : f(tv)) * tubeH;
  return (
    <div className="relative h-full w-full flex items-center justify-center gap-2">
      <SampleChip show={isSample} />
      <svg viewBox="0 0 40 120" className="h-full max-h-full">
        <rect x={14} y={top - 4} width={12} height={tubeH + 8} rx={6} fill={COL.track} />
        <rect x={16} y={fillY} width={8} height={bot - fillY + 4} fill={col} className="pro-ease" />
        <circle cx={20} cy={104} r={11} fill={col} />
        <circle cx={17} cy={101} r={3} fill="#fff" opacity={0.35} />
        {Array.from({ length: 6 }, (_, i) => { const y = bot - (i / 5) * tubeH; return <g key={i}><line x1={27} x2={31} y1={y} y2={y} stroke={COL.muted} strokeWidth={0.6} /><text x={32} y={y + 2} fontSize={4.5} fill={COL.muted}>{fmtNum(min + (i / 5) * (max - min), 0)}</text></g>; })}
        {limit != null && <line x1={10} x2={30} y1={bot - f(limit) * tubeH} y2={bot - f(limit) * tubeH} stroke={COL.bad} strokeWidth={1} strokeDasharray="2 1" />}
      </svg>
      <div className="flex flex-col">
        <span className="text-xl font-bold tabular-nums" style={{ color: col }}>{fmtNum(tv)}</span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
        {limit != null && <span className="text-[10px] text-muted-foreground">limit {limit}</span>}
      </div>
    </div>
  );
}

// ── Liquid Tank ───────────────────────────────────────────────────────────────
export function LiquidTank(p: ProProps) {
  const gid = useId().replace(/:/g, "");
  const { v, isSample, unit } = primary(p, 64);
  const cap = n(p.c.capacity, 100)!, lo = n(p.c.lowLimit, isSample ? 20 : null), hi = n(p.c.highLimit, isSample ? 90 : null);
  const tv = useTween(v);
  const pct = tv == null ? 0 : clamp(tv / (cap || 1), 0, 1);
  const alarm = v != null && ((hi != null && v >= hi) || (lo != null && v <= lo));
  const col = alarm ? COL.bad : "#38BDF8";
  const top = 10, bot = 110, H = bot - top, y = bot - pct * H;
  const wave = (amp: number, off: number) => `M0,${y} ${Array.from({ length: 9 }, (_, i) => `Q${i * 20 + 10},${y + (i % 2 ? amp : -amp) + off} ${i * 20 + 20},${y}`).join(" ")} L180,${bot} L0,${bot} Z`;
  return (
    <div className="relative h-full w-full flex items-center justify-center gap-2">
      <SampleChip show={isSample} />
      <svg viewBox="0 0 70 120" className="h-full max-h-full">
        <defs><clipPath id={gid}><rect x={6} y={top} width={58} height={H} rx={8} /></clipPath></defs>
        <rect x={6} y={top} width={58} height={H} rx={8} fill={COL.track} />
        <g clipPath={`url(#${gid})`}>
          <g className="pro-wave" style={{ ["--pro-dur" as any]: "3.5s" }}><path d={wave(3, 0)} fill={col} opacity={0.55} className="pro-ease" /></g>
          <g className="pro-wave" style={{ ["--pro-dur" as any]: "5.5s" }}><path d={wave(2.5, 1)} fill={col} opacity={0.85} className="pro-ease" /></g>
          {[14, 30, 46].map((x, i) => <circle key={x} cx={x + 6} cy={bot - 6} r={1.5} fill="#fff" opacity={0.6} className="pro-rise" style={{ animationDelay: `${i * 0.9}s` }} />)}
        </g>
        <rect x={6} y={top} width={58} height={H} rx={8} fill="none" stroke={COL.border} strokeWidth={1.5} />
        {hi != null && <line x1={2} x2={68} y1={bot - clamp(hi / cap, 0, 1) * H} y2={bot - clamp(hi / cap, 0, 1) * H} stroke={COL.bad} strokeDasharray="3 2" strokeWidth={0.8} />}
        {lo != null && <line x1={2} x2={68} y1={bot - clamp(lo / cap, 0, 1) * H} y2={bot - clamp(lo / cap, 0, 1) * H} stroke={COL.warn} strokeDasharray="3 2" strokeWidth={0.8} />}
        <text x={35} y={top + H / 2} textAnchor="middle" fontSize={11} fontWeight={700} fill={COL.fg} style={{ paintOrder: "stroke", stroke: COL.card, strokeWidth: 3 }}>{Math.round(pct * 100)}%</text>
      </svg>
      <div className="flex flex-col text-[10px] text-muted-foreground">
        <span className="text-base font-bold tabular-nums text-foreground">{fmtNum(tv)}<span className="text-[10px] font-normal ml-0.5">{unit}</span></span>
        <span>of {fmtNum(cap)}</span>
        {alarm && <span className="font-semibold pro-pulse" style={{ color: COL.bad }}>{hi != null && v! >= hi ? "High level" : "Low level"}</span>}
      </div>
    </div>
  );
}

// ── Target Bullet ─────────────────────────────────────────────────────────────
export function Bullet(p: ProProps) {
  const isSample = !p.bound;
  const items = isSample
    ? [["Line 1", 82], ["Line 2", 64], ["Line 3", 95], ["Line 4", 48]].map(([l, v], i) => ({ label: String(l), v: Number(v), col: colorOf(p, `x${i}`, i) }))
    : p.keys.map((k, i) => ({ label: nameOf(p, k, i), v: lastOf(p.rows, k), col: colorOf(p, k, i) }));
  const target = n(p.c.target, isSample ? 80 : null);
  const max = n(p.c.max) ?? (Math.max(target ?? 0, ...items.map((x) => x.v ?? 0)) * 1.15 || 100);
  return (
    <div className="relative h-full w-full flex flex-col justify-center gap-2 px-2 overflow-auto">
      <SampleChip show={isSample} />
      {items.map((it, i) => {
        const f = it.v == null ? 0 : clamp(it.v / max, 0, 1);
        const met = target == null || (it.v ?? 0) >= target;
        return (
          <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(0,90px) 1fr 52px" }}>
            <span className="text-[11px] text-muted-foreground truncate">{it.label}</span>
            <div className="relative h-4 rounded bg-muted overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-foreground/5" style={{ width: "60%" }} />
              <div className="absolute inset-y-0 left-0 bg-foreground/5" style={{ width: "85%" }} />
              <div className="absolute top-1 bottom-1 left-0 rounded-sm pro-ease" style={{ width: `${f * 100}%`, background: met ? it.col : COL.warn }} />
              {target != null && <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-foreground" style={{ left: `${clamp(target / max, 0, 1) * 100}%` }} />}
            </div>
            <span className="text-[11px] font-semibold tabular-nums text-right">{fmtNum(it.v)}</span>
          </div>
        );
      })}
      {target != null && <p className="text-[10px] text-muted-foreground text-right">│ target {target}</p>}
    </div>
  );
}

// ── Production Counter (flip digits + rate) ───────────────────────────────────
export function Counter(p: ProProps) {
  const { rows, keys, isSample } = useData(p, 1, 0, 0, 30);
  const vals = isSample ? Array.from({ length: 30 }, (_, i) => 12450 + i * 7) : valuesOf(rows, keys[0]).map((x) => x.v);
  const ts = isSample ? Array.from({ length: 30 }, (_, i) => Date.now() - (30 - i) * 60_000) : valuesOf(rows, keys[0]).map((x) => x.ts);
  if (!vals.length) return <Empty>No data in selected range</Empty>;
  const last = Math.round(vals[vals.length - 1]);
  const hours = (ts[ts.length - 1] - ts[0]) / 3_600_000;
  const rate = hours > 0 ? (vals[vals.length - 1] - vals[0]) / hours : null;
  const digits = String(Math.max(0, last)).padStart(6, "0").split("");
  const unit = p.meta[keys[0]]?.unit ?? "";
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center gap-1.5">
      <SampleChip show={isSample} />
      <div className="flex gap-1" style={{ perspective: 300 }}>
        {digits.map((d, i) => (
          <span key={`${i}-${d}`} className="pro-flip tabular-nums font-bold rounded-md text-xl px-1.5 py-1 bg-foreground text-background shadow-inner" style={{ minWidth: "1.4em", textAlign: "center" }}>{d}</span>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{unit || "count"}{rate != null && <> · <b className="text-foreground">{fmtNum(rate, 0)}</b> per hour</>}</p>
    </div>
  );
}

// ── Shift Progress ────────────────────────────────────────────────────────────
export function ShiftProgress(p: ProProps) {
  const isSample = !p.bound;
  const s0 = hhmm(p.c.shiftStart, 6 * 60), s1 = hhmm(p.c.shiftEnd, 14 * 60);
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const len = ((s1 - s0) + 1440) % 1440 || 1440;
  const elapsed = (((nowMin - s0) + 1440) % 1440);
  const inShift = elapsed <= len;
  const timeFrac = inShift ? elapsed / len : 1;
  const shiftStartTs = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); let t = d.getTime() + s0 * 60_000; if (t > now.getTime()) t -= 86_400_000; return t; })();
  const vals = isSample ? [] : valuesOf(p.rows, p.keys[0]).filter((x) => x.ts >= shiftStartTs).map((x) => x.v);
  const count = isSample ? 3120 : (p.c.countMode === "interval" ? vals.reduce((s, v) => s + v, 0) : energyUsed(vals, "counter"));
  const target = n(p.c.target, isSample ? 6000 : null);
  const tc = useTween(count);
  const expected = target != null ? target * timeFrac : null;
  const ahead = expected != null ? count - expected : null;
  const f = target ? clamp(count / target, 0, 1) : 0;
  const R = 38, C = 2 * Math.PI * R;
  const col = ahead == null ? COL.primary : ahead >= 0 ? COL.ok : COL.warn;
  return (
    <div className="relative h-full w-full flex items-center justify-center gap-3">
      <SampleChip show={isSample} />
      <svg viewBox="0 0 100 100" className="h-full max-h-[160px]">
        <circle cx={50} cy={50} r={R} stroke={COL.track} strokeWidth={9} fill="none" />
        <circle cx={50} cy={50} r={R} stroke={col} strokeWidth={9} fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - f)} transform="rotate(-90 50 50)" className="pro-ease" />
        <line x1={50} y1={50} x2={50 + (R + 6) * Math.sin(timeFrac * 2 * Math.PI)} y2={50 - (R + 6) * Math.cos(timeFrac * 2 * Math.PI)} stroke={COL.muted} strokeWidth={1} strokeDasharray="2 1.5" />
        <text x={50} y={50} textAnchor="middle" fontSize={14} fontWeight={700} fill={COL.fg}>{fmtNum(tc, 0)}</text>
        <text x={50} y={62} textAnchor="middle" fontSize={7} fill={COL.muted}>{target != null ? `of ${fmtNum(target, 0)}` : "this shift"}</text>
      </svg>
      <div className="text-[11px] space-y-0.5">
        <p className="text-muted-foreground">Shift {String(p.c.shiftStart || "06:00")}–{String(p.c.shiftEnd || "14:00")}</p>
        <p>{inShift ? `${Math.round(timeFrac * 100)}% of shift gone` : "Shift ended"}</p>
        {ahead != null && <p className="font-semibold" style={{ color: col }}>{ahead >= 0 ? "Ahead" : "Behind"} by {fmtNum(Math.abs(ahead), 0)}</p>}
      </div>
    </div>
  );
}

// ── Energy Split Ring ─────────────────────────────────────────────────────────
export function EnergyRing(p: ProProps) {
  const isSample = !p.bound;
  const parts = isSample
    ? [["Dyeing", 412], ["Drying", 268], ["Compressors", 151], ["Lighting", 64]].map(([l, v], i) => ({ label: String(l), v: Number(v), col: colorOf(p, `x${i}`, i) }))
    : p.keys.map((k, i) => ({ label: nameOf(p, k, i), v: Math.max(0, lastOf(p.rows, k) ?? 0), col: colorOf(p, k, i) }));
  const total = parts.reduce((s, x) => s + x.v, 0);
  const tt = useTween(total);
  if (!total) return <Empty>No positive values to chart</Empty>;
  const R = 36, C = 2 * Math.PI * R;
  let acc = 0;
  const unit = p.meta[p.keys[0]]?.unit ?? (isSample ? "kWh" : "");
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center gap-1">
      <SampleChip show={isSample} />
      <svg viewBox="0 0 100 100" className="flex-1 min-h-0 w-full">
        <circle cx={50} cy={50} r={R} stroke={COL.track} strokeWidth={10} fill="none" />
        {parts.map((pt, i) => {
          const len = (pt.v / total) * C, off = acc; acc += len;
          return <circle key={i} cx={50} cy={50} r={R} stroke={pt.col} strokeWidth={10} fill="none" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 50 50)" className="pro-ease" style={{ transitionDelay: `${i * 80}ms` }}><title>{`${pt.label}: ${fmtNum(pt.v)} ${unit}`}</title></circle>;
        })}
        <text x={50} y={50} textAnchor="middle" fontSize={13} fontWeight={700} fill={COL.fg}>{fmtNum(tt, 0)}</text>
        <text x={50} y={60} textAnchor="middle" fontSize={6} fill={COL.muted}>{unit} total</text>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-2 gap-y-0.5 text-[10px] shrink-0 px-1">
        {parts.map((pt, i) => <span key={i} className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-sm" style={{ background: pt.col }} />{pt.label} {Math.round((pt.v / total) * 100)}%</span>)}
      </div>
    </div>
  );
}

// ── Pump / Motor and Fan / Blower ─────────────────────────────────────────────
function Rotor({ p, kind }: { p: ProProps; kind: "pump" | "fan" }) {
  const { v, isSample, unit } = primary(p, 1180);
  const runAbove = n(p.c.runAbove, 0)!, maxSpeed = n(p.c.maxSpeed, 1500)!, crit = n(p.c.critical);
  const running = v != null && v > runAbove;
  const fault = crit != null && v != null && v >= crit;
  const col = fault ? COL.bad : running ? COL.ok : COL.neutral;
  const dur = running ? clamp(2.4 - (v! / (maxSpeed || 1)) * 2.1, 0.25, 2.4) : 0;
  const state = fault ? "Fault" : running ? "Running" : v == null ? "No data" : "Stopped";
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center gap-1">
      <SampleChip show={isSample} />
      <svg viewBox="0 0 100 100" className="flex-1 min-h-0 w-full">
        {kind === "pump" ? (
          <>
            <rect x={6} y={44} width={20} height={12} fill={COL.track} stroke={COL.border} />
            <rect x={74} y={44} width={20} height={12} fill={COL.track} stroke={COL.border} />
            <circle cx={50} cy={50} r={28} fill={COL.track} stroke={col} strokeWidth={3} />
            <g className={running ? "pro-spin" : ""} style={{ ["--pro-dur" as any]: `${dur}s` }}>
              {[0, 60, 120, 180, 240, 300].map((a) => <path key={a} d="M50,50 Q58,38 50,26" stroke={col} strokeWidth={3.5} fill="none" strokeLinecap="round" transform={`rotate(${a} 50 50)`} />)}
            </g>
            <circle cx={50} cy={50} r={5} fill={col} />
          </>
        ) : (
          <>
            <circle cx={50} cy={50} r={40} fill="none" stroke={COL.border} strokeWidth={3} />
            <g className={running ? "pro-spin" : ""} style={{ ["--pro-dur" as any]: `${dur}s` }}>
              {[0, 90, 180, 270].map((a) => <ellipse key={a} cx={50} cy={30} rx={9} ry={19} fill={col} opacity={0.85} transform={`rotate(${a} 50 50)`} />)}
            </g>
            <circle cx={50} cy={50} r={6} fill={COL.fg} />
          </>
        )}
        {fault && <circle cx={50} cy={50} r={44} fill="none" stroke={COL.bad} strokeWidth={2} className="pro-pulse" />}
      </svg>
      <p className="text-sm font-bold tabular-nums">{fmtNum(v, 0)} <span className="text-[10px] font-normal text-muted-foreground">{unit || "rpm"}</span></p>
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${col}22`, color: col }}>{state}</span>
    </div>
  );
}
export const Pump = (p: ProProps) => <Rotor p={p} kind="pump" />;
export const FanW = (p: ProProps) => <Rotor p={p} kind="fan" />;

// ── Pipe Flow ─────────────────────────────────────────────────────────────────
export function Pipe(p: ProProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const { v, isSample, unit } = primary(p, 42);
  const maxFlow = n(p.c.maxFlow, 100)!;
  const f = v == null ? 0 : clamp(v / (maxFlow || 1), 0, 1);
  const flowing = f > 0.01;
  const dur = flowing ? clamp(2.2 - f * 1.9, 0.3, 2.2) : 0;
  const tv = useTween(v);
  // Drawn at real pixel size: a stretched viewBox turned the dashes into blobs.
  const cy = h / 2, ph = Math.min(22, h * 0.4);
  return (
    <div className="relative h-full w-full flex items-center gap-3 px-2">
      <SampleChip show={isSample} />
      <div ref={ref} className="flex-1 h-full min-w-0">
        <svg width={w} height={h} className="block">
          <rect x={0} y={cy - ph / 2} width={w} height={ph} rx={ph / 2} fill={COL.track} stroke={COL.border} />
          <line x1={ph / 2} x2={w - ph / 2} y1={cy} y2={cy} stroke="#38BDF8" strokeWidth={ph * 0.35} strokeDasharray="12 8" strokeLinecap="round" opacity={flowing ? 0.9 : 0.25} className={flowing ? "pro-dash" : ""} style={{ ["--pro-dur" as any]: `${dur}s` }} />
          {[0.25, 0.75].map((k) => <rect key={k} x={w * k - 5} y={cy - ph / 2 - 3} width={10} height={ph + 6} rx={2} fill={COL.card} stroke={COL.border} />)}
          <path d={`M${w - 22},${cy - ph / 2 - 9} l8,5 l-8,5`} fill="none" stroke={COL.muted} strokeWidth={1.5} />
        </svg>
      </div>
      <div className="flex flex-col shrink-0">
        <span className="text-lg font-bold tabular-nums">{fmtNum(tv)}</span>
        <span className="text-[10px] text-muted-foreground">{unit || "flow"}{!flowing && v != null ? " · no flow" : ""}</span>
      </div>
    </div>
  );
}

// ── Valve Position ────────────────────────────────────────────────────────────
export function Valve(p: ProProps) {
  const { v, isSample } = primary(p, 65);
  const pct = v == null ? 0 : clamp(v, 0, 100);
  const tv = useTween(pct);
  const ang = ((tv ?? 0) / 100) * 90;
  const col = pct <= 1 ? COL.neutral : pct >= 99 ? COL.ok : COL.primary;
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center gap-1">
      <SampleChip show={isSample} />
      <svg viewBox="0 0 100 90" className="flex-1 min-h-0 w-full">
        <rect x={4} y={50} width={92} height={18} fill={COL.track} stroke={COL.border} />
        <path d="M30,40 L50,59 L30,78 Z M70,40 L50,59 L70,78 Z" fill={col} opacity={0.85} />
        <line x1={50} y1={59} x2={50} y2={30} stroke={COL.fg} strokeWidth={3} />
        <g transform={`rotate(${ang} 50 26)`}>
          <rect x={30} y={22} width={40} height={8} rx={4} fill={col} />
        </g>
        <circle cx={50} cy={26} r={4} fill={COL.fg} />
      </svg>
      <p className="text-sm font-bold tabular-nums" style={{ color: col }}>{fmtNum(tv, 0)}% open</p>
    </div>
  );
}

// ── Thermal Profile (zones as a heat strip) ───────────────────────────────────
function heat(f: number): string {
  const stops = [[0, [59, 130, 246]], [0.35, [34, 197, 94]], [0.65, [234, 179, 8]], [1, [239, 68, 68]]] as const;
  for (let i = 1; i < stops.length; i++) if (f <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i]; const k = (f - a) / (b - a || 1);
    return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(",")})`;
  }
  return "rgb(239,68,68)";
}
export function ThermalProfile(p: ProProps) {
  const isSample = !p.bound;
  const zones = isSample
    ? [92, 128, 156, 171, 168, 140, 105].map((v, i) => ({ label: `Zone ${i + 1}`, v }))
    : p.keys.map((k, i) => ({ label: nameOf(p, k, i), v: lastOf(p.rows, k) }));
  const min = n(p.c.min, 20)!, max = n(p.c.max, 200)!;
  const unit = p.meta[p.keys[0]]?.unit ?? "°C";
  return (
    <div className="relative h-full w-full flex flex-col justify-center gap-1.5 px-2">
      <SampleChip show={isSample} />
      <div className="flex gap-1 h-[55%] min-h-[36px]">
        {zones.map((z, i) => {
          const f = z.v == null ? 0 : clamp((z.v - min) / (max - min || 1), 0, 1);
          return (
            <div key={i} className="flex-1 rounded-md flex flex-col items-center justify-center pro-ease relative overflow-hidden" title={`${z.label}: ${fmtNum(z.v)} ${unit}`}
              style={{ background: z.v == null ? "hsl(var(--muted))" : heat(f), boxShadow: z.v == null ? undefined : `0 0 10px ${heat(f)}66` }}>
              <span className="text-[11px] font-bold text-white drop-shadow tabular-nums">{fmtNum(z.v, 0)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1">{zones.map((z, i) => <span key={i} className="flex-1 text-[9px] text-muted-foreground text-center truncate">{z.label}</span>)}</div>
      <div className="h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, ${heat(0)}, ${heat(0.35)}, ${heat(0.65)}, ${heat(1)})` }} />
      <div className="flex justify-between text-[9px] text-muted-foreground"><span>{min} {unit}</span><span>{max} {unit}</span></div>
    </div>
  );
}

// ── Vibration Spectrum ────────────────────────────────────────────────────────
export function Spectrum(p: ProProps) {
  const isSample = !p.bound;
  let bars: { label: string; v: number }[];
  if (isSample) bars = [0.8, 1.6, 4.2, 2.1, 1.2, 3.1, 0.9, 0.6, 1.4, 0.7, 0.4, 0.5].map((v, i) => ({ label: `${(i + 1) * 25} Hz`, v }));
  else if (p.keys.length === 1) bars = valuesOf(p.rows, p.keys[0]).slice(-24).map((x) => ({ label: x.t, v: x.v }));
  else bars = p.keys.map((k, i) => ({ label: nameOf(p, k, i), v: lastOf(p.rows, k) ?? 0 }));
  const max = Math.max(...bars.map((b) => b.v), 0.0001);
  const peak = bars.reduce((a, b) => (b.v > a.v ? b : a), bars[0]);
  return (
    <div className="relative h-full w-full flex flex-col gap-1 p-1">
      <SampleChip show={isSample} />
      <div className="flex-1 min-h-0 flex items-end gap-[3px]">
        {bars.map((b, i) => {
          const f = b.v / max;
          return (
            <div key={i} className="flex-1 h-full flex flex-col justify-end" title={`${b.label}: ${fmtNum(b.v)}`}>
              <div className="rounded-t-sm pro-ease" style={{ height: `${Math.max(2, f * 100)}%`, background: `linear-gradient(to top, ${COL.ok}, ${f > 0.75 ? COL.bad : f > 0.45 ? COL.warn : COL.ok})`, transitionDelay: `${i * 25}ms` }} />
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground shrink-0 truncate">Peak {fmtNum(peak?.v)} {p.meta[p.keys[0]]?.unit ?? ""} at {peak?.label}</p>
    </div>
  );
}

// ── Vibration Severity (ISO 10816-3 style zones, mm/s RMS) ────────────────────
const ISO_LIMITS: Record<string, [number, number, number]> = {
  // A/B, B/C, C/D boundaries per machine class.
  I: [0.71, 1.8, 4.5], II: [1.12, 2.8, 7.1], III: [1.8, 4.5, 11.2], IV: [2.8, 7.1, 18],
};
const ISO_ZONES = [
  { z: "A", name: "Good (new machine)", col: COL.ok },
  { z: "B", name: "Acceptable", col: "#84CC16" },
  { z: "C", name: "Unsatisfactory", col: COL.warn },
  { z: "D", name: "Unacceptable", col: COL.bad },
];
export function Iso10816(p: ProProps) {
  const { v, isSample } = primary(p, 3.4);
  const cls = String(p.c.machineClass || "II");
  const lim = ISO_LIMITS[cls] ?? ISO_LIMITS.II;
  const zi = v == null ? -1 : v < lim[0] ? 0 : v < lim[1] ? 1 : v < lim[2] ? 2 : 3;
  const top = lim[2] * 1.5;
  const tv = useTween(v);
  const f = (x: number) => clamp(x / top, 0, 1);
  const bounds = [0, ...lim, top];
  return (
    <div className="relative h-full w-full flex flex-col justify-center gap-2 px-3">
      <SampleChip show={isSample} />
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums" style={{ color: zi >= 0 ? ISO_ZONES[zi].col : COL.neutral }}>{fmtNum(tv)}</span>
        <span className="text-[11px] text-muted-foreground">mm/s</span>
        {zi >= 0 && <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded" style={{ background: `${ISO_ZONES[zi].col}22`, color: ISO_ZONES[zi].col }}>Zone {ISO_ZONES[zi].z}</span>}
      </div>
      <div className="relative h-5 rounded overflow-hidden flex">
        {ISO_ZONES.map((z, i) => <div key={z.z} className="h-full flex items-center justify-center text-[10px] font-bold text-white/90" style={{ width: `${(f(bounds[i + 1]) - f(bounds[i])) * 100}%`, background: z.col, opacity: i === zi ? 1 : 0.45 }}>{z.z}</div>)}
        {tv != null && <div className="absolute -top-0.5 -bottom-0.5 w-1 rounded bg-foreground pro-ease" style={{ left: `calc(${f(tv) * 100}% - 2px)` }} />}
      </div>
      <p className="text-[11px]">{zi >= 0 ? ISO_ZONES[zi].name : "No reading"} <span className="text-muted-foreground">· machine class {cls}</span></p>
    </div>
  );
}

