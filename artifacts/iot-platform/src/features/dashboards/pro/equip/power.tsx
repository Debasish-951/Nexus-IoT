/**
 * Power & Facility: PUE, racks, UPS, generators, transformers, single-line
 * diagram, motors, maintenance, solar, batteries, PDUs and the leak/fire panel.
 */
import { type ProProps, COL, clamp, mean, useTween } from "../common";
import {
  W, H, CYAN, VIOLET, Svg, Txt, Kpis, Row, Flow, Pill, Bar, Ring, Trend, Tile, f, fin, lvl, lvlLow, cfg, list,
  useRoles, roleSeries, ratioSeries, unitOf, useItems,
} from "./kit";

// ── PUE ───────────────────────────────────────────────────────────────────────
export function Pue(p: ProProps) {
  const [tot, it, cool] = useRoles(p, [1214, 816, 316]);
  const target = cfg(p, "target", 1.5), pue = tot / it, tv = useTween(Number.isFinite(pue) ? pue : null);
  const c = !Number.isFinite(pue) ? COL.neutral : pue <= target ? COL.ok : pue <= target + 0.3 ? COL.warn : COL.bad;
  const other = tot - it - fin(cool), parts: [string, number, string][] = [["IT", it, COL.primary], ["Cooling", cool, CYAN], ["Other", other, COL.neutral]];
  const hist = ratioSeries(p, 0, 1, 1.48, 0.04);
  let x = 10;
  return (
    <Svg>
      <Txt x={10} y={18}>PUE</Txt>
      <Txt x={10} y={48} s={28} w={700} c={c}>{f(tv ?? NaN, 2)}</Txt>
      <Txt x={W - 10} y={28} s={10.5} w={600} c={COL.fg} a="end">{f(tot, 0)} kW facility</Txt>
      <Txt x={W - 10} y={43} a="end">{f(it, 0)} kW IT</Txt>
      {parts.map(([l, v, col]) => { const w = (fin(v) / fin(tot, 1)) * (W - 20); const el = <rect key={l} x={x} y={62} width={Math.max(0, w - 1)} height={14} fill={col} className="pro-ease" />; x += w; return el; })}
      {parts.map(([l, v, col], i) => <Txt key={l} x={10 + i * ((W - 20) / 3)} y={92} w={600} c={col}>{l} {f((v / tot) * 100, 0)}%</Txt>)}
      <Trend vals={hist} x0={10} y0={102} x1={W - 10} y1={H - 22} lines={[[target, COL.ok, true]]} />
      <Txt x={10} y={H - 6} s={9}>Over the time range · target {target} · each 0.1 above ≈ {f(it * 0.1, 0)} kW</Txt>
    </Svg>
  );
}

// ── Rack Inlet Heatmap ────────────────────────────────────────────────────────
export function RackHeat(p: ProProps) {
  const sampleTemps: [string, number][] = Array.from({ length: 40 }, (_, i) => [`${"ABCD"[Math.floor(i / 10)]}${(i % 10) + 1}`, 21 + 6 * Math.exp(-((Math.floor(i / 10) - 2) ** 2 + ((i % 10) - 6) ** 2) / 3)]);
  const items = useItems(p, sampleTemps);
  const cols = Math.max(1, Math.round(cfg(p, "cols", 10))), lo = cfg(p, "lo", 18), hi = cfg(p, "hi", 27);
  const color = (t: number) => (!Number.isFinite(t) ? "hsl(var(--muted))" : t < lo ? "#38bdf8" : t <= hi - 3 ? `rgba(34,197,94,${0.3 + ((t - lo) / (hi - lo)) * 0.4})` : t <= hi ? "rgba(245,158,11,.7)" : "rgba(239,68,68,.85)");
  const vals = items.map((i) => i.v).filter(Number.isFinite), mx = vals.length ? Math.max(...vals) : NaN;
  return (
    <div className="h-full w-full flex flex-col gap-1.5 p-2">
      <div className="flex-1 grid gap-[3px] min-h-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridAutoRows: "minmax(10px, 1fr)" }}>
        {items.map((it) => <div key={it.key} className="rounded-sm pro-ease" style={{ background: color(it.v) }} title={`${it.label}: ${f(it.v, 1)} °C inlet`} />)}
      </div>
      <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
        <span>Max <b style={{ color: lvl(mx, hi - 3, hi) }}>{f(mx, 1)} °C</b></span>
        <span>{vals.filter((v) => v > hi).length} above {hi} °C</span>
        <span>Recommended {lo}–{hi} °C</span>
      </div>
    </div>
  );
}

// ── UPS Status ────────────────────────────────────────────────────────────────
export function Ups(p: ProProps) {
  const [mode, load, batt, rt] = useRoles(p, [0, 58, 100, 38]);
  const onBatt = mode === 1, bypass = mode === 2, names = ["Mains", "Rectifier", "Inverter", "Load"];
  const gap = 14, bw = (W - 20 - 3 * gap) / 4, y = 46, bh = 30, bx = (i: number) => 10 + i * (bw + gap);
  const mx = (bx(1) + bw + bx(2)) / 2, by = y + bh + 24;
  const label = !Number.isFinite(mode) ? "MODE ?" : onBatt ? "ON BATTERY" : bypass ? "BYPASS" : "ONLINE", lc = onBatt ? COL.warn : bypass ? COL.warn : Number.isFinite(mode) ? COL.ok : COL.neutral;
  return (
    <Svg>
      {[0, 1, 2].map((i) => { const dead = onBatt && i < 2; return <Flow key={i} x1={bx(i) + bw} y1={y + bh / 2} x2={bx(i + 1)} y2={y + bh / 2} c={dead ? COL.neutral : COL.ok} speed={dead ? 0 : 1} />; })}
      {names.map((n, i) => { const dead = onBatt && i < 2; return (
        <g key={n}>
          <rect x={bx(i)} y={y} width={bw} height={bh} rx={6} fill={COL.card} stroke={dead ? COL.bad : COL.border} />
          <Txt x={bx(i) + bw / 2} y={y + 19} s={9.5} w={600} c={dead ? COL.bad : COL.fg} a="middle">{n}</Txt>
        </g>); })}
      <Flow x1={mx} y1={onBatt ? by : y + bh / 2 + 4} x2={mx} y2={onBatt ? y + bh / 2 + 4 : by} c={onBatt ? COL.warn : COL.ok} speed={onBatt ? 1 : 0.4} />
      <rect x={mx - 38} y={by} width={76} height={28} rx={6} fill={COL.card} stroke={onBatt ? COL.warn : COL.border} />
      <Bar x={mx - 32} y={by + 19} w={64} h={4} frac={batt / 100} c={batt < 30 ? COL.bad : COL.ok} />
      <Txt x={mx} y={by + 13} s={9.5} w={600} c={COL.fg} a="middle">Battery {f(batt, 0)}%</Txt>
      <Pill x={10} y={10} text={label} c={lc} />
      <Txt x={W - 10} y={23} s={10.5} w={600} c={COL.fg} a="end">Load {f(load, 0)}% · {f(rt, 0)} min</Txt>
      <Txt x={10} y={H - 8} s={9.5} c={onBatt ? COL.warn : COL.muted}>{onBatt ? "Mains failed: load on battery" : bypass ? "On bypass: load not protected" : "Mains healthy: battery charging"}</Txt>
    </Svg>
  );
}

// ── DG Set ────────────────────────────────────────────────────────────────────
export function DgSet(p: ProProps) {
  const [run, kw, fuel, cool, batt, hrs, rpm] = useRoles(p, [0, 0, 64, 42, 25.2, 3412.4, 0]);
  const tank = cfg(p, "tank", 990), lph = cfg(p, "lph", 75), rated = cfg(p, "rated", 300);
  const running = Number.isFinite(run) ? run > 0 : null;
  const use = running && Number.isFinite(kw) ? Math.max(0.15, kw / rated) * lph : lph, left = ((fuel / 100) * tank) / use;
  const last = p.c.lastTest ? Math.floor((Date.now() - new Date(p.c.lastTest).getTime()) / 86_400_000) : p.bound ? NaN : 6;
  const fx = 14, fy = 42, fw = 34, fh = H - 76, fr = clamp(fin(fuel), 0, 100) / 100;
  return (
    <Svg>
      <Pill x={10} y={10} text={running == null ? "STATE ?" : running ? "RUNNING" : "STANDBY"} c={running ? COL.ok : COL.neutral} />
      <Txt x={W - 10} y={23} s={11} w={600} c={COL.fg} a="end">{f(rpm, 0)} rpm</Txt>
      <rect x={fx} y={fy} width={fw} height={fh} rx={4} fill={COL.card} stroke={COL.border} />
      <rect x={fx + 2} y={fy + fh * (1 - fr)} width={fw - 4} height={fh * fr} fill={fuel < 25 ? COL.bad : COL.warn} fillOpacity={0.7} className="pro-ease" />
      <Txt x={fx + fw / 2} y={fy + fh + 13} w={600} c={COL.fg} a="middle">{f(fuel, 0)}%</Txt>
      <Txt x={fx + fw / 2} y={fy + fh + 24} s={9} a="middle">fuel</Txt>
      {([["Load", `${f(kw, 0)} kW`], ["Fuel left", `${f(left, 1)} h${running ? "" : " at full load"}`], ["Coolant", `${f(cool, 0)} °C`, lvl(cool, 90, 98)],
        ["Battery", `${f(batt, 1)} V`, lvlLow(batt, 24, 23)], ["Run hours", `${f(hrs, 1)} h`], ["Last test run", Number.isFinite(last) ? `${last} days ago` : "set in Edit Widget", last > 14 ? COL.warn : undefined]] as [string, string, string?][]).map(([l, v, c], i) => (
        <Row key={l} x0={62} x1={W - 10} y={54 + i * 19} label={l} value={v} c={c} />
      ))}
    </Svg>
  );
}

// ── Transformer ───────────────────────────────────────────────────────────────
export function Transformer(p: ProProps) {
  const [oil, wdg, load, tap] = useRoles(p, [62, 76, 68, 5]);
  const oA = cfg(p, "oilA", 85), oT = cfg(p, "oilT", 95), wA = cfg(p, "wdgA", 100), wT = cfg(p, "wdgT", 110), kva = cfg(p, "kva", 1600), taps = cfg(p, "taps", 9);
  const thermo = (x: number, v: number, a: number, t: number, label: string) => {
    const top = 30, bot = H - 46, y = (q: number) => bot - ((clamp(q, 20, 140) - 20) / 120) * (bot - top), c = !Number.isFinite(v) ? COL.neutral : v >= t ? COL.bad : v >= a ? COL.warn : COL.ok;
    return (
      <g key={label}>
        <rect x={x - 6} y={top} width={12} height={bot - top} rx={6} fill={COL.track} />
        {Number.isFinite(v) && <rect x={x - 4} y={y(v)} width={8} height={bot - y(v)} rx={4} fill={c} className="pro-ease" />}
        <circle cx={x} cy={bot + 6} r={9} fill={c} />
        <rect x={x + 8} y={y(t) - 1} width={8} height={2} fill={COL.bad} /><Txt x={x + 19} y={y(t) - 1} s={9} c={COL.bad}>T {t}</Txt>
        <rect x={x + 8} y={y(a) - 1} width={8} height={2} fill={COL.warn} /><Txt x={x + 19} y={y(a) + 9} s={9} c={COL.warn}>A {a}</Txt>
        <Txt x={x} y={top - 6} s={12} w={700} c={c} a="middle">{f(v, 0)}°</Txt>
        <Txt x={x} y={bot + 28} s={9.5} a="middle">{label}</Txt>
      </g>
    );
  };
  return (
    <Svg>
      {thermo(24, oil, oA, oT, "Oil")}{thermo(92, wdg, wA, wT, "Winding")}
      <Ring cx={W - 60} cy={74} r={34} frac={load / 120} c={lvl(load, 90, 100)} label={`${f(load, 0)}%`} sub={`load of ${f(kva, 0)} kVA`} />
      <Txt x={W - 60} y={146} s={10.5} w={600} c={COL.fg} a="middle">Tap {f(tap, 0)} of {taps}</Txt>
    </Svg>
  );
}

// ── Single-Line Diagram ───────────────────────────────────────────────────────
export function Sld(p: ProProps) {
  const items = useItems(p, [["Incomer", 1], ["MCC-1", 210], ["Chiller", 340], ["UPS", 160], ["Lighting", 0]]);
  const inc = items[0], feeders = items.slice(1), statusMode = p.c.feederMode === "status";
  const incOn = Number.isFinite(inc?.v) ? inc.v > 0 : null, busY = 66;
  const xs = feeders.map((_, i) => (feeders.length === 1 ? W / 2 : 30 + (i * (W - 60)) / (feeders.length - 1)));
  const live = (on: boolean | null) => (on ? COL.ok : COL.neutral);
  const brk = (x: number, y: number, on: boolean | null) => (
    <rect x={x - 7} y={y - 7} width={14} height={14} fill={on ? COL.ok : "transparent"} fillOpacity={on ? 0.35 : 0} stroke={on == null ? COL.neutral : on ? COL.ok : COL.bad} strokeWidth={2} />
  );
  return (
    <Svg>
      <line x1={W / 2} y1={4} x2={W / 2} y2={25} stroke={COL.ok} strokeWidth={2} />
      {brk(W / 2, 32, incOn)}
      <line x1={W / 2} y1={39} x2={W / 2} y2={busY} stroke={live(incOn)} strokeWidth={2} />
      <Txt x={W / 2 + 12} y={22} s={9.5} w={600} c={COL.fg}>{inc?.label ?? "Incomer"}</Txt>
      <Txt x={W / 2 + 12} y={35} s={9} c={incOn == null ? COL.muted : incOn ? COL.ok : COL.bad}>{incOn == null ? "no signal" : incOn ? "closed" : "open"}</Txt>
      <rect x={14} y={busY - 2} width={W - 28} height={4} fill={live(incOn)} />
      <Txt x={14} y={busY - 7} s={9}>{(p.c.busLabel as string) || "Bus"}</Txt>
      {feeders.map((fd, i) => { const x = xs[i], on = Number.isFinite(fd.v) ? fd.v > 0 : null, en = !!incOn && !!on; return (
        <g key={fd.key}>
          <line x1={x} y1={busY} x2={x} y2={93} stroke={live(incOn)} strokeWidth={2} />
          {brk(x, 100, on)}
          <line x1={x} y1={107} x2={x} y2={128} stroke={live(en)} strokeWidth={2} />
          <path d={`M${x - 5},128 L${x + 5},128 L${x},135 Z`} fill={live(en)} />
          <Txt x={x} y={149} s={9.5} w={600} c={COL.fg} a="middle">{fd.label.slice(0, 10)}</Txt>
          <Txt x={x} y={161} s={9} c={on === false ? COL.bad : COL.muted} a="middle">{on == null ? "—" : !on ? "open" : statusMode ? "closed" : `${f(fd.v, 0)} kW`}</Txt>
        </g>); })}
    </Svg>
  );
}

// ── Motor Health ──────────────────────────────────────────────────────────────
export function MotorHealth(p: ProProps) {
  const [r, y, b, de, nde, starts] = useRoles(p, [38.3, 38.2, 34.1, 61, 57, 2]);
  const fla = cfg(p, "fla", 52), iW = cfg(p, "imbWarn", 5), iB = cfg(p, "imbBad", 10), bW = cfg(p, "brgWarn", 70);
  const ph: [string, number, string][] = [["R", r, COL.bad], ["Y", y, "#eab308"], ["B", b, COL.primary]];
  const vals = ph.map((x) => x[1]).filter(Number.isFinite), avg = vals.length ? mean(vals) : NaN;
  const imb = vals.length === 3 ? (Math.max(...vals.map((v) => Math.abs(v - avg))) / avg) * 100 : NaN;
  const x0 = 24, bw = W - x0 - 60, fx = x0 + bw / 1.2;
  return (
    <Svg>
      {ph.map(([n, v, c], i) => (
        <g key={n}>
          <Txt x={10} y={27 + i * 21} w={600} c={c}>{n}</Txt>
          <rect x={x0} y={18 + i * 21} width={bw} height={11} fill={COL.track} />
          <rect x={x0} y={18 + i * 21} width={bw * clamp(fin(v) / (fla * 1.2), 0, 1)} height={11} fill={c} fillOpacity={0.75} className="pro-ease" />
          <Txt x={W - 10} y={27 + i * 21} w={600} c={COL.fg} a="end">{f(v, 1)} A</Txt>
        </g>
      ))}
      <line x1={fx} x2={fx} y1={13} y2={78} stroke={COL.fg} strokeDasharray="2 2" />
      <Txt x={fx} y={90} s={9} a="middle">FLA {fla} A</Txt>
      <Kpis y={H - 46} items={[[`${f(imb, 1)}%`, "imbalance", lvl(imb, iW, iB)], [`${f((avg / fla) * 100, 0)}%`, "of full load", lvl(avg / fla, 0.9, 1.05)],
        [`${f(de, 0)}/${f(nde, 0)}°`, "DE/NDE", lvl(Math.max(fin(de), fin(nde)), bW, bW + 10)], [f(starts, 0), "starts/h", lvl(starts, 4, 6)]]} />
      <Txt x={10} y={H - 8} s={9.5} w={imb > iW ? 600 : undefined} c={imb > iW ? COL.warn : COL.muted}>{imb > iW ? "Phase imbalance: check supply and winding" : Number.isFinite(imb) ? "Phases balanced" : "Bind all three phase currents"}</Txt>
    </Svg>
  );
}

// ── Maintenance Due ───────────────────────────────────────────────────────────
export function MaintDue(p: ProProps) {
  const items = useItems(p, [["Compressor C-2", 3720], ["ID fan bearings", 1810], ["Chiller CH-1", 2240], ["Boiler B-1", 980], ["DG set", 210]]);
  const iv = p.bound ? list(p.c.intervals) : [4000, 2000, 4000, 2000, 500], at = p.bound ? list(p.c.atService) : [0, 0, 0, 0, 0];
  const rows = items.map((it, i) => { const used = it.v - fin(at[i]), int = iv[i]; return { ...it, used, int, frac: used / int }; })
    .sort((a, b) => fin(b.frac, -1) - fin(a.frac, -1));
  return (
    <div className="h-full w-full flex flex-col gap-1.5 p-2 text-[11px] overflow-auto">
      {rows.map((r) => { const c = !Number.isFinite(r.frac) ? COL.neutral : r.frac >= 1 ? COL.bad : r.frac >= 0.9 ? COL.warn : COL.ok; return (
        <div key={r.key} className="grid gap-x-2 gap-y-0.5" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
          <span className="truncate">{r.label}</span>
          <span className="tabular-nums text-[10px]" style={{ color: c }}>{!Number.isFinite(r.frac) ? "set interval" : r.frac >= 1 ? "OVERDUE" : `due in ${f(r.int - r.used, 0)} h`}</span>
          <div className="col-span-2 h-1.5 rounded bg-muted overflow-hidden"><div className="h-full pro-ease" style={{ width: `${clamp(fin(r.frac), 0, 1) * 100}%`, background: c }} /></div>
        </div>); })}
    </div>
  );
}

// ── Solar PV Plant ────────────────────────────────────────────────────────────
export function SolarPv(p: ProProps) {
  const [kw, irr, kwh, inv] = useRoles(p, [394, 846, 436, 4]);
  const kwp = cfg(p, "kwp", 500), invN = cfg(p, "inverters", 4), prW = cfg(p, "prWarn", 75);
  const exp = (kwp * irr) / 1000, pr = (kw / exp) * 100;
  const act = roleSeries(p, 0, 300, 120, 50), irrS = roleSeries(p, 1, 650, 250, 50).map((v) => (kwp * v) / 1000);
  const hi = Math.max(kwp * 1.05, ...act, ...irrS);
  return (
    <Svg>
      <Txt x={10} y={18} s={16} w={700} c={COL.fg}>{f(kw, 0)} kW</Txt>
      <Txt x={10} y={32} s={9.5} c={pr < prW ? COL.warn : COL.muted}>PR {f(clamp(pr, 0, 120), 0)}% · {f(irr, 0)} W/m²</Txt>
      <Txt x={W - 10} y={18} s={10.5} w={600} c={COL.fg} a="end">{f(kwh, 0)} kWh today</Txt>
      <Txt x={W - 10} y={32} s={9} a="end">dashed = expected from irradiance</Txt>
      <g strokeDasharray="4 3"><Trend vals={irrS} x0={10} y0={42} x1={W - 10} y1={H - 30} lo={0} hi={hi} c="#facc15" /></g>
      <Trend vals={act} x0={10} y0={42} x1={W - 10} y1={H - 30} lo={0} hi={hi} fill />
      <Txt x={10} y={H - 7} s={9}>Inverters</Txt>
      {Array.from({ length: Math.min(12, Math.max(1, invN)) }, (_, i) => { const ok = Number.isFinite(inv) ? i < inv : null; return (
        <rect key={i} x={56 + i * 20} y={H - 16} width={16} height={11} rx={3} fill={ok == null ? COL.neutral : ok ? COL.ok : COL.bad} />); })}
      <Txt x={W - 10} y={H - 7} s={9} a="end">{Number.isFinite(inv) ? `${f(inv, 0)} of ${invN} online` : "status not bound"}</Txt>
    </Svg>
  );
}

// ── Battery String Monitor ────────────────────────────────────────────────────
export function BatteryString(p: ProProps) {
  const items = useItems(p, Array.from({ length: 24 }, (_, i) => [`Cell ${i + 1}`, i === 16 ? 2.121 : 2.25 + Math.sin(i * 1.7) * 0.012] as [string, number]));
  const fl = cfg(p, "float", 2.25), low = cfg(p, "low", 2.15);
  const vals = items.map((i) => i.v), ok = vals.filter(Number.isFinite), min = ok.length ? Math.min(...ok) : NaN, mi = vals.indexOf(min);
  const lo = Math.min(low - 0.1, ...ok), hi = Math.max(fl + 0.08, ...ok), x0 = 10, x1 = W - 10, y0 = 40, y1 = H - 30, bw = (x1 - x0) / Math.max(1, items.length);
  const y = (v: number) => y1 - ((clamp(v, lo, hi) - lo) / (hi - lo || 1)) * (y1 - y0);
  return (
    <Svg>
      <Txt x={10} y={18} s={14} w={700} c={COL.fg}>{f(ok.reduce((a, b) => a + b, 0), 1)} V string</Txt>
      <Txt x={10} y={32} s={9}>{items.length} cells</Txt>
      {[[fl, COL.ok, `float ${fl}`], [low, COL.bad, `low ${low}`]].map(([v, c, t]) => (
        <g key={String(t)}><line x1={x0} x2={x1} y1={y(Number(v))} y2={y(Number(v))} stroke={String(c)} strokeOpacity={0.6} strokeDasharray="3 3" /><Txt x={x1} y={y(Number(v)) - 3} s={8.5} a="end">{t}</Txt></g>
      ))}
      {vals.map((v, i) => Number.isFinite(v) && (
        <rect key={i} x={x0 + i * bw + 1} y={y(v)} width={Math.max(1, bw - 2)} height={y1 - y(v)} fill={v < low ? COL.bad : v < low + 0.05 ? COL.warn : COL.primary} fillOpacity={i === mi ? 1 : 0.7} className="pro-ease">
          <title>{items[i].label}: {f(v, 3)} V</title>
        </rect>
      ))}
      <Txt x={10} y={H - 10} w={600} c={min < low ? COL.bad : min < low + 0.05 ? COL.warn : COL.muted}>Weakest: {items[mi]?.label ?? "—"} at {f(min, 3)} V</Txt>
      <Txt x={W - 10} y={H - 10} s={9.5} a="end">spread {f(ok.length ? (Math.max(...ok) - min) * 1000 : NaN, 0)} mV</Txt>
    </Svg>
  );
}

// ── Rack Power (PDU) ──────────────────────────────────────────────────────────
export function RackPdu(p: ProProps) {
  const items = useItems(p, Array.from({ length: 16 }, (_, i) => [`R0${Math.floor(i / 2) + 1} ${i % 2 ? "B" : "A"}`, [1.6, 1.5, 2.1, 2.0, 1.0, 0.9, 2.3, 2.2, 1.7, 1.6, 2.8, 2.7, 1.8, 1.9, 1.2, 1.1][i]] as [string, number]));
  const cap = cfg(p, "feedCap", 5), racks = Array.from({ length: Math.ceil(items.length / 2) }, (_, i) => ({ a: items[2 * i], b: items[2 * i + 1] }));
  const totals = racks.map((r) => fin(r.a?.v) + fin(r.b?.v)), hi = Math.max(cap * 1.3, ...totals);
  const x0 = 10, x1 = W - 10, y0 = 30, y1 = H - 36, bw = (x1 - x0) / Math.max(1, racks.length), y = (v: number) => y1 - (clamp(v, 0, hi) / hi) * (y1 - y0);
  const over = totals.filter((t) => t > cap).length;
  return (
    <Svg>
      <Txt x={10} y={16} s={9.5}>Rack power: blue A feed, purple B feed</Txt>
      <line x1={x0} x2={x1} y1={y(cap)} y2={y(cap)} stroke={COL.bad} strokeDasharray="4 3" />
      <Txt x={x1} y={y(cap) - 3} s={8.5} c={COL.bad} a="end">one feed {cap} kW</Txt>
      {racks.map((r, i) => { const a = fin(r.a?.v), t = totals[i], x = x0 + i * bw + Math.min(5, bw * 0.15), w = bw - 2 * Math.min(5, bw * 0.15); return (
        <g key={i}>
          <rect x={x} y={y(a)} width={w} height={y1 - y(a)} fill={COL.primary} className="pro-ease" />
          <rect x={x} y={y(t)} width={w} height={y(a) - y(t)} fill={VIOLET} className="pro-ease" />
          {t > cap && <rect x={x - 1} y={y(t) - 1} width={w + 2} height={y1 - y(t) + 2} fill="none" stroke={COL.bad} strokeWidth={2} />}
          <Txt x={x + w / 2} y={y1 + 11} s={8.5} a="middle">{(r.a?.label ?? `R${i + 1}`).split(" ")[0].slice(0, 6)}</Txt>
        </g>); })}
      <Txt x={10} y={H - 8} s={10} w={600} c={over ? COL.bad : COL.ok}>{over ? `${over} rack${over > 1 ? "s" : ""} would overload one feed if the other fails` : "Every rack can run on one feed"}</Txt>
    </Svg>
  );
}

// ── Leak & Fire Panel ─────────────────────────────────────────────────────────
export function LeakFire(p: ProProps) {
  const items = useItems(p, [["Leak · CRAH zone 1", 0], ["Leak · UPS room", 0], ["VESDA · Hall 1", 1], ["VESDA · Hall 2", 0], ["Suppression · Hall 1", 0], ["Fire panel", 0]]);
  return (
    <div className="h-full w-full grid gap-1.5 p-1.5 overflow-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gridAutoRows: "minmax(44px, 1fr)" }}>
      {items.map((it) => { const st = (!Number.isFinite(it.v) ? 0 : it.v >= 2 ? 2 : it.v >= 1 ? 1 : 0) as 0 | 1 | 2; return (
        <Tile key={it.key} title={it.label} value={!Number.isFinite(it.v) ? "No signal" : st === 2 ? "ALARM" : st === 1 ? "ALERT" : "Normal"} state={st} />); })}
    </div>
  );
}
