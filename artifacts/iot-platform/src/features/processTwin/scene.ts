/**
 * Process twin (P&ID builder) scene document, stored in plant_twins.scene with
 * kind "process" and version 2.
 *
 * `items` holds both the equipment symbols and the tag bubbles (the server counts
 * `items` for the "N points" label in the side panel). Pipes are kept apart.
 * Process twins saved by the earlier fixed diagram (version 1: `{ kind, demo,
 * bind }`) open as the sample process with their links carried over.
 */

import { registerMine, type MineSym } from "./symbols";

export type Role = "level" | "speed" | "opening" | "temperature" | "value";
export type LabelPos = "below" | "above" | "left" | "right" | "hidden";
/** Look of one symbol: colours (empty = library default), where its tag/label text goes, and whether the tag number shows. */
export interface SymStyle { fill?: string; stroke?: string; labelPos?: LabelPos; hideTag?: boolean }
export interface Binding { assetId: string; metric: string }
export interface LimitsCfg { warn?: number; crit?: number; low?: number; lowCrit?: number }
/** One live behaviour of a symbol or pipe: the reading that drives it and how. */
export interface Drive { bind?: Binding; min?: number; max?: number; limits?: LimitsCfg; unit?: string; decimals?: number }

export interface SymItem {
  kind: "sym"; id: string; type: string;
  /** Top-left corner of the unrotated, scaled symbol. */
  x: number; y: number; rot: number; scale: number;
  tag: string; label: string;
  drives?: Partial<Record<Role, Drive>>;
  flipX?: boolean; flipY?: boolean;
  /** Locked items can be selected and linked but not moved, resized or deleted. */
  locked?: boolean;
  style?: SymStyle;
}
export interface TagItem {
  kind: "tag"; id: string; x: number; y: number; w?: number;
  tag: string; label: string;
  /** Symbol or pipe the bubble belongs to: a leader line is drawn and its status counts there. */
  attach?: string | null;
  bind?: Binding; unit?: string; decimals?: number; limits?: LimitsCfg;
  /** What the demo simulation shows when not linked (flow, pressure, temp, level…). */
  demoKind?: string;
  locked?: boolean;
}
export type Item = SymItem | TagItem;
export type End = { sym: string; port: string } | { x: number; y: number };
export type LineType = "process" | "utility" | "signal" | "electrical";
export type Medium = "product" | "water" | "cooling" | "steam" | "oil" | "gas" | "chemical" | "air" | "hot";
export interface PipeItem {
  id: string; a: End; b: End;
  /** Bend points between the two ends; elbows are added so every run is horizontal or vertical. */
  mid: [number, number][];
  line: LineType; medium: Medium; arrows: boolean; label?: string;
  flow?: Drive;
  /** Colour instead of the medium colour (alarm colours still win). */
  color?: string;
  labelPos?: "above" | "below" | "hidden";
}
/**
 * Annotation: free text, an area/zone (dashed box with a title, drawn behind
 * everything) or a line/arrow. Kept apart from `items` so they are not counted
 * as points of the twin.
 */
export type NoteKind = "text" | "zone" | "line";
export interface NoteItem {
  id: string; kind: NoteKind; x: number; y: number;
  /** Zone size. */
  w?: number; h?: number;
  /** Line end. */
  x2?: number; y2?: number;
  text?: string; color?: string; size?: number; arrow?: boolean; dashed?: boolean; locked?: boolean;
}
export interface ProcessScene {
  kind: "process"; version: 2;
  items: Item[]; pipes: PipeItem[];
  demo: boolean;
  view?: { x: number; y: number; k: number };
  notes?: NoteItem[];
  /** Uploaded symbols used in this diagram ("My symbols"); stored chunked, see serializeScene. */
  custom?: MineSym[];
}

export const LINE_TYPES: [LineType, string][] = [["process", "Process line"], ["utility", "Utility line"], ["signal", "Signal (dashed)"], ["electrical", "Electrical"]];
export const MEDIA: [Medium, string, string][] = [
  ["product", "Product", "#38bdf8"], ["water", "Water", "#22d3ee"], ["cooling", "Cooling water", "#60a5fa"], ["steam", "Steam", "#e2e8f0"],
  ["oil", "Oil", "#f59e0b"], ["gas", "Gas", "#a3e635"], ["chemical", "Chemical", "#c084fc"], ["air", "Air", "#94a3b8"], ["hot", "Hot product", "#fb923c"],
];
export const mediumColour = (m: Medium) => MEDIA.find((x) => x[0] === m)?.[2] ?? "#38bdf8";

export const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
export const isSym = (i: Item): i is SymItem => i.kind === "sym";
export const isTag = (i: Item): i is TagItem => i.kind === "tag";
export const isPortEnd = (e: End): e is { sym: string; port: string } => "sym" in e;
export const NOTE_COLOUR: Record<NoteKind, string> = { text: "#cbd5e1", zone: "#38bdf8", line: "#94a3b8" };

/** The API refuses JSON strings over 100 000 characters, so uploaded symbols are stored in chunks. */
const CHUNK = 90_000;
export function serializeScene(s: ProcessScene): ProcessScene {
  if (!s.custom?.length) return s;
  return {
    ...s,
    custom: s.custom.map((m) => {
      const src = m.src as unknown;
      if (Array.isArray(src)) return m;
      const parts: string[] = []; for (let i = 0; i < m.src.length; i += CHUNK) parts.push(m.src.slice(i, i + CHUNK));
      return { ...m, src: parts as unknown as string };
    }),
  };
}
const MINE_SRC = /^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/;

export function blankScene(): ProcessScene { return { kind: "process", version: 2, items: [], pipes: [], demo: true }; }

// ── sample process: feed tank → pump → control valve → cooler → reactor ──────
export function sampleScene(): ProcessScene {
  const L = (min: number, max: number) => ({ min, max });
  const items: Item[] = [
    { kind: "sym", id: "t101", type: "tank", x: 60, y: 140, rot: 0, scale: 1.3, tag: "T-101", label: "Feed tank", drives: { level: { ...L(0, 100), limits: { warn: 85, crit: 92 } } } },
    { kind: "sym", id: "p101", type: "cpump", x: 290, y: 304, rot: 0, scale: 1, tag: "P-101", label: "Transfer pump", drives: { speed: { ...L(0, 1500) } } },
    { kind: "sym", id: "fcv101", type: "cv", x: 440, y: 205, rot: 0, scale: 1, tag: "FCV-101", label: "", drives: { opening: { ...L(0, 100) } } },
    { kind: "sym", id: "e101", type: "cooler", x: 590, y: 212, rot: 0, scale: 1, tag: "E-101", label: "Cooler", drives: { temperature: { ...L(25, 55) } } },
    { kind: "sym", id: "r101", type: "reactor", x: 865, y: 130, rot: 0, scale: 1, tag: "R-101", label: "Reactor", drives: { level: { ...L(0, 100) }, speed: { ...L(0, 150) }, temperature: { ...L(25, 90) } } },
    { kind: "tag", id: "b-level", x: 70, y: 70, tag: "LT-101", label: "level", attach: "t101", unit: "%", decimals: 1, limits: { warn: 85, crit: 92 }, demoKind: "level" },
    { kind: "tag", id: "b-pres", x: 250, y: 450, tag: "PT-101", label: "disch.", attach: "p101", unit: "bar", decimals: 2, limits: { low: 2.5, lowCrit: 1 }, demoKind: "pressure" },
    { kind: "tag", id: "b-flow", x: 500, y: 130, tag: "FT-101", label: "flow", attach: "pipe-main2", unit: "m³/h", decimals: 1, limits: { low: 80, lowCrit: 10 }, demoKind: "flow" },
    { kind: "tag", id: "b-valve", x: 400, y: 290, tag: "ZT-101", label: "open", attach: "fcv101", unit: "%", decimals: 0, demoKind: "opening" },
    { kind: "tag", id: "b-hxOut", x: 700, y: 130, tag: "TT-201", label: "out", attach: "e101", unit: "°C", decimals: 1, limits: { warn: 48, crit: 55 }, demoKind: "temp" },
    { kind: "tag", id: "b-rx", x: 730, y: 390, tag: "TT-301", label: "rx", attach: "r101", unit: "°C", decimals: 1, demoKind: "temp" },
    { kind: "tag", id: "b-agit", x: 990, y: 50, tag: "SIC-101", label: "agit.", attach: "r101", unit: "rpm", decimals: 0, demoKind: "agitator" },
  ];
  const pipes: PipeItem[] = [
    { id: "pipe-main1", a: { sym: "t101", port: "r" }, b: { sym: "p101", port: "in" }, mid: [], line: "process", medium: "product", arrows: true, flow: { min: 0, max: 150 } },
    { id: "pipe-main2", a: { sym: "p101", port: "out" }, b: { sym: "fcv101", port: "l" }, mid: [], line: "process", medium: "product", arrows: true, flow: { min: 0, max: 150 } },
    { id: "pipe-main3", a: { sym: "fcv101", port: "r" }, b: { sym: "e101", port: "l" }, mid: [], line: "process", medium: "product", arrows: true, flow: { min: 0, max: 150 } },
    { id: "pipe-main4", a: { sym: "e101", port: "r" }, b: { sym: "r101", port: "l" }, mid: [[830, 247]], line: "process", medium: "hot", arrows: true, flow: { min: 0, max: 150 } },
    { id: "pipe-cwin", a: { x: 640, y: 470 }, b: { sym: "e101", port: "b1" }, mid: [], line: "utility", medium: "cooling", arrows: true, label: "CW in" },
    { id: "pipe-cwout", a: { sym: "e101", port: "b2" }, b: { x: 740, y: 470 }, mid: [], line: "utility", medium: "cooling", arrows: true, label: "CW out" },
    { id: "pipe-rec", a: { sym: "r101", port: "b" }, b: { sym: "t101", port: "b" }, mid: [[920, 540], [138, 540]], line: "utility", medium: "product", arrows: true, label: "recycle", flow: { min: 0, max: 600 } },
  ];
  return { kind: "process", version: 2, items, pipes, demo: true };
}

/**
 * Version 1 keys (tagTwin/tags.ts PROCESS_KEYS) → where the link goes in the
 * sample process: the tag bubble, and the symbol or pipe behaviour it also drives.
 */
const V1_MAP: Record<string, { tag: string; also?: { id: string; role?: Role; pipes?: string[] } }> = {
  level: { tag: "b-level", also: { id: "t101", role: "level" } },
  flow: { tag: "b-flow", also: { id: "", pipes: ["pipe-main1", "pipe-main2", "pipe-main3", "pipe-main4"] } },
  pres: { tag: "b-pres" },
  valve: { tag: "b-valve", also: { id: "fcv101", role: "opening" } },
  hxOut: { tag: "b-hxOut", also: { id: "e101", role: "temperature" } },
  rx: { tag: "b-rx", also: { id: "r101", role: "temperature" } },
  agit: { tag: "b-agit", also: { id: "r101", role: "speed" } },
};

export function fromV1(raw: { demo?: unknown; bind?: unknown }): ProcessScene {
  const s = sampleScene();
  s.demo = raw.demo !== false;
  const bind = (raw.bind && typeof raw.bind === "object" ? raw.bind : {}) as Record<string, Binding>;
  for (const [k, b] of Object.entries(bind)) {
    const m = V1_MAP[k];
    if (!m || !b || typeof b.assetId !== "string" || !b.assetId) continue;
    const link: Binding = { assetId: b.assetId, metric: typeof b.metric === "string" ? b.metric : "" };
    const tag = s.items.find((i) => i.id === m.tag) as TagItem | undefined;
    if (tag) tag.bind = { ...link };
    if (m.also?.role) {
      const sym = s.items.find((i) => i.id === m.also!.id) as SymItem | undefined;
      if (sym) sym.drives = { ...sym.drives, [m.also.role]: { ...(sym.drives?.[m.also.role] ?? {}), bind: { ...link } } };
    }
    for (const pid of m.also?.pipes ?? []) {
      const p = s.pipes.find((x) => x.id === pid);
      if (p) p.flow = { ...(p.flow ?? {}), bind: { ...link } };
    }
  }
  return s;
}

// ── parsing: anything from the server is checked before it is drawn ─────────
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "", max = 200) => (typeof v === "string" ? v.slice(0, max) : d);
const optNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
function binding(v: unknown): Binding | undefined {
  const b = v as Binding | undefined;
  return b && typeof b === "object" && typeof b.assetId === "string" && b.assetId ? { assetId: b.assetId, metric: str(b.metric) } : undefined;
}
function limits(v: unknown): LimitsCfg | undefined {
  if (!v || typeof v !== "object") return undefined;
  const l = v as LimitsCfg; const o: LimitsCfg = { warn: optNum(l.warn), crit: optNum(l.crit), low: optNum(l.low), lowCrit: optNum(l.lowCrit) };
  return Object.values(o).some((x) => x !== undefined) ? o : undefined;
}
function drive(v: unknown): Drive | undefined {
  if (!v || typeof v !== "object") return undefined;
  const d = v as Drive;
  return { bind: binding(d.bind), min: optNum(d.min), max: optNum(d.max), limits: limits(d.limits), unit: typeof d.unit === "string" ? d.unit.slice(0, 20) : undefined, decimals: optNum(d.decimals) };
}
function end(v: unknown): End | null {
  const e = v as any;
  if (e && typeof e === "object" && typeof e.sym === "string") return { sym: e.sym, port: str(e.port, "c") };
  if (e && typeof e === "object" && Number.isFinite(e.x) && Number.isFinite(e.y)) return { x: e.x, y: e.y };
  return null;
}
const ROLES: Role[] = ["level", "speed", "opening", "temperature", "value"];
const LABEL_POS: unknown[] = ["below", "above", "left", "right", "hidden"];
const colour = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : undefined);

export function parseScene(raw: unknown): { scene: ProcessScene; converted: boolean } {
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  if (r.version !== 2) return { scene: fromV1(r), converted: true };
  const items: Item[] = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    if (!it || typeof it !== "object" || typeof it.id !== "string") continue;
    if (it.kind === "sym" && typeof it.type === "string") {
      const drives: Partial<Record<Role, Drive>> = {};
      for (const role of ROLES) { const d = drive(it.drives?.[role]); if (d) drives[role] = d; }
      const st = it.style && typeof it.style === "object" ? it.style : null;
      const style: SymStyle | undefined = st ? { fill: colour(st.fill), stroke: colour(st.stroke), labelPos: LABEL_POS.includes(st.labelPos) ? st.labelPos : undefined, hideTag: st.hideTag === true || undefined } : undefined;
      items.push({
        kind: "sym", id: it.id, type: it.type, x: num(it.x, 0), y: num(it.y, 0), rot: ((Math.round(num(it.rot, 0) / 90) * 90) % 360 + 360) % 360, scale: Math.min(4, Math.max(0.3, num(it.scale, 1))), tag: str(it.tag), label: str(it.label), drives,
        ...(it.flipX === true ? { flipX: true } : {}), ...(it.flipY === true ? { flipY: true } : {}), ...(it.locked === true ? { locked: true } : {}),
        ...(style && Object.values(style).some((v) => v !== undefined) ? { style } : {}),
      });
    } else if (it.kind === "tag") {
      items.push({ kind: "tag", id: it.id, x: num(it.x, 0), y: num(it.y, 0), w: optNum(it.w), tag: str(it.tag), label: str(it.label), attach: typeof it.attach === "string" ? it.attach : null, bind: binding(it.bind), unit: str(it.unit, "", 20), decimals: optNum(it.decimals), limits: limits(it.limits), demoKind: typeof it.demoKind === "string" ? it.demoKind : undefined, ...(it.locked === true ? { locked: true } : {}) });
    }
  }
  const pipes: PipeItem[] = [];
  for (const p of Array.isArray(r.pipes) ? r.pipes : []) {
    const a = end(p?.a), b = end(p?.b);
    if (!p || typeof p.id !== "string" || !a || !b) continue;
    const mid = (Array.isArray(p.mid) ? p.mid : []).filter((m: unknown) => Array.isArray(m) && Number.isFinite(m[0]) && Number.isFinite(m[1])).map((m: number[]) => [m[0], m[1]] as [number, number]);
    pipes.push({
      id: p.id, a, b, mid,
      line: LINE_TYPES.some(([l]) => l === p.line) ? p.line : "process",
      medium: MEDIA.some(([m]) => m === p.medium) ? p.medium : "product",
      arrows: p.arrows !== false, label: typeof p.label === "string" ? p.label.slice(0, 80) : undefined, flow: drive(p.flow),
      ...(colour(p.color) ? { color: colour(p.color) } : {}), ...(["above", "below", "hidden"].includes(p.labelPos) ? { labelPos: p.labelPos } : {}),
    });
  }
  const notes: NoteItem[] = [];
  for (const n of Array.isArray(r.notes) ? r.notes : []) {
    if (!n || typeof n.id !== "string" || !["text", "zone", "line"].includes(n.kind)) continue;
    notes.push({
      id: n.id, kind: n.kind, x: num(n.x, 0), y: num(n.y, 0), w: optNum(n.w), h: optNum(n.h), x2: optNum(n.x2), y2: optNum(n.y2),
      text: typeof n.text === "string" ? n.text.slice(0, 300) : undefined, color: colour(n.color), size: optNum(n.size),
      arrow: n.arrow === true || undefined, dashed: n.dashed === true || undefined, locked: n.locked === true || undefined,
    });
  }
  const custom: MineSym[] = [];
  for (const m of Array.isArray(r.custom) ? r.custom : []) {
    const src = Array.isArray(m?.src) ? m.src.filter((x: unknown) => typeof x === "string").join("") : typeof m?.src === "string" ? m.src : "";
    if (!m || typeof m.id !== "string" || !/^[\w-]{1,40}$/.test(m.id) || !MINE_SRC.test(src)) continue;
    custom.push({ id: m.id, name: str(m.name, "Symbol", 60), w: Math.min(400, Math.max(10, num(m.w, 80))), h: Math.min(400, Math.max(10, num(m.h, 80))), src });
  }
  registerMine(custom);
  const v = r.view;
  return {
    scene: {
      kind: "process", version: 2, items, pipes, demo: r.demo !== false, view: v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.k) ? { x: v.x, y: v.y, k: v.k } : undefined,
      ...(notes.length ? { notes } : {}), ...(custom.length ? { custom } : {}),
    },
    converted: false,
  };
}

/** Every asset + metric the scene reads. */
export function sceneBindings(s: ProcessScene): Binding[] {
  const out: Binding[] = [];
  for (const it of s.items) {
    if (isTag(it)) { if (it.bind?.assetId && it.bind.metric) out.push(it.bind); }
    else for (const d of Object.values(it.drives ?? {})) if (d?.bind?.assetId && d.bind.metric) out.push(d.bind);
  }
  for (const p of s.pipes) if (p.flow?.bind?.assetId && p.flow.bind.metric) out.push(p.flow.bind);
  return out;
}

/** Is any element of the scene linked to this asset? Returns the element ids. */
export function idsForAsset(s: ProcessScene, assetId: string): string[] {
  const ids: string[] = [];
  for (const it of s.items) {
    if (isTag(it) ? it.bind?.assetId === assetId : Object.values(it.drives ?? {}).some((d) => d?.bind?.assetId === assetId)) ids.push(it.id);
  }
  for (const p of s.pipes) if (p.flow?.bind?.assetId === assetId) ids.push(p.id);
  return ids;
}
