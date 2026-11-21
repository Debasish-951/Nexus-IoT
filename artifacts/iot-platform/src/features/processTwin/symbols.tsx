import type { ReactElement } from "react";
import type { Role } from "./scene";

/**
 * P&ID symbol library: ISA-style equipment, valves and instruments drawn as SVG
 * in their own coordinates (0..w, 0..h). Each symbol lists its connection ports
 * and the live behaviours (roles) it understands; the canvas places, rotates and
 * scales it and passes the current live state in `Draw`.
 */
export type Status = "ok" | "warn" | "crit" | "none";
export interface Draw {
  uid: string;
  /** 0..1 liquid level, or null when not driven. */
  level: number | null;
  /** Rotor angle in degrees (keeps turning while running). */
  angle: number;
  running: boolean | null;
  /** 0..1 valve opening. */
  open: number | null;
  /** Heat colour from a temperature reading. */
  heat: string | null;
  value: number | null;
  /** Formatted primary value (instruments). */
  text: string;
  /** 0..1 position of a gauge needle. */
  gauge: number | null;
  status: Status;
  tag: string;
  /** Seconds, for flicker effects. */
  time: number;
  /** Item label (custom blocks show it inside). */
  label?: string;
}
export interface Port { id: string; x: number; y: number }
export interface SymDef {
  type: string; group: string; name: string; w: number; h: number;
  ports: Port[]; roles: Role[]; prefix: string; keywords?: string;
  /** Kind of value the demo simulation shows for the primary role "value". */
  demo?: string;
  render: (d: Draw) => ReactElement;
}

export const GROUPS: [string, string][] = [
  ["vessel", "Vessels"], ["rotating", "Rotating"], ["valve", "Valves"], ["heat", "Heat transfer"], ["inst", "Instruments"],
  ["water", "Water & effluent"], ["solids", "Solids handling"], ["pharma", "Pharma & food"], ["oilgas", "Oil & gas"], ["power", "Power & utilities"], ["textile", "Textile"],
  ["other", "Other"], ["custom", "Custom blocks"],
];

const P = (id: string, x: number, y: number): Port => ({ id, x, y });
const mov = (d: Draw) => (d.running === false ? "px-m stopped" : "px-m");
const valveFill = (d: Draw) => (d.open == null ? { fill: "#3b82f6", opacity: 0.35 } : d.open < 0.03 ? { fill: "#64748b", opacity: 0.6 } : { fill: "#3b82f6", opacity: 0.15 + 0.75 * d.open });
const liquid = (d: Draw, x: number, y: number, w: number, h: number, clip: string, grad = "pxLiq") =>
  d.level == null ? null : <rect x={x} y={y + h - h * d.level} width={w} height={h * d.level + 1} fill={`url(#${grad})`} clipPath={`url(#${clip})`} />;
const tagNo = (tag: string) => (tag.match(/\d+[A-Z]?$/)?.[0] ?? tag.split("-").pop() ?? "");
const valueText = (d: Draw, x: number, y: number) => (d.text ? <text className="px-val" x={x} y={y} textAnchor="middle">{d.text}</text> : null);

/** Valve body: two triangles meeting at the centre of a w × h box placed at (0, y). */
const bow = (w: number, y: number, h: number) => `M0 ${y} L${w} ${y + h} L${w} ${y} L0 ${y + h} Z`;
const bowFill = (w: number, y: number, h: number) => `M0 ${y} L${w / 2} ${y + h / 2} L0 ${y + h} Z M${w} ${y} L${w / 2} ${y + h / 2} L${w} ${y + h} Z`;
function valve(extra: (d: Draw) => ReactElement | null) {
  return (d: Draw) => (<>
    <path className="px-eq" d={bow(44, 0, 28)} />
    <path d={bowFill(44, 0, 28)} {...valveFill(d)} />
    {extra(d)}
  </>);
}

// ── vessels ──────────────────────────────────────────────────────────────────
const VESSELS: SymDef[] = [
  {
    type: "tank", group: "vessel", name: "Tank", w: 120, h: 180, prefix: "T", roles: ["level", "temperature"], keywords: "storage feed",
    ports: [P("t", 60, 0), P("l", 0, 160), P("r", 120, 160), P("b", 60, 180)],
    render: (d) => (<>
      <defs><clipPath id={`${d.uid}c`}><rect x="2" y="2" width="116" height="176" rx="12" /></clipPath></defs>
      <rect className="px-eq" width="120" height="180" rx="14" />
      {liquid(d, 0, 2, 120, 176, `${d.uid}c`)}
      {d.level != null && <path d={`M2 ${180 - 176 * d.level} q 29 -4 58 0 t 58 0`} stroke="#7dd3fc" strokeOpacity=".5" fill="none" clipPath={`url(#${d.uid}c)`} />}
      <rect className="px-o" width="120" height="180" rx="14" />
    </>),
  },
  {
    type: "vvessel", group: "vessel", name: "Vertical vessel", w: 80, h: 180, prefix: "V", roles: ["level", "temperature"], keywords: "drum pressure vessel",
    ports: [P("t", 40, 0), P("l", 0, 130), P("r", 80, 130), P("b", 40, 180)],
    render: (d) => (<>
      <defs><clipPath id={`${d.uid}c`}><rect x="2" y="2" width="76" height="176" rx="36" /></clipPath></defs>
      <rect className="px-eq" width="80" height="180" rx="38" />
      {liquid(d, 0, 2, 80, 176, `${d.uid}c`)}
      <rect className="px-o" width="80" height="180" rx="38" />
    </>),
  },
  {
    type: "reactor", group: "vessel", name: "Reactor with agitator", w: 110, h: 230, prefix: "R", roles: ["level", "speed", "temperature"], keywords: "batch cstr agitated",
    ports: [P("t", 55, 34), P("l", 0, 90), P("r", 110, 90), P("b", 55, 230)],
    render: (d) => {
      const sx = Math.cos((d.angle * Math.PI) / 180).toFixed(3);
      return (<>
        <defs><clipPath id={`${d.uid}c`}><rect x="2" y="36" width="106" height="192" rx="26" /></clipPath></defs>
        <rect className="px-eq" y="34" width="110" height="196" rx="28" />
        {liquid(d, 0, 36, 110, 192, `${d.uid}c`, "pxLiq2")}
        <rect className="px-o" y="34" width="110" height="196" rx="28" />
        <rect className="px-eq" x="39" y="0" width="32" height="26" rx="4" />
        <line x1="55" y1="26" x2="55" y2="200" className={mov(d)} strokeWidth="3" />
        <g transform={`translate(55 0) scale(${sx} 1) translate(-55 0)`} className={mov(d)}>
          <rect x="25" y="192" width="60" height="7" rx="3" /><rect x="29" y="140" width="52" height="6" rx="3" />
        </g>
      </>);
    },
  },
  {
    type: "silo", group: "vessel", name: "Silo / hopper", w: 100, h: 200, prefix: "S", roles: ["level"], keywords: "bin hopper solids",
    ports: [P("t", 50, 0), P("b", 50, 200)],
    render: (d) => {
      const shape = "M4 0 H96 V130 L60 188 H40 L4 130 Z";
      return (<>
        <defs><clipPath id={`${d.uid}c`}><path d={shape} /></clipPath></defs>
        <path className="px-eq" d={shape} />
        {liquid(d, 0, 0, 100, 188, `${d.uid}c`, "pxSolid")}
        <path className="px-o" d={shape} />
        <rect className="px-eq" x="42" y="188" width="16" height="12" />
      </>);
    },
  },
  {
    type: "column", group: "vessel", name: "Column / tower", w: 70, h: 260, prefix: "C", roles: ["temperature", "level"], keywords: "distillation absorber scrubber",
    ports: [P("t", 35, 0), P("r", 70, 60), P("l", 0, 200), P("b", 35, 260)],
    render: (d) => (<>
      <defs><clipPath id={`${d.uid}c`}><rect x="2" y="2" width="66" height="256" rx="33" /></clipPath></defs>
      <rect className="px-eq" width="70" height="260" rx="35" />
      {liquid(d, 0, 2, 70, 256, `${d.uid}c`)}
      {[50, 80, 110, 140, 170, 200].map((y) => <line key={y} className="px-d" x1="6" x2="64" y1={y} y2={y} strokeDasharray="8 5" />)}
      <rect className="px-o" width="70" height="260" rx="35" />
    </>),
  },
];

// ── rotating ─────────────────────────────────────────────────────────────────
const ROTATING: SymDef[] = [
  {
    type: "cpump", group: "rotating", name: "Centrifugal pump", w: 72, h: 72, prefix: "P", roles: ["speed"], keywords: "pump centrifugal",
    ports: [P("in", 0, 44), P("out", 55, 0)],
    render: (d) => (<>
      <rect className="px-eq" x="48" y="0" width="14" height="22" />
      <rect className="px-eq" x="0" y="38" width="10" height="12" />
      <circle className="px-eq" cx="36" cy="44" r="28" />
      <g transform={`rotate(${d.angle} 36 44)`} className={mov(d)}>
        {["M36 44 q8 -11 2 -21", "M36 44 q11 8 21 2", "M36 44 q-8 11 -2 21", "M36 44 q-11 -8 -21 -2"].map((p) => <path key={p} d={p} strokeWidth="3" fill="none" />)}
        <circle cx="36" cy="44" r="4" />
      </g>
    </>),
  },
  {
    type: "pdpump", group: "rotating", name: "Positive-displacement pump", w: 72, h: 60, prefix: "P", roles: ["speed"], keywords: "gear screw lobe dosing metering",
    ports: [P("l", 0, 30), P("r", 72, 30)],
    render: (d) => (<>
      <rect className="px-eq" x="0" y="24" width="72" height="12" />
      <circle className="px-eq" cx="36" cy="30" r="26" />
      <g transform={`rotate(${d.angle} 36 30)`} className={mov(d)}>
        <ellipse cx="36" cy="21" rx="6" ry="9" /><ellipse cx="36" cy="39" rx="6" ry="9" />
      </g>
    </>),
  },
  {
    type: "compressor", group: "rotating", name: "Compressor", w: 80, h: 60, prefix: "K", roles: ["speed"], keywords: "gas air",
    ports: [P("l", 0, 30), P("r", 80, 30)],
    render: (d) => (<>
      <path className="px-eq" d="M6 2 L74 16 L74 44 L6 58 Z" />
      <g transform={`rotate(${d.angle} 38 30)`} className={mov(d)}><line x1="26" y1="30" x2="50" y2="30" strokeWidth="3" /><line x1="38" y1="18" x2="38" y2="42" strokeWidth="3" /></g>
      <rect className="px-eq" x="0" y="25" width="6" height="10" /><rect className="px-eq" x="74" y="25" width="6" height="10" />
    </>),
  },
  {
    type: "fan", group: "rotating", name: "Fan / blower", w: 64, h: 64, prefix: "F", roles: ["speed"], keywords: "blower exhaust ventilation",
    ports: [P("l", 0, 32), P("r", 64, 32)],
    render: (d) => (<>
      <circle className="px-eq" cx="32" cy="32" r="28" />
      <g transform={`rotate(${d.angle} 32 32)`} className={mov(d)}>
        {[0, 120, 240].map((a) => <path key={a} transform={`rotate(${a} 32 32)`} d="M32 32 C 28 22, 30 12, 38 8 C 40 16, 38 26, 32 32 Z" />)}
      </g>
    </>),
  },
  {
    type: "agitator", group: "rotating", name: "Agitator / mixer", w: 40, h: 110, prefix: "AG", roles: ["speed"], keywords: "stirrer impeller",
    ports: [P("t", 20, 0)],
    render: (d) => (<>
      <rect className="px-eq" x="6" y="0" width="28" height="22" rx="4" />
      <line x1="20" y1="22" x2="20" y2="100" className={mov(d)} strokeWidth="3" />
      <g transform={`translate(20 0) scale(${Math.cos((d.angle * Math.PI) / 180).toFixed(3)} 1) translate(-20 0)`} className={mov(d)}><rect x="2" y="94" width="36" height="7" rx="3" /></g>
    </>),
  },
  {
    type: "motor", group: "rotating", name: "Motor", w: 64, h: 44, prefix: "M", roles: ["speed", "temperature"], keywords: "drive electric",
    ports: [P("l", 0, 22), P("r", 64, 22)],
    render: (d) => (<>
      <line x1="52" y1="22" x2="64" y2="22" className={mov(d)} strokeWidth="4" />
      <rect className="px-eq" x="2" y="4" width="50" height="36" rx="6" />
      <text x="27" y="28" textAnchor="middle" className="px-letters">M</text>
      <circle cx="44" cy="12" r="3" fill={d.running === false ? "#4b5563" : d.running ? "#22c55e" : "#64748b"} />
    </>),
  },
];

// ── valves ───────────────────────────────────────────────────────────────────
const VLR = [P("l", 0, 14), P("r", 44, 14)];
const VALVES: SymDef[] = [
  { type: "gate", group: "valve", name: "Gate valve", w: 44, h: 28, prefix: "XV", roles: ["opening"], ports: VLR, keywords: "isolation manual", render: valve(() => null) },
  { type: "globe", group: "valve", name: "Globe valve", w: 44, h: 28, prefix: "HV", roles: ["opening"], ports: VLR, keywords: "throttle", render: valve(() => <circle cx="22" cy="14" r="5" fill="#9fb3cc" />) },
  {
    type: "cv", group: "valve", name: "Control valve", w: 44, h: 56, prefix: "FCV", roles: ["opening"], keywords: "actuated modulating fcv pcv lcv tcv",
    ports: [P("l", 0, 42), P("r", 44, 42)],
    render: (d) => (<>
      <path className="px-eq" d={bow(44, 28, 28)} />
      <path d={bowFill(44, 28, 28)} {...valveFill(d)} />
      <line x1="22" y1="42" x2="22" y2="14" stroke="#7b8ba3" strokeWidth="2" />
      <path className="px-eq" d="M8 16 A14 14 0 0 1 36 16 Z" />
    </>),
  },
  { type: "check", group: "valve", name: "Check valve", w: 44, h: 28, prefix: "CV", roles: ["opening"], ports: VLR, keywords: "non-return nrv", render: valve(() => <path d="M14 14 H32 M26 8 L32 14 L26 20" stroke="#cbd5e1" strokeWidth="2" fill="none" />) },
  { type: "ball", group: "valve", name: "Ball valve", w: 44, h: 28, prefix: "BV", roles: ["opening"], ports: VLR, keywords: "quarter turn", render: valve(() => <circle cx="22" cy="14" r="7" className="px-eq" />) },
  {
    type: "butterfly", group: "valve", name: "Butterfly valve", w: 44, h: 28, prefix: "BFV", roles: ["opening"], ports: VLR, keywords: "damper",
    render: (d) => (<>
      <line className="px-o" x1="4" y1="0" x2="4" y2="28" /><line className="px-o" x1="40" y1="0" x2="40" y2="28" />
      <line x1="4" y1="14" x2="40" y2="14" className="px-d" />
      <ellipse cx="22" cy="14" rx={3 + 9 * (d.open ?? 0.5)} ry="12" {...valveFill(d)} stroke="#7b8ba3" />
    </>),
  },
  {
    type: "valve3", group: "valve", name: "3-way valve", w: 44, h: 44, prefix: "TV", roles: ["opening"], keywords: "diverter mixing",
    ports: [P("l", 0, 14), P("r", 44, 14), P("b", 22, 44)],
    render: (d) => (<>
      <path className="px-eq" d="M0 0 L22 14 L0 28 Z M44 0 L22 14 L44 28 Z M8 44 L22 14 L36 44 Z" />
      <path d="M0 0 L22 14 L0 28 Z M44 0 L22 14 L44 28 Z" {...valveFill(d)} />
    </>),
  },
  {
    type: "psv", group: "valve", name: "Safety / relief valve", w: 40, h: 52, prefix: "PSV", roles: ["opening"], keywords: "relief prv psv",
    ports: [P("b", 14, 52), P("r", 40, 30)],
    render: (d) => (<>
      <path className="px-eq" d="M4 52 L24 52 L14 30 Z M14 30 L40 20 L40 40 Z" />
      <path d="M14 30 L40 20 L40 40 Z" {...valveFill(d)} />
      <polyline points="14,30 8,26 20,22 8,18 20,14 8,10 14,6" stroke="#9fb3cc" strokeWidth="2" fill="none" />
      <line x1="6" y1="4" x2="22" y2="4" stroke="#9fb3cc" strokeWidth="2" />
    </>),
  },
];

// ── heat transfer ────────────────────────────────────────────────────────────
const HEAT: SymDef[] = [
  {
    type: "shelltube", group: "heat", name: "Shell-and-tube exchanger", w: 160, h: 60, prefix: "E", roles: ["temperature"], keywords: "heat exchanger condenser",
    ports: [P("l", 0, 30), P("r", 160, 30), P("t", 40, 0), P("b", 120, 60)],
    render: (d) => (<>
      <rect className="px-eq" width="160" height="60" rx="30" />
      <line className="px-o" x1="28" y1="2" x2="28" y2="58" /><line className="px-o" x1="132" y1="2" x2="132" y2="58" />
      {[18, 26, 34, 42].map((y) => <line key={y} className="px-d" x1="28" x2="132" y1={y} y2={y} style={d.heat ? { stroke: d.heat } : undefined} />)}
    </>),
  },
  {
    type: "plate", group: "heat", name: "Plate exchanger", w: 80, h: 90, prefix: "E", roles: ["temperature"], keywords: "phe gasket",
    ports: [P("t1", 16, 0), P("t2", 64, 0), P("b1", 16, 90), P("b2", 64, 90)],
    render: (d) => (<>
      <rect className="px-eq" x="0" y="8" width="80" height="74" rx="4" />
      {[14, 22, 30, 38, 46, 54, 62].map((x) => <line key={x} className="px-d" x1={x} x2={x} y1="14" y2="76" style={d.heat ? { stroke: d.heat } : undefined} />)}
      <rect className="px-eq" x="10" y="0" width="12" height="8" /><rect className="px-eq" x="58" y="0" width="12" height="8" />
      <rect className="px-eq" x="10" y="82" width="12" height="8" /><rect className="px-eq" x="58" y="82" width="12" height="8" />
    </>),
  },
  {
    type: "cooler", group: "heat", name: "Cooler", w: 200, h: 70, prefix: "E", roles: ["temperature"], keywords: "aftercooler heat exchanger",
    ports: [P("l", 0, 35), P("r", 200, 35), P("b1", 50, 70), P("b2", 150, 70)],
    render: (d) => (<>
      <rect className="px-eq" width="200" height="70" rx="35" />
      {[17, 29, 41, 53].map((y) => <line key={y} className="px-d" x1="30" x2="170" y1={y} y2={y} style={d.heat ? { stroke: d.heat } : undefined} />)}
    </>),
  },
  {
    type: "heater", group: "heat", name: "Heater", w: 120, h: 60, prefix: "H", roles: ["temperature"], keywords: "electric furnace",
    ports: [P("l", 0, 30), P("r", 120, 30)],
    render: (d) => (<>
      <rect className="px-eq" width="120" height="60" rx="6" />
      <polyline points="14,30 24,14 34,46 44,14 54,46 64,14 74,46 84,14 94,46 106,30" fill="none" strokeWidth="2.5" stroke={d.heat ?? "#fb923c"} />
    </>),
  },
  {
    type: "boiler", group: "heat", name: "Boiler", w: 120, h: 130, prefix: "B", roles: ["temperature", "level"], keywords: "steam generator",
    ports: [P("t", 60, 0), P("l", 0, 25), P("b", 60, 130)],
    render: (d) => {
      const f = 1 + 0.12 * Math.sin(d.time * 9) * (d.running === false ? 0 : 1);
      return (<>
        <defs><clipPath id={`${d.uid}c`}><rect x="2" y="2" width="116" height="46" rx="23" /></clipPath></defs>
        <rect className="px-eq" width="120" height="50" rx="25" />
        {liquid(d, 0, 2, 120, 46, `${d.uid}c`)}
        <rect className="px-o" width="120" height="50" rx="25" />
        <rect className="px-eq" x="10" y="58" width="100" height="72" rx="4" />
        <g transform={`translate(60 122) scale(1 ${f.toFixed(3)}) translate(-60 -122)`}>
          <path d="M40 122 C 38 104, 50 100, 48 86 C 58 98, 56 106, 60 92 C 66 104, 72 104, 70 88 C 82 102, 82 116, 80 122 Z" fill={d.heat ?? "#f97316"} opacity=".85" />
        </g>
      </>);
    },
  },
  {
    type: "ctower", group: "heat", name: "Cooling tower", w: 110, h: 130, prefix: "CT", roles: ["speed", "temperature"], keywords: "evaporative",
    ports: [P("l", 0, 112), P("r", 110, 112)],
    render: (d) => (<>
      <path className="px-eq" d="M12 130 Q40 66 22 12 L88 12 Q70 66 98 130 Z" />
      <g transform={`translate(55 8) scale(${Math.cos((d.angle * Math.PI) / 180).toFixed(3)} 1) translate(-55 -8)`} className={mov(d)}><rect x="30" y="5" width="50" height="6" rx="3" /></g>
      <rect className="px-eq" x="0" y="106" width="14" height="12" /><rect className="px-eq" x="96" y="106" width="14" height="12" />
    </>),
  },
];

// ── other equipment ──────────────────────────────────────────────────────────
const OTHER: SymDef[] = [
  {
    type: "filter", group: "other", name: "Filter / strainer", w: 60, h: 70, prefix: "FL", roles: ["value"], demo: "dp", keywords: "strainer cartridge",
    ports: [P("l", 0, 35), P("r", 60, 35)],
    render: (d) => (<>
      <rect className="px-eq" x="6" y="0" width="48" height="70" rx="4" />
      <line x1="6" y1="70" x2="54" y2="0" className="px-d" strokeDasharray="6 4" />
      <rect className="px-eq" x="0" y="30" width="6" height="10" /><rect className="px-eq" x="54" y="30" width="6" height="10" />
      {valueText(d, 30, 86)}
    </>),
  },
  {
    type: "separator", group: "other", name: "Separator", w: 180, h: 70, prefix: "V", roles: ["level"], keywords: "knockout drum horizontal vessel",
    ports: [P("l", 0, 35), P("t", 140, 0), P("b1", 40, 70), P("b2", 150, 70)],
    render: (d) => (<>
      <defs><clipPath id={`${d.uid}c`}><rect x="2" y="2" width="176" height="66" rx="33" /></clipPath></defs>
      <rect className="px-eq" width="180" height="70" rx="35" />
      {liquid(d, 0, 2, 180, 66, `${d.uid}c`)}
      <line className="px-o" x1="120" y1="40" x2="120" y2="68" />
      <rect className="px-o" width="180" height="70" rx="35" />
    </>),
  },
  {
    type: "mixer", group: "other", name: "Static mixer", w: 100, h: 40, prefix: "MX", roles: [], keywords: "inline blending",
    ports: [P("l", 0, 20), P("r", 100, 20)],
    render: () => (<>
      <rect className="px-eq" width="100" height="40" rx="6" />
      <polyline points="10,32 22,8 34,32 46,8 58,32 70,8 82,32 92,8" className="px-d" />
    </>),
  },
  {
    type: "conveyor", group: "other", name: "Conveyor", w: 180, h: 40, prefix: "CV", roles: ["speed"], keywords: "belt transport",
    ports: [P("l", 0, 20), P("r", 180, 20)],
    render: (d) => (<>
      <rect className="px-eq" x="0" y="2" width="180" height="36" rx="18" />
      {[20, 60, 100, 140, 160].map((x) => (
        <g key={x} transform={`rotate(${d.angle} ${x} 20)`} className={mov(d)}><circle cx={x} cy="20" r="11" fill="none" strokeWidth="2" /><line x1={x - 10} y1="20" x2={x + 10} y2="20" strokeWidth="2" /></g>
      ))}
    </>),
  },
  {
    type: "cyclone", group: "other", name: "Cyclone", w: 70, h: 150, prefix: "CY", roles: [], keywords: "dust separator",
    ports: [P("l", 0, 22), P("t", 35, 0), P("b", 35, 150)],
    render: () => (<>
      <path className="px-eq" d="M4 10 H66 V64 L42 136 H28 L4 64 Z" />
      <rect className="px-eq" x="26" y="0" width="18" height="30" />
      <rect className="px-eq" x="30" y="136" width="10" height="14" />
      <path className="px-d" d="M14 40 Q35 52 56 40 M18 64 Q35 74 52 64" />
    </>),
  },
  {
    type: "flare", group: "other", name: "Flare stack", w: 50, h: 160, prefix: "FS", roles: [], keywords: "vent",
    ports: [P("b", 25, 160)],
    render: (d) => {
      const f = 1 + 0.15 * Math.sin(d.time * 7);
      return (<>
        <rect className="px-eq" x="19" y="40" width="12" height="120" />
        <g transform={`translate(25 40) scale(1 ${f.toFixed(3)}) translate(-25 -40)`}>
          <path d="M14 40 C 10 22, 24 18, 22 2 C 34 16, 40 28, 36 40 Z" fill="#f97316" opacity=".85" />
        </g>
      </>);
    },
  },
  {
    type: "heattrace", group: "other", name: "Heat tracing", w: 120, h: 24, prefix: "HT", roles: ["temperature"], keywords: "trace heating",
    ports: [P("l", 0, 12), P("r", 120, 12)],
    render: (d) => (<>
      <line x1="0" y1="12" x2="120" y2="12" stroke="#3a4658" strokeWidth="8" />
      <polyline points="0,12 8,4 16,20 24,4 32,20 40,4 48,20 56,4 64,20 72,4 80,20 88,4 96,20 104,4 112,20 120,12" fill="none" strokeWidth="1.8" stroke={d.heat ?? "#f87171"} />
    </>),
  },
];

// ── instruments ──────────────────────────────────────────────────────────────
const INST_LIST: [string, string, string][] = [
  ["FT", "Flow transmitter", "flow"], ["PT", "Pressure transmitter", "pressure"], ["TT", "Temperature transmitter", "temp"], ["LT", "Level transmitter", "level"],
  ["AT", "Analyser transmitter", "analysis"], ["PDT", "Differential pressure transmitter", "dp"],
  ["FIC", "Flow controller", "flow"], ["PIC", "Pressure controller", "pressure"], ["TIC", "Temperature controller", "temp"], ["LIC", "Level controller", "level"],
  ["AIC", "Analysis controller", "analysis"], ["PDIC", "Differential pressure controller", "dp"], ["SIC", "Speed controller", "speed"],
  ["LSH", "Level switch (high)", "level"], ["PSH", "Pressure switch (high)", "pressure"], ["FSL", "Flow switch (low)", "flow"],
];
const BUBBLE_PORTS = [P("s", 24, 48), P("l", 0, 24), P("r", 48, 24)];
const INSTRUMENTS: SymDef[] = [
  ...INST_LIST.map(([letters, name, demo]): SymDef => ({
    type: `inst-${letters.toLowerCase()}`, group: "inst", name: `${letters} ${name}`, w: 48, h: 48, prefix: letters, roles: ["value"], demo, keywords: "isa bubble instrument",
    ports: BUBBLE_PORTS,
    render: (d) => (<>
      <circle className="px-eq" cx="24" cy="24" r="22" />
      {letters.endsWith("C") && <line className="px-o" x1="2" y1="24" x2="46" y2="24" />}
      <text className="px-letters" x="24" y={letters.endsWith("C") ? 19 : 21} textAnchor="middle">{letters}</text>
      <text className="px-no" x="24" y={letters.endsWith("C") ? 37 : 35} textAnchor="middle">{tagNo(d.tag)}</text>
      {valueText(d, 24, 62)}
    </>),
  })),
  {
    type: "flowmeter", group: "inst", name: "Flow meter", w: 64, h: 40, prefix: "FE", roles: ["value"], demo: "flow", keywords: "magnetic coriolis vortex magmeter",
    ports: [P("l", 0, 20), P("r", 64, 20)],
    render: (d) => (<>
      <rect className="px-eq" x="0" y="15" width="64" height="10" />
      <rect className="px-eq" x="12" y="4" width="40" height="32" rx="5" />
      <circle cx="32" cy="20" r="10" fill="none" stroke="#9fb3cc" strokeWidth="2" />
      <text className="px-letters sm" x="32" y="24" textAnchor="middle">M</text>
      {valueText(d, 32, 52)}
    </>),
  },
  {
    type: "gauge", group: "inst", name: "Pressure gauge", w: 50, h: 64, prefix: "PI", roles: ["value"], demo: "pressure", keywords: "dial manometer indicator",
    ports: [P("b", 25, 64)],
    render: (d) => (<>
      <rect className="px-eq" x="21" y="46" width="8" height="18" />
      <circle className="px-eq" cx="25" cy="25" r="23" />
      {Array.from({ length: 7 }, (_, i) => -135 + i * 45).map((a) => <line key={a} transform={`rotate(${a} 25 25)`} x1="25" y1="5" x2="25" y2="9" stroke="#7b8ba3" strokeWidth="2" />)}
      <line transform={`rotate(${-135 + 270 * (d.gauge ?? 0)} 25 25)`} x1="25" y1="25" x2="25" y2="8" stroke={d.status === "crit" ? "#ef4444" : d.status === "warn" ? "#f59e0b" : "#e2e8f0"} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="25" cy="25" r="3" fill="#cbd5e1" />
      {valueText(d, 25, 78)}
    </>),
  },
  {
    type: "energy", group: "inst", name: "Energy meter", w: 84, h: 60, prefix: "EM", roles: ["value"], demo: "energy", keywords: "power kwh electrical",
    ports: [P("l", 0, 30), P("r", 84, 30)],
    render: (d) => (<>
      <rect className="px-eq" width="84" height="60" rx="6" />
      <rect x="8" y="9" width="68" height="26" rx="3" fill="#0b1a12" stroke="#1f3b2a" />
      <text x="72" y="28" textAnchor="end" className="px-lcd">{d.text || "-----"}</text>
      <text x="42" y="50" textAnchor="middle" className="px-no">ENERGY</text>
    </>),
  },
];

// ── helpers for the industry groups ──────────────────────────────────────────
/** Squash a part horizontally with the rotor angle (agitator blades, scrapers seen from the side). */
const flatX = (d: Draw, cx: number) => `translate(${cx} 0) scale(${Math.cos((d.angle * Math.PI) / 180).toFixed(3)} 1) translate(${-cx} 0)`;
const clipDef = (d: Draw, el: ReactElement) => <defs><clipPath id={`${d.uid}c`}>{el}</clipPath></defs>;
const heatStyle = (d: Draw) => (d.heat ? { stroke: d.heat } : undefined);

// ── more vessels ─────────────────────────────────────────────────────────────
const VESSELS2: SymDef[] = [
  {
    type: "htank", group: "vessel", name: "Horizontal tank", w: 180, h: 90, prefix: "T", roles: ["level", "temperature"], keywords: "bullet storage drum",
    ports: [P("l", 0, 40), P("r", 180, 40), P("t", 90, 0), P("b", 90, 80)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="2" width="176" height="76" rx="38" />)}
      <rect className="px-eq" x="34" y="76" width="14" height="14" /><rect className="px-eq" x="132" y="76" width="14" height="14" />
      <rect className="px-eq" width="180" height="80" rx="40" />
      {liquid(d, 0, 2, 180, 76, `${d.uid}c`)}
      <rect className="px-o" width="180" height="80" rx="40" />
    </>),
  },
  {
    type: "sphere", group: "vessel", name: "Spherical tank", w: 130, h: 150, prefix: "TK", roles: ["level", "temperature"], keywords: "lpg sphere pressure storage horton",
    ports: [P("t", 65, 2), P("l", 5, 62), P("r", 125, 62), P("b", 65, 122)],
    render: (d) => (<>
      {clipDef(d, <circle cx="65" cy="62" r="58" />)}
      {[18, 46, 84, 112].map((x) => <line key={x} className="px-o" x1={x} y1="80" x2={x} y2="150" />)}
      <line className="px-d" x1="18" y1="120" x2="112" y2="120" />
      <circle className="px-eq" cx="65" cy="62" r="60" />
      {liquid(d, 0, 4, 130, 116, `${d.uid}c`)}
      <circle className="px-o" cx="65" cy="62" r="60" />
    </>),
  },
  {
    type: "daytank", group: "vessel", name: "Day tank", w: 90, h: 110, prefix: "T", roles: ["level"], keywords: "small tank dosing chemical buffer",
    ports: [P("t", 45, 0), P("l", 0, 90), P("r", 90, 90), P("b", 45, 110)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="2" width="86" height="106" rx="3" />)}
      <rect className="px-eq" width="90" height="110" rx="4" />
      {liquid(d, 0, 2, 90, 106, `${d.uid}c`)}
      <rect className="px-o" width="90" height="110" rx="4" />
    </>),
  },
  {
    type: "coneroof", group: "vessel", name: "Cone-roof storage tank", w: 160, h: 150, prefix: "TK", roles: ["level", "temperature"], keywords: "atmospheric storage crude oil product tank farm",
    ports: [P("t", 80, 0), P("l", 0, 130), P("r", 160, 130), P("b", 80, 150)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="24" width="156" height="124" />)}
      <path className="px-eq" d="M0 24 L80 2 L160 24 Z" />
      <rect className="px-eq" y="24" width="160" height="126" />
      {liquid(d, 0, 24, 160, 124, `${d.uid}c`)}
      <rect className="px-o" y="24" width="160" height="126" />
    </>),
  },
];

// ── water & effluent ─────────────────────────────────────────────────────────
const WATER: SymDef[] = [
  {
    type: "clarifier", group: "water", name: "Clarifier", w: 220, h: 90, prefix: "CL", roles: ["level", "speed"], keywords: "settler sedimentation settling tank",
    ports: [P("l", 0, 20), P("r", 220, 20), P("b", 110, 90)],
    render: (d) => {
      const shape = "M2 10 H218 V56 L124 88 H96 L2 56 Z";
      return (<>
        {clipDef(d, <path d={shape} />)}
        <path className="px-eq" d={shape} />
        {liquid(d, 0, 10, 220, 78, `${d.uid}c`)}
        <path className="px-o" d={shape} />
        <rect className="px-eq" x="100" y="0" width="20" height="12" rx="2" />
        <line x1="110" y1="12" x2="110" y2="78" className={mov(d)} strokeWidth="3" />
        <g transform={flatX(d, 110)} className={mov(d)}><path d="M30 58 L110 80 L190 58" fill="none" strokeWidth="3" /></g>
      </>);
    },
  },
  {
    type: "thickener", group: "water", name: "Thickener", w: 200, h: 120, prefix: "TH", roles: ["level", "speed"], keywords: "sludge thickening gravity",
    ports: [P("l", 0, 22), P("r", 200, 22), P("b", 100, 120)],
    render: (d) => {
      const shape = "M2 10 H198 V50 L110 110 H90 L2 50 Z";
      return (<>
        {clipDef(d, <path d={shape} />)}
        <path className="px-eq" d={shape} />
        {liquid(d, 0, 10, 200, 100, `${d.uid}c`, "pxSolid")}
        <path className="px-o" d={shape} />
        <rect className="px-eq" x="92" y="110" width="16" height="10" />
        <rect className="px-eq" x="90" y="0" width="20" height="12" rx="2" />
        <line x1="100" y1="12" x2="100" y2="100" className={mov(d)} strokeWidth="3" />
        <g transform={flatX(d, 100)} className={mov(d)}><path d="M24 52 L100 102 L176 52" fill="none" strokeWidth="3" /></g>
      </>);
    },
  },
  {
    type: "aeration", group: "water", name: "Aeration basin", w: 220, h: 90, prefix: "AB", roles: ["level", "speed"], keywords: "activated sludge biological diffuser bioreactor",
    ports: [P("l", 0, 30), P("r", 220, 30), P("b", 110, 90)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="2" width="216" height="86" rx="3" />)}
      <rect className="px-eq" width="220" height="90" rx="4" />
      {liquid(d, 0, 2, 220, 86, `${d.uid}c`)}
      <line className="px-d" x1="14" y1="80" x2="206" y2="80" />
      {d.running !== false && Array.from({ length: 12 }, (_, i) => <circle key={i} cx={22 + i * 16} cy={76 - ((d.time * 22 + i * 17) % 56)} r="2.5" fill="#e0f2fe" fillOpacity=".75" clipPath={`url(#${d.uid}c)`} />)}
      <rect className="px-o" width="220" height="90" rx="4" />
    </>),
  },
  {
    type: "sandfilter", group: "water", name: "Sand filter", w: 80, h: 130, prefix: "SF", roles: ["value"], demo: "dp", keywords: "pressure filter media multimedia carbon",
    ports: [P("t", 40, 0), P("l", 0, 30), P("r", 80, 110), P("b", 40, 130)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="2" width="76" height="126" rx="30" />)}
      <rect className="px-eq" width="80" height="130" rx="32" />
      <rect x="0" y="66" width="80" height="34" fill="#d6b98c" fillOpacity=".55" clipPath={`url(#${d.uid}c)`} />
      <rect x="0" y="100" width="80" height="30" fill="#8a6a3e" fillOpacity=".6" clipPath={`url(#${d.uid}c)`} />
      <rect className="px-o" width="80" height="130" rx="32" />
      {valueText(d, 40, 146)}
    </>),
  },
  {
    type: "ro", group: "water", name: "RO membrane", w: 180, h: 64, prefix: "RO", roles: ["value"], demo: "pressure", keywords: "reverse osmosis membrane ultrafiltration uf permeate",
    ports: [P("l", 0, 32), P("r1", 180, 12), P("r2", 180, 52)],
    render: (d) => (<>
      {[4, 24, 44].map((y) => <rect key={y} className="px-eq" x="14" y={y} width="152" height="16" rx="8" />)}
      <rect className="px-eq" x="0" y="2" width="14" height="60" rx="2" /><rect className="px-eq" x="166" y="2" width="14" height="60" rx="2" />
      {[12, 32, 52].map((y) => <line key={y} className="px-d" x1="24" x2="156" y1={y} y2={y} strokeDasharray="4 4" />)}
      {valueText(d, 90, 80)}
    </>),
  },
  {
    type: "uv", group: "water", name: "UV disinfection", w: 140, h: 44, prefix: "UV", roles: ["value"], demo: "value", keywords: "ultraviolet steriliser lamp",
    ports: [P("l", 0, 22), P("r", 140, 22)],
    render: (d) => (<>
      <rect className="px-eq" width="140" height="44" rx="22" />
      {[28, 52, 76, 100].map((x) => <line key={x} x1={x} y1="9" x2={x + 12} y2="35" stroke="#a78bfa" strokeWidth="3" strokeLinecap="round" opacity={(0.65 + 0.35 * Math.sin(d.time * 6 + x)).toFixed(2)} />)}
      {valueText(d, 70, 60)}
    </>),
  },
  {
    type: "dosing", group: "water", name: "Chemical dosing skid", w: 110, h: 100, prefix: "DS", roles: ["level", "speed"], keywords: "coagulant polymer chemical injection dosing pump metering",
    ports: [P("t", 30, 0), P("r", 110, 80)],
    render: (d) => (<>
      {clipDef(d, <rect x="6" y="2" width="48" height="76" rx="3" />)}
      <rect className="px-eq" x="4" y="0" width="52" height="80" rx="4" />
      {liquid(d, 4, 2, 52, 76, `${d.uid}c`, "pxLiq2")}
      <rect className="px-o" x="4" y="0" width="52" height="80" rx="4" />
      <line className="px-o" x1="56" y1="80" x2="68" y2="80" />
      <circle className="px-eq" cx="84" cy="80" r="16" />
      <g transform={`rotate(${d.angle} 84 80)`} className={mov(d)}><ellipse cx="84" cy="74" rx="4" ry="6" /><ellipse cx="84" cy="86" rx="4" ry="6" /></g>
      <rect className="px-eq" x="0" y="96" width="110" height="4" />
    </>),
  },
  {
    type: "chlorinator", group: "water", name: "Chlorinator", w: 70, h: 110, prefix: "CH", roles: ["value"], demo: "analysis", keywords: "chlorine gas cylinder hypochlorite disinfection",
    ports: [P("r", 70, 40)],
    render: (d) => (<>
      <line className="px-o" x1="34" y1="12" x2="56" y2="12" /><line className="px-o" x1="56" y1="12" x2="56" y2="30" />
      <rect className="px-eq" x="8" y="20" width="36" height="90" rx="16" />
      <rect className="px-eq" x="18" y="6" width="16" height="14" rx="2" />
      <rect className="px-eq" x="44" y="30" width="24" height="20" rx="3" />
      <text className="px-no" x="26" y="70" textAnchor="middle">Cl₂</text>
      {valueText(d, 35, 126)}
    </>),
  },
  {
    type: "filterpress", group: "water", name: "Filter press", w: 180, h: 80, prefix: "FP", roles: ["speed"], keywords: "sludge dewatering plate press belt press",
    ports: [P("t", 40, 0), P("b", 100, 80)],
    render: (d) => (<>
      <rect className="px-eq" x="0" y="10" width="20" height="56" rx="2" /><rect className="px-eq" x="150" y="10" width="20" height="56" rx="2" />
      <line className="px-o" x1="20" y1="16" x2="150" y2="16" /><line className="px-o" x1="20" y1="60" x2="150" y2="60" />
      {Array.from({ length: 12 }, (_, i) => <rect key={i} className="px-eq" x={28 + i * 10} y="20" width="7" height="36" />)}
      <rect className={mov(d)} x="170" y="30" width="10" height="16" />
      <path className="px-eq" d="M30 66 H140 L110 80 H60 Z" />
    </>),
  },
  {
    type: "liftstation", group: "water", name: "Lift station / wet well", w: 110, h: 150, prefix: "LS", roles: ["level", "speed"], keywords: "sump pit sewage pumping station submersible",
    ports: [P("l", 0, 40), P("r", 110, 20)],
    render: (d) => (<>
      {clipDef(d, <rect x="12" y="22" width="86" height="126" />)}
      <line className="px-d" x1="0" y1="20" x2="110" y2="20" strokeDasharray="6 4" />
      <rect className="px-eq" x="10" y="20" width="90" height="130" />
      {liquid(d, 10, 22, 90, 126, `${d.uid}c`)}
      <rect className="px-o" x="10" y="20" width="90" height="130" />
      <line className="px-o" x1="70" y1="20" x2="70" y2="118" /><line className="px-o" x1="70" y1="20" x2="110" y2="20" />
      <circle className="px-eq" cx="70" cy="130" r="14" />
      <g transform={`rotate(${d.angle} 70 130)`} className={mov(d)}><line x1="60" y1="130" x2="80" y2="130" strokeWidth="3" /><line x1="70" y1="120" x2="70" y2="140" strokeWidth="3" /></g>
    </>),
  },
];

// ── solids handling ──────────────────────────────────────────────────────────
const SOLIDS: SymDef[] = [
  {
    type: "bucketelev", group: "solids", name: "Bucket elevator", w: 60, h: 220, prefix: "BE", roles: ["speed"], keywords: "elevator lift bulk grain cement",
    ports: [P("l", 0, 200), P("r", 60, 24)],
    render: (d) => {
      const ph = ((d.angle / 360) * 40) % 20;
      return (<>
        <rect className="px-eq" x="10" y="0" width="40" height="220" rx="6" />
        <circle className="px-eq" cx="30" cy="20" r="14" /><circle className="px-eq" cx="30" cy="200" r="14" />
        <g transform={`rotate(${d.angle} 30 20)`} className={mov(d)}><line x1="18" y1="20" x2="42" y2="20" strokeWidth="2" /></g>
        <g transform={`rotate(${d.angle} 30 200)`} className={mov(d)}><line x1="18" y1="200" x2="42" y2="200" strokeWidth="2" /></g>
        <line className="px-d" x1="17" y1="22" x2="17" y2="198" /><line className="px-d" x1="43" y1="22" x2="43" y2="198" />
        {Array.from({ length: 8 }, (_, i) => <rect key={i} className={mov(d)} x="38" y={192 - (i * 20 + ph)} width="8" height="5" />)}
        <rect className="px-eq" x="50" y="18" width="10" height="12" /><rect className="px-eq" x="0" y="194" width="10" height="12" />
      </>);
    },
  },
  {
    type: "screwconv", group: "solids", name: "Screw conveyor", w: 180, h: 44, prefix: "SC", roles: ["speed"], keywords: "auger screw feeder",
    ports: [P("t", 20, 0), P("b", 162, 44)],
    render: (d) => {
      const ph = ((d.angle / 360) * 20) % 20;
      return (<>
        {clipDef(d, <rect x="8" y="8" width="164" height="28" />)}
        <rect className="px-eq" x="4" y="6" width="172" height="32" rx="6" />
        <g clipPath={`url(#${d.uid}c)`} className={mov(d)}>{Array.from({ length: 10 }, (_, i) => <line key={i} x1={i * 20 + ph} y1="34" x2={i * 20 + ph + 12} y2="10" strokeWidth="2.5" />)}</g>
        <line className="px-o" x1="8" y1="22" x2="172" y2="22" />
        <rect className="px-eq" x="12" y="0" width="16" height="8" /><rect className="px-eq" x="154" y="38" width="16" height="6" />
      </>);
    },
  },
  {
    type: "rotaryvalve", group: "solids", name: "Rotary valve", w: 60, h: 64, prefix: "RV", roles: ["speed"], keywords: "airlock rotary feeder star valve",
    ports: [P("t", 30, 0), P("b", 30, 64)],
    render: (d) => (<>
      <rect className="px-eq" x="18" y="0" width="24" height="10" /><rect className="px-eq" x="18" y="54" width="24" height="10" />
      <rect className="px-eq" x="4" y="8" width="52" height="48" rx="4" />
      <circle className="px-o" cx="30" cy="32" r="20" />
      <g transform={`rotate(${d.angle} 30 32)`} className={mov(d)}>{[0, 60, 120, 180, 240, 300].map((a) => <line key={a} transform={`rotate(${a} 30 32)`} x1="30" y1="32" x2="30" y2="14" strokeWidth="2.5" />)}</g>
    </>),
  },
  {
    type: "crusher", group: "solids", name: "Crusher", w: 100, h: 110, prefix: "CR", roles: ["speed"], keywords: "jaw cone roll crusher breaker",
    ports: [P("t", 50, 0), P("b", 50, 110)],
    render: (d) => (<>
      <path className="px-eq" d="M4 0 H96 L80 34 H20 Z" />
      <rect className="px-eq" x="14" y="34" width="72" height="56" rx="4" />
      <circle className="px-o" cx="36" cy="62" r="16" /><circle className="px-o" cx="64" cy="62" r="16" />
      <g transform={`rotate(${d.angle} 36 62)`} className={mov(d)}><line x1="24" y1="62" x2="48" y2="62" strokeWidth="2.5" /><line x1="36" y1="50" x2="36" y2="74" strokeWidth="2.5" /></g>
      <g transform={`rotate(${-d.angle} 64 62)`} className={mov(d)}><line x1="52" y1="62" x2="76" y2="62" strokeWidth="2.5" /><line x1="64" y1="50" x2="64" y2="74" strokeWidth="2.5" /></g>
      <path className="px-eq" d="M30 90 H70 L60 110 H40 Z" />
    </>),
  },
  {
    type: "ballmill", group: "solids", name: "Ball mill", w: 200, h: 90, prefix: "ML", roles: ["speed"], keywords: "grinding mill cement raw mill sag rod mill",
    ports: [P("l", 0, 45), P("r", 200, 45)],
    render: (d) => {
      const ph = ((d.angle / 360) * 28) % 28;
      return (<>
        {clipDef(d, <rect x="22" y="12" width="156" height="66" rx="10" />)}
        <rect className="px-eq" x="0" y="36" width="22" height="18" /><rect className="px-eq" x="178" y="36" width="22" height="18" />
        <rect className="px-eq" x="20" y="10" width="160" height="70" rx="12" />
        <g clipPath={`url(#${d.uid}c)`} className={mov(d)}>{Array.from({ length: 7 }, (_, i) => <line key={i} x1={22 + i * 28 + ph} y1="12" x2={22 + i * 28 + ph} y2="78" strokeWidth="2" />)}</g>
        <rect className="px-o" x="20" y="10" width="160" height="70" rx="12" />
        <rect className="px-eq" x="120" y="4" width="10" height="82" rx="2" />
      </>);
    },
  },
  {
    type: "vscreen", group: "solids", name: "Vibrating screen", w: 180, h: 70, prefix: "VS", roles: ["speed"], keywords: "sieve screen classifier grader",
    ports: [P("t", 20, 0), P("r", 180, 44), P("b", 90, 70)],
    render: (d) => {
      const dy = d.running === false ? 0 : Math.sin(d.time * 40) * 1.5;
      return (<>
        <g transform={`translate(0 ${dy.toFixed(2)})`}>
          <path className="px-eq" d="M4 8 L176 36 L176 52 L4 24 Z" />
          <path className="px-d" d="M10 18 L170 44" strokeDasharray="3 3" />
        </g>
        <polyline points="30,26 25,56 35,60 25,64 30,70" stroke="#7b8ba3" strokeWidth="2" fill="none" />
        <polyline points="150,46 145,56 155,60 145,64 150,70" stroke="#7b8ba3" strokeWidth="2" fill="none" />
        <rect className="px-eq" x="12" y="0" width="16" height="8" />
      </>);
    },
  },
  {
    type: "bagfilter", group: "solids", name: "Bag filter / dust collector", w: 110, h: 190, prefix: "BF", roles: ["value"], demo: "dp", keywords: "baghouse dust collector fabric filter pulse jet",
    ports: [P("l", 0, 110), P("t", 55, 0), P("b", 55, 190)],
    render: (d) => (<>
      <rect className="px-eq" x="4" y="10" width="102" height="120" rx="3" />
      <rect className="px-eq" x="40" y="0" width="30" height="10" />
      {[20, 38, 56, 74, 92].map((x) => <rect key={x} x={x - 5} y="22" width="10" height="96" rx="5" fill="none" stroke="#7b8ba3" strokeWidth="1.5" />)}
      <path className="px-eq" d="M4 130 H106 L64 176 H46 Z" />
      <rect className="px-eq" x="46" y="176" width="18" height="14" />
      {valueText(d, 55, 206)}
    </>),
  },
  {
    type: "weighfeeder", group: "solids", name: "Weigh feeder", w: 180, h: 70, prefix: "WF", roles: ["speed", "value"], demo: "flow", keywords: "belt weigher gravimetric loss in weight dosing",
    ports: [P("t", 30, 0), P("r", 180, 46)],
    render: (d) => (<>
      <path className="px-eq" d="M8 0 H52 L42 24 H18 Z" />
      <rect className="px-eq" x="4" y="32" width="168" height="28" rx="14" />
      {[18, 158].map((x) => <g key={x} transform={`rotate(${d.angle} ${x} 46)`} className={mov(d)}><circle cx={x} cy="46" r="10" fill="none" strokeWidth="2" /><line x1={x - 9} y1="46" x2={x + 9} y2="46" strokeWidth="2" /></g>)}
      <path d="M84 60 L96 60 L90 70 Z" fill="#9fb3cc" />
      {valueText(d, 90, 84)}
    </>),
  },
  {
    type: "kiln", group: "solids", name: "Rotary kiln", w: 260, h: 80, prefix: "KL", roles: ["temperature", "speed"], keywords: "cement clinker lime calciner rotary furnace",
    ports: [P("l", 0, 40), P("r", 260, 40)],
    render: (d) => {
      const ph = ((d.angle / 360) * 30) % 30;
      return (<>
        {clipDef(d, <rect x="12" y="14" width="236" height="52" rx="20" />)}
        <rect className="px-eq" x="10" y="12" width="240" height="56" rx="22" />
        <g clipPath={`url(#${d.uid}c)`}>{Array.from({ length: 9 }, (_, i) => <line key={i} x1={i * 30 + ph} y1="14" x2={i * 30 + ph - 10} y2="66" stroke={d.heat ?? "#3d4d64"} strokeWidth="2" />)}</g>
        <rect className="px-o" x="10" y="12" width="240" height="56" rx="22" />
        {[70, 190].map((x) => <rect key={x} className="px-eq" x={x} y="6" width="10" height="68" rx="2" />)}
        <path d="M250 40 l10 -6 v12 Z" fill="#f97316" opacity={d.running === false ? 0.3 : 0.9} />
      </>);
    },
  },
  {
    type: "rotarydryer", group: "solids", name: "Rotary dryer", w: 200, h: 80, prefix: "DR", roles: ["temperature", "speed"], keywords: "drum dryer cooler",
    ports: [P("l", 0, 40), P("r", 200, 40), P("t", 30, 0)],
    render: (d) => {
      const ph = ((d.angle / 360) * 24) % 24;
      return (<>
        {clipDef(d, <rect x="12" y="16" width="176" height="48" rx="18" />)}
        <rect className="px-eq" x="10" y="14" width="180" height="52" rx="20" />
        <g clipPath={`url(#${d.uid}c)`}>{Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${i * 24 + ph} 18 q 6 22 0 44`} stroke={d.heat ?? "#3d4d64"} strokeWidth="2" fill="none" />)}</g>
        <rect className="px-o" x="10" y="14" width="180" height="52" rx="20" />
        <rect className="px-eq" x="22" y="0" width="16" height="14" />
        {[60, 140].map((x) => <rect key={x} className="px-eq" x={x} y="8" width="8" height="64" rx="2" />)}
      </>);
    },
  },
];

// ── pharma & food ────────────────────────────────────────────────────────────
const PHARMA: SymDef[] = [
  {
    type: "fermenter", group: "pharma", name: "Fermenter / bioreactor", w: 110, h: 230, prefix: "FR", roles: ["level", "speed", "temperature"], keywords: "bioreactor fermentation vessel culture",
    ports: [P("t", 55, 34), P("l", 0, 90), P("r", 110, 90), P("b", 55, 230)],
    render: (d) => (<>
      {clipDef(d, <rect x="8" y="42" width="94" height="180" rx="22" />)}
      <rect className="px-o" y="34" width="110" height="196" rx="28" strokeDasharray="5 4" />
      <rect className="px-eq" x="6" y="40" width="98" height="184" rx="24" />
      {liquid(d, 6, 42, 98, 180, `${d.uid}c`)}
      {d.running !== false && Array.from({ length: 6 }, (_, i) => <circle key={i} cx={30 + i * 10} cy={214 - ((d.time * 30 + i * 23) % 120)} r="2" fill="#e0f2fe" fillOpacity=".7" clipPath={`url(#${d.uid}c)`} />)}
      <rect className="px-o" x="6" y="40" width="98" height="184" rx="24" />
      <rect className="px-eq" x="39" y="0" width="32" height="26" rx="4" />
      <line x1="55" y1="26" x2="55" y2="200" className={mov(d)} strokeWidth="3" />
      <g transform={flatX(d, 55)} className={mov(d)}><rect x="27" y="190" width="56" height="6" rx="3" /><rect x="31" y="140" width="48" height="6" rx="3" /></g>
      <line className="px-d" x1="30" y1="216" x2="80" y2="216" />
    </>),
  },
  {
    type: "centrifuge", group: "pharma", name: "Centrifuge", w: 100, h: 100, prefix: "CF", roles: ["speed"], keywords: "decanter separator disc stack basket",
    ports: [P("t", 50, 0), P("l", 0, 70), P("r", 100, 70)],
    render: (d) => (<>
      <rect className="px-eq" x="44" y="0" width="12" height="16" />
      <path className="px-eq" d="M10 16 H90 V60 Q90 84 50 84 Q10 84 10 60 Z" />
      <g transform={`rotate(${d.angle} 50 48)`} className={mov(d)}>{[0, 45, 90, 135].map((a) => <line key={a} transform={`rotate(${a} 50 48)`} x1="26" y1="48" x2="74" y2="48" strokeWidth="2" />)}</g>
      <circle cx="50" cy="48" r="5" fill="#9fb3cc" />
      <rect className="px-eq" x="0" y="64" width="12" height="12" /><rect className="px-eq" x="88" y="64" width="12" height="12" />
      <rect className="px-eq" x="30" y="84" width="40" height="16" rx="3" />
    </>),
  },
  {
    type: "spraydryer", group: "pharma", name: "Spray dryer", w: 120, h: 220, prefix: "SD", roles: ["temperature"], keywords: "powder dryer atomiser milk",
    ports: [P("t", 60, 0), P("l", 0, 40), P("r", 120, 150), P("b", 60, 220)],
    render: (d) => (<>
      <path className="px-eq" d="M8 16 H112 V120 L68 206 H52 L8 120 Z" />
      <rect className="px-eq" x="52" y="0" width="16" height="18" />
      {[-30, -15, 0, 15, 30].map((a) => <line key={a} transform={`rotate(${a} 60 22)`} x1="60" y1="22" x2="60" y2="70" stroke={d.heat ?? "#9fb3cc"} strokeWidth="1.5" strokeDasharray="2 4" />)}
      <rect className="px-eq" x="0" y="32" width="10" height="16" /><rect className="px-eq" x="110" y="142" width="10" height="16" />
      <rect className="px-eq" x="54" y="206" width="12" height="14" />
    </>),
  },
  {
    type: "evaporator", group: "pharma", name: "Evaporator", w: 90, h: 230, prefix: "EV", roles: ["level", "temperature"], keywords: "falling film concentrator calandria",
    ports: [P("t", 45, 0), P("r", 90, 60), P("l", 0, 120), P("b", 45, 230)],
    render: (d) => (<>
      {clipDef(d, <rect x="12" y="172" width="66" height="44" rx="10" />)}
      <rect className="px-eq" x="10" y="0" width="70" height="230" rx="14" />
      {[26, 38, 50, 62].map((x) => <line key={x} className="px-d" x1={x} x2={x} y1="40" y2="160" style={heatStyle(d)} />)}
      <line className="px-o" x1="10" y1="36" x2="80" y2="36" /><line className="px-o" x1="10" y1="164" x2="80" y2="164" />
      {liquid(d, 10, 172, 70, 44, `${d.uid}c`, "pxLiq2")}
      <rect className="px-o" x="10" y="0" width="70" height="230" rx="14" />
      <rect className="px-eq" x="0" y="112" width="10" height="16" /><rect className="px-eq" x="80" y="52" width="10" height="16" />
    </>),
  },
  {
    type: "homogeniser", group: "pharma", name: "Homogeniser", w: 110, h: 70, prefix: "HG", roles: ["speed", "value"], demo: "pressure", keywords: "high pressure homogenizer piston pump dairy",
    ports: [P("l", 0, 50), P("r", 110, 50)],
    render: (d) => {
      const s = Math.sin((d.angle * Math.PI) / 90) * 4;
      return (<>
        <rect className="px-eq" x="6" y="30" width="98" height="34" rx="4" />
        {[30, 55, 80].map((x, i) => <rect key={x} className={mov(d)} x={x - 4} y={(14 + (i % 2 ? -s : s)).toFixed(2)} width="8" height="18" />)}
        <rect className="px-eq" x="0" y="44" width="8" height="12" /><rect className="px-eq" x="102" y="44" width="8" height="12" />
        {valueText(d, 55, 82)}
      </>);
    },
  },
  {
    type: "cip", group: "pharma", name: "CIP skid", w: 170, h: 110, prefix: "CIP", roles: ["level", "temperature"], keywords: "clean in place cleaning caustic acid",
    ports: [P("l", 0, 95), P("r", 170, 95)],
    render: (d) => (<>
      {clipDef(d, <><rect x="12" y="6" width="36" height="66" rx="3" /><rect x="67" y="6" width="36" height="66" rx="3" /><rect x="122" y="6" width="36" height="66" rx="3" /></>)}
      {[10, 65, 120].map((x) => <rect key={x} className="px-eq" x={x} y="4" width="40" height="70" rx="4" />)}
      {liquid(d, 0, 6, 170, 66, `${d.uid}c`)}
      {[10, 65, 120].map((x, i) => <g key={x}><rect className="px-o" x={x} y="4" width="40" height="70" rx="4" /><text className="px-no" x={x + 20} y="68" textAnchor="middle">{["NaOH", "HNO₃", "H₂O"][i]}</text></g>)}
      <line className="px-o" x1="0" y1="95" x2="170" y2="95" style={heatStyle(d)} />
      {[30, 85, 140].map((x) => <line key={x} className="px-o" x1={x} y1="74" x2={x} y2="95" />)}
    </>),
  },
  {
    type: "autoclave", group: "pharma", name: "Autoclave / steriliser", w: 190, h: 90, prefix: "AC", roles: ["temperature", "value"], demo: "pressure", keywords: "steriliser sterilizer retort",
    ports: [P("t", 60, 0), P("b", 90, 90)],
    render: (d) => (<>
      <rect className="px-eq" x="0" y="6" width="160" height="70" rx="12" style={heatStyle(d)} />
      <rect className="px-eq" x="160" y="2" width="14" height="78" rx="3" />
      <circle className="px-o" cx="167" cy="41" r="10" /><line className="px-o" x1="157" y1="41" x2="177" y2="41" /><line className="px-o" x1="167" y1="31" x2="167" y2="51" />
      {[30, 130].map((x) => <rect key={x} className="px-eq" x={x} y="76" width="8" height="14" />)}
      {valueText(d, 80, 46)}
    </>),
  },
  {
    type: "freezedryer", group: "pharma", name: "Freeze dryer", w: 150, h: 120, prefix: "FD", roles: ["temperature"], keywords: "lyophiliser lyophilizer vacuum",
    ports: [P("l", 0, 100), P("r", 150, 100)],
    render: (d) => (<>
      <rect className="px-eq" x="0" y="0" width="96" height="120" rx="4" />
      {[22, 44, 66, 88].map((y) => <line key={y} className="px-o" x1="10" y1={y} x2="86" y2={y} style={heatStyle(d)} />)}
      <rect className="px-eq" x="104" y="20" width="46" height="70" rx="20" />
      <line className="px-o" x1="96" y1="55" x2="104" y2="55" />
      <text className="px-no" x="127" y="60" textAnchor="middle">❄</text>
    </>),
  },
  {
    type: "fillingline", group: "pharma", name: "Filling line", w: 210, h: 80, prefix: "FL", roles: ["speed"], keywords: "filler bottling capper vial packaging",
    ports: [P("l", 0, 64), P("r", 210, 64), P("t", 100, 0)],
    render: (d) => {
      const ph = ((d.angle / 360) * 60) % 30;
      return (<>
        {clipDef(d, <rect x="0" y="30" width="210" height="34" />)}
        <rect className="px-eq" x="60" y="0" width="80" height="22" rx="3" />
        {[76, 100, 124].map((x) => <rect key={x} className="px-eq" x={x - 3} y="22" width="6" height="12" />)}
        <g clipPath={`url(#${d.uid}c)`}>{Array.from({ length: 8 }, (_, i) => <path key={i} className="px-o" d={`M${i * 30 + ph - 20} 62 v-16 l4 -6 v-6 h6 v6 l4 6 v16 Z`} />)}</g>
        <rect className="px-eq" x="0" y="62" width="210" height="8" rx="4" />
        <line className="px-o" x1="20" y1="70" x2="20" y2="80" /><line className="px-o" x1="190" y1="70" x2="190" y2="80" />
      </>);
    },
  },
];

// ── oil & gas ────────────────────────────────────────────────────────────────
const OILGAS: SymDef[] = [
  {
    type: "sep3", group: "oilgas", name: "3-phase separator", w: 230, h: 80, prefix: "V", roles: ["level"], keywords: "three phase production separator oil water gas",
    ports: [P("l", 0, 40), P("t", 200, 0), P("b1", 60, 80), P("b2", 190, 80)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="2" width="160" height="76" rx="38" />)}
      <rect className="px-eq" width="230" height="80" rx="40" />
      {liquid(d, 0, 2, 230, 76, `${d.uid}c`)}
      {d.level != null && <rect x="0" y={78 - 76 * d.level} width="230" height={Math.min(14, 76 * d.level)} fill="url(#pxLiq2)" clipPath={`url(#${d.uid}c)`} />}
      <line className="px-o" x1="162" y1="34" x2="162" y2="78" />
      {d.level != null && <rect x="164" y="56" width="58" height="20" fill="url(#pxLiq2)" opacity=".85" />}
      <rect className="px-o" width="230" height="80" rx="40" />
    </>),
  },
  {
    type: "desalter", group: "oilgas", name: "Desalter", w: 230, h: 80, prefix: "D", roles: ["level"], keywords: "electrostatic dehydrator coalescer",
    ports: [P("l", 0, 60), P("t", 60, 20), P("r", 230, 40), P("b", 115, 80)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="22" width="226" height="56" rx="28" />)}
      <rect className="px-eq" x="100" y="0" width="30" height="20" rx="2" />
      <text className="px-no" x="115" y="14" textAnchor="middle">⚡</text>
      <rect className="px-eq" y="20" width="230" height="60" rx="30" />
      {liquid(d, 0, 22, 230, 56, `${d.uid}c`)}
      {[38, 48].map((y) => <line key={y} x1="40" x2="190" y1={y} y2={y} stroke="#facc15" strokeWidth="1.5" strokeDasharray="6 4" />)}
      <rect className="px-o" y="20" width="230" height="60" rx="30" />
    </>),
  },
  {
    type: "piglauncher", group: "oilgas", name: "Pig launcher / receiver", w: 190, h: 60, prefix: "PL", roles: [], keywords: "pigging scraper trap",
    ports: [P("r", 190, 30), P("t", 70, 6)],
    render: () => (<>
      <rect className="px-eq" x="14" y="6" width="110" height="48" rx="4" />
      <path className="px-eq" d="M124 6 L150 22 V38 L124 54 Z" />
      <rect className="px-eq" x="150" y="22" width="40" height="16" />
      <rect className="px-eq" x="0" y="0" width="14" height="60" rx="3" />
      <path d="M40 18 h40 a12 12 0 0 1 0 24 h-40 a12 12 0 0 1 0 -24 Z" fill="#64748b" opacity=".6" />
    </>),
  },
  {
    type: "wellhead", group: "oilgas", name: "Wellhead / X-mas tree", w: 70, h: 150, prefix: "WH", roles: ["value"], demo: "pressure", keywords: "christmas tree well oil gas production",
    ports: [P("r", 70, 70)],
    render: (d) => (<>
      <rect className="px-eq" x="28" y="10" width="14" height="140" />
      {[30, 70, 110].map((y) => <path key={y} className="px-eq" d={`M21 ${y - 12} L49 ${y + 12} L21 ${y + 12} L49 ${y - 12} Z`} />)}
      <path className="px-eq" d="M42 70 L56 60 L56 80 Z M70 60 L56 70 L70 80 Z" />
      <circle className="px-eq" cx="35" cy="8" r="8" />
      <rect className="px-eq" x="10" y="140" width="50" height="10" />
      {valueText(d, 35, 166)}
    </>),
  },
  {
    type: "heatertreater", group: "oilgas", name: "Heater treater", w: 230, h: 90, prefix: "HT", roles: ["temperature", "level"], keywords: "emulsion treater fire tube",
    ports: [P("l", 0, 30), P("t", 200, 0), P("b", 120, 90)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="2" width="226" height="86" rx="43" />)}
      <rect className="px-eq" width="230" height="90" rx="45" />
      {liquid(d, 0, 2, 230, 86, `${d.uid}c`, "pxLiq2")}
      <path d="M20 52 H150 a12 12 0 0 1 0 24 H20" fill="none" stroke={d.heat ?? "#f97316"} strokeWidth="5" strokeLinecap="round" />
      <rect className="px-o" width="230" height="90" rx="45" />
    </>),
  },
  {
    type: "gasscrubber", group: "oilgas", name: "Gas scrubber", w: 70, h: 200, prefix: "V", roles: ["level"], keywords: "knockout drum mist eliminator demister suction scrubber",
    ports: [P("l", 0, 120), P("t", 35, 0), P("b", 35, 200)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="2" width="66" height="196" rx="33" />)}
      <rect className="px-eq" width="70" height="200" rx="35" />
      {liquid(d, 0, 2, 70, 196, `${d.uid}c`)}
      <rect x="8" y="34" width="54" height="14" fill="none" stroke="#7b8ba3" strokeWidth="1.5" />
      <path d="M8 34 L22 48 L36 34 L50 48 L62 36" fill="none" stroke="#7b8ba3" strokeWidth="1.2" />
      <rect className="px-o" width="70" height="200" rx="35" />
    </>),
  },
];

// ── power & utilities ────────────────────────────────────────────────────────
const POWER: SymDef[] = [
  {
    type: "steamturbine", group: "power", name: "Steam turbine", w: 150, h: 90, prefix: "ST", roles: ["speed"], keywords: "turbine generator steam",
    ports: [P("t", 30, 0), P("b", 120, 90), P("r", 150, 45)],
    render: (d) => (<>
      <path className="px-eq" d="M10 26 L130 6 L130 84 L10 64 Z" />
      <rect className="px-eq" x="22" y="0" width="16" height="22" /><rect className="px-eq" x="112" y="80" width="16" height="10" />
      <g transform={flatX(d, 70)} className={mov(d)}>{[40, 60, 80, 100].map((x) => <line key={x} x1={x} y1={30 - (x - 40) / 6} x2={x} y2={60 + (x - 40) / 6} strokeWidth="2.5" />)}</g>
      <line x1="130" y1="45" x2="150" y2="45" className={mov(d)} strokeWidth="5" />
    </>),
  },
  {
    type: "generator", group: "power", name: "Generator", w: 100, h: 70, prefix: "G", roles: ["speed", "temperature"], keywords: "alternator genset electrical power",
    ports: [P("l", 0, 35), P("r", 100, 35)],
    render: (d) => (<>
      <line x1="0" y1="35" x2="14" y2="35" className={mov(d)} strokeWidth="5" />
      <rect className="px-eq" x="12" y="4" width="76" height="62" rx="8" />
      <circle className="px-o" cx="50" cy="35" r="22" />
      <g transform={`rotate(${d.angle} 50 35)`} className={mov(d)}><path d="M36 35 q7 -12 14 0 t14 0" fill="none" strokeWidth="2.5" /></g>
      <text className="px-letters" x="50" y="27" textAnchor="middle">G</text>
      <line className="px-o" x1="88" y1="35" x2="100" y2="35" />
    </>),
  },
  {
    type: "transformer", group: "power", name: "Transformer", w: 90, h: 110, prefix: "TR", roles: ["temperature"], keywords: "power transformer substation step up down",
    ports: [P("t", 45, 0), P("b", 45, 110)],
    render: (d) => (<>
      <line className="px-o" x1="45" y1="0" x2="45" y2="14" /><line className="px-o" x1="45" y1="96" x2="45" y2="110" />
      <circle className="px-eq" cx="45" cy="38" r="24" style={heatStyle(d)} />
      <circle className="px-o" cx="45" cy="72" r="24" style={heatStyle(d)} />
    </>),
  },
  {
    type: "switchgear", group: "power", name: "Switchgear / MCC", w: 130, h: 110, prefix: "MCC", roles: ["value"], demo: "energy", keywords: "mcc panel switchboard lv mv breaker distribution board",
    ports: [P("t", 65, 0), P("b", 65, 110)],
    render: (d) => (<>
      <rect className="px-eq" width="130" height="110" rx="3" />
      {[0, 1, 2].map((i) => <g key={i}><rect className="px-o" x={6 + i * 40} y="34" width="38" height="70" /><circle cx={25 + i * 40} cy="50" r="4" fill={d.status === "crit" && i === 1 ? "#ef4444" : "#22c55e"} /><rect x={17 + i * 40} y="62" width="16" height="22" fill="#334155" /></g>)}
      <rect x="8" y="6" width="114" height="22" rx="2" fill="#0b1a12" stroke="#1f3b2a" />
      <text x="116" y="22" textAnchor="end" className="px-lcd">{d.text || "-----"}</text>
    </>),
  },
  {
    type: "deaerator", group: "power", name: "Deaerator", w: 200, h: 160, prefix: "DA", roles: ["level", "temperature"], keywords: "feedwater tank boiler feed",
    ports: [P("t", 50, 0), P("l", 0, 115), P("r", 200, 115), P("b", 150, 160)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="82" width="196" height="66" rx="33" />)}
      <rect className="px-eq" x="30" y="0" width="40" height="88" rx="18" />
      {[24, 40, 56].map((y) => <line key={y} className="px-d" x1="36" x2="64" y1={y} y2={y} strokeDasharray="4 3" />)}
      <rect className="px-eq" y="80" width="200" height="70" rx="35" />
      {liquid(d, 0, 82, 200, 66, `${d.uid}c`)}
      <rect className="px-o" y="80" width="200" height="70" rx="35" />
      <rect className="px-eq" x="142" y="150" width="16" height="10" />
    </>),
  },
  {
    type: "airreceiver", group: "power", name: "Air receiver", w: 80, h: 170, prefix: "AR", roles: ["value"], demo: "pressure", keywords: "compressed air receiver buffer vessel",
    ports: [P("l", 0, 130), P("r", 80, 60), P("t", 40, 0)],
    render: (d) => (<>
      {[14, 66].map((x) => <line key={x} className="px-o" x1={x} y1="140" x2={x} y2="170" />)}
      <rect className="px-eq" x="0" y="6" width="80" height="140" rx="36" />
      <rect className="px-eq" x="32" y="0" width="16" height="8" />
      <circle className="px-o" cx="40" cy="70" r="12" />
      <line transform={`rotate(${-135 + 270 * (d.gauge ?? 0)} 40 70)`} x1="40" y1="70" x2="40" y2="60" stroke="#e2e8f0" strokeWidth="2" />
      {valueText(d, 40, 186)}
    </>),
  },
  {
    type: "airdryer", group: "power", name: "Air dryer", w: 100, h: 140, prefix: "AD", roles: ["value"], demo: "temp", keywords: "desiccant refrigerated dryer twin tower dew point",
    ports: [P("l", 0, 120), P("r", 100, 20)],
    render: (d) => (<>
      <line className="px-o" x1="0" y1="120" x2="100" y2="120" /><line className="px-o" x1="0" y1="20" x2="100" y2="20" />
      {[8, 56].map((x) => <g key={x}><rect className="px-eq" x={x} y="14" width="36" height="112" rx="16" /><rect x={x + 4} y="40" width="28" height="60" fill="#d6b98c" fillOpacity=".35" /></g>)}
      {valueText(d, 50, 156)}
    </>),
  },
  {
    type: "chiller", group: "power", name: "Chiller", w: 170, h: 100, prefix: "CH", roles: ["temperature", "speed"], keywords: "water chiller refrigeration hvac",
    ports: [P("l1", 0, 30), P("l2", 0, 75), P("r1", 170, 30), P("r2", 170, 75)],
    render: (d) => (<>
      <line className="px-o" x1="0" y1="30" x2="170" y2="30" /><line className="px-o" x1="0" y1="75" x2="170" y2="75" />
      <rect className="px-eq" x="10" y="16" width="150" height="28" rx="14" />
      <rect className="px-eq" x="10" y="60" width="150" height="30" rx="15" style={heatStyle(d)} />
      <circle className="px-eq" cx="120" cy="52" r="14" />
      <g transform={`rotate(${d.angle} 120 52)`} className={mov(d)}><line x1="110" y1="52" x2="130" y2="52" strokeWidth="2.5" /><line x1="120" y1="42" x2="120" y2="62" strokeWidth="2.5" /></g>
      <text className="px-no" x="24" y="34">COND</text><text className="px-no" x="24" y="79">EVAP</text>
    </>),
  },
  {
    type: "ahu", group: "power", name: "Air handling unit", w: 220, h: 90, prefix: "AHU", roles: ["speed", "temperature"], keywords: "ahu hvac air handler fan coil",
    ports: [P("l", 0, 45), P("r", 220, 45), P("b1", 90, 90), P("b2", 110, 90)],
    render: (d) => (<>
      <rect className="px-eq" width="220" height="90" rx="3" />
      <line className="px-o" x1="60" y1="0" x2="60" y2="90" /><line className="px-o" x1="140" y1="0" x2="140" y2="90" />
      <path className="px-d" d="M12 10 L48 80 M48 10 L12 80" />
      {[74, 86, 98, 110, 122].map((x) => <line key={x} className="px-d" x1={x} x2={x} y1="10" y2="80" style={heatStyle(d)} />)}
      <circle className="px-o" cx="180" cy="45" r="28" />
      <g transform={`rotate(${d.angle} 180 45)`} className={mov(d)}>{[0, 120, 240].map((a) => <path key={a} transform={`rotate(${a} 180 45)`} d="M180 45 C 176 35, 178 25, 186 21 C 188 29, 186 39, 180 45 Z" />)}</g>
    </>),
  },
  {
    type: "solar", group: "power", name: "Solar PV array", w: 150, h: 100, prefix: "PV", roles: ["value"], demo: "energy", keywords: "solar photovoltaic panel pv inverter renewable",
    ports: [P("b", 75, 100)],
    render: (d) => (<>
      <path d="M20 10 H140 L120 66 H0 Z" fill="#1e3a8a" fillOpacity=".8" />
      {[1, 2, 3].map((i) => <line key={i} x1={20 + i * 30} y1="10" x2={i * 30} y2="66" stroke="#93c5fd" strokeOpacity=".5" />)}
      <line x1="10" y1="38" x2="130" y2="38" stroke="#93c5fd" strokeOpacity=".5" />
      <path className="px-o" d="M20 10 H140 L120 66 H0 Z" />
      <line className="px-o" x1="60" y1="66" x2="60" y2="84" /><line className="px-o" x1="90" y1="66" x2="90" y2="84" />
      <text x="75" y="98" textAnchor="middle" className="px-val">{d.text}</text>
    </>),
  },
  {
    type: "bess", group: "power", name: "Battery storage (BESS)", w: 140, h: 90, prefix: "BESS", roles: ["level", "temperature"], keywords: "battery bms energy storage container lithium soc",
    ports: [P("l", 0, 60), P("r", 140, 60)],
    render: (d) => {
      const lv = d.level ?? 0.5;
      return (<>
        <rect className="px-eq" width="140" height="90" rx="3" style={heatStyle(d)} />
        {[0, 1, 2, 3, 4].map((i) => <g key={i}><rect x={10 + i * 25} y="12" width="18" height="66" rx="2" fill="#0f172a" stroke="#475569" /><rect x={12 + i * 25} y={14 + 62 * (1 - lv)} width="14" height={62 * lv} fill={lv < 0.15 ? "#ef4444" : lv < 0.3 ? "#f59e0b" : "#22c55e"} opacity=".8" /></g>)}
      </>);
    },
  },
  {
    type: "wind", group: "power", name: "Wind turbine", w: 100, h: 210, prefix: "WTG", roles: ["speed"], keywords: "wind turbine wtg renewable",
    ports: [P("b", 50, 210)],
    render: (d) => (<>
      <path className="px-eq" d="M46 60 L54 60 L58 206 L42 206 Z" />
      <rect className="px-eq" x="40" y="44" width="26" height="14" rx="4" />
      <g transform={`rotate(${d.angle} 50 50)`} className={mov(d)}>{[0, 120, 240].map((a) => <path key={a} transform={`rotate(${a} 50 50)`} d="M50 50 L46 8 Q50 2 54 8 Z" />)}</g>
      <circle cx="50" cy="50" r="5" fill="#cbd5e1" />
      <rect className="px-eq" x="30" y="204" width="40" height="6" />
    </>),
  },
];

// ── textile ──────────────────────────────────────────────────────────────────
const TEXTILE: SymDef[] = [
  {
    type: "jetdyeing", group: "textile", name: "Jet dyeing machine", w: 170, h: 120, prefix: "DY", roles: ["level", "temperature"], keywords: "dyeing jet soft flow winch htht",
    ports: [P("l", 0, 90), P("r", 170, 90), P("b1", 50, 120), P("b2", 120, 120)],
    render: (d) => (<>
      {clipDef(d, <rect x="2" y="32" width="166" height="76" rx="36" />)}
      <rect className="px-eq" x="0" y="30" width="170" height="80" rx="38" />
      {liquid(d, 0, 32, 170, 76, `${d.uid}c`, "pxLiq2")}
      <path d="M30 80 C 30 20, 140 20, 140 80" fill="none" stroke="#c4b5fd" strokeWidth="3" strokeDasharray="8 5" strokeDashoffset={(-d.time * 20).toFixed(1)} />
      <rect className="px-eq" x="70" y="0" width="30" height="30" rx="4" />
      <rect className="px-o" x="0" y="30" width="170" height="80" rx="38" style={heatStyle(d)} />
      {[50, 120].map((x) => <rect key={x} className="px-eq" x={x - 6} y="108" width="12" height="12" />)}
    </>),
  },
  {
    type: "jigger", group: "textile", name: "Jigger", w: 150, h: 90, prefix: "JG", roles: ["speed"], keywords: "jigger dyeing roller fabric batch",
    ports: [P("b", 75, 90)],
    render: (d) => (<>
      <path className="px-eq" d="M10 40 H140 L120 86 H30 Z" />
      {[30, 120].map((x) => <g key={x} transform={`rotate(${d.angle} ${x} 22)`} className={mov(d)}><circle cx={x} cy="22" r="18" fill="none" strokeWidth="3" /><line x1={x - 16} y1="22" x2={x + 16} y2="22" strokeWidth="2" /></g>)}
      <path d="M30 40 L60 76 H90 L120 40" fill="none" stroke="#c4b5fd" strokeWidth="2.5" />
      <rect className="px-eq" x="69" y="84" width="12" height="6" />
    </>),
  },
  {
    type: "stenter", group: "textile", name: "Stenter", w: 260, h: 70, prefix: "SN", roles: ["temperature", "speed"], keywords: "tenter frame heat setting drying finishing",
    ports: [P("l", 0, 40), P("r", 260, 40)],
    render: (d) => (<>
      <rect className="px-eq" x="20" y="8" width="220" height="56" rx="3" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={26 + i * 43} y="14" width="38" height="44" fill={d.heat ?? "#3d4d64"} fillOpacity=".25" stroke="#3d4d64" />)}
      <line x1="0" y1="40" x2="260" y2="40" stroke="#c4b5fd" strokeWidth="3" strokeDasharray="12 6" strokeDashoffset={(-((d.angle / 360) * 36)).toFixed(1)} />
    </>),
  },
  {
    type: "washer", group: "textile", name: "Open-width washer", w: 210, h: 80, prefix: "WR", roles: ["level", "temperature"], keywords: "washing range soaper rinsing",
    ports: [P("l", 0, 20), P("r", 210, 20), P("b", 105, 80)],
    render: (d) => (<>
      {clipDef(d, <><rect x="12" y="22" width="56" height="56" /><rect x="77" y="22" width="56" height="56" /><rect x="142" y="22" width="56" height="56" /></>)}
      {[10, 75, 140].map((x) => <rect key={x} className="px-eq" x={x} y="20" width="60" height="60" />)}
      {liquid(d, 0, 22, 210, 56, `${d.uid}c`)}
      {[10, 75, 140].map((x) => <rect key={x} className="px-o" x={x} y="20" width="60" height="60" style={heatStyle(d)} />)}
      <polyline points="0,20 20,70 30,20 50,70 60,20 85,70 95,20 115,70 125,20 150,70 160,20 180,70 190,20 210,20" fill="none" stroke="#c4b5fd" strokeWidth="2" />
    </>),
  },
  {
    type: "cyldryer", group: "textile", name: "Cylinder dryer", w: 190, h: 90, prefix: "CD", roles: ["temperature", "speed"], keywords: "drying range can dryer fabric",
    ports: [P("l", 0, 45), P("r", 190, 45)],
    render: (d) => (<>
      <rect className="px-eq" x="6" y="0" width="178" height="90" rx="4" />
      {[[40, 26], [95, 26], [150, 26], [67, 64], [122, 64]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle className="px-o" cx={x} cy={y} r="17" style={heatStyle(d)} />
          <g transform={`rotate(${d.angle} ${x} ${y})`} className={mov(d)}><line x1={x - 14} y1={y} x2={x + 14} y2={y} strokeWidth="2" /></g>
        </g>
      ))}
      <line className="px-o" x1="0" y1="45" x2="6" y2="45" /><line className="px-o" x1="184" y1="45" x2="190" y2="45" />
    </>),
  },
];

// ── more instruments ─────────────────────────────────────────────────────────
const ANALYSERS: [string, string, string, string, string][] = [
  ["analyser-ph", "pH analyser", "pH", "analysis", "ph acidity alkalinity"],
  ["analyser-cond", "Conductivity analyser", "µS/cm", "cond", "conductivity tds salinity"],
  ["analyser-o2", "Oxygen analyser", "O₂", "o2", "dissolved oxygen do flue gas"],
];
const INSTRUMENTS2: SymDef[] = [
  ...ANALYSERS.map(([type, name, unit, demo, keywords]): SymDef => ({
    type, group: "inst", name, w: 70, h: 56, prefix: "AT", roles: ["value"], demo, keywords: `analyser analyzer ${keywords}`,
    ports: [P("b", 35, 56), P("l", 0, 22), P("r", 70, 22)],
    render: (d) => (<>
      <line className="px-o" x1="35" y1="44" x2="35" y2="56" />
      <rect className="px-eq" width="70" height="44" rx="5" />
      <rect x="6" y="6" width="58" height="20" rx="2" fill="#0b1a12" stroke="#1f3b2a" />
      <text x="60" y="21" textAnchor="end" className="px-lcd" style={{ fontSize: 11 }}>{d.value != null ? d.value.toFixed(d.value < 100 ? 2 : 0) : "--"}</text>
      <text x="35" y="39" textAnchor="middle" className="px-no">{unit}</text>
    </>),
  })),
  {
    type: "vfd", group: "inst", name: "Variable frequency drive (VFD)", w: 70, h: 90, prefix: "VFD", roles: ["speed", "value"], demo: "freq", keywords: "vfd vsd inverter drive frequency",
    ports: [P("t", 35, 0), P("b", 35, 90)],
    render: (d) => (<>
      <rect className="px-eq" width="70" height="90" rx="4" />
      <rect x="8" y="10" width="54" height="22" rx="2" fill="#0b1a12" stroke="#1f3b2a" />
      <text x="58" y="26" textAnchor="end" className="px-lcd" style={{ fontSize: 12 }}>{d.value != null ? d.value.toFixed(1) : "--"}</text>
      <text x="35" y="48" textAnchor="middle" className="px-no">Hz</text>
      <circle cx="20" cy="66" r="4" fill={d.running === false ? "#4b5563" : "#22c55e"} />
      <circle cx="35" cy="66" r="4" fill={d.status === "crit" ? "#ef4444" : "#4b5563"} />
      <path d="M46 72 q4 -12 8 0 t8 0" stroke="#9fb3cc" fill="none" strokeWidth="1.5" />
    </>),
  },
];

// ── custom blocks: a labelled box for anything not in the library ────────────
function block(type: string, name: string, w: number, h: number): SymDef {
  return {
    type, group: "custom", name, w, h, prefix: "X", roles: ["value"], demo: "value", keywords: "custom block generic box equipment other",
    ports: [P("t", w / 2, 0), P("r", w, h / 2), P("b", w / 2, h), P("l", 0, h / 2), P("t1", w / 4, 0), P("t2", (3 * w) / 4, 0), P("b1", w / 4, h), P("b2", (3 * w) / 4, h)],
    render: (d) => {
      const text = (d.label || d.tag || "").slice(0, Math.max(6, Math.floor(w / 8)));
      return (<>
        <rect className="px-eq" width={w} height={h} rx="6" />
        <text className="px-letters" x={w / 2} y={h / 2 + (d.text ? -2 : 4)} textAnchor="middle">{text}</text>
        {d.text && <text className="px-no" x={w / 2} y={h / 2 + 14} textAnchor="middle">{d.text}</text>}
      </>);
    },
  };
}
const CUSTOM_BLOCKS: SymDef[] = [block("block", "Custom block", 120, 70), block("block-wide", "Custom block (wide)", 220, 70), block("block-tall", "Custom block (tall)", 90, 160)];

export const SYMBOLS: SymDef[] = [...VESSELS, ...VESSELS2, ...ROTATING, ...VALVES, ...HEAT, ...OTHER, ...INSTRUMENTS, ...INSTRUMENTS2, ...WATER, ...SOLIDS, ...PHARMA, ...OILGAS, ...POWER, ...TEXTILE, ...CUSTOM_BLOCKS];
export const SYM: Record<string, SymDef> = Object.fromEntries(SYMBOLS.map((s) => [s.type, s]));

/** Fallback so an unknown type in a saved twin still draws (as a box). */
export const UNKNOWN: SymDef = {
  type: "unknown", group: "other", name: "Unknown symbol", w: 60, h: 40, prefix: "X", roles: [], ports: [P("l", 0, 20), P("r", 60, 20)],
  render: () => <rect className="px-eq" width="60" height="40" rx="4" strokeDasharray="4 3" />,
};
/**
 * "My symbols": drawings or images the user uploaded. They travel inside the
 * scene (scene.custom) and are registered here so every part of the builder can
 * draw them. Shown with <image>, so an SVG never runs scripts or loads links.
 */
export interface MineSym { id: string; name: string; w: number; h: number; src: string }
const MINE = new Map<string, { def: SymDef; sym: MineSym }>();
export const mineType = (id: string) => `my-${id}`;
export const isMineType = (type: string) => type.startsWith("my-");
export function mineDef(m: MineSym): SymDef {
  const { w, h } = m;
  return {
    type: mineType(m.id), group: "mine", name: m.name, w, h, prefix: "X", roles: ["value"], demo: "value", keywords: "my custom upload",
    ports: [P("t", w / 2, 0), P("r", w, h / 2), P("b", w / 2, h), P("l", 0, h / 2)],
    render: (d) => (<>
      <image href={m.src} width={w} height={h} preserveAspectRatio="xMidYMid meet" />
      <rect className="px-frame" width={w} height={h} rx="4" />
      {valueText(d, w / 2, h + 14)}
    </>),
  };
}
export function registerMine(list: MineSym[] | undefined) {
  for (const m of list ?? []) { const ty = mineType(m.id); if (!MINE.has(ty)) MINE.set(ty, { def: mineDef(m), sym: m }); }
}
/** The uploaded symbol behind a "my-…" type, when known in this browser session. */
export const mineSym = (type: string) => MINE.get(type)?.sym;
export const symDef = (type: string) => SYM[type] ?? MINE.get(type)?.def ?? UNKNOWN;

/** Style rules, embedded in the SVG itself so PNG snapshots keep them. */
export const PX_CSS = `
.px-eq { fill: var(--px-fill, #1a2433); stroke: var(--px-stroke, #5a6b85); stroke-width: 2; }
.px-o { fill: none; stroke: var(--px-stroke, #5a6b85); stroke-width: 2; }
.px-frame { fill: none; stroke: transparent; stroke-width: 2; }
.px-sym.warn .px-frame { stroke: #f59e0b; }
.px-sym.crit .px-frame { stroke: #ef4444; animation: px-pulse 1s ease-in-out infinite; }
.px-note { font: 500 14px system-ui, sans-serif; }
.px-d { fill: none; stroke: #3d4d64; stroke-width: 2; }
.px-m { fill: #9fb3cc; stroke: #9fb3cc; }
.px-m.stopped { fill: #4b5563; stroke: #4b5563; }
.px-sym.warn .px-eq, .px-sym.warn .px-o { stroke: #f59e0b; }
.px-sym.crit .px-eq, .px-sym.crit .px-o { stroke: #ef4444; animation: px-pulse 1s ease-in-out infinite; }
.px-sym.flash { animation: px-flash .6s ease-in-out 5; }
@keyframes px-pulse { 50% { stroke-width: 5; } }
@keyframes px-flash { 50% { opacity: .25; } }
.px-letters { fill: #dbe5f1; font: 600 12px system-ui, sans-serif; }
.px-letters.sm { font-size: 11px; }
.px-no { fill: #8796ab; font: 500 10px system-ui, sans-serif; }
.px-val { fill: #e2e8f0; font: 600 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.px-lcd { fill: #4ade80; font: 600 13px ui-monospace, SFMono-Regular, Consolas, monospace; }
.px-lbl { fill: #8796ab; font: 600 13px system-ui, sans-serif; letter-spacing: .02em; }
.px-plbl { fill: #8796ab; font: 500 11px system-ui, sans-serif; }
.px-bub rect.bg { fill: #0f1520; stroke: #2c3a50; stroke-width: 1.2; }
.px-bub.warn rect.bg { stroke: #f59e0b; } .px-bub.crit rect.bg { stroke: #ef4444; animation: px-pulse 1s ease-in-out infinite; }
.px-bub.nolink .bv { fill: #64748b; }
.px-bub .bt { fill: #8796ab; font: 500 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.px-bub .bv { fill: #e2e8f0; font: 600 14px ui-monospace, SFMono-Regular, Consolas, monospace; }
.px-bub .bd { fill: #f59e0b; font: 500 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.px-port { fill: #0ea5e9; stroke: #e0f2fe; stroke-width: 1.5; cursor: crosshair; }
.px-port:hover { fill: #f97316; }
.px-handle { fill: #f8fafc; stroke: #0ea5e9; stroke-width: 2; cursor: move; }
@media (prefers-reduced-motion: reduce) { .px-sym.crit .px-eq, .px-sym.crit .px-o, .px-bub.crit rect.bg, .px-sym.flash { animation: none; } }
`;

/** Gradients shared by every symbol; placed once in the canvas <defs>. */
export function SymbolDefs() {
  return (<>
    <linearGradient id="pxLiq" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#38bdf8" stopOpacity=".75" /><stop offset="1" stopColor="#1d4ed8" stopOpacity=".85" /></linearGradient>
    <linearGradient id="pxLiq2" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fb923c" stopOpacity=".65" /><stop offset="1" stopColor="#9a3412" stopOpacity=".85" /></linearGradient>
    <linearGradient id="pxSolid" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#d6b98c" stopOpacity=".7" /><stop offset="1" stopColor="#8a6a3e" stopOpacity=".85" /></linearGradient>
  </>);
}

/** Small preview for the palette. */
export function SymbolPreview({ def, size = 36 }: { def: SymDef; size?: number }) {
  const d: Draw = { uid: `pv-${def.type}`, level: def.roles.includes("level") ? 0.6 : null, angle: 20, running: true, open: def.roles.includes("opening") ? 0.7 : null, heat: null, value: null, text: "", gauge: 0.55, status: "ok", tag: `${def.prefix}-101`, time: 0 };
  const pad = 4;
  return (
    <svg width={size} height={size} viewBox={`${-pad} ${-pad} ${def.w + pad * 2} ${def.h + pad * 2}`} aria-hidden="true">
      <defs><SymbolDefs /></defs>
      <style>{PX_CSS}</style>
      {def.render(d)}
    </svg>
  );
}
