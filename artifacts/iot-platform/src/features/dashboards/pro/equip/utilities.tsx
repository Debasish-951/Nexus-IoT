/**
 * Utilities: chillers, cooling towers, compressors, draft fans, boilers,
 * refrigeration, dryers, hot-oil heaters and steam.
 */
import { useId } from "react";
import { type ProProps, COL, clamp, mean, valuesOf, useTween } from "../common";
import {
  W, H, CYAN, VIOLET, Svg, Txt, Kpis, Row, Flow, Pill, Bar, ArcGauge, Ring, Trend, f, fin, lvl, lvlLow, cfg,
  useRoles, roleSeries, ratioSeries, unitOf, useItems, thin,
} from "./kit";

// ── Chiller Plant ─────────────────────────────────────────────────────────────
export function Chiller(p: ProProps) {
  const [sup, ret, flow, kw, cin, cout] = useRoles(p, [6.8, 12.2, 180, 255, 30.2, 35.1]);
  const good = cfg(p, "good", 0.65), poor = cfg(p, "poor", 0.8);
  const tr = flow * (ret - sup) * 0.3307, eff = kw / tr;
  const bw = 86, bh = 64, bx = W / 2 - bw / 2, by = 24, yt = by + 16, yb = by + bh - 16;
  const sp = p.bound ? (Number.isFinite(flow) && flow > 0 ? 1 : 0) : 1;
  return (
    <Svg>
      <Flow x1={6} y1={yt} x2={bx} y2={yt} c={COL.warn} speed={sp} />
      <Flow x1={bx} y1={yb} x2={6} y2={yb} c={CYAN} speed={sp} />
      <Flow x1={W - 6} y1={yb} x2={bx + bw} y2={yb} c={COL.ok} speed={sp} />
      <Flow x1={bx + bw} y1={yt} x2={W - 6} y2={yt} c={COL.bad} speed={sp} />
      <rect x={bx} y={by} width={bw} height={bh} rx={8} fill={COL.card} stroke={COL.primary} strokeWidth={1.5} />
      <Txt x={W / 2} y={by + 28} s={11} w={600} c={COL.fg} a="middle">Chiller</Txt>
      <Txt x={W / 2} y={by + 44} s={10} a="middle">{f(kw, 0)} kW</Txt>
      <Txt x={8} y={yt - 8} c={COL.warn}>Return {f(ret, 1)}°</Txt>
      <Txt x={8} y={yb + 17} c={CYAN}>Supply {f(sup, 1)}°</Txt>
      <Txt x={W - 8} y={yt - 8} c={COL.bad} a="end">Cond out {f(cout, 1)}°</Txt>
      <Txt x={W - 8} y={yb + 17} c={COL.ok} a="end">Cond in {f(cin, 1)}°</Txt>
      <Txt x={8} y={by + bh / 2 + 3} s={9}>CHW loop</Txt>
      <Txt x={W - 8} y={by + bh / 2 + 3} s={9} a="end">to tower</Txt>
      <Kpis y={H - 26} items={[[`${f(tr, 0)} TR`, "cooling"], [f(eff, 2), "kW/TR", lvl(eff, good, poor)], [`${f(ret - sup, 1)} °C`, "CHW ΔT"]]} />
    </Svg>
  );
}

// ── Chiller Efficiency (kW/TR) ────────────────────────────────────────────────
export function KwTr(p: ProProps) {
  const [kw, trv, plant] = useRoles(p, [255, 400, 345]);
  const good = cfg(p, "good", 0.65), poor = cfg(p, "poor", 0.85);
  const v = kw / trv, pv = plant / trv;
  const tv = useTween(Number.isFinite(v) ? v : null);
  const hist = ratioSeries(p, 0, 1, 0.64, 0.05);
  const cx = 78, cy = H - 52, r = 58;
  return (
    <Svg>
      <ArcGauge cx={cx} cy={cy} r={r} min={0.4} max={1.2} v={tv ?? NaN} bands={[[0.4, good, COL.ok], [good, poor, COL.warn], [poor, 1.2, COL.bad]]} />
      <Txt x={cx} y={cy + 24} s={18} w={700} c={lvl(v, good, poor)} a="middle">{f(tv ?? NaN, 2)}</Txt>
      <Txt x={cx} y={cy + 38} s={9.5} a="middle">kW/TR · chiller</Txt>
      <Txt x={cx - r} y={cy + 14} s={9} a="middle">0.4</Txt>
      <Txt x={cx + r} y={cy + 14} s={9} a="middle">1.2</Txt>
      <Txt x={160} y={24}>COP</Txt>
      <Txt x={160} y={44} s={17} w={700} c={COL.fg}>{f(3.517 / v, 2)}</Txt>
      <Txt x={160} y={66}>Plant kW/TR</Txt>
      <Txt x={160} y={86} s={17} w={700} c={lvl(pv, poor, poor + 0.25)}>{f(pv, 2)}</Txt>
      <Txt x={160} y={99} s={9}>incl. pumps, tower</Txt>
      <Trend vals={hist} x0={160} y0={H - 52} x1={W - 8} y1={H - 16} />
      <Txt x={160} y={H - 4} s={9}>over the time range</Txt>
    </Svg>
  );
}

// ── Cooling Tower ─────────────────────────────────────────────────────────────
export function CoolingTower(p: ProProps) {
  const [hot, cold, wb, fan] = useRoles(p, [35, 30.5, 27, 1]);
  const apWarn = cfg(p, "apWarn", 4), apBad = cfg(p, "apBad", 5.5);
  const range = hot - cold, appr = cold - wb, eff = range / (range + appr);
  const running = Number.isFinite(fan) ? fan > 0 : null;
  const tx = 16, ty = 34, tw = 88, th = H - 62, fx = tx + tw / 2, fy = ty - 10;
  return (
    <Svg>
      <path d={`M${tx + 12},${ty} L${tx + tw - 12},${ty} L${tx + tw},${ty + th} L${tx},${ty + th} Z`} fill={COL.track} stroke={COL.border} />
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={tx + 18 + i * 13} y1={ty + 6} x2={tx + 18 + i * 13} y2={ty + th - 10} stroke={CYAN} strokeOpacity={0.5} strokeWidth={2}
          strokeDasharray="3 9" className="pro-dash" style={{ "--pro-dur": "1.6s" } as React.CSSProperties} />
      ))}
      <rect x={tx + 2} y={ty + th - 8} width={tw - 4} height={6} fill={COL.primary} fillOpacity={0.45} />
      <g className={running === false ? undefined : "pro-spin"} style={{ "--pro-dur": "1.2s" } as React.CSSProperties}>
        {[0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2; return <line key={i} x1={fx} y1={fy} x2={fx + Math.cos(a) * 14} y2={fy + Math.sin(a) * 14} stroke={CYAN} strokeWidth={3} strokeLinecap="round" />; })}
      </g>
      <Txt x={fx} y={ty + th + 14} s={9.5} c={COL.bad} a="middle">in {f(hot, 1)}°</Txt>
      <Txt x={fx} y={ty + th + 26} s={9.5} c={CYAN} a="middle">out {f(cold, 1)}°</Txt>
      <Row x0={124} x1={W - 10} y={26} label="Range" value={`${f(range, 1)} °C`} c={COL.primary} />
      <Bar x={124} y={32} w={W - 134} frac={range / 10} c={COL.primary} />
      <Row x0={124} x1={W - 10} y={64} label="Approach" value={`${f(appr, 1)} °C`} c={lvl(appr, apWarn, apBad)} />
      <Bar x={124} y={70} w={W - 134} frac={appr / 8} c={lvl(appr, apWarn, apBad)} />
      <Row x0={124} x1={W - 10} y={106} label="Effectiveness" value={`${f(eff * 100, 0)}%`} c={lvlLow(eff, 0.6, 0.5)} />
      <Txt x={124} y={132} s={9.5}>Wet-bulb {f(wb, 1)} °C</Txt>
      <Txt x={124} y={148} s={9.5} c={running == null ? COL.muted : running ? COL.ok : COL.muted}>{running == null ? "Fan status not bound" : running ? "Fan running" : "Fan stopped"}</Txt>
    </Svg>
  );
}

// ── Air Compressor ────────────────────────────────────────────────────────────
export function AirComp(p: ProProps) {
  const [pr, load, kw, cfm, hrs] = useRoles(p, [7.1, 1, 75, 420, 12846]);
  const lo = cfg(p, "loadAt", 6.5), hi = cfg(p, "unloadAt", 7.5), kwWarn = cfg(p, "kwcfmWarn", 0.19);
  const pv = roleSeries(p, 0, (lo + hi) / 2, (hi - lo) / 2.2, 60);
  const lv = p.bound ? valuesOf(p.rows, "s1").map((x) => x.v) : pv.map((_, i) => (Math.floor(i / 6) % 2 ? 1 : 0));
  const share = lv.length ? mean(lv.map((x) => (x > 0 ? 1 : 0))) : NaN, kwcfm = kw / cfm;
  const loaded = Number.isFinite(load) ? load > 0 : null;
  const strip = thin(lv, 120), sw = (W - 20) / Math.max(1, strip.length);
  return (
    <Svg>
      <Pill x={10} y={8} text={loaded == null ? "STATE ?" : loaded ? "LOADED" : "UNLOADED"} c={loaded == null ? COL.neutral : loaded ? COL.ok : COL.warn} />
      <Txt x={W - 10} y={22} s={16} w={700} c={COL.fg} a="end">{f(pr, 2)} {unitOf(p, 0, "bar")}</Txt>
      <Trend vals={pv} x0={10} y0={38} x1={W - 10} y1={108} lo={lo - (hi - lo) * 0.6} hi={hi + (hi - lo) * 0.6}
        lines={[[hi, COL.muted, true], [lo, COL.muted, true]]} />
      <Txt x={W - 10} y={36} s={9} a="end">unload {hi} · load {lo}</Txt>
      {strip.map((x, i) => <rect key={i} x={10 + i * sw} y={114} width={sw + 0.5} height={5} fill={x > 0 ? COL.ok : COL.track} />)}
      <Kpis y={H - 24} items={[[`${f(share * 100, 0)}%`, "time loaded"], [f(kwcfm, 3), "kW per CFM", lvl(kwcfm, kwWarn, kwWarn + 0.03)], [`${f(hrs, 0)} h`, "run hours"]]} />
    </Svg>
  );
}

// ── Draft Fan (ID / FD / PA) ──────────────────────────────────────────────────
export function DraftFan(p: ProProps) {
  const [spd, amp, de, nde, vib, pv] = useRoles(p, [72, 142, 58, 54, 2.4, -6]);
  const type = (p.c.fanType as string) || "ID";
  const brgW = cfg(p, "brgWarn", 70), brgB = cfg(p, "brgBad", 80), vW = cfg(p, "vibWarn", 4.5), vB = cfg(p, "vibBad", 7.1), aW = cfg(p, "ampWarn", Infinity);
  const last = type === "FD" ? "Air flow" : type === "PA" ? "PA header" : "Furnace draft";
  const lastUnit = unitOf(p, 5, type === "FD" ? "t/h" : "mmWC");
  const cx = 58, cy = 88, r = 38, dur = Number.isFinite(spd) && spd > 0 ? clamp(3 - (spd / 100) * 2.6, 0.35, 3) : 0;
  return (
    <Svg>
      <Txt x={10} y={20} s={11} w={600} c={COL.fg}>{type} fan</Txt>
      <circle cx={cx} cy={cy} r={r + 6} fill="none" stroke={COL.border} strokeWidth={2} />
      <g className={dur ? "pro-spin" : undefined} style={{ "--pro-dur": `${dur || 1}s` } as React.CSSProperties}>
        <circle cx={cx} cy={cy} r={r} fill="transparent" />
        {Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return (
          <path key={i} d={`M${cx + Math.cos(a) * 8},${cy + Math.sin(a) * 8} Q${cx + Math.cos(a + 0.35) * r * 0.7},${cy + Math.sin(a + 0.35) * r * 0.7} ${cx + Math.cos(a + 0.2) * r},${cy + Math.sin(a + 0.2) * r}`}
            stroke={COL.primary} strokeWidth={3} fill="none" strokeLinecap="round" />); })}
      </g>
      <circle cx={cx} cy={cy} r={5} fill={COL.fg} />
      <Txt x={cx} y={cy + r + 24} a="middle">Speed {f(spd, 0)}%</Txt>
      <Row x0={120} x1={W - 10} y={46} label="Motor current" value={`${f(amp, 0)} A`} c={lvl(amp, aW, Infinity)} />
      <Row x0={120} x1={W - 10} y={69} label="Bearing DE" value={`${f(de, 1)} °C`} c={lvl(de, brgW, brgB)} />
      <Row x0={120} x1={W - 10} y={92} label="Bearing NDE" value={`${f(nde, 1)} °C`} c={lvl(nde, brgW, brgB)} />
      <Row x0={120} x1={W - 10} y={115} label="Vibration" value={`${f(vib, 1)} mm/s`} c={lvl(vib, vW, vB)} />
      <Row x0={120} x1={W - 10} y={138} label={last} value={`${f(pv, 1)} ${lastUnit}`} />
    </Svg>
  );
}

// ── Boiler Overview ───────────────────────────────────────────────────────────
export function Boiler(p: ProProps) {
  const clip = useId().replace(/:/g, "");
  const [lv, sp, sf, fw, o2, stack] = useRoles(p, [-12, 10.4, 8.2, 8.4, 3.6, 182]);
  const hh = cfg(p, "hh", 80), ll = cfg(p, "ll", -80), span = cfg(p, "span", 100), stW = cfg(p, "stackWarn", 200);
  const tl = useTween(Number.isFinite(lv) ? lv : null);
  const dx = 12, dy = 36, dw = 112, dh = 56, ly = (mm: number) => dy + dh / 2 - (clamp(mm, -span, span) / span) * (dh / 2 - 4);
  const near = Number.isFinite(lv) && (lv >= hh - (hh - 0) * 0.25 || lv <= ll - ll * 0.25);
  return (
    <Svg>
      <defs><clipPath id={clip}><rect x={dx} y={dy} width={dw} height={dh} rx={dh / 2} /></clipPath></defs>
      <Txt x={dx} y={24}>Drum level</Txt>
      <rect x={dx} y={dy} width={dw} height={dh} rx={dh / 2} fill={COL.track} />
      <g clipPath={`url(#${clip})`}>
        <rect x={dx} y={ly(fin(tl ?? NaN, 0))} width={dw} height={dh} fill={COL.primary} fillOpacity={0.55} />
      </g>
      <rect x={dx} y={dy} width={dw} height={dh} rx={dh / 2} fill="none" stroke={COL.border} strokeWidth={1.5} />
      {[[hh, "HH"], [ll, "LL"]].map(([mm, l]) => (
        <g key={String(l)}>
          <line x1={dx + 14} x2={dx + dw - 14} y1={ly(Number(mm))} y2={ly(Number(mm))} stroke={COL.bad} strokeDasharray="3 3" />
          <Txt x={dx + dw + 4} y={ly(Number(mm)) + 3} s={9} c={COL.bad}>{l}</Txt>
        </g>
      ))}
      <Txt x={dx + dw / 2} y={dy + dh + 22} s={15} w={700} c={near ? COL.warn : COL.fg} a="middle">{Number.isFinite(lv) && lv > 0 ? "+" : ""}{f(lv, 0)} mm</Txt>
      <Txt x={dx + dw / 2} y={dy + dh + 35} s={9} a="middle">from normal level</Txt>
      {([["Steam pressure", `${f(sp, 1)} bar`], ["Steam flow", `${f(sf, 1)} t/h`], ["Feed water", `${f(fw, 1)} t/h`], ["Flue O₂", `${f(o2, 1)} %`, lvl(o2, 4.5, 6)], ["Stack temp", `${f(stack, 0)} °C`, lvl(stack, stW, stW + 20)]] as [string, string, string?][]).map(([l, v, c], i) => (
        <g key={l}>
          <Txt x={160} y={22 + i * 30} s={9.5}>{l}</Txt>
          <Txt x={160} y={36 + i * 30} s={12} w={600} c={c || COL.fg}>{v}</Txt>
        </g>
      ))}
    </Svg>
  );
}

// ── Boiler Efficiency ─────────────────────────────────────────────────────────
const SIEGERT: Record<string, [number, number]> = { gas: [0.66, 0.009], oil: [0.68, 0.007], coal: [0.68, 0.007] };
export function BoilerEff(p: ProProps) {
  const [o2, tg, ta, steam, fuel] = useRoles(p, [3.6, 190, 32, 8.2, 0.62]);
  const [A, B] = SIEGERT[(p.c.fuel as string) || "gas"] ?? SIEGERT.gas;
  const dry = (tg - ta) * (A / (21 - o2) + B);
  const other: [string, number, string][] = [
    ["Dry flue gas", dry, COL.bad], ["H₂ and moisture", cfg(p, "hLoss", 4), COL.warn],
    ["Radiation, other", cfg(p, "radLoss", 1.5), CYAN], ["Blowdown", cfg(p, "bdLoss", 1), VIOLET],
  ];
  const loss = other.reduce((s, x) => s + fin(x[1]), 0), eff = Number.isFinite(dry) ? 100 - loss : NaN;
  const sfr = steam / fuel;
  let x = 10;
  const big = other.reduce((b, it) => (fin(it[1]) > fin(b[1]) ? it : b), other[0]);
  return (
    <Svg>
      <Txt x={10} y={18}>Efficiency, loss method</Txt>
      <Txt x={10} y={46} s={24} w={700} c={lvlLow(eff, 84, 80)}>{f(eff, 1)} %</Txt>
      <Txt x={W - 10} y={46} s={11} w={600} c={COL.fg} a="end">Steam/fuel {f(sfr, 1)}</Txt>
      {other.map(([l, v, c]) => { const w = (fin(v) / 25) * (W - 20); const el = <rect key={l} x={x} y={58} width={Math.max(0, w - 1)} height={12} fill={c} className="pro-ease" />; x += w; return el; })}
      <Txt x={W - 10} y={86} s={9.5} a="end">losses {f(loss, 1)}%</Txt>
      {other.map(([l, v, c], i) => (
        <g key={l}>
          <rect x={10} y={94 + i * 17} width={8} height={8} fill={c} />
          <Txt x={23} y={102 + i * 17}>{l}</Txt>
          <Txt x={170} y={102 + i * 17} w={600} c={COL.fg} a="end">{f(v, 1)}%</Txt>
        </g>
      ))}
      <Txt x={186} y={110} s={9.5}>Biggest loss</Txt>
      <Txt x={186} y={124} s={10.5} w={600} c={COL.warn}>{big[0]}</Txt>
      {big === other[0] && <Txt x={186} y={138} s={9}>check excess air</Txt>}
    </Svg>
  );
}

// ── Combustion Window ─────────────────────────────────────────────────────────
export function Combustion(p: ProProps) {
  const [o2, co] = useRoles(p, [3.1, 62]);
  const lo = cfg(p, "o2Lo", 2), hi = cfg(p, "o2Hi", 3.5), coMax = cfg(p, "coMax", 100);
  const trail: [number, number][] = p.bound
    ? thin(p.rows.filter((r) => r.s0 != null && r.s1 != null).map((r) => [Number(r.s0), Number(r.s1)] as [number, number]), 40)
    : Array.from({ length: 30 }, (_, i) => { const x = 3 + Math.sin(i / 4) * 1.4; return [x, 40 + 900 * Math.exp(-x * 1.6)] as [number, number]; });
  const coTop = Math.max(400, coMax * 3), x0 = 30, x1 = W - 10, y0 = 16, y1 = H - 36;
  const sx = (v: number) => x0 + (clamp(v, 0, 8) / 8) * (x1 - x0), sy = (v: number) => y1 - (clamp(v, 0, coTop) / coTop) * (y1 - y0);
  const good = o2 >= lo && o2 <= hi && co < coMax, c = !Number.isFinite(o2) ? COL.neutral : good ? COL.ok : COL.warn;
  const ea = (o2 / (21 - o2)) * 100;
  return (
    <Svg>
      <rect x={sx(lo)} y={sy(coMax)} width={sx(hi) - sx(lo)} height={y1 - sy(coMax)} fill={COL.ok} fillOpacity={0.12} />
      <Txt x={sx(lo) + 3} y={y1 - 4} s={9} c={COL.ok}>efficient</Txt>
      <path d={`M${x0},${y0} L${x0},${y1} L${x1},${y1}`} stroke={COL.border} fill="none" />
      {trail.map(([a, b], i) => <circle key={i} cx={sx(a)} cy={sy(b)} r={2} fill={COL.primary} fillOpacity={(i / trail.length) * 0.6} />)}
      {Number.isFinite(o2) && Number.isFinite(co) && <circle cx={sx(o2)} cy={sy(co)} r={6} fill={c} className="pro-ease" />}
      {[0, 2, 4, 6, 8].map((v) => <Txt key={v} x={sx(v)} y={y1 + 11} s={9} a="middle">{v}</Txt>)}
      <Txt x={4} y={y0 + 6} s={9}>CO</Txt>
      <Txt x={4} y={y0 + 17} s={9}>{coTop}</Txt>
      <Txt x={x1} y={y0 + 6} s={9} a="end">O₂ % →</Txt>
      <Txt x={10} y={H - 8} s={10} w={600} c={c}>O₂ {f(o2, 1)}% · CO {f(co, 0)} ppm · excess air {f(ea, 0)}%</Txt>
    </Svg>
  );
}

// ── Duty / Standby Rotation ───────────────────────────────────────────────────
export function DutyStandby(p: ProProps) {
  const items = useItems(p, [["P-101", 18420], ["P-102", 17980], ["P-103", 18110]]);
  const running = items.map((it, i) => {
    if (!p.bound) return i !== 1;
    const v = valuesOf(p.rows, it.key);
    return v.length > 1 && v[v.length - 1].v > v[Math.max(0, v.length - 4)].v;
  });
  const hrs = items.map((it) => it.v).filter(Number.isFinite);
  const max = hrs.length ? Math.max(...hrs) : 0, min = hrs.length ? Math.min(...hrs) : 0, base = min * 0.9;
  const warn = cfg(p, "spreadWarn", 500);
  return (
    <div className="h-full w-full flex flex-col gap-1.5 p-2 text-[11px] overflow-auto">
      {items.map((it, i) => (
        <div key={it.key} className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(0,1fr) 70px 1fr 70px" }}>
          <b className="truncate">{it.label}</b>
          <span className="text-[10px] font-bold" style={{ color: running[i] ? COL.ok : undefined }}>{running[i] ? "● DUTY" : "○ STANDBY"}</span>
          <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full pro-ease" style={{ width: `${max > base ? ((fin(it.v, base) - base) / (max - base)) * 100 : 0}%`, background: running[i] ? COL.ok : COL.neutral }} /></div>
          <span className="text-right tabular-nums text-[10.5px]">{f(it.v, 0)} h</span>
        </div>
      ))}
      <div className="mt-auto flex justify-between text-[10.5px] text-muted-foreground">
        <span>Run-hour spread <b style={{ color: max - min >= warn ? COL.warn : undefined }}>{f(max - min, 0)} h</b></span>
        <span>{running.filter(Boolean).length} on duty · {running.filter((r) => !r).length} standby</span>
      </div>
    </div>
  );
}

// ── Refrigeration Plant ───────────────────────────────────────────────────────
const SAT: Record<string, [number, number]> = { R717: [11.698, 2802.6], R134a: [10.911, 2692.8], R404A: [10.501, 2380.3], R22: [10.519, 2441.1] };
export function RefrigPlant(p: ProProps) {
  const [suc, dis, st, cap] = useRoles(p, [0.9, 11.4, -13.5, 72]);
  const ref = (p.c.refrigerant as string) || "R717", [A, B] = SAT[ref] ?? SAT.R717;
  const abs = (x: number) => (p.c.pressure === "abs" ? x : x + 1.013);
  const sat = (x: number) => B / (A - Math.log(abs(x))) - 273.15;
  const ts = sat(suc), td = sat(dis), sh = st - ts;
  const shLo = cfg(p, "shLo", 3), shHi = cfg(p, "shHi", 10), shc = !Number.isFinite(sh) ? COL.neutral : sh < shLo ? COL.bad : sh > shHi ? COL.warn : COL.ok;
  const l = 24, r = W - 24, tp = 28, bt = H - 56, unit = p.c.pressure === "abs" ? "bara" : "barg";
  const box = (cx: number, cy: number, t: string, c: string) => { const w = t.length * 6 + 14; return (
    <g key={t}><rect x={cx - w / 2} y={cy - 9} width={w} height={18} rx={5} fill={COL.card} stroke={c} /><Txt x={cx} y={cy + 3.5} s={9.5} w={600} c={COL.fg} a="middle">{t}</Txt></g>); };
  return (
    <Svg>
      <Flow x1={l} y1={bt} x2={l} y2={tp} c={COL.bad} />
      <Flow x1={l} y1={tp} x2={r} y2={tp} c={COL.bad} />
      <Flow x1={r} y1={tp} x2={r} y2={bt} c={COL.warn} />
      <Flow x1={r} y1={bt} x2={l} y2={bt} c={CYAN} />
      {box(W / 2, tp, "Condenser", COL.bad)}{box(W / 2, bt, "Evaporator", CYAN)}{box(l + 10, (tp + bt) / 2, "Comp", COL.primary)}{box(r - 8, (tp + bt) / 2, "EXV", COL.warn)}
      <Txt x={W / 2} y={(tp + bt) / 2 - 3} s={10.5} w={600} c={COL.fg} a="middle">Capacity {f(cap, 0)}%</Txt>
      <Txt x={W / 2} y={(tp + bt) / 2 + 11} s={9} a="middle">{ref} · saturation approx.</Txt>
      <Kpis y={H - 24} items={[[`${f(suc, 2)} ${unit}`, `suction · ${f(ts, 1)}°`], [`${f(dis, 1)} ${unit}`, `discharge · ${f(td, 1)}°`], [`${f(sh, 1)} K`, Number.isFinite(sh) && sh < shLo ? "superheat LOW" : "superheat", shc]]} />
    </Svg>
  );
}

// ── Compressed Air Dryer ──────────────────────────────────────────────────────
export function AirDryer(p: ProProps) {
  const [pdp, towerA, purge] = useRoles(p, [-44, 1, 14]);
  const limit = cfg(p, "limit", -40), hist = roleSeries(p, 0, limit - 4, 2, 60);
  const c = !Number.isFinite(pdp) ? COL.neutral : pdp > limit ? COL.bad : pdp > limit - 2 ? COL.warn : COL.ok;
  const known = Number.isFinite(towerA), aDry = towerA > 0;
  const tower = (x: number, n: string, drying: boolean | null) => (
    <g key={n}>
      <rect x={x} y={34} width={28} height={H - 66} rx={10} fill={COL.card} stroke={drying == null ? COL.border : drying ? COL.primary : COL.warn} strokeWidth={1.5} />
      <rect x={x + 3} y={42} width={22} height={H - 82} rx={7} fill={drying == null ? COL.track : drying ? COL.primary : COL.warn} fillOpacity={0.3} />
      {drying != null && <line x1={x + 14} y1={drying ? H - 44 : 44} x2={x + 14} y2={drying ? 44 : H - 44} stroke={drying ? COL.fg : COL.warn} strokeWidth={2} strokeDasharray="3 8" className="pro-dash" />}
      <Txt x={x + 14} y={28} w={600} c={COL.fg} a="middle">{n}</Txt>
      <Txt x={x + 14} y={H - 18} s={9} c={drying == null ? COL.muted : drying ? COL.primary : COL.warn} a="middle">{drying == null ? "—" : drying ? "drying" : "regen"}</Txt>
    </g>
  );
  return (
    <Svg>
      {tower(14, "A", known ? aDry : null)}{tower(52, "B", known ? !aDry : null)}
      <Txt x={100} y={22}>Pressure dew point</Txt>
      <Txt x={100} y={48} s={21} w={700} c={c}>{f(pdp, 1)} °C</Txt>
      <Txt x={100} y={62} s={9}>limit {limit} °C</Txt>
      <Trend vals={hist} x0={100} y0={74} x1={W - 10} y1={H - 26} lines={[[limit, COL.bad, true]]} />
      <Txt x={100} y={H - 8} s={9}>Purge {f(purge, 0)}% of air</Txt>
    </Svg>
  );
}

// ── Thermic Fluid Heater ──────────────────────────────────────────────────────
export function ThermicFluid(p: ProProps) {
  const [out, inn, flow] = useRoles(p, [265, 238, 112]);
  const low = cfg(p, "lowFlow", 75), rho = cfg(p, "density", 850), cp = cfg(p, "cp", 2.5);
  const dt = out - inn, kw = ((flow * rho) / 3600) * cp * dt, isLow = Number.isFinite(flow) && flow < low * 1.13;
  const hx = 14, hy = 26, hw = 66, hh = 72, ux = W - 86, uw = 72, sp = Number.isFinite(flow) ? flow / 100 : p.bound ? 0 : 1;
  return (
    <Svg>
      <Flow x1={hx + hw} y1={hy + 14} x2={ux} y2={hy + 14} c={COL.bad} speed={sp} />
      <Flow x1={ux} y1={hy + hh - 14} x2={hx + hw} y2={hy + hh - 14} c={COL.warn} speed={sp} />
      <rect x={hx} y={hy} width={hw} height={hh} rx={8} fill={COL.card} stroke={COL.border} />
      <rect x={ux} y={hy} width={uw} height={hh} rx={8} fill={COL.card} stroke={COL.border} />
      <path d={Array.from({ length: 9 }, (_, i) => `${i ? "L" : "M"}${hx + 13 + i * 5},${hy + 14 + (i % 2) * 22}`).join(" ")} stroke={COL.bad} strokeWidth={2} fill="none" />
      {[0, 1, 2].map((i) => <path key={i} d={`M${hx + 18 + i * 15},${hy + hh - 6} q4,-14 8,0`} fill={COL.warn} className="pro-pulse" />)}
      <Txt x={hx + hw / 2} y={hy - 7} w={600} c={COL.fg} a="middle">Heater</Txt>
      <Txt x={ux + uw / 2} y={hy - 7} w={600} c={COL.fg} a="middle">Users</Txt>
      <Txt x={(hx + hw + ux) / 2} y={hy + 7} w={600} c={COL.bad} a="middle">{f(out, 0)} °C →</Txt>
      <Txt x={(hx + hw + ux) / 2} y={hy + hh - 21} w={600} c={COL.warn} a="middle">← {f(inn, 0)} °C</Txt>
      <Kpis y={H - 30} items={[[`${f(dt, 0)} °C`, "ΔT"], [`${f(flow, 0)} m³/h`, "flow", isLow ? COL.warn : undefined], [`${f(kw, 0)} kW`, "heat delivered"]]} />
      <Txt x={10} y={H - 3} s={9} c={isLow ? COL.warn : COL.muted}>{isLow ? `Flow near the low-flow trip (${low} m³/h)` : `Low-flow trip at ${low} m³/h`}</Txt>
    </Svg>
  );
}

// ── Steam & Condensate ────────────────────────────────────────────────────────
export function SteamCond(p: ProProps) {
  const [gen, cond, ok, pass, blk] = useRoles(p, [8.2, 5.6, 42, 3, 1]);
  const rec = cond / gen, lossPer = cfg(p, "lossPerTrap", 7);
  const traps = [ok, pass, blk].map((x) => fin(x)), total = traps.reduce((a, b) => a + b, 0);
  let x = 116;
  return (
    <Svg>
      <Ring cx={56} cy={66} r={38} frac={rec} c={lvlLow(rec, 0.7, 0.55)} label={`${f(rec * 100, 0)}%`} sub="condensate back" />
      <Row x0={116} x1={W - 10} y={22} label="Steam generated" value={`${f(gen, 1)} t/h`} />
      <Row x0={116} x1={W - 10} y={42} label="Condensate back" value={`${f(cond, 1)} t/h`} />
      <Row x0={116} x1={W - 10} y={62} label="Make-up water" value={`${f(gen - cond, 1)} t/h`} />
      <Txt x={116} y={92}>Steam traps{total ? ` (${total})` : ""}</Txt>
      {total > 0 ? traps.map((t, i) => { const w = (t / total) * (W - 126); const el = <rect key={i} x={x} y={98} width={Math.max(0, w - 1)} height={9} fill={[COL.ok, COL.warn, COL.bad][i]} />; x += w; return el; })
        : <rect x={116} y={98} width={W - 126} height={9} fill={COL.track} />}
      <Txt x={116} y={122} s={9.5} c={COL.fg}>{f(ok, 0)} OK · {f(pass, 0)} passing · {f(blk, 0)} blocked</Txt>
      <Txt x={116} y={138} s={9.5} w={600} c={fin(pass) > 2 ? COL.warn : COL.muted}>Lost via traps ≈ {f(pass * lossPer, 0)} kg/h</Txt>
      <Txt x={10} y={H - 6} s={9}>More condensate back: less feed water and fuel</Txt>
    </Svg>
  );
}
