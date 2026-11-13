/**
 * Process equipment: heat exchangers, furnaces, separators, reactors, tanks,
 * gas detection, flow balance, permissives, compressor surge, pump curves,
 * columns, pipelines, turbines, flares and dust collectors.
 */
import { useId } from "react";
import { type ProProps, COL, clamp, valuesOf, linFit, useTween, sample } from "../common";
import {
  W, H, CYAN, VIOLET, Svg, Txt, Kpis, Row, Flow, Pill, Bar, Trend, Tile, f, fin, lvl, lvlLow, cfg, list,
  useRoles, roleSeries, roleSeriesTs, unitOf, useItems, thin,
} from "./kit";

const DAY = 86_400_000;

// ── Heat Exchanger Performance ────────────────────────────────────────────────
export function HeatEx(p: ProProps) {
  const [hi, ho, ci, co, flow] = useRoles(p, [92, 58, 30, 66, 40]);
  const limit = cfg(p, "effLimit", 50) / 100;
  const d1 = hi - co, d2 = ho - ci, lmtd = Math.abs(d1 - d2) < 0.01 ? d1 : (d1 - d2) / Math.log(d1 / d2);
  const eff = (co - ci) / (hi - ci), duty = 1.163 * flow * (co - ci);
  const hist: { ts: number; v: number }[] = p.bound
    ? p.rows.filter((r) => ["s0", "s2", "s3"].every((k) => r[k] != null) && Number(r.s0) !== Number(r.s2))
      .map((r) => ({ ts: r.ts, v: (Number(r.s3) - Number(r.s2)) / (Number(r.s0) - Number(r.s2)) }))
    : Array.from({ length: 30 }, (_, i) => ({ ts: Date.now() - (30 - i) * DAY, v: 0.6 - i * 0.002 + Math.sin(i) * 0.004 }));
  const fit = hist.length > 3 ? linFit(hist.map((h) => h.ts / DAY), hist.map((h) => h.v)) : null;
  const days = fit && fit.b < -1e-4 && Number.isFinite(eff) ? Math.max(0, (eff - limit) / -fit.b) : null;
  const sx = 46, sw = W - 92, sy = 24, sh = 40;
  return (
    <Svg>
      <Flow x1={6} y1={sy + 10} x2={sx} y2={sy + 10} c={COL.bad} />
      <Flow x1={sx + sw} y1={sy + 10} x2={W - 6} y2={sy + 10} c={COL.warn} />
      <Flow x1={W - 6} y1={sy + sh - 6} x2={sx + sw} y2={sy + sh - 6} c={CYAN} />
      <Flow x1={sx} y1={sy + sh - 6} x2={6} y2={sy + sh - 6} c={COL.ok} />
      <rect x={sx} y={sy} width={sw} height={sh} rx={18} fill={COL.card} stroke={COL.border} />
      {[0, 1, 2, 3].map((i) => <line key={i} x1={sx + 14} x2={sx + sw - 14} y1={sy + 8 + i * 8} y2={sy + 8 + i * 8} stroke={COL.bad} strokeOpacity={0.3} />)}
      <Txt x={W / 2} y={sy + sh / 2 + 4} s={9.5} w={600} a="middle">hot →  ← cold</Txt>
      <Txt x={6} y={sy - 3} w={600} c={COL.bad}>{f(hi, 1)}°</Txt>
      <Txt x={W - 6} y={sy - 3} w={600} c={COL.warn} a="end">{f(ho, 1)}°</Txt>
      <Txt x={6} y={sy + sh + 13} w={600} c={COL.ok}>{f(co, 1)}°</Txt>
      <Txt x={W - 6} y={sy + sh + 13} w={600} c={CYAN} a="end">{f(ci, 1)}°</Txt>
      <Kpis y={100} items={[[`${f(lmtd, 1)} °C`, "LMTD"], [`${f(eff * 100, 0)}%`, "effectiveness", lvlLow(eff, limit + 0.05, limit)], [Number.isFinite(duty) ? `${f(duty, 0)} kW` : "—", "heat duty"]]} />
      <Trend vals={hist.map((h) => h.v)} x0={10} y0={H - 44} x1={W * 0.5} y1={H - 10} lines={[[limit, COL.bad, true]]} c={VIOLET} />
      <Txt x={W * 0.5 + 18} y={H - 28} s={9.5}>Effectiveness trend</Txt>
      <Txt x={W * 0.5 + 18} y={H - 13} s={11} w={600} c={Number.isFinite(eff) && eff <= limit ? COL.warn : days != null && days < 10 ? COL.warn : COL.fg}>
        {Number.isFinite(eff) && eff <= limit ? "Cleaning due now" : days == null ? "No fouling trend" : `Clean in ~${f(days, 0)} days`}
      </Txt>
    </Svg>
  );
}

// ── Furnace Zones ─────────────────────────────────────────────────────────────
export function FurnaceZones(p: ProProps) {
  const items = useItems(p, [["Z1", 652], ["Z2", 812], ["Z3", 955], ["Z4", 951], ["Z5", 884], ["Z6", 783]]);
  const sp = p.bound || p.c.setpoints ? list(p.c.setpoints) : [650, 820, 950, 950, 900, 780];
  const dev = cfg(p, "dev", 10);
  const all = [...items.map((i) => i.v), ...sp].filter(Number.isFinite);
  const lo = all.length ? Math.min(...all) * 0.8 : 0, hi = all.length ? Math.max(...all) * 1.05 : 100;
  const n = Math.max(1, items.length), gw = (W - 20) / n, top = 32, bot = H - 30, y = (v: number) => bot - ((clamp(v, lo, hi) - lo) / (hi - lo || 1)) * (bot - top);
  return (
    <Svg>
      <Txt x={10} y={12} s={9}>°C · bar actual · line set point</Txt>
      {items.map((it, i) => {
        const x = 10 + i * gw + Math.min(6, gw * 0.15), bw = gw - 2 * Math.min(6, gw * 0.15), s = sp[i], off = Number.isFinite(s) && Math.abs(it.v - s) > dev;
        const c = off ? COL.warn : COL.primary;
        return (
          <g key={it.key}>
            <rect x={x} y={top} width={bw} height={bot - top} fill={COL.track} />
            {Number.isFinite(it.v) && <rect x={x} y={y(it.v)} width={bw} height={bot - y(it.v)} fill={c} fillOpacity={0.75} className="pro-ease" />}
            {Number.isFinite(s) && <rect x={x - 3} y={y(s) - 1} width={bw + 6} height={2} fill={COL.fg} />}
            <Txt x={x + bw / 2} y={top - 5} w={600} c={off ? COL.warn : COL.fg} a="middle">{f(it.v, 0)}</Txt>
            <Txt x={x + bw / 2} y={bot + 12} s={9.5} a="middle">{it.label.length > 8 ? it.label.slice(0, 8) : it.label}</Txt>
            {Number.isFinite(s) && <Txt x={x + bw / 2} y={bot + 24} s={9} a="middle">sp {s}</Txt>}
          </g>
        );
      })}
    </Svg>
  );
}

// ── Three-Phase Separator ─────────────────────────────────────────────────────
export function Separator(p: ProProps) {
  const clip = useId().replace(/:/g, "");
  const [oil, iface, pr, ov, wv] = useRoles(p, [62, 30, 12.4, 42, 35]);
  const ifLo = cfg(p, "ifLo", 20), ifHi = cfg(p, "ifHi", 40);
  const to = useTween(Number.isFinite(oil) ? oil : null), ti = useTween(Number.isFinite(iface) ? iface : null);
  const vx = 10, vy = 26, vw = W - 20, vh = 84, wx = vx + vw * 0.7, yl = (pc: number) => vy + vh * (1 - clamp(pc, 0, 100) / 100);
  const ifBad = Number.isFinite(iface) && (iface < ifLo || iface > ifHi);
  return (
    <Svg>
      <defs><clipPath id={clip}><rect x={vx} y={vy} width={vw} height={vh} rx={vh / 2} /></clipPath></defs>
      <rect x={vx} y={vy} width={vw} height={vh} rx={vh / 2} fill={COL.track} />
      <g clipPath={`url(#${clip})`}>
        {to != null && <rect x={vx} y={yl(to)} width={wx - vx} height={vh} fill="#b4782a" fillOpacity={0.75} />}
        {ti != null && <rect x={vx} y={yl(ti)} width={wx - vx} height={vh} fill={COL.primary} fillOpacity={0.6} />}
        <rect x={wx} y={yl(30)} width={vx + vw - wx} height={vh} fill="#b4782a" fillOpacity={0.75} />
      </g>
      <rect x={vx} y={vy} width={vw} height={vh} rx={vh / 2} fill="none" stroke={COL.border} strokeWidth={1.5} />
      <rect x={wx - 2} y={yl(55)} width={4} height={vh * 0.55} fill={COL.neutral} />
      <Txt x={vx + 36} y={vy + 18} w={600}>Gas</Txt>
      {to != null && ti != null && <Txt x={vx + 36} y={(yl(to) + yl(ti)) / 2 + 4} w={600} c={COL.fg}>Oil</Txt>}
      {ti != null && <Txt x={vx + 36} y={(yl(ti) + vy + vh) / 2 + 4} w={600} c={COL.fg}>Water</Txt>}
      <Txt x={wx + 6} y={yl(55) - 3} s={9}>weir</Txt>
      <Txt x={10} y={15} w={600} c={COL.fg}>Inlet · {f(pr, 1)} {unitOf(p, 2, "barg")}</Txt>
      <Txt x={W - 10} y={15} s={9.5} a="end">gas out ↑</Txt>
      <Kpis y={H - 26} items={[[`${f(oil, 0)}%`, "oil level"], [`${f(iface, 0)}%`, "interface", ifBad ? COL.warn : undefined], [`${f(ov, 0)} / ${f(wv, 0)}%`, "oil / water valve"]]} />
    </Svg>
  );
}

// ── Batch Reactor ─────────────────────────────────────────────────────────────
export function Reactor(p: ProProps) {
  const [tm, tj, pr, rpm] = useRoles(p, [62.4, 55.1, 1.42, 120]);
  const limit = cfg(p, "rateLimit", 0.5);
  const ser = roleSeriesTs(p, 0, 62, 1.5, 60);
  const lastTs = ser.length ? ser[ser.length - 1].ts : 0, recent = ser.filter((s) => s.ts >= lastTs - 10 * 60_000);
  const rate = recent.length > 2 ? linFit(recent.map((s) => s.ts / 60_000), recent.map((s) => s.v)).b : NaN;
  const alarm = rate > limit, vx = 20, vw = 66, vy = 28, vh = H - 52, cx = vx + vw / 2;
  const turning = Number.isFinite(rpm) ? rpm > 0 : !p.bound;
  return (
    <Svg>
      <rect x={vx - 6} y={vy + 20} width={vw + 12} height={vh - 14} rx={14} fill="none" stroke={VIOLET} strokeOpacity={0.45} strokeWidth={5} />
      <path d={`M${vx},${vy + 14} Q${vx},${vy} ${vx + 14},${vy} L${vx + vw - 14},${vy} Q${vx + vw},${vy} ${vx + vw},${vy + 14} L${vx + vw},${vy + vh - 22} Q${vx + vw},${vy + vh} ${vx + vw - 22},${vy + vh} L${vx + 22},${vy + vh} Q${vx},${vy + vh} ${vx},${vy + vh - 22} Z`} fill={COL.card} stroke={COL.border} />
      <rect x={vx + 2} y={vy + vh * 0.35} width={vw - 4} height={vh * 0.65 - 2} rx={18} fill={alarm ? COL.bad : COL.primary} fillOpacity={0.4} />
      <line x1={cx} y1={vy - 6} x2={cx} y2={vy + vh * 0.78} stroke={COL.fg} strokeWidth={2} />
      <rect x={cx - 9} y={vy - 15} width={18} height={10} fill={COL.neutral} />
      <g className={turning ? "pro-pulse" : undefined}>
        <line x1={cx - 22} y1={vy + vh * 0.78} x2={cx + 22} y2={vy + vh * 0.78} stroke={COL.fg} strokeWidth={2.5} />
      </g>
      <Txt x={106} y={17} s={11} w={600} c={COL.fg}>Mass {f(tm, 1)} °C</Txt>
      <Txt x={106} y={31}>Jacket {f(tj, 1)} °C · {f(pr, 2)} bar</Txt>
      <Txt x={106} y={46} w={600} c={!Number.isFinite(rate) ? COL.muted : alarm ? COL.bad : COL.ok}>Rise {Number.isFinite(rate) && rate >= 0 ? "+" : ""}{f(rate, 2)} °C/min</Txt>
      <Trend vals={ser.map((s) => s.v)} x0={106} y0={56} x1={W - 10} y1={H - 30} c={alarm ? COL.bad : COL.primary} />
      <Txt x={106} y={H - 12} s={9.5} w={alarm ? 600 : undefined} c={alarm ? COL.bad : COL.muted}>{alarm ? `Rise above ${limit} °C/min` : `Agitator ${f(rpm, 0)} rpm`}</Txt>
    </Svg>
  );
}

// ── Tank Farm Inventory ───────────────────────────────────────────────────────
export function TankFarm(p: ProProps) {
  const items = useItems(p, [["HSD", 72], ["FO", 41], ["Caustic", 18], ["Solvent", 88], ["DM water", 55]]);
  const caps = list(p.c.capacities), lowL = cfg(p, "lowLimit", 20), highL = cfg(p, "highLimit", 90);
  const n = Math.max(1, items.length), gw = (W - 12) / n;
  return (
    <Svg>
      {items.map((it, i) => {
        const ser = p.bound ? valuesOf(p.rows, it.key) : sample(20, i + 1, it.v, 3).map((v, j) => ({ ts: Date.now() - (20 - j) * DAY / 4, v }));
        const fit = ser.length > 3 ? linFit(ser.map((s) => s.ts / DAY), ser.map((s) => s.v)) : null;
        const rate = fit?.b ?? 0, days = rate < -0.05 && Number.isFinite(it.v) ? it.v / -rate : null;
        const x = 6 + i * gw + Math.min(6, gw * 0.12), tw = gw - 2 * Math.min(6, gw * 0.12), ty = 32, th = H - 80, lv = clamp(fin(it.v), 0, 100) / 100;
        const c = it.v < lowL ? COL.bad : it.v > highL ? COL.warn : COL.primary, cap = p.bound ? caps[i] : [450, 600, 120, 200, 800][i];
        return (
          <g key={it.key}>
            <path d={`M${x},${ty + th} L${x},${ty + 8} Q${x},${ty} ${x + 8},${ty} L${x + tw - 8},${ty} Q${x + tw},${ty} ${x + tw},${ty + 8} L${x + tw},${ty + th} Z`} fill={COL.card} stroke={COL.border} />
            <rect x={x + 2} y={ty + th * (1 - lv)} width={tw - 4} height={th * lv} fill={c} fillOpacity={0.7} className="pro-ease" />
            <Txt x={x + tw / 2} y={ty - 6} w={600} c={c === COL.primary ? COL.fg : c} a="middle">{f(it.v, 0)}%</Txt>
            {days != null ? <Txt x={x + tw / 2} y={ty + 14} s={9} c={COL.fg} a="middle">▼ {f(days, 1)} d</Txt>
              : rate > 0.05 ? <Txt x={x + tw / 2} y={ty + 14} s={9} c={COL.ok} a="middle">▲</Txt> : null}
            <Txt x={x + tw / 2} y={ty + th + 13} s={9.5} w={600} c={COL.fg} a="middle">{it.label.length > 9 ? it.label.slice(0, 9) : it.label}</Txt>
            {Number.isFinite(cap) && <Txt x={x + tw / 2} y={ty + th + 25} s={9} a="middle">{f((cap * fin(it.v)) / 100, 0)} m³</Txt>}
          </g>
        );
      })}
    </Svg>
  );
}

// ── Gas Detection Panel ───────────────────────────────────────────────────────
export function GasDetect(p: ProProps) {
  const items = useItems(p, [["LEL · GD-01", 4], ["LEL · GD-02", 6], ["H₂S · GD-03", 2], ["CO · GD-04", 9], ["O₂ · GD-05", 20.9], ["NH₃ · GD-06", 5]]);
  const a1 = cfg(p, "a1", 20), a2 = cfg(p, "a2", 40), la1 = cfg(p, "lowA1", 19.5), la2 = cfg(p, "lowA2", 18);
  const lowPos = new Set(p.bound ? list(p.c.lowSeries).filter(Number.isFinite) : [5]);
  return (
    <div className="h-full w-full grid gap-1.5 p-1.5 overflow-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gridAutoRows: "minmax(58px, 1fr)" }}>
      {items.map((it, i) => {
        const low = lowPos.has(i + 1);
        const st: 0 | 1 | 2 = !Number.isFinite(it.v) ? 0 : low ? (it.v <= la2 ? 2 : it.v <= la1 ? 1 : 0) : (it.v >= a2 ? 2 : it.v >= a1 ? 1 : 0);
        return <Tile key={it.key} title={it.label} value={<>{f(it.v, low ? 1 : 0)} <small className="text-[10px] text-muted-foreground">{p.meta[it.key]?.unit ?? ""}</small></>}
          state={st} note={!Number.isFinite(it.v) ? "No reading" : st === 2 ? "A2 ALARM" : st === 1 ? "A1 WARNING" : "Healthy"} />;
      })}
    </div>
  );
}

// ── Flow Balance ──────────────────────────────────────────────────────────────
export function FlowBalance(p: ProProps) {
  const items = useItems(p, [["Main meter", 1088], ["Dyeing", 362], ["Boiler house", 255], ["Utilities", 218], ["Finishing", 170]]);
  const main = items[0]?.v ?? NaN, subs = items.slice(1);
  const sum = subs.reduce((s, x) => s + fin(x.v), 0), un = main - sum, pct = (un / main) * 100;
  const warn = cfg(p, "warn", 5), bad = cfg(p, "bad", 10), unit = p.meta.s0?.unit ?? (p.bound ? "" : "m³/d");
  const cols = [COL.primary, VIOLET, CYAN, COL.neutral, "#eab308", "#f472b6"];
  const sc = (W - 20) / Math.max(fin(main) * 1.02, sum * 1.02, 1);
  let x = 10;
  return (
    <Svg>
      <Row x0={10} x1={W - 10} y={18} label={items[0]?.label ?? "Main meter"} value={`${f(main, 0)} ${unit}`} />
      <rect x={10} y={24} width={fin(main) * sc} height={14} fill={COL.neutral} className="pro-ease" />
      <Row x0={10} x1={W - 10} y={58} label="Sum of sub-meters" value={`${f(sum, 0)} ${unit}`} />
      {subs.map((s, i) => { const w = fin(s.v) * sc; const el = <rect key={s.key} x={x} y={64} width={Math.max(0, w - 1)} height={14} fill={cols[i % cols.length]} />; x += w; return el; })}
      {un > 0 && <rect x={x} y={64} width={un * sc} height={14} fill={COL.bad} fillOpacity={0.3} stroke={COL.bad} strokeDasharray="3 2" />}
      {subs.slice(0, 6).map((s, i) => (
        <g key={s.key}>
          <rect x={10 + (i % 2) * 140} y={92 + Math.floor(i / 2) * 16} width={8} height={8} fill={cols[i % cols.length]} />
          <Txt x={22 + (i % 2) * 140} y={100 + Math.floor(i / 2) * 16} s={9.5}>{s.label.slice(0, 14)} {f(s.v, 0)}</Txt>
        </g>
      ))}
      <Txt x={10} y={H - 8} s={11} w={600} c={lvl(pct, warn, bad)}>Unaccounted {f(un, 0)} {unit} · {f(pct, 1)}%</Txt>
    </Svg>
  );
}

// ── Permissives & First-Out ───────────────────────────────────────────────────
export function Permissives(p: ProProps) {
  const items = useItems(p, [["Drum level normal", 1], ["FD fan running", 0], ["ID fan running", 1], ["Furnace purge done", 1], ["Fuel pressure OK", 1], ["Flame scanner healthy", 0]]);
  let first: string | null = p.bound ? null : "s1";
  if (p.bound && items.some((i) => i.v === 0)) {
    let lastOk = -1;
    p.rows.forEach((r, idx) => { if (items.every((it) => r[it.key] == null || Number(r[it.key]) > 0)) lastOk = idx; });
    let best = Infinity;
    for (const it of items) {
      if (it.v !== 0) continue;
      const idx = p.rows.findIndex((r, j) => j > lastOk && r[it.key] != null && Number(r[it.key]) <= 0);
      if (idx >= 0 && idx < best) { best = idx; first = it.key; }
    }
  }
  const ready = items.every((i) => i.v > 0), firstItem = items.find((i) => i.key === first);
  return (
    <div className="h-full w-full flex flex-col gap-1 p-2 text-[11px] overflow-auto">
      {items.map((it) => { const ok = it.v > 0, known = Number.isFinite(it.v); const c = !known ? COL.neutral : ok ? COL.ok : COL.bad; return (
        <div key={it.key} className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
          <span className="truncate" style={{ color: known && !ok ? COL.bad : undefined }}>{it.label}</span>
          {first === it.key && <span className="ml-auto text-[9.5px] font-bold shrink-0" style={{ color: COL.bad }}>FIRST OUT</span>}
        </div>); })}
      <div className="mt-auto px-2 py-1 rounded-md text-[11px] font-bold" style={{ color: ready ? COL.ok : COL.bad, background: `color-mix(in srgb, ${ready ? COL.ok : COL.bad} 15%, transparent)` }}>
        {ready ? "All permissives healthy" : `NOT READY${firstItem ? ` · first out: ${firstItem.label}` : ""}`}
      </div>
    </div>
  );
}

// ── Compressor Surge Map ──────────────────────────────────────────────────────
export function SurgeMap(p: ProProps) {
  const [q, pr, rv] = useRoles(p, [55, 2.1, 0]);
  const pts = String(p.c.surgeLine || "20:1.3, 60:2.6").split(",").map((s) => s.split(":").map((x) => Number(x.trim())));
  const [[q1, p1] = [20, 1.3], [q2, p2] = [60, 2.6]] = pts;
  const m = cfg(p, "margin", 10) / 100, maxQ = cfg(p, "maxFlow", 100), maxR = cfg(p, "maxRatio", 3);
  const qs = (r: number) => q1 + ((r - p1) * (q2 - q1)) / (p2 - p1 || 1);
  const margin = ((q - qs(pr)) / qs(pr)) * 100;
  const x0 = 26, x1 = W - 10, y0 = 26, y1 = H - 24, sx = (v: number) => x0 + (clamp(v, 0, maxQ) / maxQ) * (x1 - x0), sy = (v: number) => y1 - (clamp(v, 0, maxR) / maxR) * (y1 - y0);
  const trail: [number, number][] = p.bound
    ? thin(p.rows.filter((r) => r.s0 != null && r.s1 != null).map((r) => [Number(r.s0), Number(r.s1)] as [number, number]), 40)
    : Array.from({ length: 25 }, (_, i) => [55 + Math.sin(i / 3) * 8, 2.1 + Math.cos(i / 3) * 0.1] as [number, number]);
  const c = !Number.isFinite(margin) ? COL.neutral : margin < m * 50 ? COL.bad : margin < m * 100 ? COL.warn : COL.ok;
  const rLo = 0, rHi = maxR;
  return (
    <Svg>
      <path d={`M${x0},${sy(rLo)} L${sx(qs(rLo))},${sy(rLo)} L${sx(qs(rHi))},${sy(rHi)} L${x0},${sy(rHi)} Z`} fill={COL.bad} fillOpacity={0.1} />
      <Txt x={x0 + 4} y={y0 + 12} s={9} w={600} c={COL.bad}>surge</Txt>
      <path d={`M${x0},${y0} L${x0},${y1} L${x1},${y1}`} stroke={COL.border} fill="none" />
      <line x1={sx(qs(rLo))} y1={sy(rLo)} x2={sx(qs(rHi))} y2={sy(rHi)} stroke={COL.bad} strokeWidth={2} />
      <line x1={sx(qs(rLo) * (1 + m))} y1={sy(rLo)} x2={sx(qs(rHi) * (1 + m))} y2={sy(rHi)} stroke={COL.warn} strokeDasharray="4 3" />
      {trail.map(([a, b], i) => <circle key={i} cx={sx(a)} cy={sy(b)} r={2} fill={COL.primary} fillOpacity={(i / trail.length) * 0.6} />)}
      {Number.isFinite(q) && Number.isFinite(pr) && <circle cx={sx(q)} cy={sy(pr)} r={6} fill={c} className="pro-ease" />}
      <Txt x={10} y={16} s={11} w={600} c={c}>Surge margin {f(margin, 1)}%</Txt>
      <Txt x={W - 10} y={16} s={10.5} w={600} c={fin(rv) > 1 ? COL.warn : COL.muted} a="end">Recycle valve {f(rv, 0)}%</Txt>
      <Txt x={x1} y={y1 + 12} s={9} a="end">flow →</Txt>
      <Txt x={x0 + 4} y={y1 + 12} s={9}>pressure ratio ↑ · red surge line · amber control line</Txt>
    </Svg>
  );
}

// ── Pump Performance Curve ────────────────────────────────────────────────────
export function PumpCurve(p: ProProps) {
  const [q, head0, kw] = useRoles(p, [97, 37.2, 13.5]);
  const head = p.c.headUnit === "bar" ? head0 * 10.2 : head0;
  const Qb = cfg(p, "bepFlow", 108), Hb = cfg(p, "bepHead", 40), H0 = cfg(p, "shutoff", 60);
  const Hq = (x: number) => H0 - (H0 - Hb) * (x / Qb) ** 2;
  const qMax = Qb * 1.5, hMax = H0 * 1.1, bep = q / Qb, eta = (q * head) / (367 * kw);
  const x0 = 14, x1 = W - 10, y0 = 26, y1 = H - 22, sx = (v: number) => x0 + (clamp(v, 0, qMax) / qMax) * (x1 - x0), sy = (v: number) => y1 - (clamp(v, 0, hMax) / hMax) * (y1 - y0);
  const curve = Array.from({ length: 41 }, (_, i) => (i / 40) * qMax).filter((x) => Hq(x) >= 0).map((x, i) => `${i ? "L" : "M"}${sx(x)},${sy(Hq(x))}`).join(" ");
  const c = !Number.isFinite(bep) ? COL.neutral : bep >= 0.7 && bep <= 1.2 ? COL.ok : COL.warn;
  return (
    <Svg>
      <rect x={sx(Qb * 0.7)} y={y0} width={sx(Qb * 1.2) - sx(Qb * 0.7)} height={y1 - y0} fill={COL.ok} fillOpacity={0.08} />
      <Txt x={sx(Qb * 0.7) + 3} y={y1 - 4} s={8.5} c={COL.ok}>preferred 70–120% BEP</Txt>
      <path d={`M${x0},${y0} L${x0},${y1} L${x1},${y1}`} stroke={COL.border} fill="none" />
      <path d={curve} stroke={COL.primary} strokeWidth={2} fill="none" />
      <path d={`M${sx(Qb)},${sy(Hb) - 6} l5,6 l-5,6 l-5,-6 Z`} fill={COL.fg} />
      <Txt x={sx(Qb) + 7} y={sy(Hb) - 6} s={9} c={COL.fg}>BEP</Txt>
      {Number.isFinite(q) && Number.isFinite(head) && <circle cx={sx(q)} cy={sy(head)} r={6} fill={c} className="pro-ease" />}
      <Txt x={10} y={15} s={10.5} w={600} c={COL.fg}>{f(q, 0)} m³/h · {f(head, 1)} m{Number.isFinite(eta) ? ` · η ${f(eta * 100, 0)}%` : ""}</Txt>
      <Txt x={W - 10} y={15} s={10.5} w={600} c={c} a="end">{f(bep * 100, 0)}% BEP</Txt>
      <Txt x={10} y={H - 6} s={9}>Curve from the datasheet points set in Edit Widget</Txt>
    </Svg>
  );
}

// ── Distillation Column ───────────────────────────────────────────────────────
export function DistColumn(p: ProProps) {
  const [dp, reflux, dist] = useRoles(p, [0.19, 24, 10]);
  const flood = cfg(p, "flood", 0.3);
  const trays = p.bound
    ? p.keys.filter((k) => Number(k.slice(1)) >= 3).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((k) => { const v = valuesOf(p.rows, k); return v.length ? v[v.length - 1].v : NaN; })
    : Array.from({ length: 10 }, (_, i) => 78 + 34 / (1 + Math.exp(-(i - 5) / 1.4)));
  const rr = reflux / dist, isFlood = dp >= flood, cx = 44, cw = 36, cy0 = 22, cy1 = H - 14;
  const fv = trays.filter(Number.isFinite), lo = fv.length ? Math.min(...fv) - 3 : 0, hi = fv.length ? Math.max(...fv) + 3 : 1;
  const x0 = 106, x1 = W - 12, y0 = 54, y1 = H - 18, tx = (v: number) => x0 + ((v - lo) / (hi - lo || 1)) * (x1 - x0), ty = (i: number) => y0 + (i / Math.max(1, trays.length - 1)) * (y1 - y0);
  const ok = trays.map((v, i) => [v, i] as [number, number]).filter(([v]) => Number.isFinite(v));
  return (
    <Svg>
      <rect x={cx - cw / 2} y={cy0} width={cw} height={cy1 - cy0} rx={16} fill={COL.card} stroke={isFlood ? COL.warn : COL.border} strokeWidth={1.5} />
      {Array.from({ length: 11 }, (_, i) => { const yy = cy0 + 10 + (i * (cy1 - cy0 - 20)) / 10; return <line key={i} x1={i % 2 ? cx - cw / 2 : cx - cw / 2 + 8} x2={i % 2 ? cx + cw / 2 - 8 : cx + cw / 2} y1={yy} y2={yy} stroke={COL.border} />; })}
      <line x1={cx} y1={cy1 - 8} x2={cx} y2={cy0 + 8} stroke={CYAN} strokeOpacity={0.6} strokeWidth={3} strokeDasharray="2 10" className="pro-dash" />
      <Txt x={cx + cw / 2 + 3} y={cy0 + (cy1 - cy0) * 0.55} s={8.5}>← feed</Txt>
      <Txt x={x0} y={16} s={10.5} w={600} c={isFlood ? COL.warn : COL.fg}>Column ΔP {f(dp, 2)} bar</Txt>
      <Txt x={x0} y={31} s={9.5} c={isFlood ? COL.warn : COL.muted}>{isFlood ? "rising ΔP: flooding risk" : `Reflux ratio ${f(rr, 1)}`}</Txt>
      <Txt x={x0} y={45} s={9}>tray temperature, top to bottom</Txt>
      <line x1={x0} y1={y0} x2={x0} y2={y1} stroke={COL.border} />
      {ok.length > 1 && <path d={ok.map(([v, i], j) => `${j ? "L" : "M"}${tx(v)},${ty(i)}`).join(" ")} stroke={COL.warn} strokeWidth={1.6} fill="none" />}
      {ok.map(([v, i]) => <circle key={i} cx={tx(v)} cy={ty(i)} r={2.2} fill={COL.warn} />)}
      {ok.length > 0 && <Txt x={tx(ok[0][0]) + 6} y={ty(ok[0][1]) + 3} s={9} c={COL.fg}>top {f(ok[0][0], 1)}°</Txt>}
      {ok.length > 1 && <Txt x={tx(ok[ok.length - 1][0]) - 6} y={ty(ok[ok.length - 1][1]) + 3} s={9} c={COL.fg} a="end">bottom {f(ok[ok.length - 1][0], 1)}°</Txt>}
      {!ok.length && <Txt x={(x0 + x1) / 2} y={(y0 + y1) / 2} s={9} a="middle">Add tray temperatures from input 4</Txt>}
    </Svg>
  );
}

// ── Pipeline Pressure Profile ─────────────────────────────────────────────────
export function Pipeline(p: ProProps) {
  const [fin_, fout] = useRoles(p, [817, 815]);
  const stations = p.bound
    ? p.keys.filter((k) => Number(k.slice(1)) >= 2).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((k) => { const v = valuesOf(p.rows, k); return v.length ? v[v.length - 1].v : NaN; })
    : [62, 51.8, 40.2, 28, 19];
  const kmIn = p.bound ? list(p.c.km) : [0, 38, 81, 126, 160], km = stations.map((_, i) => (Number.isFinite(kmIn[i]) ? kmIn[i] : i));
  const imb = ((fin_ - fout) / fin_) * 100, alarm = imb >= cfg(p, "imbalance", 2);
  const fv = stations.filter(Number.isFinite), lo = fv.length ? Math.min(...fv) * 0.8 : 0, hi = fv.length ? Math.max(...fv) * 1.1 : 1;
  const kmMax = Math.max(...km, 1), x0 = 18, x1 = W - 18, y0 = 40, y1 = H - 56, sx = (k: number) => x0 + (k / kmMax) * (x1 - x0), sy = (v: number) => y1 - ((v - lo) / (hi - lo || 1)) * (y1 - y0);
  // Where the drop departs most from the straight expected line: the likely leak section.
  const first = stations[0], last = stations[stations.length - 1];
  const exp = (k: number) => first + ((last - first) * k) / kmMax;
  let worst = -1, worstDev = 0;
  stations.forEach((v, i) => { const d = exp(km[i]) - v; if (i > 0 && d > worstDev) { worstDev = d; worst = i; } });
  const ok = stations.map((v, i) => [v, i] as [number, number]).filter(([v]) => Number.isFinite(v));
  const nameOf = (i: number) => String.fromCharCode(65 + i);
  return (
    <Svg>
      <rect x={x0} y={y1 + 4} width={x1 - x0} height={4} fill={COL.neutral} />
      {alarm && worst > 0 && <rect x={sx(km[worst - 1])} y={y1 + 4} width={sx(km[worst]) - sx(km[worst - 1])} height={4} fill={COL.bad} />}
      {Number.isFinite(first) && Number.isFinite(last) && <line x1={sx(0)} y1={sy(first)} x2={sx(kmMax)} y2={sy(last)} stroke={COL.muted} strokeDasharray="4 3" />}
      {ok.length > 1 && <path d={ok.map(([v, i], j) => `${j ? "L" : "M"}${sx(km[i])},${sy(v)}`).join(" ")} stroke={COL.primary} strokeWidth={2} fill="none" />}
      {stations.map((v, i) => (
        <g key={i}>
          {Number.isFinite(v) && <circle cx={sx(km[i])} cy={sy(v)} r={3.5} fill={COL.primary} />}
          {Number.isFinite(v) && <Txt x={sx(km[i])} y={sy(v) - 7} s={9} c={COL.fg} a="middle">{f(v, 0)}</Txt>}
          <Txt x={sx(km[i])} y={y1 + 20} s={9.5} w={600} c={COL.fg} a="middle">{nameOf(i)}</Txt>
          <Txt x={sx(km[i])} y={y1 + 31} s={8.5} a="middle">{km[i]} km</Txt>
        </g>
      ))}
      <Txt x={10} y={15} s={10.5} w={600} c={COL.fg}>In {f(fin_, 0)} · out {f(fout, 0)} {unitOf(p, 0, "")}</Txt>
      <Txt x={W - 10} y={15} s={10.5} w={600} c={!Number.isFinite(imb) ? COL.muted : alarm ? COL.bad : COL.ok} a="end">Imbalance {f(imb, 1)}%</Txt>
      <Txt x={10} y={29} s={9}>{unitOf(p, 2, "bar")} · dashed = expected gradient</Txt>
      <Txt x={10} y={H - 4} s={9.5} w={alarm ? 600 : undefined} c={alarm ? COL.bad : COL.muted}>
        {alarm && worst > 0 ? `Flow lost and pressure low after ${nameOf(worst - 1)}: check ${nameOf(worst - 1)}–${nameOf(worst)}` : "Pressures follow the expected gradient"}
      </Txt>
    </Svg>
  );
}

// ── Turbine Generator ─────────────────────────────────────────────────────────
export function TurbineGen(p: ProProps) {
  const [mw, hz, ex, ...vib] = useRoles(p, [18.4, 49.98, 520, 32, 41, 28, 36]);
  const rated = cfg(p, "rated", 25), va = cfg(p, "vibAlarm", 75), vt = cfg(p, "vibTrip", 100), exW = cfg(p, "exWarn", 545);
  const tmw = useTween(Number.isFinite(mw) ? mw : null), sync = Number.isFinite(hz) && Math.abs(hz - 50) < 0.5 && fin(mw) > 0;
  const bw = (W - 20) / 4, top = 88, bot = H - 20, vmax = vt * 1.2, y = (v: number) => bot - (clamp(v, 0, vmax) / vmax) * (bot - top);
  return (
    <Svg>
      <Pill x={10} y={8} text={sync ? "SYNCHRONISED" : Number.isFinite(mw) ? "NOT SYNCHRONISED" : "STATE ?"} c={sync ? COL.ok : COL.neutral} />
      <Txt x={W - 10} y={21} s={11} w={600} c={COL.fg} a="end">{f(hz, 2)} Hz</Txt>
      <Txt x={10} y={52} s={22} w={700} c={COL.fg}>{f(tmw ?? NaN, 1)} MW</Txt>
      <Txt x={10} y={66} s={9.5}>of {rated} MW · {f((mw / rated) * 100, 0)}% load</Txt>
      <Txt x={W - 10} y={40} s={9.5} a="end">Exhaust</Txt>
      <Txt x={W - 10} y={57} s={14} w={700} c={lvl(ex, exW, exW + 15)} a="end">{f(ex, 0)} °C</Txt>
      <Txt x={10} y={82} s={9}>Shaft vibration, µm</Txt>
      {vib.map((v, i) => { const x = 10 + i * bw + 8, w = bw - 16; return (
        <g key={i}>
          <rect x={x} y={top} width={w} height={bot - top} fill={COL.track} />
          {Number.isFinite(v) && <rect x={x} y={y(v)} width={w} height={bot - y(v)} fill={lvl(v, va, vt)} fillOpacity={0.75} className="pro-ease" />}
          <Txt x={x + w / 2} y={bot + 12} s={9} a="middle">B{i + 1} {f(v, 0)}</Txt>
        </g>); })}
      <line x1={10} x2={W - 10} y1={y(va)} y2={y(va)} stroke={COL.warn} strokeDasharray="3 3" />
      <line x1={10} x2={W - 10} y1={y(vt)} y2={y(vt)} stroke={COL.bad} strokeDasharray="3 3" />
    </Svg>
  );
}

// ── Flare Monitor ─────────────────────────────────────────────────────────────
export function Flare(p: ProProps) {
  const [flow, steam, ...pil] = useRoles(p, [1.4, 0.45, 612, 598, 640]);
  const lost = cfg(p, "pilotLost", 200), smin = cfg(p, "steamMin", 0.25), maxF = cfg(p, "maxFlow", 6);
  const ratio = steam / flow, fl = 10 + clamp(fin(flow) / maxF, 0, 1) * 46, sx = 48, top = 66, bot = H - 12;
  const lowSteam = Number.isFinite(ratio) && ratio < smin, out = pil.findIndex((v) => Number.isFinite(v) && v < lost);
  return (
    <Svg>
      <rect x={sx - 4} y={top} width={8} height={bot - top} fill={COL.neutral} />
      <rect x={sx - 16} y={bot - 4} width={32} height={4} fill={COL.neutral} />
      <rect x={sx - 8} y={top - 3} width={16} height={4} fill={COL.neutral} />
      {fin(flow) > 0 && [0, 1, 2, 3].map((i) => { const hh = fl * (1 - i * 0.2), ww = Math.max(3, hh * 0.32); return (
        <path key={i} d={`M${sx - ww},${top - 3} Q${sx - ww * 1.1},${top - 3 - hh * 0.55} ${sx},${top - 3 - hh} Q${sx + ww * 1.1},${top - 3 - hh * 0.55} ${sx + ww},${top - 3} Z`}
          fill={["#ef4444", "#f59e0b", "#facc15", "#fff7d2"][i]} fillOpacity={0.55 + i * 0.1} className={i === 3 ? "pro-pulse" : undefined} />); })}
      {lowSteam && fin(flow) > 0 && <circle cx={sx + 14} cy={top - fl - 8} r={8} fill={COL.neutral} fillOpacity={0.5} className="pro-pulse" />}
      <Row x0={104} x1={W - 10} y={20} label="Flare flow" value={`${f(flow, 1)} ${unitOf(p, 0, "t/h")}`} />
      <Row x0={104} x1={W - 10} y={42} label="Steam / gas" value={f(ratio, 2)} c={lowSteam ? COL.warn : undefined} />
      {lowSteam && <Txt x={104} y={56} s={9} c={COL.warn}>low steam: smoke risk</Txt>}
      <Txt x={104} y={80}>Pilots</Txt>
      {pil.map((v, i) => { const ok = Number.isFinite(v) ? v >= lost : null, c = ok == null ? COL.neutral : ok ? COL.ok : COL.bad; return (
        <g key={i}>
          <circle cx={109} cy={94 + i * 17} r={4} fill={c} />
          <Txt x={118} y={98 + i * 17} c={ok === false ? COL.bad : COL.fg}>Pilot {i + 1}</Txt>
          <Txt x={W - 10} y={98 + i * 17} w={600} c={ok === false ? COL.bad : COL.fg} a="end">{f(v, 0)} °C</Txt>
        </g>); })}
      {out >= 0 && <Txt x={104} y={H - 4} w={700} c={COL.bad}>PILOT {out + 1} OUT</Txt>}
    </Svg>
  );
}

// ── Dust Collector ────────────────────────────────────────────────────────────
export function DustCollector(p: ProProps) {
  const [dp, dust, cleaning] = useRoles(p, [128, 21, 0]);
  const cleanAt = cfg(p, "cleanAt", 150), bad = cfg(p, "dpBad", 180), lim = cfg(p, "dustLimit", 50);
  const hist = p.bound ? roleSeries(p, 0, 0, 0) : Array.from({ length: 80 }, (_, i) => 110 + ((i * 1.2) % 42));
  const isCleaning = Number.isFinite(cleaning) ? cleaning > 0 : null;
  return (
    <Svg>
      <Txt x={10} y={18} s={15} w={700} c={lvl(dp, cleanAt + (bad - cleanAt) / 2, bad)}>ΔP {f(dp, 0)} {unitOf(p, 0, "mmWC")}</Txt>
      <Txt x={W - 10} y={18} s={10} w={600} c={isCleaning ? CYAN : COL.muted} a="end">{isCleaning ? "CLEANING" : `Cleaning at ${cleanAt}`}</Txt>
      <Trend vals={hist} x0={10} y0={30} x1={W - 10} y1={H - 52} lines={[[cleanAt, CYAN, true], [bad, COL.bad, true]]} />
      <Txt x={10} y={H - 34} s={9}>Pulse valves</Txt>
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={10 + i * ((W - 20) / 8) + 2} y={H - 30} width={(W - 20) / 8 - 4} height={9} rx={3} fill={isCleaning ? CYAN : COL.track}
          className={isCleaning ? "pro-pulse" : undefined} style={isCleaning ? { animationDelay: `${i * 0.15}s` } : undefined} />
      ))}
      <Txt x={10} y={H - 6} s={10} w={600} c={lvl(dust, lim * 0.8, lim)}>Stack dust {f(dust, 0)} mg/Nm³ · limit {lim}</Txt>
    </Svg>
  );
}
