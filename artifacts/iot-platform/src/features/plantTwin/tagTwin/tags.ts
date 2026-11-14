/**
 * Readings of the 3D Machine Twin (pump skid) and the Process Twin (P&ID), and
 * the demo simulation that stands in for readings not linked to an asset.
 * Ported from the Live Twin concepts demo. Demo values are never plant data and
 * are labelled "demo" wherever they show.
 */

export type Src = "live" | "demo" | "none";
export type TagStatus = "ok" | "warn" | "crit" | "nolink";
export interface TagMeta { key: string; tag: string; n: string; u: string; d: number; rest: number; status: (v: number) => "ok" | "warn" | "crit" }

const hi = (warn: number, crit: number) => (v: number) => (v >= crit ? "crit" : v >= warn ? "warn" : "ok");
const lo = (warn: number, crit: number) => (v: number) => (v <= crit ? "crit" : v <= warn ? "warn" : "ok");
const none = () => "ok" as const;

export const TAGS: Record<string, TagMeta> = {
  rpm:   { key: "rpm",   tag: "SI-101",  n: "Speed",               u: "rpm",  d: 0, rest: 0,  status: (v) => (v < 100 ? "crit" : "ok") },
  flow:  { key: "flow",  tag: "FT-101",  n: "Flow",                u: "m³/h", d: 1, rest: 0,  status: lo(80, 10) },
  pres:  { key: "pres",  tag: "PT-101",  n: "Discharge pressure",  u: "bar",  d: 2, rest: 0,  status: lo(2.5, 1) },
  vib:   { key: "vib",   tag: "VT-101",  n: "Bearing vibration",   u: "mm/s", d: 1, rest: 0,  status: hi(4.5, 7.1) },
  temp:  { key: "temp",  tag: "TT-101",  n: "Bearing temperature", u: "°C",   d: 1, rest: 30, status: hi(80, 95) },
  amps:  { key: "amps",  tag: "IT-101",  n: "Motor current",       u: "A",    d: 1, rest: 0,  status: none },
  level: { key: "level", tag: "LT-101",  n: "Tank level",          u: "%",    d: 1, rest: 50, status: hi(85, 92) },
  valve: { key: "valve", tag: "ZT-101",  n: "Valve opening",       u: "%",    d: 0, rest: 0,  status: none },
  hxOut: { key: "hxOut", tag: "TT-201",  n: "Cooler outlet",       u: "°C",   d: 1, rest: 30, status: hi(48, 55) },
  rx:    { key: "rx",    tag: "TT-301",  n: "Reactor temperature", u: "°C",   d: 1, rest: 30, status: none },
  agit:  { key: "agit",  tag: "SIC-101", n: "Agitator speed",      u: "rpm",  d: 0, rest: 0,  status: none },
};
export const MACHINE_KEYS = ["rpm", "flow", "pres", "vib", "temp", "amps"];
export const PROCESS_KEYS = ["level", "flow", "pres", "valve", "hxOut", "rx", "agit"];
export const ALIASES: Record<string, string[]> = {
  rpm: ["speed", "rpm"], flow: ["flow", "flowrate"], pres: ["pressure", "dischargepressure", "pres"], vib: ["vibration", "vib"],
  temp: ["temperature", "bearingtemperature", "temp"], amps: ["current", "amps", "motorcurrent"], level: ["level", "tanklevel"],
  valve: ["valve", "valveopening", "position", "opening"], hxOut: ["outlettemperature", "coolerout", "outlet"], rx: ["reactortemperature", "temperature"], agit: ["agitator", "agitatorspeed", "speed"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Best metric of an asset for one reading, or "" when nothing matches. */
export function matchMetric(key: string, metrics: string[], used = new Set<string>()): string {
  const want = [norm(key), norm(TAGS[key]?.n ?? ""), ...(ALIASES[key] ?? []).map(norm)];
  const bare = (m: string) => norm(m.includes(".") ? m.split(".").slice(1).join(".") : m);
  for (const w of want) { const m = metrics.find((x) => !used.has(x) && bare(x) === w); if (m) return m; }
  for (const w of want) { if (w.length < 3) continue; const m = metrics.find((x) => !used.has(x) && bare(x).includes(w)); if (m) return m; }
  return "";
}

/* ---------- demo simulation ---------- */
export type Scenario = "normal" | "cavitation" | "overheat" | "trip";
const SCEN: Record<Scenario, { rpm: number; flow: number; pres: number; vib: number; temp: number; amps: number }> = {
  normal:     { rpm: 1480, flow: 120, pres: 4.2, vib: 2.1, temp: 62,  amps: 38 },
  cavitation: { rpm: 1480, flow: 92,  pres: 3.0, vib: 7.9, temp: 71,  amps: 41 },
  overheat:   { rpm: 1480, flow: 118, pres: 4.1, vib: 3.6, temp: 101, amps: 46 },
  trip:       { rpm: 0,    flow: 0,   pres: 0.3, vib: 0.1, temp: 48,  amps: 0 },
};
export function createDemoSim() {
  const S: Record<string, number> = { rpm: 1480, flow: 120, pres: 4.2, vib: 2.1, temp: 62, amps: 38, level: 68, valve: 70, hxOut: 41, rx: 74, agit: 120 };
  const noise = (k: number) => (Math.random() - 0.5) * k;
  const sim = {
    S, scenario: "normal" as Scenario, valve: 70,
    step(dt: number) {
      const t = SCEN[sim.scenario], vf = sim.valve / 70;
      const target: Record<string, number> = { rpm: t.rpm, amps: t.amps * (0.85 + 0.15 * vf), vib: t.vib, temp: t.temp, flow: t.flow * Math.min(vf, 100 / 70), pres: t.pres * (1 + (70 - sim.valve) / 150) };
      const k = Math.min(1, dt * 0.9);
      for (const key in target) S[key] += (target[key] - S[key]) * k;
      S.rpm += noise(t.rpm ? 6 : 0); S.flow += noise(t.flow ? 1.6 : 0); S.pres += noise(t.pres > 1 ? (sim.scenario === "cavitation" ? 0.35 : 0.05) : 0);
      S.vib += noise(t.vib > 1 ? (sim.scenario === "cavitation" ? 0.6 : 0.12) : 0); S.temp += noise(0.3); S.amps += noise(t.amps ? 0.4 : 0);
      for (const key of ["rpm", "flow", "vib", "pres"]) S[key] = Math.max(0, S[key]);
      const levelT = sim.scenario === "trip" ? 93 : 68 - (S.flow - 120) * 0.08;
      S.level += (levelT - S.level) * dt * 0.08 + noise(0.05);
      S.valve += (sim.valve - S.valve) * Math.min(1, dt * 3);
      S.hxOut += ((38 + 22 * (1 - Math.min(S.flow, 140) / 140)) - S.hxOut) * dt * 0.4 + noise(0.08);
      S.rx += ((60 + S.hxOut * 0.34) - S.rx) * dt * 0.2 + noise(0.06);
      S.agit += (118 - S.agit) * dt + noise(1.2);
    },
  };
  return sim;
}
export type DemoSim = ReturnType<typeof createDemoSim>;
export const fmt = (key: string, v: number | null) => (v == null ? "—" : `${v.toFixed(TAGS[key].d)} ${TAGS[key].u}`);
