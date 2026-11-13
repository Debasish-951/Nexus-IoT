/**
 * Pharma & Cold Chain and HVAC & Water: cleanroom cascade, excursion records,
 * MKT, sterilizer F₀, cold rooms, psychrometrics, PW/WFI, lyophilizers, AHUs,
 * filters, RO and effluent quality.
 */
import { type ProProps, COL, clamp, valuesOf, linFit } from "../common";
import {
  W, H, CYAN, VIOLET, Svg, Txt, Kpis, Row, Flow, Pill, Bar, Trend, f, fin, lvl, lvlLow, cfg, list,
  useRoles, roleSeries, roleSeriesTs, unitOf, useItems, thin,
} from "./kit";

const DAY = 86_400_000;

/** Minutes spent where `bad(v)` is true, using the gap to the next reading (capped at 1 h). */
function minutesWhere(s: { ts: number; v: number }[], bad: (v: number) => boolean): { min: number; total: number; events: number } {
  let min = 0, total = 0, events = 0;
  for (let i = 0; i < s.length; i++) {
    const dt = i < s.length - 1 ? Math.min(60, (s[i + 1].ts - s[i].ts) / 60_000) : 0;
    total += dt;
    if (bad(s[i].v)) { min += dt; if (i === 0 || !bad(s[i - 1].v)) events++; }
  }
  return { min, total, events };
}

// ── Cleanroom Pressure Cascade ────────────────────────────────────────────────
export function Cleanroom(p: ProProps) {
  const items = useItems(p, [["Corridor", 0], ["Change", 15], ["Buffer", 31], ["Filling", 46]]);
  const minDp = cfg(p, "minDp", 10), grades = String(p.c.grades || (p.bound ? "" : "D, C, B, A/B")).split(",").map((s) => s.trim());
  const n = Math.max(1, items.length), gap = 16, rw = (W - 20 - gap * (n - 1)) / n, ry = 34, rh = 62;
  return (
    <Svg>
      <Txt x={10} y={16} s={9.5}>Room pressure vs reference · air flows ←</Txt>
      {items.map((it, i) => {
        const x = 10 + i * (rw + gap), dp = i ? it.v - items[i - 1].v : NaN, c = !Number.isFinite(dp) ? COL.neutral : dp < minDp / 2 ? COL.bad : dp < minDp ? COL.warn : COL.ok;
        return (
          <g key={it.key}>
            <rect x={x} y={ry} width={rw} height={rh} rx={6} fill={COL.primary} fillOpacity={0.08 + (i / n) * 0.25} stroke={COL.border} />
            <Txt x={x + rw / 2} y={ry + 16} w={600} c={COL.fg} a="middle">{it.label.slice(0, 10)}</Txt>
            {grades[i] && <Txt x={x + rw / 2} y={ry + 29} s={9} a="middle">Grade {grades[i]}</Txt>}
            <Txt x={x + rw / 2} y={ry + 50} s={12} w={700} c={COL.fg} a="middle">{f(it.v, 0)} Pa</Txt>
            {i > 0 && (
              <g>
                <Txt x={x - gap / 2} y={ry + rh + 18} s={11} w={700} c={c} a="middle">{f(dp, 0)}</Txt>
                <path d={`M${x - gap / 2 - 4},${ry + rh / 2} l6,-5 v10 Z`} fill={c} className="pro-pulse" />
              </g>
            )}
          </g>
        );
      })}
      <Txt x={10} y={H - 10} s={9.5}>ΔP across each door, Pa · minimum {minDp}</Txt>
    </Svg>
  );
}

// ── Temperature & RH Compliance ───────────────────────────────────────────────
export function EnvCompliance(p: ProProps) {
  const [t, rh] = useRoles(p, [21.4, 48]);
  const lo = cfg(p, "tLo", 15), hi = cfg(p, "tHi", 25), rlo = cfg(p, "rhLo", -Infinity), rhi = cfg(p, "rhHi", Infinity);
  const s = roleSeriesTs(p, 0, 21, 2.5, 120);
  if (!p.bound) { s[64].v = 25.8; s[65].v = 26.1; }
  const bad = (v: number) => v < lo || v > hi, r = minutesWhere(s, bad), ins = r.total ? 100 - (r.min / r.total) * 100 : NaN;
  const rhBad = Number.isFinite(rh) && (rh < rlo || rh > rhi);
  return (
    <Svg>
      <Txt x={10} y={22} s={16} w={700} c={Number.isFinite(t) && bad(t) ? COL.bad : COL.fg}>{f(t, 1)} °C</Txt>
      <Txt x={10} y={37} s={10} w={600} c={rhBad ? COL.warn : COL.muted}>RH {f(rh, 0)}%</Txt>
      <Txt x={W - 10} y={16} s={10.5} w={600} c={ins < 98 ? COL.warn : COL.ok} a="end">In spec {f(ins, 1)}%</Txt>
      <Txt x={W - 10} y={30} s={9.5} a="end">{r.events} excursions · {f(r.min, 0)} min</Txt>
      <rect x={10} y={42} width={W - 20} height={H - 66} fill="none" />
      <Trend vals={s.map((x) => x.v)} x0={10} y0={44} x1={W - 10} y1={H - 24} lo={Math.min(lo - 3, ...s.map((x) => x.v))} hi={Math.max(hi + 3, ...s.map((x) => x.v))}
        lines={[[lo, COL.ok, true], [hi, COL.ok, true]]} />
      <Txt x={10} y={H - 8} s={9}>Over the time range · limits {lo}–{hi} °C</Txt>
    </Svg>
  );
}

// ── Mean Kinetic Temperature ──────────────────────────────────────────────────
export function Mkt(p: ProProps) {
  const limit = cfg(p, "limit", 25), E = (cfg(p, "dh", 83.144) * 1000) / 8.3144;
  const s = p.bound ? valuesOf(p.rows, "s0").map((x) => ({ ts: x.ts, v: x.v })) : Array.from({ length: 30 * 24 }, (_, i) => ({ ts: Date.now() - (720 - i) * 3_600_000, v: 22 + 2 * Math.sin(i / 60) + Math.sin(i / 3) }));
  const mkt = s.length ? E / -Math.log(s.reduce((a, x) => a + Math.exp(-E / (x.v + 273.15)), 0) / s.length) - 273.15 : NaN;
  const avg = s.length ? s.reduce((a, x) => a + x.v, 0) / s.length : NaN, mx = s.length ? Math.max(...s.map((x) => x.v)) : NaN;
  const days: Record<string, number[]> = {};
  for (const x of s) { const d = new Date(x.ts).toDateString(); (days[d] ??= []).push(x.v); }
  const daily = Object.values(days).map((a) => a.reduce((q, v) => q + v, 0) / a.length).slice(-31);
  const c = !Number.isFinite(mkt) ? COL.neutral : mkt > limit ? COL.bad : mkt > limit - 1 ? COL.warn : COL.ok;
  const x0 = 10, x1 = W - 10, y0 = 74, y1 = H - 14, bw = (x1 - x0) / Math.max(1, daily.length), lo = Math.min(limit - 10, ...daily), hi = Math.max(limit + 3, ...daily);
  const y = (v: number) => y1 - ((clamp(v, lo, hi) - lo) / (hi - lo || 1)) * (y1 - y0);
  return (
    <Svg>
      <Txt x={10} y={18}>MKT over the time range</Txt>
      <Txt x={10} y={44} s={22} w={700} c={c}>{f(mkt, 2)} °C</Txt>
      <Txt x={10} y={60} s={9.5}>Average {f(avg, 1)} °C · max {f(mx, 1)} °C</Txt>
      <Txt x={W - 10} y={18} s={10} w={600} c={COL.fg} a="end">Label limit {limit} °C</Txt>
      <Txt x={W - 10} y={40} s={10.5} w={600} c={c} a="end">{!Number.isFinite(mkt) ? "No data" : mkt > limit ? "Above limit" : "Within limit"}</Txt>
      {daily.map((v, i) => <rect key={i} x={x0 + i * bw + 1} y={y(v)} width={Math.max(1, bw - 2)} height={y1 - y(v)} fill={v > limit ? COL.bad : COL.primary} fillOpacity={0.6} />)}
      <line x1={x0} x2={x1} y1={y(limit)} y2={y(limit)} stroke={COL.bad} strokeDasharray="4 3" />
      {Number.isFinite(mkt) && <line x1={x0} x2={x1} y1={y(mkt)} y2={y(mkt)} stroke={VIOLET} strokeWidth={1.5} />}
      <Txt x={x0} y={H - 2} s={9}>daily average · purple MKT · red limit</Txt>
    </Svg>
  );
}

// ── Sterilizer Cycle (F₀) ─────────────────────────────────────────────────────
export function Sterilizer(p: ProProps) {
  const [temp, phase] = useRoles(p, [121.4, 3]);
  const target = cfg(p, "target", 15), ref = cfg(p, "ref", 121.1), z = cfg(p, "z", 10);
  const names = String(p.c.phases || "Pre-vac, Heat-up, Exposure, Vent, Dry").split(",").map((s) => s.trim());
  const s = p.bound ? roleSeriesTs(p, 0, 0, 0) : Array.from({ length: 50 }, (_, i) => ({ ts: Date.now() - (50 - i) * 60_000, v: i < 12 ? 40 + i * 2 : i < 26 ? 64 + (i - 12) * 4.1 : 121.5 + Math.sin(i) * 0.3 }));
  let f0 = 0;
  for (let i = 1; i < s.length; i++) f0 += ((s[i].ts - s[i - 1].ts) / 60_000) * Math.pow(10, (s[i - 1].v - ref) / z);
  const pass = f0 >= target, ph = Number.isFinite(phase) ? names[Math.round(phase) - 1] ?? `Phase ${phase}` : null;
  return (
    <Svg>
      <Txt x={10} y={22} s={15} w={700} c={COL.fg}>{f(temp, 1)} °C</Txt>
      <Txt x={W / 2 + 6} y={22} s={15} w={700} c={pass ? COL.ok : COL.fg} a="middle">F₀ {f(f0, 1)} min</Txt>
      <Txt x={W - 10} y={22} s={11} w={700} c={pass ? COL.ok : COL.muted} a="end">{pass ? "TARGET MET" : `target ≥ ${target}`}</Txt>
      {ph && <Pill x={10} y={32} text={ph.toUpperCase()} c={COL.primary} />}
      <Trend vals={s.map((x) => x.v)} x0={10} y0={56} x1={W - 10} y1={H - 22} c={COL.warn} lo={20} hi={Math.max(135, ref + 10)} lines={[[ref, COL.bad, true]]} />
      <Txt x={W - 12} y={H - 8} s={9} c={COL.bad} a="end">{ref} °C reference</Txt>
      <Txt x={10} y={H - 8} s={9}>F₀ added up over the time range</Txt>
    </Svg>
  );
}

// ── Cold Room Monitor ─────────────────────────────────────────────────────────
export function ColdRoom(p: ProProps) {
  const [t, door, defrost, comp] = useRoles(p, [-18.4, 0, 0, 1]);
  const limit = cfg(p, "limit", -15), sp = cfg(p, "setpoint", -18);
  const rows = p.bound ? thin(p.rows.filter((r) => r.s0 != null), 160)
    : Array.from({ length: 120 }, (_, i) => ({ s0: -18.5 + Math.sin(i / 5) * 0.4 + (i > 40 && i < 46 ? (i - 40) * 0.9 : 0), s1: i > 40 && i < 45 ? 1 : 0, s2: i > 80 && i < 92 ? 1 : 0 }));
  const vals = rows.map((r: any) => Number(r.s0)), lo = Math.min(sp - 4, ...vals), hi = Math.max(limit + 3, ...vals);
  const x0 = 10, x1 = W - 10, y0 = 46, y1 = H - 22, bw = (x1 - x0) / Math.max(1, rows.length);
  const r = minutesWhere(roleSeriesTs(p, 0, -18.4, 0.4, 60), (v) => v > limit);
  return (
    <Svg>
      {rows.map((row: any, i: number) => (
        <g key={i}>
          {Number(row.s2) > 0 && <rect x={x0 + i * bw} y={y0} width={bw + 0.5} height={y1 - y0} fill={CYAN} fillOpacity={0.13} />}
          {Number(row.s1) > 0 && <rect x={x0 + i * bw} y={y0 - 6} width={bw + 0.5} height={4} fill={COL.warn} />}
        </g>
      ))}
      <Trend vals={vals} x0={x0} y0={y0} x1={x1} y1={y1} c={CYAN} lo={lo} hi={hi} lines={[[limit, COL.bad, true], [sp, COL.muted, true]]} />
      <Txt x={x1} y={y0 + 10} s={9} c={COL.bad} a="end">limit {limit}°</Txt>
      <Txt x={10} y={23} s={16} w={700} c={t > limit ? COL.bad : COL.fg}>{f(t, 1)} °C</Txt>
      <Pill x={92} y={10} text={!Number.isFinite(door) ? "DOOR ?" : door > 0 ? "DOOR OPEN" : "DOOR SHUT"} c={door > 0 ? COL.warn : COL.neutral} />
      <Pill x={176} y={10} text={defrost > 0 ? "DEFROST" : !Number.isFinite(comp) ? "COMP ?" : comp > 0 ? "COMP ON" : "COMP OFF"} c={defrost > 0 ? CYAN : comp > 0 ? COL.ok : COL.neutral} />
      <Txt x={10} y={H - 7} s={9}>Above limit {f(r.min, 0)} min in range · orange door · blue defrost</Txt>
    </Svg>
  );
}

// ── Psychrometric Chart ───────────────────────────────────────────────────────
const P_ATM = 101.325, psat = (t: number) => 0.61078 * Math.exp((17.27 * t) / (t + 237.3));
const humRatio = (t: number, rh: number) => { const pw = (rh / 100) * psat(t); return (622 * pw) / (P_ATM - pw); };
export function Psychro(p: ProProps) {
  const [t, rh] = useRoles(p, [22.6, 50]);
  const tLo = cfg(p, "tLo", 20), tHi = cfg(p, "tHi", 24), rLo = cfg(p, "rhLo", 45), rHi = cfg(p, "rhHi", 55);
  const x0 = 14, x1 = W - 30, y0 = 10, y1 = H - 34, sx = (v: number) => x0 + ((clamp(v, 10, 40) - 10) / 30) * (x1 - x0), sy = (g: number) => y1 - (clamp(g, 0, 25) / 25) * (y1 - y0);
  const trail: [number, number][] = p.bound ? thin(p.rows.filter((r) => r.s0 != null && r.s1 != null).map((r) => [Number(r.s0), Number(r.s1)] as [number, number]), 50) : [];
  const inZ = t >= tLo && t <= tHi && rh >= rLo && rh <= rHi, c = !Number.isFinite(t) || !Number.isFinite(rh) ? COL.neutral : inZ ? COL.ok : COL.warn;
  const gm = Math.log(rh / 100) + (17.27 * t) / (237.3 + t), dp = (237.3 * gm) / (17.27 - gm);
  return (
    <Svg>
      <path d={`M${sx(tLo)},${sy(humRatio(tLo, rLo))} L${sx(tHi)},${sy(humRatio(tHi, rLo))} L${sx(tHi)},${sy(humRatio(tHi, rHi))} L${sx(tLo)},${sy(humRatio(tLo, rHi))} Z`} fill={COL.ok} fillOpacity={0.16} />
      {[20, 40, 60, 80, 100].map((r) => {
        const pts = Array.from({ length: 61 }, (_, i) => 10 + i * 0.5).map((tt) => [tt, humRatio(tt, r)]).filter(([, g]) => g <= 25);
        const last = pts[pts.length - 1];
        return (
          <g key={r}>
            <path d={pts.map(([tt, g], i) => `${i ? "L" : "M"}${sx(tt)},${sy(g)}`).join(" ")} stroke={r === 100 ? COL.fg : COL.muted} strokeOpacity={r === 100 ? 0.5 : 0.3} fill="none" />
            {last && <Txt x={sx(last[0]) + 2} y={sy(last[1]) + 3} s={8.5}>{r}%</Txt>}
          </g>
        );
      })}
      <line x1={x0} x2={x1} y1={y1} y2={y1} stroke={COL.border} />
      {[10, 20, 30, 40].map((v) => <Txt key={v} x={sx(v)} y={y1 + 11} s={9} a="middle">{v}°</Txt>)}
      {trail.map(([a, b], i) => <circle key={i} cx={sx(a)} cy={sy(humRatio(a, b))} r={1.8} fill={COL.primary} fillOpacity={(i / trail.length) * 0.5} />)}
      {Number.isFinite(t) && Number.isFinite(rh) && <circle cx={sx(t)} cy={sy(humRatio(t, rh))} r={5.5} fill={c} className="pro-ease" />}
      <Txt x={x0 + 2} y={y0 + 6} s={9} c={COL.ok}>target {tLo}–{tHi} °C, {rLo}–{rHi}%</Txt>
      <Txt x={10} y={H - 7} s={10} w={600} c={c}>{f(t, 1)} °C · {f(rh, 0)}% RH · dew point {f(dp, 1)} °C</Txt>
    </Svg>
  );
}

// ── Purified Water / WFI Loop ─────────────────────────────────────────────────
export function PwLoop(p: ProProps) {
  const [cond, toc, temp, vel] = useRoles(p, [0.62, 118, 82.1, 1.4]);
  const cM = cfg(p, "condMax", 1.3), tM = cfg(p, "tocMax", 500), tMin = cfg(p, "tempMin", 80), vMin = cfg(p, "velMin", 1);
  const cx = 72, cy = 84, rx = 50, ry = 50, flowing = Number.isFinite(vel) ? vel > 0 : !p.bound;
  return (
    <Svg>
      <Txt x={10} y={16} w={600} c={COL.fg}>Distribution loop</Txt>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={COL.track} strokeWidth={6} />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={CYAN} strokeWidth={2} strokeDasharray="5 5" className={flowing ? "pro-dash" : undefined} />
      <rect x={cx - 20} y={cy - 16} width={40} height={32} rx={6} fill={COL.card} stroke={COL.border} />
      <Txt x={cx} y={cy + 3} s={9.5} w={600} c={COL.fg} a="middle">Tank</Txt>
      {[0, 1, 2, 3].map((i) => { const a = -Math.PI * 0.85 + i * Math.PI * 0.23, px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry; return (
        <g key={i}><circle cx={px} cy={py} r={4} fill={COL.primary} /><Txt x={px} y={py - 8} s={8.5} a="middle">UP{i + 1}</Txt></g>); })}
      {([["Conductivity", `${f(cond, 2)} µS/cm`, lvl(cond, cM * 0.8, cM), `≤ ${cM}`], ["TOC", `${f(toc, 0)} ppb`, lvl(toc, tM * 0.8, tM), `≤ ${tM}`],
        ["Loop temp", `${f(temp, 1)} °C`, lvlLow(temp, tMin, tMin - 5), `≥ ${tMin}`], ["Return velocity", `${f(vel, 2)} m/s`, lvlLow(vel, vMin, vMin * 0.9), `≥ ${vMin}`]] as [string, string, string, string][]).map(([l, v, c, lim], i) => (
        <g key={l}>
          <Txt x={140} y={22 + i * 38} s={9.5}>{l} ({lim})</Txt>
          <Txt x={140} y={38 + i * 38} s={13} w={700} c={c}>{v}</Txt>
        </g>
      ))}
    </Svg>
  );
}

// ── Lyophilizer Cycle ─────────────────────────────────────────────────────────
export function Lyophilizer(p: ProProps) {
  const [shelf, prod, cm, pir] = useRoles(p, [-25, -34.5, 0.1, 0.19]);
  const gapLim = cfg(p, "gap", 0.01), gap = pir - cm;
  const sh = roleSeries(p, 0, -30, 10, 60), pr = roleSeries(p, 1, -36, 8, 60);
  const pc = roleSeries(p, 2, 0.1, 0.005, 60), pp = roleSeries(p, 3, 0.18, 0.04, 60);
  const lo = Math.min(-50, ...sh, ...pr), hi = Math.max(30, ...sh, ...pr), log = (v: number) => Math.log10(clamp(v, 0.01, 10));
  const done = Number.isFinite(gap) && gap < gapLim && cm < 1;
  return (
    <Svg>
      <Txt x={10} y={14} s={10.5} w={600} c={COL.fg}>Shelf {f(shelf, 0)}° · product {f(prod, 0)}°</Txt>
      <Txt x={10} y={28} s={9.5} c={done ? COL.ok : COL.muted}>{!Number.isFinite(gap) ? "Pressure gauges not bound" : done ? "Pirani = CM: primary drying done" : `Pirani − CM ${f(gap, 3)} mbar`}</Txt>
      <Txt x={W - 10} y={14} s={9} a="end">red shelf · orange product</Txt>
      <Txt x={W - 10} y={28} s={9} a="end">purple Pirani · cyan CM (log)</Txt>
      <Trend vals={sh} x0={10} y0={38} x1={W - 10} y1={H - 14} lo={lo} hi={hi} c={COL.bad} />
      <Trend vals={pr} x0={10} y0={38} x1={W - 10} y1={H - 14} lo={lo} hi={hi} c={COL.warn} />
      <Trend vals={pp.map(log)} x0={10} y0={38} x1={W - 10} y1={H - 14} lo={-2} hi={1} c={VIOLET} />
      <Trend vals={pc.map(log)} x0={10} y0={38} x1={W - 10} y1={H - 14} lo={-2} hi={1} c={CYAN} />
      <Txt x={10} y={H - 2} s={9}>Over the time range</Txt>
    </Svg>
  );
}

// ── Air Handling Unit ─────────────────────────────────────────────────────────
export function Ahu(p: ProProps) {
  const [sup, rh, dmp, fdp, vlv, htr, hz, ret] = useRoles(p, [18.3, 51, 30, 192, 77, 0, 39, 24.1]);
  const sp = cfg(p, "setpoint", 18), fch = cfg(p, "filterChange", 250);
  const dx = 10, dw = W - 20, dy = 40, dh = 50, sw = dw / 5, cx = (i: number) => dx + sw * i + sw / 2, my = dy + dh / 2;
  const fanDur = Number.isFinite(hz) && hz > 0 ? clamp(60 / hz, 0.4, 3) : 0, a = ((100 - clamp(fin(dmp, 50), 0, 100)) / 100) * (Math.PI / 2.2);
  return (
    <Svg>
      <Txt x={10} y={18} s={12} w={700} c={Math.abs(sup - sp) > 1.2 ? COL.warn : COL.fg}>Supply {f(sup, 1)} °C · {f(rh, 0)}% RH</Txt>
      <Txt x={W - 10} y={18} s={9.5} a="end">set {sp} °C</Txt>
      <Txt x={dx} y={dy - 5} s={9}>outside / return air →</Txt>
      <Txt x={dx + dw} y={dy - 5} s={9} a="end">→ supply</Txt>
      <rect x={dx} y={dy} width={dw} height={dh} rx={6} fill={COL.track} stroke={COL.border} />
      {[0, 1, 2].map((i) => <line key={i} x1={dx + 4} x2={dx + dw - 4} y1={dy + 12 + i * 13} y2={dy + 12 + i * 13} stroke={COL.muted} strokeOpacity={0.35} strokeDasharray="5 5" className={fanDur ? "pro-dash" : undefined} />)}
      {[0, 1, 2].map((j) => { const yy = dy + 12 + j * 13; return <line key={j} x1={cx(0) - Math.cos(a) * 8} y1={yy - Math.sin(a) * 6} x2={cx(0) + Math.cos(a) * 8} y2={yy + Math.sin(a) * 6} stroke={COL.fg} strokeWidth={2} />; })}
      <path d={Array.from({ length: 9 }, (_, j) => `${j ? "L" : "M"}${cx(1) + (j % 2 ? 6 : -6)},${dy + 4 + (j * (dh - 8)) / 8}`).join(" ")} stroke={fdp >= fch ? COL.warn : COL.muted} fill="none" />
      <rect x={cx(2) - 10} y={dy + 4} width={20} height={dh - 8} fill={CYAN} fillOpacity={0.2 + (clamp(fin(vlv), 0, 100) / 100) * 0.5} stroke={CYAN} />
      <path d={Array.from({ length: 7 }, (_, j) => `${j ? "L" : "M"}${cx(3) + (j % 2 ? 7 : -7)},${dy + 6 + (j * (dh - 12)) / 6}`).join(" ")} stroke={fin(htr) > 1 ? COL.bad : COL.neutral} strokeWidth={2} fill="none" />
      <circle cx={cx(4)} cy={my} r={18} fill="none" stroke={COL.border} />
      <g className={fanDur ? "pro-spin" : undefined} style={{ "--pro-dur": `${fanDur || 1}s` } as React.CSSProperties}>
        <circle cx={cx(4)} cy={my} r={15} fill="transparent" />
        {[0, 1, 2, 3].map((j) => { const an = (j * Math.PI) / 2; return <line key={j} x1={cx(4)} y1={my} x2={cx(4) + Math.cos(an) * 15} y2={my + Math.sin(an) * 15} stroke={COL.primary} strokeWidth={2.5} />; })}
      </g>
      {([["Damper", `${f(dmp, 0)}%`], ["Filter", `${f(fdp, 0)} Pa`, fdp >= fch ? COL.warn : undefined], ["Cooling", `${f(vlv, 0)}%`], ["Heater", `${f(htr, 0)}%`], ["Fan", `${f(hz, 0)} Hz`]] as [string, string, string?][]).map(([l, v, c], i) => (
        <g key={l}>
          <Txt x={cx(i)} y={dy + dh + 14} s={9} a="middle">{l}</Txt>
          <Txt x={cx(i)} y={dy + dh + 27} w={600} c={c || COL.fg} a="middle">{v}</Txt>
        </g>
      ))}
      <Txt x={10} y={H - 6} s={9}>Return {f(ret, 1)} °C{fdp >= fch ? " · filter due for change" : ""}</Txt>
    </Svg>
  );
}

// ── Filter Loading ────────────────────────────────────────────────────────────
export function FilterLoad(p: ProProps) {
  const items = useItems(p, [["AHU-3 pre-filter G4", 120], ["AHU-3 fine F8", 290], ["HEPA · Filling 1", 410], ["HEPA · Filling 2", 335], ["HEPA · Buffer", 260]]);
  const clean = p.bound ? list(p.c.clean) : [50, 110, 220, 220, 220], fin_ = p.bound ? list(p.c.final) : [250, 450, 600, 600, 600];
  return (
    <div className="h-full w-full flex flex-col gap-1.5 p-2 text-[11px] overflow-auto">
      {items.map((it, i) => {
        const c0 = Number.isFinite(clean[i]) ? clean[i] : 0, c1 = Number.isFinite(fin_[i]) ? fin_[i] : NaN;
        const fr = (it.v - c0) / (c1 - c0), col = !Number.isFinite(fr) ? COL.neutral : fr >= 1 ? COL.bad : fr >= 0.8 ? COL.warn : COL.ok;
        const ser = p.bound ? valuesOf(p.rows, it.key) : [];
        const fit = ser.length > 3 ? linFit(ser.map((s) => s.ts / DAY), ser.map((s) => s.v)) : null;
        const days = p.bound ? (fit && fit.b > 0.01 && Number.isFinite(c1) ? Math.max(0, (c1 - it.v) / fit.b) : null) : [63, 81, 103, 147, 197][i];
        return (
          <div key={it.key} className="grid gap-x-2 gap-y-0.5" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
            <span className="truncate">{it.label}</span>
            <span className="tabular-nums text-[10px]" style={{ color: col }}>{f(it.v, 0)} Pa · {Number.isFinite(fr) && fr >= 1 ? "CHANGE NOW" : days != null ? `~${f(days, 0)} d` : Number.isFinite(c1) ? "steady" : "set change ΔP"}</span>
            <div className="col-span-2 h-1.5 rounded bg-muted overflow-hidden"><div className="h-full pro-ease" style={{ width: `${clamp(fin(fr), 0, 1) * 100}%`, background: col }} /></div>
          </div>
        );
      })}
      <p className="mt-auto text-[10px] text-muted-foreground">Bar runs from clean ΔP to change ΔP</p>
    </div>
  );
}

// ── RO / Water Treatment ──────────────────────────────────────────────────────
export function RoPlant(p: ProProps) {
  const [fc, pc, ff, pf, dp] = useRoles(p, [1100, 31, 13.5, 10, 1.4]);
  const dpW = cfg(p, "dpWarn", 1.8), cip = cfg(p, "cipDrop", 15);
  const rec = pf / ff, rej = 1 - pc / fc;
  const flow = roleSeries(p, 3, 10, 0.3, 40), base = flow.length ? flow[0] : NaN, now = flow.length ? flow[flow.length - 1] : NaN;
  const drop = ((base - now) / base) * 100;
  const y = 34;
  return (
    <Svg>
      <Flow x1={8} y1={y} x2={40} y2={y} c={COL.neutral} />
      <circle cx={48} cy={y} r={8} fill={COL.ok} />
      <Flow x1={56} y1={y} x2={74} y2={y} c={COL.neutral} />
      {[0, 1].map((i) => <rect key={i} x={74} y={y - 18 + i * 20} width={W - 150} height={14} rx={7} fill={COL.card} stroke={COL.border} />)}
      <Flow x1={W - 76} y1={y - 11} x2={W - 8} y2={y - 11} c={CYAN} />
      <Flow x1={W - 76} y1={y + 9} x2={W - 8} y2={y + 9} c={COL.neutral} speed={0.5} />
      <Txt x={8} y={y - 10} s={8.5}>feed {f(fc, 0)} µS</Txt>
      <Txt x={W - 8} y={y - 17} s={8.5} c={CYAN} a="end">permeate</Txt>
      <Txt x={W - 8} y={y + 22} s={8.5} a="end">reject</Txt>
      <Kpis y={86} items={[[`${f(rec * 100, 0)}%`, "recovery"], [`${f(rej * 100, 1)}%`, "rejection", lvlLow(rej, 0.965, 0.95)], [`${f(pc, 0)} µS`, "permeate"], [`${f(dp, 1)} bar`, "stage ΔP", lvl(dp, dpW, dpW + 0.3)]]} />
      <Trend vals={flow} x0={10} y0={H - 46} x1={W * 0.55} y1={H - 10} c={CYAN} />
      <Txt x={W * 0.55 + 12} y={H - 28} s={9}>Permeate flow vs range start</Txt>
      <Txt x={W * 0.55 + 12} y={H - 13} s={10.5} w={600} c={drop >= cip ? COL.warn : COL.fg}>{!Number.isFinite(drop) ? "—" : drop >= cip ? "Clean membranes (CIP)" : `${drop >= 0 ? "−" : "+"}${f(Math.abs(drop), 0)}% · CIP at −${cip}%`}</Txt>
    </Svg>
  );
}

// ── ETP / STP Outlet Quality ──────────────────────────────────────────────────
export function Etp(p: ProProps) {
  const [ph, cod, bod, tss, og, flow] = useRoles(p, [7.4, 182, 22, 61, 4, 432]);
  const phLo = cfg(p, "phLo", 5.5), phHi = cfg(p, "phHi", 9);
  const params: [string, number, number][] = [["COD", cod, cfg(p, "cod", 250)], ["BOD", bod, cfg(p, "bod", 30)], ["TSS", tss, cfg(p, "tss", 100)], ["Oil & grease", og, cfg(p, "og", 10)]];
  const x0 = 86, bw = W - x0 - 50, px = (v: number) => x0 + ((clamp(v, 4, 11) - 4) / 7) * bw;
  const phc = !Number.isFinite(ph) ? COL.neutral : ph < phLo || ph > phHi ? COL.bad : ph < phLo + 0.5 || ph > phHi - 0.5 ? COL.warn : COL.ok;
  return (
    <Svg>
      <Txt x={10} y={21}>pH</Txt>
      <rect x={x0} y={12} width={bw} height={10} fill={COL.track} />
      <rect x={px(phLo)} y={12} width={px(phHi) - px(phLo)} height={10} fill={COL.ok} fillOpacity={0.3} />
      {Number.isFinite(ph) && <rect x={px(ph) - 2} y={9} width={4} height={16} fill={phc} className="pro-ease" />}
      <Txt x={W - 10} y={21} s={10.5} w={600} c={phc} a="end">{f(ph, 1)}</Txt>
      {params.map(([l, v, lim], i) => { const yy = 42 + i * 25, fr = v / lim, c = !Number.isFinite(fr) ? COL.neutral : fr >= 1 ? COL.bad : fr >= 0.85 ? COL.warn : COL.ok; return (
        <g key={l}>
          <Txt x={10} y={yy + 8}>{l}</Txt>
          <rect x={x0} y={yy} width={bw} height={10} fill={COL.track} />
          <rect x={x0} y={yy} width={(bw * clamp(fin(fr), 0, 1.25)) / 1.25} height={10} fill={c} fillOpacity={0.8} className="pro-ease" />
          <rect x={x0 + bw / 1.25 - 1} y={yy - 3} width={2} height={16} fill={COL.fg} />
          <Txt x={W - 10} y={yy + 8} s={10.5} w={600} c={c} a="end">{f(v, 0)}</Txt>
        </g>); })}
      <Txt x={10} y={H - 8} s={9}>Treated {f(flow, 0)} m³ · white tick = consent limit · mg/L</Txt>
    </Svg>
  );
}
