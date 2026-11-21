import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PI, DS, clamp, rnd, P, M, cyl, lamp, pipe, polyline, particles, lights, SCOL, type TagDef } from "./kit";
import { MODELS } from "./models";
import { PACKS, MED, AREA_COL, UTIL_COL, type PackDef } from "./packs";
import type { AreaState, ConnSpec, Item, ItemSpec, SceneDoc, Status } from "./types";

/**
 * The 3D plant twin engine: one three.js scene with machines laid out by process
 * area, the material flow between areas, pipes and cables between machines,
 * pointer interaction (select, drag, orbit, zoom) and the floating labels.
 *
 * Framework-free on purpose: React owns the panels and calls into this through
 * the returned API; this owns the canvas and the animation loop.
 *
 * Readings: a machine's reading is LIVE when the machine is linked to an asset
 * and the reading to one of its metrics, and a value has arrived. Otherwise it
 * is a DEMO value when the twin's demo switch is on, or NOT LINKED. Demo values
 * never come from the plant and are labelled as such everywhere they show.
 */

export type LabelMode = "smart" | "all" | "off";
export type Source = "live" | "demo" | "none";
export type Scenario = "normal" | "fault" | "cavitation" | "overheat" | "trip" | "cloud" | "storm" | "lowwind" | "charge" | "discharge";
/** Scenarios that only models declaring them in `scen` react to (solar, wind, battery storage). */
const MODEL_SCENARIOS: Scenario[] = ["cloud", "storm", "lowwind", "charge", "discharge"];
export interface Reading {
  k: string; n: string; u: string; d: number; value: number | null; source: Source; status: Status; metric: string | null;
  /** The status comes from the asset's alarm rules, not the model's own limits. */
  rules?: boolean;
  /** History playback is on and the value is a recorded one. */
  playback?: boolean;
}
/** Alarm limits for one linked reading (see shared/alarmLimits.ts). */
export interface RuleLimits { warn?: number; crit?: number; low?: number; lowCrit?: number }
export interface AreaStat { id: string; total: number; running: number; alarms: number; worst: Status; linked: number }
export interface EngineOptions {
  canvas: HTMLCanvasElement;
  host: HTMLElement;
  overlay: HTMLElement;
  getLive: (assetId: string, metric: string) => number | null | undefined;
  /** Limits from the asset's alarm rules for a linked reading, used instead of the model's own. */
  getLimits?: (assetId: string, metric: string) => RuleLimits | undefined;
  /** Bytes of an uploaded .glb model, by upload id. */
  fetchGlb?: (uploadId: string) => Promise<ArrayBuffer>;
  /** Something the panels show changed. */
  onChange: () => void;
  /** The saved scene changed and should be persisted. */
  onEdit: () => void;
}

const RANK: Record<string, number> = { off: -1, nolink: -1, ok: 0, warn: 1, crit: 2 };
const ALIASES: Record<string, string[]> = {
  speed: ["speed", "rpm"], vib: ["vibration", "vib"], temp: ["temperature", "temp"], level: ["level"], flow: ["flow", "flowrate"],
  pres: ["pressure", "pres"], amps: ["current", "amps", "amp"], kw: ["power", "kw", "load"], load: ["load"], cyl: ["cylinder"],
  oil: ["oiltemp", "oiltemperature"], open: ["opening", "position", "valve"], dp: ["dp", "differentialpressure"], out: ["outputspeed", "outspeed"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const tagStatus = (t: TagDef, v: number): Status => t.warn === undefined || t.crit === undefined ? "ok"
  : t.low ? (v <= t.crit ? "crit" : v <= t.warn ? "warn" : "ok") : (v >= t.crit ? "crit" : v >= t.warn ? "warn" : "ok");
const hasLimits = (l: RuleLimits | undefined): l is RuleLimits => !!l && (l.warn !== undefined || l.crit !== undefined || l.low !== undefined || l.lowCrit !== undefined);
const ruleStatus = (l: RuleLimits, v: number): Status =>
  (l.crit !== undefined && v >= l.crit) || (l.lowCrit !== undefined && v <= l.lowCrit) ? "crit"
    : (l.warn !== undefined && v >= l.warn) || (l.low !== undefined && v <= l.low) ? "warn" : "ok";
export const fmtReading = (r: { value: number | null; d: number; u: string }) => r.value == null ? "—" : `${r.value.toFixed(r.d)}${r.u ? " " + r.u : ""}`;
export const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/** Guess which of an asset's metrics feeds each reading: exact key or name, then common aliases. */
export function autoMap(tags: TagDef[], metrics: string[]): Record<string, string> {
  const byNorm = new Map(metrics.map((m) => [norm(m.includes(".") ? m.split(".").slice(1).join(".") : m), m]));
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const t of tags) {
    const cands = [norm(t.k), norm(t.n), ...(ALIASES[t.k] ?? []).map(norm)];
    let hit: string | undefined;
    for (const c of cands) { const m = byNorm.get(c); if (m && !used.has(m)) { hit = m; break; } }
    if (!hit) for (const [k, m] of byNorm) { if (used.has(m)) continue; if (cands.some((c) => c.length > 2 && (k.includes(c) || c.includes(k) && k.length > 2))) { hit = m; break; } }
    if (hit) { out[t.k] = hit; used.add(hit); }
  }
  return out;
}

export function createPlantEngine(o: EngineOptions) {
  const { canvas, host, overlay } = o;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(42, 1.6, 0.1, 800);
  lights(scene);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M(0x111925, { metalness: 0.1, roughness: 0.9 })); floor.rotation.x = -PI / 2; scene.add(floor);
  let grid: THREE.GridHelper | null = null; const fb = { x0: -23, x1: 23, z0: -16, z1: 16 };
  const world = new THREE.Group(), connG = new THREE.Group(), areaG = new THREE.Group(); scene.add(world, connG, areaG);

  let items: Item[] = [], conns: (ConnSpec & { flow?: ReturnType<typeof particles> | null; group?: THREE.Group | null })[] = [];
  let areas: AreaState[] = [], flows: [string, string, string][] = [];
  let sel: Item | null = null, connectFrom: Item | null = null, labelMode: LabelMode = "smart", auto = false, uid = 1;
  /** X-ray: machines see-through. Heat map: machines tinted from their temperatures (or status). */
  let xray = false, heat = false;
  /** Plant-wide demo scenario. Moves demo values only; linked readings always show plant data. */
  let scenario: Scenario = "normal";
  const isPump = (it: Item) => /pump/i.test(MODELS[it.type]?.name ?? "") || it.type === "pump";
  const isRotating = (it: Item) => MODELS[it.type]?.fam === "rotating";
  function scenarioTarget(it: Item, t: TagDef, base: number): number {
    if (scenario === "fault" && t.fault !== undefined) return t.fault;
    const own = MODELS[it.type]?.scen?.(it.params)?.[scenario]?.[t.k];
    if (own !== undefined) return own;
    if (scenario === "cavitation" && isPump(it)) {
      if (t.k === "vib") return t.fault ?? (t.crit ?? base) * 1.05;
      if (t.k === "flow") return base * 0.72;
    }
    if (scenario === "overheat" && isRotating(it)) {
      if (t.u === "\u00b0C" && t.crit !== undefined && !t.low) return t.crit * 1.04;
      if (t.k === "vib" && t.warn !== undefined) return t.warn * 1.1;
    }
    return base;
  }
  /** History playback: linked values are recorded ones, labelled "playback". */
  let playback = false;
  /** Rule limits of a linked reading, if its asset has threshold alarm rules for that metric. */
  function limitsOf(it: Item, t: TagDef): RuleLimits | undefined {
    const metric = it.assetId ? it.bind[t.k] : undefined;
    if (!metric || !it.assetId || !o.getLimits) return undefined;
    const l = o.getLimits(it.assetId, metric);
    return hasLimits(l) ? l : undefined;
  }
  function statusOf(it: Item, t: TagDef, v: number): Status { const l = limitsOf(it, t); return l ? ruleStatus(l, v) : tagStatus(t, v); }
  let pack = "textile", demo = true, readOnly = false, focusId: string | null = null, iso = false, raf = 0, disposed = false;
  let flowTex: THREE.Texture[] = [], flowLbls: { el: HTMLDivElement; p: THREE.Vector3; g: THREE.Group }[] = [];
  const tgt = P(0, 0.5, 0), goal = { t: P(0, 0.5, 0), r: 40, on: false, th: null as number | null, ph: null as number | null }; let th = 0.5, ph = 0.92, rad = 40;
  const byId = (id: string | null | undefined) => items.find((i) => i.id === id);
  const areaById = (id: string | null | undefined) => areas.find((a) => a.id === id);
  const nid = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

  function ib(i: Item) {
    const a = i.rot * PI / 180, c = Math.cos(a), s = Math.sin(a);
    const cx = i.x + i.cx * c + i.cz * s, cz = i.z - i.cx * s + i.cz * c, q = Math.round(i.rot / 90) % 2 === 1;
    const w = q ? i.d : i.w, d = q ? i.w : i.d;
    return { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, cx, cz };
  }
  function boundsOf(list: Item[]) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; list.forEach((i) => { const b = ib(i); x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); z0 = Math.min(z0, b.z0); z1 = Math.max(z1, b.z1); }); return { x0, x1, z0, z1 }; }
  function disposeTree(obj: THREE.Object3D) { obj.traverse((c: any) => { if (c.geometry) c.geometry.dispose(); }); }

  /* ---------- machines ---------- */
  function build(it: Item) {
    const m = MODELS[it.type];
    if (it.root) { world.remove(it.root); if (it.type !== "glb") disposeTree(it.root); }
    const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
    it.update = (m.build(it.params, inner, it) as any) || null;
    inner.updateMatrixWorld(true);
    const b = new THREE.Box3();
    inner.traverse((ob: any) => { if (ob.isMesh && !ob.userData.fx) { ob.geometry.computeBoundingBox(); b.union(ob.geometry.boundingBox.clone().applyMatrix4(ob.matrixWorld)); } });
    if (b.isEmpty()) b.set(P(-0.5, 0, -0.5), P(0.5, 1, 0.5));
    it.cx = (b.min.x + b.max.x) / 2; it.cz = (b.min.z + b.max.z) / 2; it.top = b.max.y;
    it.w = b.max.x - b.min.x; it.d = b.max.z - b.min.z; it.rad = Math.max(it.w, it.d) / 2 + 0.3;
    it.ringM = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0, side: DS, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(it.rad, it.rad + 0.3, 56), it.ringM); ring.rotation.x = -PI / 2; ring.position.set(it.cx, 0.03, it.cz); root.add(ring);
    const sr = new THREE.Mesh(new THREE.RingGeometry(it.rad + 0.4, it.rad + 0.55, 56), new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.9, side: DS, depthWrite: false })); sr.rotation.x = -PI / 2; sr.position.set(it.cx, 0.035, it.cz); root.add(sr); it.selRing = sr;
    it.beaconM = lamp(0x22c55e);
    const bc = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 14), it.beaconM); bc.position.set(it.cx, it.top + 0.45, it.cz);
    const post = cyl(0.03, 0.03, 0.3, M(0x555f6e), 8); post.position.set(it.cx, it.top + 0.25, it.cz); root.add(bc, post);
    root.position.set(it.x, 0, it.z); root.rotation.y = it.rot * PI / 180;
    root.traverse((ob) => { ob.userData.item = it; });
    it.root = root; it.inner = inner; world.add(root);
    const old = it.r || {}; it.tags = m.tags(it.params, it); it.r = {};
    it.tags.forEach((t) => { it.r[t.k] = old[t.k] !== undefined ? old[t.k] : t.v; });
    it.mainKey = m.main ? m.main(it.params) : it.tags[0]?.k;
  }
  function autoName(type: string) { const m = MODELS[type]; return `${m.pre}-${101 + items.filter((i) => i.type === type).length}`; }
  function defaults(type: string) { const out: Record<string, any> = {}; const ps = MODELS[type].params; for (const k in ps) out[k] = ps[k].v; return out; }
  function makePin(title: string) {
    const p = document.createElement("div"); p.className = "pt-pin";
    p.innerHTML = `<span class="pt-dot"></span><span class="pt-card"><b></b><span></span></span>`;
    (p.querySelector("b") as HTMLElement).textContent = title;
    overlay.appendChild(p); return p;
  }
  /* Readings pinned onto parts of an uploaded model: one small label per part pin. */
  function syncPartPins(it: Item) {
    const x = it as any; (x._gp as HTMLDivElement[] | undefined)?.forEach((p) => p.remove()); x._gp = [];
    (it.gp || []).forEach((g) => { const p = document.createElement("div"); p.className = "pt-pin pt-part"; p.innerHTML = `<span class="pt-dot"></span><span class="pt-card"><b></b><span></span></span>`; (p.querySelector("b") as HTMLElement).textContent = g.mesh; overlay.appendChild(p); x._gp.push(p); });
  }
  function dropPartPins(it: Item) { ((it as any)._gp as HTMLDivElement[] | undefined)?.forEach((p) => p.remove()); (it as any)._gp = []; }
  let partPick: { id: string; cb: (mesh: string) => void } | null = null;
  function createItem(spec: Partial<ItemSpec> & { type: string } & Partial<Item>): Item | null {
    if (!MODELS[spec.type]) return null;
    if (spec.type === "glb" && !spec.glbObj) return null;
    const it = {
      id: spec.id || nid("m"), type: spec.type, name: spec.name || autoName(spec.type), x: spec.x || 0, z: spec.z || 0, rot: spec.rot || 0,
      params: { ...defaults(spec.type), ...(spec.params || {}) }, running: spec.running !== false, fault: !!spec.fault,
      area: spec.area || "", sub: spec.sub || "", assetId: spec.assetId ?? null, bind: { ...(spec.bind || {}) },
      glbObj: spec.glbObj, glbK: spec.glbK, glbNames: spec.glbNames, gb: spec.gb, gp: spec.gp, glbId: spec.glbId, live: new Set<string>(), status: "nolink",
    } as unknown as Item;
    build(it);
    syncPartPins(it);
    it.pin = makePin(it.name);
    it.pin.addEventListener("click", () => select(it.id));
    items.push(it); return it;
  }
  function placeFree(it: Item, nx = 0, nz = 0) {
    const fits = (x: number, z: number) => items.every((q) => q === it || Math.hypot(q.x - x, q.z - z) > q.rad + it.rad + 0.4);
    for (let r = 0; r < 40; r++) {
      const n = Math.max(1, r * 6);
      for (let a = 0; a < n; a++) {
        const ang = a / n * 2 * PI, x = Math.round((nx + Math.cos(ang) * r * 2) * 2) / 2, z = Math.round((nz + Math.sin(ang) * r * 2) * 2) / 2;
        if (fits(x, z)) { it.x = x; it.z = z; it.root.position.set(x, 0, z); return; }
      }
    }
  }
  function sizeFloor() {
    const b = items.length ? boundsOf(items) : { x0: -20, x1: 20, z0: -14, z1: 14 };
    const x0 = b.x0 - 8, x1 = b.x1 + 8, z0 = b.z0 - 8, z1 = b.z1 + 8;
    Object.assign(fb, { x0, x1, z0, z1 });
    floor.scale.set(x1 - x0, z1 - z0, 1); floor.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    if (grid) { scene.remove(grid); grid.geometry.dispose(); }
    const size = Math.ceil(Math.max(x1 - x0, z1 - z0) / 2) * 2;
    grid = new THREE.GridHelper(size, Math.min(240, size), 0x24324a, 0x172131); grid.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2); scene.add(grid);
  }
  /** Areas left to right in process order, sub-processes as columns, parallel machines stacked. */
  function autoLayout() {
    const GX = 1.6, GZ = 1.3, AG = 6, ROW = 75; let cx = 0, cz = 0, rowD = 0;
    areas.filter((a) => a.enabled).forEach((A) => {
      const cols = A.subs.filter((s) => s.enabled).map((s) => items.filter((i) => i.area === A.id && i.sub === s.name)).filter((l) => l.length);
      if (!cols.length) return;
      const dims = cols.map((list) => ({ w: Math.max(...list.map((i) => i.w)), d: list.reduce((s, i) => s + i.d, 0) + GZ * (list.length - 1), list }));
      const aw = dims.reduce((s, c) => s + c.w, 0) + GX * (dims.length - 1), ad = Math.max(...dims.map((c) => c.d));
      if (cx > 0 && cx + aw > ROW) { cx = 0; cz += rowD + AG + 3; rowD = 0; }
      let x = cx;
      dims.forEach((c) => { let z = cz + (ad - c.d) / 2; c.list.forEach((i) => { i.x = x + c.w / 2 - i.cx; i.z = z + i.d / 2 - i.cz; z += i.d + GZ; }); x += c.w + GX; });
      cx += aw + AG; rowD = Math.max(rowD, ad);
    });
    if (!items.length) { sizeFloor(); return; }
    const b = boundsOf(items), mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
    items.forEach((i) => { i.x -= mx; i.z -= mz; i.root.position.set(i.x, 0, i.z); });
    sizeFloor();
  }
  function rebuildConns() {
    while (connG.children.length) { const c = connG.children.pop()!; disposeTree(c); }
    conns.forEach((c) => {
      const a = byId(c.a), b = byId(c.b); c.flow = null; c.group = null; if (!a || !b) return;
      const y = c.medium === "power" ? 0.08 : 0.45, A = P(a.x, y, a.z), B = P(b.x, y, b.z);
      const pts = Math.abs(a.x - b.x) < 0.01 || Math.abs(a.z - b.z) < 0.01 ? [A, B] : [A, P(b.x, y, a.z), B];
      const r = c.medium === "power" ? 0.05 : 0.1, g = new THREE.Group();
      const mat = M(c.medium === "power" ? 0x3f3f1f : 0x5d6b80, { transparent: true, opacity: 0.45, depthWrite: false });
      for (let i = 0; i < pts.length - 1; i++) g.add(pipe(pts[i], pts[i + 1], r, mat));
      const line = polyline(pts);
      c.flow = particles(g, line, Math.min(60, Math.max(6, Math.round(line.total * 1.2))), (MED[c.medium] ?? MED.product).c, r * 0.6 + 0.02);
      c.group = g; connG.add(g);
    });
  }

  /* ---------- process areas on the floor + material flow arrows ---------- */
  function floorText(title: string, sub: string, color: number) {
    const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 160; const x = cv.getContext("2d")!;
    x.font = "700 76px system-ui, sans-serif"; x.fillStyle = hex(color); x.fillText(title, 8, 80);
    x.font = "500 44px system-ui, sans-serif"; x.fillStyle = "#8796ab"; x.fillText(sub, 10, 140);
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.25), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })); m.rotation.x = -PI / 2; return m;
  }
  const chev = (() => { const cv = document.createElement("canvas"); cv.width = 64; cv.height = 32; const x = cv.getContext("2d")!; x.fillStyle = "rgba(255,255,255,.16)"; x.fillRect(0, 0, 64, 32); x.strokeStyle = "#fff"; x.lineWidth = 5; x.beginPath(); x.moveTo(20, 6); x.lineTo(36, 16); x.lineTo(20, 26); x.stroke(); return cv; })();
  type Rect = NonNullable<AreaState["rect"]>;
  function route(a: Rect, b: Rect, k: number) {
    if (b.z0 > a.z1 + 1) { const mz = (a.z1 + b.z0) / 2; return [P(a.cx, 0, a.z1), P(a.cx, 0, mz), P(b.cx, 0, mz), P(b.cx, 0, b.z0)]; }
    if (a.z0 > b.z1 + 1) { const mz = (b.z1 + a.z0) / 2; return [P(a.cx, 0, a.z0), P(a.cx, 0, mz), P(b.cx, 0, mz), P(b.cx, 0, b.z1)]; }
    const z = (Math.max(a.z0, b.z0) + Math.min(a.z1, b.z1)) / 2, right = b.x0 >= a.x1, xa = right ? a.x1 : a.x0, xb = right ? b.x0 : b.x1;
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    const blockers = areas.filter((q) => q.rect && q.rect !== a && q.rect !== b && q.rect.x1 > lo && q.rect.x0 < hi && q.rect.z0 < z && q.rect.z1 > z);
    if (!blockers.length) return [P(xa, 0, z), P(xb, 0, z)];
    const zd = Math.max(a.z1, b.z1, ...blockers.map((q) => q.rect!.z1)) + 1.4 + (k % 3) * 0.9;
    return [P(a.cx, 0, a.z1), P(a.cx, 0, zd), P(b.cx, 0, zd), P(b.cx, 0, b.z1)];
  }
  function rebuildAreas() {
    while (areaG.children.length) { const c = areaG.children.pop()!; c.traverse((q: any) => { if (q.geometry) q.geometry.dispose(); if (q.material?.map) q.material.map.dispose(); }); }
    flowTex = []; flowLbls.forEach((l) => l.el.remove()); flowLbls = [];
    areas.forEach((A) => {
      A.rect = null; if (!A.enabled) return;
      const its = items.filter((i) => i.area === A.id); if (!its.length) return;
      const b = boundsOf(its), x0 = b.x0 - 1.4, x1 = b.x1 + 1.4, z0 = b.z0 - 1.2, z1 = b.z1 + 2.2;
      A.rect = { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
      const g = new THREE.Group(); g.userData.area = A.id;
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(A.rect.w, A.rect.d), new THREE.MeshBasicMaterial({ color: A.color, transparent: true, opacity: 0.07, depthWrite: false })); fill.rotation.x = -PI / 2; fill.position.set(A.rect.cx, 0.02, A.rect.cz); g.add(fill);
      g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([P(x0, 0.04, z0), P(x1, 0.04, z0), P(x1, 0.04, z1), P(x0, 0.04, z1)]), new THREE.LineBasicMaterial({ color: A.color, transparent: true, opacity: 0.75 })));
      const lab = floorText(A.name.toUpperCase(), A.out ? "→ " + A.out : (A.util ? "Serves the process areas" : ""), A.color);
      const sc = Math.min(1.2, (A.rect.w - 0.6) / 8); lab.scale.setScalar(sc); lab.position.set(x0 + 0.3 + 4 * sc, 0.05, z1 - 0.75 * sc); g.add(lab);
      areaG.add(g);
    });
    flows.forEach(([fa, fbid, label], k) => {
      const A = areaById(fa), B = areaById(fbid); if (!A?.rect || !B?.rect) return;
      const pts = route(A.rect, B.rect, k), g = new THREE.Group(); g.userData.flow = true;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz); if (len < 0.05) continue;
        const tex = new THREE.CanvasTexture(chev); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(len / 1.4, 1); flowTex.push(tex);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.8, 0.8), new THREE.MeshBasicMaterial({ map: tex, color: A.color, transparent: true, opacity: 0.9, depthWrite: false }));
        m.rotation.order = "YXZ"; m.rotation.y = Math.atan2(-dz, dx); m.rotation.x = -PI / 2; m.position.set((a.x + b.x) / 2, 0.06, (a.z + b.z) / 2); g.add(m);
      }
      areaG.add(g);
      const kk = Math.floor((pts.length - 1) / 2), mp = P((pts[kk].x + pts[kk + 1].x) / 2, 0.3, (pts[kk].z + pts[kk + 1].z) / 2);
      const d = document.createElement("div"); d.className = "pt-flowlbl"; d.textContent = "→ " + (label || A.out); overlay.appendChild(d); flowLbls.push({ el: d, p: mp, g });
    });
  }
  function applyIso() {
    const vis = (i: Item) => !(iso && focusId) || i.area === focusId;
    items.forEach((i) => { i.root.visible = vis(i); });
    conns.forEach((c) => { if (!c.group) return; const a = byId(c.a), b = byId(c.b); c.group.visible = !!(a && b && a.root.visible && b.root.visible); });
    areaG.children.forEach((g) => { g.visible = g.userData.flow ? !(iso && focusId) : (!(iso && focusId) || g.userData.area === focusId); });
  }
  function fitTo(list: Item[]) {
    goal.th = goal.ph = null;
    if (!list.length) { goal.t.set(0, 0.5, 0); goal.r = 30; goal.on = true; return; }
    const b = boundsOf(list);
    goal.t.set((b.x0 + b.x1) / 2, 0.5, (b.z0 + b.z1) / 2);
    goal.r = clamp(Math.max(b.x1 - b.x0, (b.z1 - b.z0) * 1.5) * 0.95 + 6, 8, 170); goal.on = true;
  }
  function frameView() { fitTo(focusId ? items.filter((i) => i.area === focusId) : items); }
  /** Fit button: frame everything and return to the starting view angle (nearest turn, so it does not spin round). */
  function fitAll() {
    frameView();
    const home = 0.5, d = ((th - home) % (2 * PI) + 3 * PI) % (2 * PI) - PI;
    goal.th = th - d; goal.ph = 0.92; goal.on = true; o.onChange();
  }
  function looksOf(it: Item): any[] {
    const out = new Set<any>();
    it.inner.traverse((ob: any) => { if (ob.isMesh && !ob.userData.fx) (Array.isArray(ob.material) ? ob.material : [ob.material]).forEach((m: any) => m && out.add(m)); });
    return [...out];
  }
  const HEAT_COLD = new THREE.Color(0x1d4ed8), HEAT_HOT = new THREE.Color(0xef4444), heatTmp = new THREE.Color();
  function heatLevel(it: Item): number {
    let h = -1;
    it.tags.forEach((t) => {
      if (t.u !== "\u00b0C") return;
      const l = limitsOf(it, t);
      const crit = l?.crit ?? (l?.warn !== undefined ? l.warn * 1.15 : t.low ? undefined : t.crit);
      const warn = l?.warn ?? (l?.crit !== undefined ? l.crit * 0.87 : t.low ? undefined : t.warn);
      if (warn === undefined || crit === undefined || crit <= warn) return;
      const v = it.r[t.k]; if (v === undefined || !Number.isFinite(v)) return;
      const span = Math.max(1e-6, crit - warn), lo = warn - span * 3;
      h = Math.max(h, clamp((v - lo) / (crit - lo), 0, 1));
    });
    if (h >= 0) return h;
    return it.status === "crit" ? 1 : it.status === "warn" ? 0.65 : it.status === "ok" ? 0.2 : 0;
  }
  /** Applies X-ray and heat map to one machine; materials keep their own look in userData to restore it. */
  function applyLook(it: Item) {
    const x = it as any;
    if (x._xr !== xray) {
      x._xr = xray;
      looksOf(it).forEach((m) => {
        const u = m.userData; if (u.xo === undefined) { u.xo = m.opacity; u.xt = m.transparent; u.xd = m.depthWrite; }
        if (xray) { m.transparent = true; m.opacity = Math.min(u.xo, 0.22); m.depthWrite = false; } else { m.transparent = u.xt; m.opacity = u.xo; m.depthWrite = u.xd; }
        m.needsUpdate = true;
      });
    }
    if (heat) {
      heatTmp.copy(HEAT_COLD).lerp(HEAT_HOT, heatLevel(it));
      looksOf(it).forEach((m) => { if (!m.emissive) return; const u = m.userData; if (u.he === undefined) { u.he = m.emissive.getHex(); u.hi = m.emissiveIntensity; } m.emissive.copy(heatTmp); m.emissiveIntensity = 0.55; });
      x._ht = true;
    } else if (x._ht) {
      looksOf(it).forEach((m) => { const u = m.userData; if (u.he !== undefined && m.emissive) { m.emissive.setHex(u.he); m.emissiveIntensity = u.hi; delete u.he; delete u.hi; } });
      x._ht = false;
    }
  }
  function frameNow() { frameView(); tgt.copy(goal.t); rad = goal.r; goal.on = false; th = 0.5; ph = 0.92; }
  function structureChanged(edit = true) { sizeFloor(); rebuildConns(); rebuildAreas(); applyIso(); o.onChange(); if (edit) o.onEdit(); }

  /* ---------- loading and saving ---------- */
  function clearAll() { loadGen++; pendingGlb = []; partPick = null; items.slice().forEach((i) => { world.remove(i.root); if (i.type !== "glb") disposeTree(i.root); i.pin.remove(); dropPartPins(i); }); items = []; conns = []; sel = null; connectFrom = null; rebuildConns(); }

  /* ---------- uploaded .glb models ---------- */
  /** Saved models still downloading: kept as specs so a save meanwhile does not drop them. */
  let pendingGlb: ItemSpec[] = [], loadGen = 0;
  const glbCache = new Map<string, Promise<{ obj: THREE.Object3D; names: string[]; k: number }>>();
  function parseGlb(buf: ArrayBuffer) {
    return new Promise<any>((res, rej) => new GLTFLoader().parse(buf, "", res, rej)).then((gltf) => {
      const obj: THREE.Object3D = gltf.scene, names: string[] = []; let n = 0;
      obj.traverse((q: any) => { if (q.isMesh) { if (!q.name) q.name = "Part " + (++n); names.push(q.name); } });
      const sz = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
      return { obj, names, k: 3 / Math.max(sz.x, sz.y, sz.z, 0.001) };
    });
  }
  function loadSavedGlb(spec: ItemSpec) {
    if (!spec.glbId || !o.fetchGlb) return;
    pendingGlb.push(spec);
    const gen = loadGen;
    let p = glbCache.get(spec.glbId);
    if (!p) { p = o.fetchGlb(spec.glbId).then(parseGlb); glbCache.set(spec.glbId, p); p.catch(() => glbCache.delete(spec.glbId!)); }
    p.then((m) => {
      if (gen !== loadGen || disposed) return;
      pendingGlb = pendingGlb.filter((s) => s !== spec);
      const it = createItem({ ...spec, glbObj: m.obj, glbK: m.k, glbNames: m.names });
      if (it) { applyIso(); sizeFloor(); rebuildConns(); rebuildAreas(); applyIso(); o.onChange(); }
    }).catch(() => {
      if (gen !== loadGen) return;
      // Kept in pendingGlb, so saving does not lose it; the panel reports it.
      glbFailed.add(spec.id); o.onChange();
    });
  }
  const glbFailed = new Set<string>();
  function makeAreas(pk: PackDef): AreaState[] { let k = 0; return pk.areas.map((a) => ({ id: a.id, name: a.name, out: a.out || "", med: a.med || "product", util: !!a.util, color: a.util ? UTIL_COL : AREA_COL[k++ % AREA_COL.length], enabled: true, subs: a.subs.map((s) => ({ name: s.name, enabled: true })) })); }
  function packFlows(pk: PackDef): [string, string, string][] { if (pk.flows) return pk.flows; const proc = pk.areas.filter((a) => !a.util); return proc.slice(0, -1).map((a, i) => [a.id, proc[i + 1].id, a.out || ""]); }

  /**
   * Lay a template out from scratch. `keep` carries machines from the current
   * layout (matched by area, sub-process and name) so unticking a stage does not
   * throw away asset links and settings; custom machines are carried over too.
   */
  function loadPack(key: string, disabled?: Set<string>, keep?: ItemSpec[]) {
    const pk = PACKS[key] ?? PACKS.textile;
    clearAll(); pack = PACKS[key] ? key : "textile";
    areas = makeAreas(pk);
    if (disabled) areas.forEach((A) => { if (disabled.has(A.id)) A.enabled = false; A.subs.forEach((S) => { if (disabled.has(A.id + "/" + S.name)) S.enabled = false; }); });
    const kept = new Map((keep || []).map((s) => [`${s.area}|${s.sub}|${s.name}`, s]));
    pk.areas.forEach((a, ai) => {
      const A = areas[ai]; if (!A.enabled) return;
      a.subs.forEach((s, si) => {
        if (!A.subs[si].enabled) return;
        s.items.forEach(([type, name, params, extra]) => {
          const prev = kept.get(`${a.id}|${s.name}|${name}`); kept.delete(`${a.id}|${s.name}|${name}`);
          const it = createItem({ type, name, params: { ...(params || {}), ...(prev?.params || {}) }, area: a.id, sub: s.name, assetId: prev?.assetId, bind: prev?.bind, running: prev?.running, fault: prev?.fault });
          if (it && extra) { it.feeds = extra.feeds; it.feedMed = extra.med; }
        });
      });
    });
    autoLayout();
    for (const spec of kept.values()) {
      const A = areaById(spec.area); if (spec.area && !A?.enabled) continue;
      if (A && !A.subs.some((s) => s.name === spec.sub)) A.subs.push({ name: spec.sub || "Added", enabled: true });
      if (spec.type === "glb") { loadSavedGlb(spec); continue; }
      const it = createItem({ ...spec, id: undefined }); if (it) placeFree(it, 0, 0);
    }
    areas.forEach((A) => {
      if (!A.enabled || A.util) return;
      const cols = A.subs.filter((s) => s.enabled).map((s) => items.filter((i) => i.area === A.id && i.sub === s.name)).filter((l) => l.length);
      for (let i = 0; i < cols.length - 1; i++) cols[i].slice(0, 3).forEach((f) => conns.push({ id: nid("c"), a: f.id, b: cols[i + 1][0].id, medium: A.med }));
    });
    items.filter((i) => i.feeds).forEach((i) => i.feeds!.forEach((aid) => { const first = items.find((x) => x.area === aid); if (first) conns.push({ id: nid("c"), a: i.id, b: first.id, medium: i.feedMed || "water" }); }));
    flows = packFlows(pk); focusId = null;
    sizeFloor(); rebuildConns(); rebuildAreas(); applyIso(); frameNow();
  }
  function loadScene(doc: Partial<SceneDoc> | null | undefined, fallbackPack = "textile") {
    if (!doc || !Array.isArray(doc.items) || !doc.areas) { demo = true; loadPack(doc?.pack || fallbackPack); o.onChange(); return; }
    clearAll();
    pack = doc.pack && PACKS[doc.pack] ? doc.pack : fallbackPack;
    demo = doc.demo !== false;
    let k = 0;
    areas = doc.areas.map((a) => ({ ...a, subs: a.subs.map((s) => ({ ...s })), color: a.util ? UTIL_COL : AREA_COL[k++ % AREA_COL.length] }));
    doc.items.forEach((s) => { if (s.type === "glb") loadSavedGlb(s); else createItem(s); });
    (doc.conns || []).forEach((c) => { if (byId(c.a) && byId(c.b)) conns.push({ id: nid("c"), a: c.a, b: c.b, medium: MED[c.medium] ? c.medium : "product" }); });
    flows = (doc.flows || []).filter((f) => Array.isArray(f) && f.length >= 2) as [string, string, string][];
    focusId = null;
    sizeFloor(); rebuildConns(); rebuildAreas(); applyIso(); frameNow(); o.onChange();
  }
  function serialize(): SceneDoc {
    // Uploaded models are saved when they are in the upload store (glbId); a model
    // read from a file only in this browser is not.
    const keep = items.filter((i) => i.type !== "glb" || i.glbId);
    const ids = new Set([...keep.map((i) => i.id), ...pendingGlb.map((s) => s.id)]);
    return {
      version: 1, pack, demo,
      areas: areas.map((a) => ({ id: a.id, name: a.name, out: a.out, med: a.med, util: a.util, enabled: a.enabled, subs: a.subs.map((s) => ({ ...s })) })),
      flows,
      items: [
        ...keep.map((i) => ({
          id: i.id, type: i.type, name: i.name, x: +i.x.toFixed(2), z: +i.z.toFixed(2), rot: i.rot, params: i.params, area: i.area, sub: i.sub, assetId: i.assetId || null, bind: i.bind, running: i.running, fault: i.fault,
          ...(i.type === "glb" ? { glbId: i.glbId, gb: (i.gb || []).map((b) => ({ ...b })), gp: (i.gp || []).map((g) => ({ ...g })) } : {}),
        })),
        ...pendingGlb.map((s) => ({ ...s })),
      ],
      conns: conns.filter((c) => ids.has(c.a) && ids.has(c.b)).map((c) => ({ a: c.a, b: c.b, medium: c.medium })),
    };
  }

  /* ---------- readings ---------- */
  function readingOf(it: Item, t: TagDef): Reading {
    const metric = it.assetId ? it.bind[t.k] || null : null;
    const live = it.live.has(t.k);
    const source: Source = live ? "live" : demo && !metric ? "demo" : "none";
    const value = source === "none" ? null : it.r[t.k];
    const rules = !!limitsOf(it, t);
    return { k: t.k, n: t.n, u: t.u, d: t.d, value, source, status: value == null ? "nolink" : statusOf(it, t, value), metric, rules, playback: playback && live };
  }
  function sim(dt: number) {
    const k = Math.min(1, dt * 0.6), kl = Math.min(1, dt * 4);
    items.forEach((it) => {
      let w: Status = "ok", counted = 0;
      it.live.clear();
      const running = demo ? it.running && !(scenario === "trip" && isPump(it)) : true;
      it.tags.forEach((t) => {
        const metric = it.assetId ? it.bind[t.k] : undefined;
        const lv = metric && it.assetId ? o.getLive(it.assetId, metric) : undefined;
        if (lv != null && Number.isFinite(lv)) {
          it.live.add(t.k); it.r[t.k] += (lv - it.r[t.k]) * kl;
          if (Math.abs(lv - it.r[t.k]) < Math.abs(lv) * 1e-4 + 1e-6) it.r[t.k] = lv;
        } else if (demo && !metric) {
          const target = !running ? t.off : scenarioTarget(it, t, it.fault && t.fault !== undefined ? t.fault : t.v);
          it.r[t.k] += (target - it.r[t.k]) * k + (running ? rnd(t.noise) : 0);
        } else {
          it.r[t.k] += (t.off - it.r[t.k]) * k;
          return;
        }
        counted++;
        const v = it.live.has(t.k) ? (lv as number) : it.r[t.k];
        const s = statusOf(it, t, v); if (RANK[s] > RANK[w]) w = s;
      });
      it.status = demo && !it.running ? "off" : counted ? w : "nolink";
    });
  }

  /* ---------- interaction ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
  function setRay(e: PointerEvent | WheelEvent) { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); }
  function pickItem(e: PointerEvent): Item | null {
    setRay(e);
    for (const h of ray.intersectObjects(world.children, true)) {
      const obj: any = h.object; if (obj.userData.fx || obj.isLine || !obj.visible) continue;
      const it = obj.userData.item as Item | undefined; if (it && it.root.visible) return it;
    }
    return null;
  }
  let ptr: { x: number; y: number; moved: number; it: Item | null; drag: boolean; off?: { x: number; z: number } } | null = null;
  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const it = pickItem(e); ptr = { x: e.clientX, y: e.clientY, moved: 0, it, drag: false };
    if (it && ray.ray.intersectPlane(floorPlane, hitP)) ptr.off = { x: it.x - hitP.x, z: it.z - hitP.z };
  };
  const onMove = (e: PointerEvent) => {
    if (!ptr) return;
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y; ptr.moved += Math.abs(dx) + Math.abs(dy); ptr.x = e.clientX; ptr.y = e.clientY;
    if (!ptr.it || readOnly) { if (!ptr.it || ptr.moved > 5) { th -= dx * 0.006; ph = clamp(ph - dy * 0.006, 0.2, 1.42); goal.on = false; } return; }
    if (ptr.moved > 5 && !connectFrom && ptr.off) {
      if (!ptr.drag) { ptr.drag = true; if (sel !== ptr.it) select(ptr.it.id); }
      setRay(e);
      if (ray.ray.intersectPlane(floorPlane, hitP)) { const it = ptr.it; it.x = clamp(Math.round((hitP.x + ptr.off.x) * 2) / 2, fb.x0 + 1, fb.x1 - 1); it.z = clamp(Math.round((hitP.z + ptr.off.z) * 2) / 2, fb.z0 + 1, fb.z1 - 1); it.root.position.set(it.x, 0, it.z); }
    }
  };
  const onUp = () => {
    if (!ptr) return;
    if (ptr.moved <= 5 && partPick) {
      const pk = partPick; partPick = null;
      const target = byId(pk.id);
      if (target) {
        for (const h of ray.intersectObject(target.inner, true)) { const ob: any = h.object; if (ob.isMesh && !ob.userData.fx && ob.name) { pk.cb(ob.name); break; } }
      }
      o.onChange(); ptr = null; return;
    }
    if (ptr.moved <= 5) {
      if (connectFrom) {
        if (ptr.it && ptr.it !== connectFrom) { conns.push({ id: nid("c"), a: connectFrom.id, b: ptr.it.id, medium: areaById(connectFrom.area)?.med || "product" }); rebuildConns(); applyIso(); o.onEdit(); }
        connectFrom = null; o.onChange();
      } else select(ptr.it?.id ?? null);
    } else if (ptr.drag) structureChanged();
    ptr = null;
  };
  const onCancel = () => { ptr = null; };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); goal.on = false; rad = clamp(rad * (1 + Math.sign(e.deltaY) * 0.08), 6, 180); };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  function select(id: string | null) { sel = byId(id) ?? null; o.onChange(); }
  function focusArea(id: string | null) { focusId = id || null; applyIso(); frameView(); o.onChange(); }
  function ensureSub(A: AreaState | undefined, name: string) { if (A && !A.subs.some((s) => s.name === name)) A.subs.push({ name, enabled: true }); }

  /* ---------- frame loop ---------- */
  const anchorV = new THREE.Vector3(), projV = new THREE.Vector3();
  function showLabel(it: Item) {
    if (labelMode === "off") return it === sel;
    if (labelMode === "all") return true;
    // Whole plant: only what needs attention, unless the plant is tiny. Chosen area: all of its machines.
    return it === sel || it.status === "warn" || it.status === "crit" || (focusId ? it.area === focusId : items.length <= 8);
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    const cw = Math.round(w), ch = Math.round(h);
    if (canvas.width !== Math.round(cw * renderer.getPixelRatio()) || canvas.height !== Math.round(ch * renderer.getPixelRatio())) { renderer.setSize(cw, ch, false); cam.aspect = cw / ch; cam.updateProjectionMatrix(); }
  }
  function placePin(pin: HTMLElement, v: THREE.Vector3) {
    projV.copy(v).project(cam);
    if (projV.z > 1) { pin.style.transform = "translate(-9999px,0)"; return; }
    pin.style.transform = `translate(${(projV.x + 1) / 2 * host.clientWidth - 6}px, ${(1 - projV.y) / 2 * host.clientHeight - 6}px)`;
  }
  let last = performance.now();
  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
    if (!host.clientWidth) return;
    resize(); sim(dt);
    items.forEach((it) => {
      if (!it.root.visible) return;
      it.running = demo ? it.running : true;
      if (it.update) it.update(dt, t, it);
      if (it.r.vib !== undefined) { const a = it.r.vib * 0.004; it.inner.position.set(rnd(a), rnd(a * 0.5), rnd(a)); }
      const s = it.status, c = SCOL[s];
      it.beaconM.color.setHex(c); it.beaconM.emissive.setHex(c); it.beaconM.emissiveIntensity = s === "crit" ? (Math.sin(t * 10) > 0 ? 1.6 : 0.15) : s === "off" || s === "nolink" ? 0.2 : 1.1;
      it.ringM.color.setHex(s === "warn" ? 0xf59e0b : 0xef4444); it.ringM.opacity = s === "warn" || s === "crit" ? 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 5)) : 0;
      it.selRing.visible = sel === it || connectFrom === it;
    });
    conns.forEach((c) => { if (c.flow && c.group?.visible) { const a = byId(c.a); c.flow.update(dt, a && a.status !== "off" ? 1.4 : 0); } });
    flowTex.forEach((tx) => { tx.offset.x -= dt * 0.7; });
    if (goal.on) {
      const k = Math.min(1, dt * 3); tgt.lerp(goal.t, k); rad += (goal.r - rad) * k;
      if (goal.th != null) th += (goal.th - th) * k;
      if (goal.ph != null) ph += (goal.ph - ph) * k;
      const angDone = (goal.th == null || Math.abs(goal.th - th) < 0.01) && (goal.ph == null || Math.abs(goal.ph - ph) < 0.01);
      if (tgt.distanceTo(goal.t) < 0.05 && Math.abs(goal.r - rad) < 0.05 && angDone) { goal.on = false; goal.th = goal.ph = null; }
    }
    items.forEach((it) => { applyLook(it); });
    if (auto && !ptr) th += dt * 0.06;
    cam.position.set(tgt.x + rad * Math.sin(ph) * Math.sin(th), tgt.y + rad * Math.cos(ph), tgt.z + rad * Math.sin(ph) * Math.cos(th)); cam.lookAt(tgt);
    renderer.render(scene, cam);
    items.forEach((it) => {
      if (!it.root.visible || !showLabel(it)) { it.pin.style.transform = "translate(-9999px,0)"; return; }
      anchorV.set(it.cx, it.top + 1.0, it.cz); it.root.localToWorld(anchorV); placePin(it.pin, anchorV);
      it.pin.className = "pt-pin " + (it.status === "ok" ? "" : it.status) + (sel === it ? " sel" : "");
      const mt = it.tags.find((x) => x.k === it.mainKey);
      const r = mt ? readingOf(it, mt) : null;
      (it.pin.querySelector(".pt-card > span") as HTMLElement).textContent = it.status === "off" ? "stopped" : !r ? "" : r.source === "none" ? "not linked" : fmtReading(r) + (r.source === "demo" ? " · demo" : r.playback ? " · playback" : "");
    });
    items.forEach((it) => {
      const pins = (it as any)._gp as HTMLDivElement[] | undefined; if (!pins?.length) return;
      (it.gp || []).forEach((g, i) => {
        const pin = pins[i]; if (!pin) return;
        const mesh: any = it.root.visible ? it.inner.getObjectByName(g.mesh) : null;
        if (!mesh || labelMode === "off") { pin.style.transform = "translate(-9999px,0)"; return; }
        if (mesh.geometry && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry?.boundingBox; anchorV.set(bb ? (bb.min.x + bb.max.x) / 2 : 0, bb ? bb.max.y : 0, bb ? (bb.min.z + bb.max.z) / 2 : 0);
        mesh.localToWorld(anchorV); placePin(pin, anchorV);
        const t = it.tags.find((x) => x.k === g.k); const r = t ? readingOf(it, t) : null;
        pin.className = "pt-pin pt-part " + (r && r.status !== "ok" && r.status !== "nolink" ? r.status : "");
        (pin.querySelector(".pt-card > span") as HTMLElement).textContent = !r ? "" : r.source === "none" ? `${r.n}: not linked` : `${r.n}: ${fmtReading(r)}${r.source === "demo" ? " · demo" : r.playback ? " · playback" : ""}`;
      });
    });
    flowLbls.forEach((l) => {
      if (!l.g.visible) { l.el.style.transform = "translate(-9999px,0)"; return; }
      projV.copy(l.p).project(cam); if (projV.z > 1) { l.el.style.transform = "translate(-9999px,0)"; return; }
      l.el.style.transform = `translate(${(projV.x + 1) / 2 * host.clientWidth}px, ${(1 - projV.y) / 2 * host.clientHeight}px) translate(-50%,-50%)`;
    });
  }

  /* ---------- API ---------- */
  const api = {
    start() { if (!raf && !disposed) { last = performance.now(); raf = requestAnimationFrame(frame); } },
    dispose() {
      disposed = true; cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onCancel); canvas.removeEventListener("wheel", onWheel);
      clearAll(); flowLbls.forEach((l) => l.el.remove());
      scene.traverse((q: any) => { if (q.geometry) q.geometry.dispose(); if (q.material) { (Array.isArray(q.material) ? q.material : [q.material]).forEach((m: any) => { m.map?.dispose(); m.dispose(); }); } });
      renderer.dispose();
    },
    loadScene, loadPack: (key: string) => { demo = true; loadPack(key); o.onChange(); },
    serialize,
    get items() { return items; }, get areas() { return areas; }, get flows() { return flows; }, get conns() { return conns; },
    get selected() { return sel; }, get focusId() { return focusId; }, get iso() { return iso; }, get labelMode() { return labelMode; },
    get demo() { return demo; }, get pack() { return pack; }, get connectingFrom() { return connectFrom; }, get readOnly() { return readOnly; },
    setReadOnly(b: boolean) { readOnly = b; if (b) connectFrom = null; },
    select, focusArea,
    setIso(b: boolean) { iso = b; applyIso(); frameView(); o.onChange(); },
    setLabelMode(m: LabelMode) { labelMode = m; o.onChange(); },
    setAuto(b: boolean) { auto = b; },
    setXray(b: boolean) { xray = b; o.onChange(); },
    setHeat(b: boolean) { heat = b; o.onChange(); },
    setScenario(sc: Scenario) { scenario = sc; o.onChange(); },
    get scenario() { return scenario; },
    /** Which scenarios do something with the machines now on the floor. */
    scenarioFits(): Record<Scenario, boolean> {
      const pumps = items.some(isPump), rot = items.some(isRotating);
      const own = (sc: Scenario) => items.some((i) => !!MODELS[i.type]?.scen?.(i.params)?.[sc]);
      const fits = { normal: true, fault: items.some((i) => i.tags.some((t) => t.fault !== undefined)), cavitation: pumps, overheat: rot, trip: pumps } as Record<Scenario, boolean>;
      MODEL_SCENARIOS.forEach((sc) => { fits[sc] = own(sc); });
      return fits;
    },
    get xray() { return xray; }, get heat() { return heat; }, get auto() { return auto; },
    fitAll,
    frameView,
    fitItem(id: string) { const it = byId(id); if (!it) return; if (iso && focusId && it.area !== focusId) { focusId = it.area; applyIso(); } fitTo([it]); goal.r = Math.max(goal.r, 14); o.onChange(); },
    readings(id: string): Reading[] { const it = byId(id); return it ? it.tags.map((t) => readingOf(it, t)) : []; },
    bindList(id: string) { const it = byId(id); return it ? MODELS[it.type].binds(it.params, it) : []; },
    areaStats(): AreaStat[] {
      const stat = (id: string, list: Item[]): AreaStat => ({
        id, total: list.length, running: list.filter((i) => i.status !== "off").length,
        alarms: list.filter((i) => i.status === "warn" || i.status === "crit").length,
        worst: list.reduce<Status>((s, i) => (RANK[i.status] > RANK[s] ? i.status : s), "ok"),
        linked: list.filter((i) => i.live.size > 0).length,
      });
      return [stat("*", items), ...areas.map((a) => stat(a.id, items.filter((i) => i.area === a.id)))];
    },
    topAlarm() {
      const bad = items.filter((i) => i.status === "warn" || i.status === "crit").sort((a, b) => RANK[b.status] - RANK[a.status]);
      if (!bad.length) return null;
      const it = bad[0], r = it.tags.map((t) => readingOf(it, t)).find((x) => x.status === it.status);
      return { status: it.status, id: it.id, area: areaById(it.area)?.name ?? "", name: it.name, reading: r ? `${r.n.toLowerCase()} ${fmtReading(r)}${r.source === "demo" ? " (demo)" : ""}` : "", more: bad.length - 1 };
    },
    /** Asset + metric pairs that need live values. */
    pairs() { const out = new Map<string, { assetId: string; metric: string }>(); items.forEach((i) => { if (!i.assetId) return; Object.values(i.bind).forEach((m) => { if (m) out.set(i.assetId + "\u0000" + m, { assetId: i.assetId!, metric: m }); }); }); return [...out.values()]; },
    unlinkedCount() { let n = 0; items.forEach((i) => i.tags.forEach((t) => { if (!(i.assetId && i.bind[t.k])) n++; })); return n; },

    addMachine(type: string, areaId: string, near?: { x: number; z: number }) {
      const A = areaById(areaId);
      const it = createItem({ type, area: A ? areaId : "", sub: A ? "Added" : "" }); if (!it) return null;
      ensureSub(A, "Added");
      const c = near ?? (A?.rect ? { x: A.rect.cx, z: A.rect.cz } : { x: tgt.x, z: tgt.z }); placeFree(it, c.x, c.z);
      applyIso(); sel = it; structureChanged(); fitTo([it]); goal.r = Math.max(goal.r, 16); return it.id;
    },
    /** Floor position under a screen point, for dropping a machine from the library. */
    floorPoint(clientX: number, clientY: number): { x: number; z: number } | null {
      const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return null;
      ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam);
      return ray.ray.intersectPlane(floorPlane, hitP) ? { x: hitP.x, z: hitP.z } : null;
    },
    removeItem(id: string) {
      const it = byId(id); if (!it) return;
      world.remove(it.root); if (it.type !== "glb") disposeTree(it.root); it.pin.remove(); dropPartPins(it);
      items = items.filter((i) => i !== it); conns = conns.filter((c) => c.a !== it.id && c.b !== it.id);
      if (sel === it) sel = null; if (connectFrom === it) connectFrom = null;
      structureChanged();
    },
    rotateItem(id: string) { const it = byId(id); if (!it) return; it.rot = (it.rot + 90) % 360; it.root.rotation.y = it.rot * PI / 180; structureChanged(); },
    duplicateItem(id: string) {
      const it = byId(id); if (!it) return;
      const n = createItem({ type: it.type, params: { ...it.params }, rot: it.rot, area: it.area, sub: it.sub, assetId: it.assetId, bind: { ...it.bind }, glbObj: it.glbObj, glbK: it.glbK, glbNames: it.glbNames, glbId: it.glbId, gb: it.gb?.map((x) => ({ ...x })), gp: it.gp?.map((x) => ({ ...x })) });
      if (!n) return; placeFree(n, it.x, it.z); applyIso(); sel = n; structureChanged();
    },
    /**
     * Copies of a machine with its settings and readings links, numbered on from
     * its name (WTG-01 → WTG-02, WTG-03…) and laid out in a row or a grid.
     * `assetFor(i)` may give copy i (1-based) a different asset; the links are
     * kept by reading key, so sibling assets made from one template map at once.
     */
    duplicateMany(id: string, count: number, layout: "row" | "grid", gap: number, assetFor?: (i: number) => string | null | undefined): string[] {
      const it = byId(id); if (!it) return [];
      count = Math.max(1, Math.min(50, Math.round(count)));
      const m = /^(.*?)(\d+)$/.exec(it.name);
      const prefix = m ? m[1] : it.name + "-", width = m ? m[2].length : 2;
      const used = new Set(items.map((i) => i.name));
      let num = m ? Number(m[2]) : 1;
      const nextName = () => { let nm: string; do { num++; nm = prefix + String(num).padStart(width, "0"); } while (used.has(nm)); used.add(nm); return nm; };
      const stepX = it.w + gap, stepZ = it.d + gap, cols = layout === "grid" ? Math.ceil(Math.sqrt(count + 1)) : count + 1;
      const out: string[] = [];
      for (let i = 1; i <= count; i++) {
        const other = assetFor?.(i);
        const n = createItem({
          type: it.type, name: nextName(), params: { ...it.params }, rot: it.rot, area: it.area, sub: it.sub,
          assetId: other ?? it.assetId, bind: { ...it.bind }, running: it.running,
          glbObj: it.glbObj, glbK: it.glbK, glbNames: it.glbNames, glbId: it.glbId, gb: it.gb?.map((x) => ({ ...x })), gp: it.gp?.map((x) => ({ ...x })),
        });
        if (!n) continue;
        const col = i % cols, row = Math.floor(i / cols);
        n.x = Math.round((it.x + col * stepX) * 2) / 2; n.z = Math.round((it.z + row * stepZ) * 2) / 2; n.root.position.set(n.x, 0, n.z);
        out.push(n.id);
      }
      applyIso(); structureChanged(); fitTo([it, ...out.map((x) => byId(x)!).filter(Boolean)]);
      return out;
    },
    /** Close view of one machine that also fits its height (a wind turbine is tall). */
    frameClose(id: string) {
      const it = byId(id); if (!it) return;
      const b = ib(it), size = Math.max(b.x1 - b.x0, b.z1 - b.z0, it.top * 1.25);
      goal.t.set(b.cx, Math.max(0.5, it.top * 0.42), b.cz); goal.r = clamp(size * 1.45 + 3, 7, 170);
      goal.th = 0.6; goal.ph = 1.12; goal.on = true; o.onChange();
    },
    /** PNG of the current 3D view on the page background. Renders a frame first, so no preserved buffer is needed. */
    snapshot(background = "#0b1220"): string {
      renderer.render(scene, cam);
      const out = document.createElement("canvas"); out.width = canvas.width; out.height = canvas.height;
      const x = out.getContext("2d")!; x.fillStyle = background; x.fillRect(0, 0, out.width, out.height); x.drawImage(canvas, 0, 0);
      return out.toDataURL("image/png");
    },
    setPlayback(b: boolean) { playback = b; o.onChange(); },
    get playback() { return playback; },
    /** Saved models that are still downloading, or failed to. */
    glbStatus() { return { loading: pendingGlb.filter((s) => !glbFailed.has(s.id)).length, failed: pendingGlb.filter((s) => glbFailed.has(s.id)).map((s) => s.name) }; },
    /** Next click on a part of this machine reports the part name. */
    pickPart(id: string | null, cb?: (mesh: string) => void) { partPick = id && cb ? { id, cb } : null; o.onChange(); },
    get pickingPart() { return partPick?.id ?? null; },
    addPartPin(id: string, mesh: string, k: string) { const it = byId(id); if (!it) return; it.gp = [...(it.gp || []), { mesh, k }]; syncPartPins(it); o.onChange(); o.onEdit(); },
    setPartPin(id: string, i: number, field: "mesh" | "k", value: string) { const it = byId(id); if (!it?.gp?.[i]) return; it.gp[i] = { ...it.gp[i], [field]: value }; syncPartPins(it); o.onChange(); o.onEdit(); },
    removePartPin(id: string, i: number) { const it = byId(id); if (!it?.gp) return; it.gp = it.gp.filter((_, j) => j !== i); syncPartPins(it); o.onChange(); o.onEdit(); },
    startConnect(id: string | null) { connectFrom = id ? byId(id) ?? null : null; o.onChange(); },
    setName(id: string, name: string) { const it = byId(id); if (!it) return; it.name = name; (it.pin.querySelector("b") as HTMLElement).textContent = name; o.onChange(); o.onEdit(); },
    setParam(id: string, key: string, value: any, final: boolean) {
      const it = byId(id); if (!it) return; it.params[key] = value; build(it); rebuildConns(); applyIso();
      if (final) structureChanged(); else o.onChange();
    },
    setArea(id: string, areaId: string) { const it = byId(id); if (!it) return; it.area = areaId; it.sub = areaId ? "Added" : ""; ensureSub(areaById(areaId), "Added"); structureChanged(); },
    setRunning(id: string, b: boolean) { const it = byId(id); if (it) { it.running = b; o.onChange(); o.onEdit(); } },
    setFault(id: string, b: boolean) { const it = byId(id); if (it) { it.fault = b; o.onChange(); o.onEdit(); } },
    setDemo(b: boolean) { demo = b; o.onChange(); o.onEdit(); },
    setAsset(id: string, assetId: string | null, metrics: string[]) {
      const it = byId(id); if (!it) return; it.assetId = assetId; it.bind = assetId ? autoMap(it.tags, metrics) : {};
      o.onChange(); o.onEdit();
    },
    setBinding(id: string, k: string, metric: string) { const it = byId(id); if (!it) return; if (metric) it.bind[k] = metric; else delete it.bind[k]; o.onChange(); o.onEdit(); },
    setConnMedium(cid: string, medium: string) { const c = conns.find((x) => x.id === cid); if (c) { c.medium = medium; rebuildConns(); applyIso(); o.onChange(); o.onEdit(); } },
    removeConn(cid: string) { conns = conns.filter((c) => c.id !== cid); rebuildConns(); applyIso(); o.onChange(); o.onEdit(); },
    /** Include or leave out a process stage; rebuilds the layout and keeps asset links. */
    setStage(areaId: string, subIndex: number | null, enabled: boolean) {
      const A = areaById(areaId); if (!A) return;
      if (subIndex == null) A.enabled = enabled; else if (A.subs[subIndex]) A.subs[subIndex].enabled = enabled;
      const dis = new Set<string>(); areas.forEach((a) => { if (!a.enabled) dis.add(a.id); a.subs.forEach((s) => { if (!s.enabled) dis.add(a.id + "/" + s.name); }); });
      const keep = serialize().items;
      loadPack(pack, dis, keep);
      o.onChange(); o.onEdit();
    },
    /**
     * Places an uploaded .glb model. With `uploadId` (the file is in the upload
     * store) it is saved with the twin; without, it shows in this session only.
     */
    async addGlb(file: File, areaId: string, uploadId?: string): Promise<string> {
      const m = await parseGlb(await file.arrayBuffer());
      if (uploadId) glbCache.set(uploadId, Promise.resolve(m));
      const A = areaById(areaId);
      const it = createItem({ type: "glb", name: file.name.replace(/\.glb$/i, ""), glbObj: m.obj, glbK: m.k, glbNames: m.names, glbId: uploadId, gb: [{ mesh: m.names[0] || "", beh: "Rotate Y", k: "speed" }], area: A ? areaId : "", sub: A ? "Added" : "" });
      if (!it) throw new Error("model could not be created");
      ensureSub(A, "Added"); placeFree(it, A?.rect?.cx ?? tgt.x, A?.rect?.cz ?? tgt.z); sel = it; structureChanged(!!uploadId);
      return `Loaded ${m.names.length} parts.`;
    },
    setGlbBehaviour(id: string, i: number, field: "mesh" | "beh" | "k", value: string) { const it = byId(id); if (!it?.gb) return; (it.gb[i] as any)[field] = value; o.onChange(); o.onEdit(); },
    addGlbBehaviour(id: string) { const it = byId(id); if (!it) return; it.gb = it.gb || []; it.gb.push({ mesh: it.glbNames?.[0] || "", beh: "Heat colour", k: "temp" }); o.onChange(); o.onEdit(); },
    removeGlbBehaviour(id: string, i: number) { const it = byId(id); if (!it?.gb) return; it.gb = it.gb.filter((_, j) => j !== i); o.onChange(); o.onEdit(); },
  };
  return api;
}
export type PlantEngine = ReturnType<typeof createPlantEngine>;
