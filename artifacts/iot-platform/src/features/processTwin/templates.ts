import { sampleScene, type Drive, type End, type Item, type LimitsCfg, type Medium, type LineType, type NoteItem, type PipeItem, type ProcessScene, type Role, type SymItem, type TagItem } from "./scene";

/**
 * Industry process templates for the Process twin builder. Each one is an
 * ordinary scene built from library symbols, with pipes and tag bubbles; every
 * reading shows demo values until it is linked to an asset metric.
 */
type Drives = Partial<Record<Role, Drive>>;
const L = (min: number, max: number, limits?: LimitsCfg): Drive => ({ min, max, ...(limits ? { limits } : {}) });
const S = (id: string, type: string, x: number, y: number, tag: string, label: string, drives: Drives = {}, scale = 1): SymItem =>
  ({ kind: "sym", id, type, x, y, rot: 0, scale, tag, label, drives });
const B = (id: string, x: number, y: number, tag: string, label: string, attach: string, unit: string, demoKind: string, decimals = 1, limits?: LimitsCfg): TagItem =>
  ({ kind: "tag", id, x, y, tag, label, attach, unit, decimals, demoKind, ...(limits ? { limits } : {}) });
type E = [string, string] | [number, number];
const end = (e: E): End => (typeof e[0] === "string" ? { sym: e[0], port: e[1] as string } : { x: e[0], y: e[1] as number });
const PP = (id: string, a: E, b: E, medium: Medium, o: { line?: LineType; label?: string; mid?: [number, number][]; flow?: number } = {}): PipeItem => ({
  id, a: end(a), b: end(b), mid: o.mid ?? [], line: o.line ?? "process", medium, arrows: true,
  ...(o.label ? { label: o.label } : {}), ...(o.flow ? { flow: { min: 0, max: o.flow } } : {}),
});
const Z = (id: string, x: number, y: number, w: number, h: number, text: string): NoteItem => ({ id, kind: "zone", x, y, w, h, text });
const scene = (items: Item[], pipes: PipeItem[], notes: NoteItem[] = []): ProcessScene => ({ kind: "process", version: 2, items, pipes, demo: true, ...(notes.length ? { notes } : {}) });

function water(): ProcessScene {
  return scene([
    S("ls1", "liftstation", 40, 160, "LS-101", "Raw water", { level: L(0, 100, { warn: 85, crit: 95 }), speed: L(0, 1500) }),
    S("ds1", "dosing", 240, 10, "DS-101", "Coagulant", { level: L(0, 100, { low: 20, lowCrit: 10 }), speed: L(0, 1500) }),
    S("cl1", "clarifier", 230, 150, "CL-101", "Clarifier", { level: L(0, 100), speed: L(0, 6000) }),
    S("sf1", "sandfilter", 520, 110, "SF-101", "Sand filter"),
    S("uv1", "uv", 650, 198, "UV-101", "UV"),
    S("ch1", "chlorinator", 760, 10, "CH-101", "Chlorine"),
    S("tk1", "tank", 850, 100, "T-101", "Treated water", { level: L(0, 100, { warn: 90, crit: 96 }) }),
    S("p1", "cpump", 1030, 216, "P-101", "Distribution pump", { speed: L(0, 1500) }),
    S("sp1", "filterpress", 300, 330, "FP-101", "Sludge press", { speed: L(0, 1500) }),
    B("b1", 30, 90, "LT-101", "well", "ls1", "%", "level", 1, { warn: 85, crit: 95 }),
    B("b2", 140, 260, "FT-101", "raw", "pw1", "m³/h", "flow"),
    B("b3", 380, 60, "AT-101", "turbidity", "cl1", "NTU", "analysis", 2),
    B("b4", 610, 60, "PDT-101", "filter", "sf1", "bar", "dp", 2, { warn: 0.8, crit: 1.2 }),
    B("b5", 1000, 40, "AT-102", "Cl₂ resid.", "tk1", "mg/L", "analysis", 2),
    B("b6", 1120, 300, "PT-101", "disch.", "p1", "bar", "pressure", 2, { low: 2.5, lowCrit: 1 }),
  ], [
    PP("pw0", [-40, 200], ["ls1", "l"], "water", { label: "raw water", flow: 150 }),
    PP("pw1", ["ls1", "r"], ["cl1", "l"], "water", { flow: 150 }),
    PP("pw2", ["ds1", "r"], [300, 160], "chemical", { line: "utility" }),
    PP("pw3", ["cl1", "r"], ["sf1", "l"], "water", { flow: 150 }),
    PP("pw4", ["sf1", "r"], ["uv1", "l"], "water", { flow: 150 }),
    PP("pw5", ["uv1", "r"], ["tk1", "l"], "water", { flow: 150 }),
    PP("pw6", ["ch1", "r"], ["tk1", "t"], "chemical", { line: "utility" }),
    PP("pw7", ["tk1", "r"], ["p1", "in"], "water", { flow: 150 }),
    PP("pw8", ["p1", "out"], [1200, 150], "water", { label: "to distribution", flow: 150 }),
    PP("pw9", ["cl1", "b"], ["sp1", "t"], "product", { line: "utility", label: "sludge" }),
  ], [Z("z1", 0, -20, 470, 450, "PRE-TREATMENT"), Z("z2", 490, -20, 760, 450, "FILTRATION & DISINFECTION")]);
}

function boiler(): ProcessScene {
  return scene([
    S("da1", "deaerator", 40, 120, "DA-101", "Deaerator", { level: L(0, 100, { low: 30, lowCrit: 15 }), temperature: L(60, 130) }),
    S("fp1", "cpump", 290, 236, "P-101", "Feed pump", { speed: L(0, 3000) }),
    S("b1", "boiler", 420, 150, "B-101", "Boiler", { temperature: L(100, 450), level: L(0, 100, { low: 30, lowCrit: 15 }) }),
    S("st1", "steamturbine", 640, 60, "ST-101", "Steam turbine", { speed: L(0, 3600) }),
    S("g1", "generator", 830, 70, "G-101", "Generator", { speed: L(0, 3600), temperature: L(20, 120) }),
    S("cn1", "shelltube", 690, 220, "E-101", "Condenser", { temperature: L(20, 60) }),
    S("cp1", "cpump", 560, 316, "P-102", "Condensate pump", { speed: L(0, 1500) }),
    B("b1t", 20, 50, "LT-101", "DA level", "da1", "%", "level", 1, { low: 30, lowCrit: 15 }),
    B("b2t", 250, 380, "PT-101", "feed", "fp1", "bar", "pressure", 1),
    B("b3t", 370, 330, "LT-102", "drum", "b1", "%", "level", 1, { low: 30, lowCrit: 15 }),
    B("b4t", 500, 0, "PT-102", "steam", "ps1", "bar", "pressure", 1),
    B("b5t", 660, -60, "TT-101", "steam", "ps1", "°C", "temp", 0),
    B("b6t", 830, 160, "SI-101", "turbine", "st1", "rpm", "speed", 0),
    B("b7t", 960, 50, "EI-101", "output", "g1", "kWh", "energy", 0),
  ], [
    PP("ps0", ["da1", "b"], ["fp1", "in"], "water", { flow: 150 }),
    PP("ps1", ["b1", "t"], ["st1", "t"], "steam", { mid: [[480, 30], [670, 30]], flow: 150 }),
    PP("ps2", ["fp1", "out"], ["b1", "l"], "water", { flow: 150 }),
    PP("ps3", ["st1", "r"], ["g1", "l"], "product", { line: "electrical" }),
    PP("ps4", ["st1", "b"], ["cn1", "t"], "steam", { flow: 150 }),
    PP("ps5", [620, 250], ["cn1", "l"], "cooling", { line: "utility", label: "CW in" }),
    PP("ps6", ["cn1", "r"], [920, 250], "cooling", { line: "utility", label: "CW out" }),
    PP("ps7", ["cn1", "b"], ["cp1", "in"], "water", { flow: 150 }),
    PP("ps8", ["cp1", "out"], ["da1", "l"], "water", { label: "condensate", mid: [[615, 300], [660, 300], [660, 450], [20, 450], [20, 235]], flow: 150 }),
  ]);
}

function air(): ProcessScene {
  return scene([
    S("f1", "filter", 40, 170, "FL-101", "Intake filter"),
    S("k1", "compressor", 160, 175, "K-101", "Air compressor", { speed: L(0, 3000) }),
    S("m1", "motor", 168, 260, "M-101", "", { speed: L(0, 3000) }),
    S("e1", "cooler", 300, 170, "E-101", "Aftercooler", { temperature: L(20, 120) }),
    S("ar1", "airreceiver", 570, 90, "AR-101", "Receiver"),
    S("ad1", "airdryer", 710, 110, "AD-101", "Dryer"),
    S("f2", "filter", 870, 95, "FL-102", "Line filter"),
    B("c1", 520, 0, "PT-101", "header", "ar1", "bar", "pressure", 2, { low: 6, lowCrit: 5 }),
    B("c2", 200, 90, "TT-101", "disch.", "pa2", "°C", "temp", 0, { warn: 95, crit: 110 }),
    B("c3", 400, 80, "TT-102", "after cooler", "e1", "°C", "temp", 0),
    B("c4", 760, 270, "TT-103", "dew pt", "ad1", "°C", "temp", 1),
    B("c5", 900, 10, "PDT-101", "filter", "f2", "bar", "dp", 2, { warn: 0.5, crit: 0.8 }),
    B("c6", 980, 160, "FT-101", "to plant", "pa6", "Nm³/h", "flow", 0),
    B("c7", 40, 300, "EI-101", "power", "m1", "kWh", "energy", 0),
  ], [
    PP("pa1", [-30, 205], ["f1", "l"], "air", { label: "atmosphere", flow: 150 }),
    PP("pa2", ["f1", "r"], ["k1", "l"], "air", { flow: 150 }),
    PP("pa3", ["k1", "r"], ["e1", "l"], "air", { flow: 150 }),
    PP("pa4", ["e1", "r"], ["ar1", "l"], "air", { flow: 150 }),
    PP("pa5", ["ar1", "r"], ["ad1", "l"], "air", { flow: 150 }),
    PP("pa7", ["ad1", "r"], ["f2", "l"], "air", { flow: 150 }),
    PP("pa6", ["f2", "r"], [1060, 130], "air", { label: "to plant", flow: 150 }),
    PP("pa8", [330, 330], ["e1", "b1"], "cooling", { line: "utility", label: "CW in" }),
    PP("pa9", ["e1", "b2"], [470, 330], "cooling", { line: "utility", label: "CW out" }),
  ]);
}

function chiller(): ProcessScene {
  return scene([
    S("ch1", "chiller", 360, 160, "CH-101", "Chiller", { temperature: L(4, 15), speed: L(0, 3000) }),
    S("ct1", "ctower", 60, 20, "CT-101", "Cooling tower", { speed: L(0, 1500), temperature: L(20, 40) }),
    S("p1", "cpump", 220, 236, "P-101", "CW pump", { speed: L(0, 1500) }),
    S("p2", "cpump", 600, 236, "P-201", "CHW pump", { speed: L(0, 1500) }),
    S("a1", "ahu", 720, 120, "AHU-101", "AHU", { speed: L(0, 1500), temperature: L(10, 30) }),
    B("d1", 640, 330, "TT-201", "CHW supply", "pc5", "°C", "temp", 1, { warn: 9, crit: 12 }),
    B("d2", 620, 0, "TT-202", "CHW return", "pc6", "°C", "temp", 1),
    B("d3", 200, 340, "TT-101", "CW supply", "pc2", "°C", "temp", 1),
    B("d4", 760, 260, "FT-201", "CHW", "pc5", "m³/h", "flow", 0),
    B("d5", 380, 300, "EI-101", "chiller", "ch1", "kWh", "energy", 0),
    B("d6", 180, 0, "SI-101", "tower fan", "ct1", "rpm", "speed", 0),
    B("d7", 960, 220, "TT-301", "supply air", "a1", "°C", "temp", 1),
  ], [
    PP("pc1", ["ct1", "l"], ["p1", "in"], "cooling", { mid: [[30, 132], [30, 280]], flow: 150 }),
    PP("pc2", ["p1", "out"], ["ch1", "l2"], "cooling", { flow: 150 }),
    PP("pc3", ["ch1", "l1"], ["ct1", "r"], "cooling", { flow: 150 }),
    PP("pc4", ["ch1", "r2"], ["p2", "in"], "water", { flow: 150 }),
    PP("pc5", ["p2", "out"], ["a1", "l"], "water", { flow: 150 }),
    PP("pc6", ["a1", "r"], ["ch1", "r1"], "water", { mid: [[980, 165], [980, 70], [560, 70], [560, 190]], flow: 150 }),
  ], [Z("zc1", 0, -30, 330, 420, "CONDENSER WATER"), Z("zc2", 545, -30, 465, 420, "CHILLED WATER")]);
}

function dyeing(): ProcessScene {
  return scene([
    S("tk1", "daytank", 40, 60, "T-101", "Soft water", { level: L(0, 100, { low: 20, lowCrit: 10 }) }),
    S("ds1", "dosing", 40, 220, "DS-101", "Dyes & chemicals", { level: L(0, 100, { low: 20, lowCrit: 10 }), speed: L(0, 1500) }),
    S("dy1", "jetdyeing", 260, 140, "DY-101", "Jet dyeing", { level: L(0, 100), temperature: L(20, 135) }),
    S("e1", "plate", 300, 290, "E-101", "Heat exchanger", { temperature: L(20, 135) }),
    S("wa1", "washer", 520, 190, "WR-101", "Washer", { level: L(0, 100), temperature: L(20, 95) }),
    S("sn1", "stenter", 800, 170, "SN-101", "Stenter", { temperature: L(20, 220), speed: L(0, 1500) }),
    B("t1", 300, 60, "TT-101", "dye bath", "dy1", "°C", "temp", 1, { warn: 132, crit: 136 }),
    B("t2", 440, 80, "AT-101", "pH", "dy1", "pH", "analysis", 2),
    B("t3", 140, 40, "FT-101", "water", "pd1", "m³/h", "flow", 1),
    B("t4", 600, 90, "TT-201", "wash", "wa1", "°C", "temp", 1),
    B("t5", 880, 80, "TT-301", "stenter", "sn1", "°C", "temp", 0, { warn: 210, crit: 225 }),
  ], [
    PP("pd1", ["tk1", "r"], ["dy1", "l"], "water", { flow: 150 }),
    PP("pd2", ["ds1", "r"], [230, 230], "chemical", { line: "utility" }),
    PP("pd3", ["e1", "t1"], ["dy1", "b1"], "hot", { flow: 150 }),
    PP("pd4", ["dy1", "b2"], ["e1", "t2"], "hot", { flow: 150 }),
    PP("pd5", [316, 440], ["e1", "b1"], "steam", { line: "utility", label: "steam" }),
    PP("pd6", ["e1", "b2"], [364, 440], "water", { line: "utility", label: "condensate" }),
    PP("pd7", ["dy1", "r"], ["wa1", "l"], "product", { label: "fabric" }),
    PP("pd8", ["wa1", "b"], [625, 360], "water", { line: "utility", label: "to effluent" }),
    PP("pd9", ["wa1", "r"], ["sn1", "l"], "product", { label: "fabric" }),
    PP("pd10", ["sn1", "r"], [1140, 210], "product", { label: "finished fabric" }),
  ]);
}

function pharma(): ProcessScene {
  return scene([
    S("wfi", "vvessel", 40, 80, "T-101", "WFI tank", { level: L(0, 100, { low: 20, lowCrit: 10 }) }),
    S("fm1", "fermenter", 220, 40, "FR-101", "Fermenter", { level: L(0, 100), speed: L(0, 150), temperature: L(20, 45) }),
    S("p1", "cpump", 330, 300, "P-101", "Harvest pump", { speed: L(0, 1500) }),
    S("cf1", "centrifuge", 440, 170, "CF-101", "Centrifuge", { speed: L(0, 6000) }),
    S("ev1", "evaporator", 620, 40, "EV-101", "Evaporator", { level: L(0, 100), temperature: L(40, 110) }),
    S("sd1", "spraydryer", 800, 120, "SD-101", "Spray dryer", { temperature: L(60, 200) }),
    S("cip1", "cip", 20, 340, "CIP-101", "CIP", { level: L(0, 100), temperature: L(20, 85) }),
    B("r1", 350, 20, "TT-101", "broth", "fm1", "°C", "temp", 1, { warn: 38, crit: 40 }),
    B("r2", 350, 80, "AT-101", "pH", "fm1", "pH", "analysis", 2, { low: 6.6, warn: 7.4 }),
    B("r3", 350, 140, "AT-102", "DO", "fm1", "%", "analysis", 1),
    B("r4", 90, -20, "SIC-101", "agitator", "fm1", "rpm", "agitator", 0),
    B("r5", 420, 330, "SI-201", "bowl", "cf1", "rpm", "speed", 0),
    B("r6", 560, 360, "LT-301", "evap.", "ev1", "%", "level", 1),
    B("r7", 940, 60, "TT-401", "inlet air", "sd1", "°C", "temp", 0),
  ], [
    PP("ph1", ["wfi", "r"], ["fm1", "l"], "water", { flow: 150 }),
    PP("ph2", ["fm1", "b"], ["p1", "in"], "product", { flow: 150 }),
    PP("ph3", ["p1", "out"], ["cf1", "t"], "product", { mid: [[385, 140], [490, 140]], flow: 150 }),
    PP("ph4", ["cf1", "r"], ["ev1", "t"], "product", { mid: [[580, 240], [580, 10], [665, 10]], flow: 150 }),
    PP("ph5", [580, 300], ["ev1", "l"], "steam", { line: "utility", label: "steam", mid: [[600, 300], [600, 160]] }),
    PP("ph6", ["ev1", "r"], [760, 100], "steam", { line: "utility", label: "vapour" }),
    PP("ph7", ["ev1", "b"], ["sd1", "t"], "product", { mid: [[665, 300], [740, 300], [740, 90], [840, 90]], flow: 150 }),
    PP("ph8", ["sd1", "b"], [840, 400], "product", { label: "powder" }),
    PP("ph9", ["sd1", "r"], [960, 270], "air", { line: "utility", label: "exhaust" }),
    PP("ph10", ["cip1", "r"], [300, 435], "chemical", { line: "utility", label: "CIP supply" }),
  ]);
}

function oil(): ProcessScene {
  return scene([
    S("wh1", "wellhead", 40, 120, "WH-101", "Well 1"),
    S("cv1", "cv", 170, 148, "FCV-101", "Choke", { opening: L(0, 100) }),
    S("s1", "sep3", 290, 150, "V-101", "Production separator", { level: L(0, 100, { warn: 80, crit: 90 }) }),
    S("gs1", "gasscrubber", 640, 20, "V-102", "Gas scrubber", { level: L(0, 100, { warn: 60, crit: 80 }) }),
    S("fl1", "flare", 780, -140, "FS-101", "Flare"),
    S("p1", "cpump", 520, 316, "P-101", "Oil pump", { speed: L(0, 1500) }),
    S("tk1", "coneroof", 760, 300, "TK-101", "Oil storage", { level: L(0, 100, { warn: 85, crit: 95 }) }),
    B("o1", 20, 40, "PT-101", "WHP", "wh1", "bar", "pressure", 1),
    B("o2", 330, 70, "PT-102", "separator", "s1", "bar", "pressure", 1),
    B("o3", 300, 260, "LT-101", "interface", "s1", "%", "level", 1),
    B("o4", 505, 70, "FT-201", "gas", "po3", "Nm³/h", "flow", 0),
    B("o5", 600, 420, "FT-301", "oil", "po5", "m³/h", "flow", 1),
    B("o6", 300, 330, "AT-101", "water cut", "s1", "%", "analysis", 1),
    B("o7", 940, 300, "LT-201", "tank", "tk1", "%", "level", 1, { warn: 85, crit: 95 }),
  ], [
    PP("po1", ["wh1", "r"], ["cv1", "l"], "oil", { flow: 150 }),
    PP("po2", ["cv1", "r"], ["s1", "l"], "oil", { flow: 150 }),
    PP("po3", ["s1", "t"], ["gs1", "l"], "gas", { flow: 150 }),
    PP("po4", ["gs1", "t"], ["fl1", "b"], "gas", { flow: 150 }),
    PP("po5", ["s1", "b2"], ["p1", "in"], "oil", { mid: [[480, 360]], flow: 150 }),
    PP("po6", ["p1", "out"], ["tk1", "l"], "oil", { mid: [[575, 430]], flow: 150 }),
    PP("po7", ["s1", "b1"], [350, 420], "water", { line: "utility", label: "produced water" }),
    PP("po8", ["gs1", "b"], [675, 290], "oil", { line: "utility", label: "condensate" }),
  ]);
}

export interface ProcessTemplate { key: string; name: string; about: string; build: () => ProcessScene }
export const TEMPLATES: ProcessTemplate[] = [
  { key: "sample", name: "Reactor cooling loop (sample)", about: "Feed tank, pump, control valve, cooler and reactor with recycle", build: sampleScene },
  { key: "water", name: "Water treatment", about: "Lift station, coagulant dosing, clarifier, sand filter, UV and chlorination", build: water },
  { key: "boiler", name: "Boiler house / steam", about: "Deaerator, feed pump, boiler, steam turbine, generator and condensate return", build: boiler },
  { key: "air", name: "Compressed air", about: "Compressor, aftercooler, air receiver, dryer and filters", build: air },
  { key: "chiller", name: "Chiller plant", about: "Chiller, cooling tower, condenser and chilled water pumps, AHU", build: chiller },
  { key: "dyeing", name: "Textile dyeing", about: "Soft water, chemical dosing, jet dyeing machine, washer and stenter", build: dyeing },
  { key: "pharma", name: "Pharma batch", about: "WFI, fermenter, centrifuge, evaporator, spray dryer and CIP", build: pharma },
  { key: "oil", name: "Oil separation", about: "Wellhead, choke, 3-phase separator, gas scrubber, flare and oil storage", build: oil },
];
