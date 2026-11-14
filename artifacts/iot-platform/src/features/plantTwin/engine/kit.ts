import * as THREE from "three";

/**
 * Building blocks shared by every machine model: materials, primitive shapes,
 * flow particles, heat colouring and reading definitions.
 *
 * Models are built in code from simple shapes so that every size, zone count
 * and type a user picks produces a matching model without any asset files.
 */

export const PI = Math.PI;
export const DS = THREE.DoubleSide;
export const AMB = 30;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const rnd = (k: number) => (Math.random() - 0.5) * k;
export const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const C = { steel: 0x3a4556, dark: 0x222b38, blue: 0x2f5f9e, grey: 0x6b7b90, light: 0x9aa6b6, green: 0x2e7d5b, yellow: 0xd4a23a, white: 0xc9d3df, orange: 0xf59e0b, belt: 0x141a24 };
export const TEXB = 0x3b6e8f;
export const PRODUCT: Record<string, number> = { Water: 0x2563eb, Oil: 0xb45309, Chemical: 0x16a34a, Dye: 0xc026d3, Product: 0x0ea5e9 };
export const SCOL: Record<string, number> = { off: 0x64748b, ok: 0x22c55e, warn: 0xf59e0b, crit: 0xef4444, nolink: 0x64748b };

export const M = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.45, roughness: 0.5, ...o });
export const glass = (c: number, o = 0.25) => M(c, { transparent: true, opacity: o, side: DS, depthWrite: false });
export const lamp = (col: number) => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1 });
export const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 32, open = false) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), m);
export const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
/** Lay a Y-axis cylinder along X. */
export const X = <T extends THREE.Object3D>(mesh: T): T => { mesh.rotation.z = PI / 2; return mesh; };
const UP = new THREE.Vector3(0, 1, 0);

export function pipe(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const mesh = cyl(r, r, len, m, 20); mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize()); return mesh;
}
export function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, mat: THREE.Material) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const m = box(len, h, w, mat); m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize()); return m;
}
export interface Polyline { total: number; at(u: number, out: THREE.Vector3): THREE.Vector3 }
export function polyline(pts: THREE.Vector3[]): Polyline {
  const segs: number[] = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = pts[i].distanceTo(pts[i + 1]); segs.push(l); total += l; }
  return {
    total,
    at(u, out) { let d = u * total; for (let i = 0; i < segs.length; i++) { if (d <= segs[i]) return out.lerpVectors(pts[i], pts[i + 1], segs[i] ? d / segs[i] : 0); d -= segs[i]; } return out.copy(pts[pts.length - 1]); },
  };
}
export function particles(parent: THREE.Object3D, line: Polyline, n: number, color: number, size: number) {
  const geo = new THREE.SphereGeometry(size, 8, 8), mat = new THREE.MeshBasicMaterial({ color });
  const ps: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) { const p = new THREE.Mesh(geo, mat); p.userData.u = i / n; p.userData.fx = true; parent.add(p); ps.push(p); }
  return { update(dt: number, speed: number) { ps.forEach((p) => { p.userData.u = (p.userData.u + dt * speed / Math.max(0.01, line.total)) % 1; line.at(p.userData.u, p.position); p.visible = speed > 0.02; }); } };
}
export function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x1a2230, 0.85));
  const d = new THREE.DirectionalLight(0xffffff, 0.9); d.position.set(5, 9, 6); scene.add(d);
  const d2 = new THREE.DirectionalLight(0x6fa8ff, 0.35); d2.position.set(-6, 4, -5); scene.add(d2);
}

const RAMP = [[0, 0x000000], [0.35, 0x5c0f0f], [0.6, 0xc2410c], [0.85, 0xf59e0b], [1, 0xfef3c7]].map(([u, c]) => [u, new THREE.Color(c)] as const);
const tmpC = new THREE.Color();
export const BROWN = new THREE.Color(0x5b4636);
/** Colour a material's glow by temperature: dark → dull red → orange → yellow-white. */
export function heatTo(mat: any, v: number, lo: number, hi: number, k = 1) {
  if (!mat || !mat.emissive) return;
  const u = clamp((v - lo) / (hi - lo), 0, 1); let i = 0;
  while (i < RAMP.length - 2 && u > RAMP[i + 1][0]) i++;
  const [a, ca] = RAMP[i], [b, cb] = RAMP[i + 1];
  tmpC.copy(ca).lerp(cb, (u - a) / (b - a)); mat.emissive.copy(tmpC).multiplyScalar(k);
}
export const spinVis = (rpm: number) => rpm < 60 ? rpm / 60 * 2 * PI : 6 + (rpm - 60) * 0.003;

/* ---------- readings ---------- */
export interface TagDef {
  /** Key the model's moving parts read. */
  k: string;
  /** Name shown to the user. */
  n: string;
  u: string;
  /** Nominal running value, used for demo values and as the starting point. */
  v: number;
  /** Rest value: machine stopped, or reading not linked. */
  off: number;
  /** Demo noise amplitude. */
  noise: number;
  d: number;
  warn?: number;
  crit?: number;
  /** True when LOW values are the alarm (e.g. pressure, efficiency). */
  low?: boolean;
  /** Value "Simulate fault" drives toward, in demo mode. */
  fault?: number;
}
export const T = (k: string, n: string, u: string, v: number, o: Partial<TagDef> = {}): TagDef => ({ k, n, u, v, off: 0, noise: 0, d: 1, ...o });
export const VIB = () => T("vib", "Vibration", "mm/s", 2.2, { noise: 0.15, fault: 7.8, warn: 4.5, crit: 7.1 });
export function zoneTags(temps: number[], prefix: string, label: string, faultIdx: number) {
  return temps.map((v, i) => T(prefix + (i + 1), label + " " + (i + 1), "°C", Math.round(v), { off: AMB, noise: Math.max(0.3, v * 0.002), d: 0, warn: Math.round(v * 1.06), crit: Math.round(v * 1.1), fault: i === faultIdx ? Math.round(v * 1.13) : undefined }));
}
export function zoneProfile(kind: string, N: number) {
  return Array.from({ length: N }, (_, i) => {
    const u = N > 1 ? i / (N - 1) : 0;
    switch (kind) {
      case "Furnace": return 750 + 450 * Math.sin(Math.min(u * 1.4, 1) * PI / 2);
      case "Reheat furnace": return 950 + 300 * Math.min(1, u * 1.3);
      case "Annealing lehr": { const pk = 0.25; return u <= pk ? 470 + 90 * (u / pk) : 560 - 500 * ((u - pk) / (1 - pk)); }
      case "Oven": return 200 + 10 * Math.sin(u * PI);
      case "Dryer": return 110 + 20 * Math.sin(u * PI);
      default: return 900 - 780 * u; // Cooler
    }
  });
}

/* ---------- moving parts ---------- */
export function fanRotor(n: number, len: number, w: number, col = C.light) {
  const r = new THREE.Group(); r.add(cyl(len * 0.18, len * 0.18, w * 0.8, M(0x9aa6b6), 16));
  for (let i = 0; i < n; i++) { const piv = new THREE.Group(); piv.rotation.y = i / n * 2 * PI; const bl = box(len, 0.03, w, M(col)); bl.position.x = len / 2 + len * 0.1; bl.rotation.x = 0.35; piv.add(bl); r.add(piv); }
  return r;
}
export function holder(axis: "x" | "y" | "z", obj: THREE.Object3D) { const h = new THREE.Group(); if (axis === "x") h.rotation.z = PI / 2; if (axis === "z") h.rotation.x = PI / 2; h.add(obj); return h; }
export function smoke(g: THREE.Object3D, x: number, y: number, z: number, n = 12, col = 0xcbd5e1, size = 0.25) {
  const ps: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false })); m.userData.u = i / n; m.userData.fx = true; m.position.set(x, y, z); g.add(m); ps.push(m); }
  return (dt: number, on: boolean, rate = 1, h = 3) => ps.forEach((m, i) => { m.userData.u = (m.userData.u + dt * 0.15 * rate) % 1; const u = m.userData.u; m.position.set(x + Math.sin(u * 6 + i) * 0.4 * u, y + u * h, z + Math.cos(u * 5 + i) * 0.4 * u); m.scale.setScalar(0.5 + u * 2.2); m.material.opacity = on ? 0.28 * (1 - u) : 0; });
}
export function legs4(g: THREE.Object3D, w: number, d: number, h: number, mat: THREE.Material, r = 0.06) { [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => { const l = cyl(r, r, h, mat, 8); l.position.set(a * w / 2, h / 2, b * d / 2); g.add(l); }); }
export function lathe(pts: number[][], mat: THREE.Material, seg = 40) { return new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat); }
/** A roller with spoke markers so its rotation is visible. Spins on `.rotation.z`. */
export function wheel(r: number, w: number, col: number, spokes = 3, spokeCol = C.orange) {
  const g = new THREE.Group(); const c = cyl(r, r, w, M(col), 24); c.rotation.x = PI / 2; g.add(c);
  for (let i = 0; i < spokes; i++) { const b = box(r * 1.9, Math.max(0.03, r * 0.12), w + 0.02, M(spokeCol)); b.rotation.z = i * PI / spokes; g.add(b); }
  return g;
}
export const setMat = (g: THREE.Object3D, mat: THREE.Material) => { (g.children[0] as THREE.Mesh).material = mat; };
export function canvas2d(w: number, h: number) { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; return { cv, x: cv.getContext("2d")! }; }
export function stripeTex(a: string, b: string, len = 64, bw = 10) { const { cv, x } = canvas2d(len, 8); x.fillStyle = a; x.fillRect(0, 0, len, 8); x.fillStyle = b; x.fillRect(0, 0, bw, 8); const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
export function sparks(g: THREE.Object3D, n: number, col = 0xffb347, size = 0.06) {
  const ps: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 6), new THREE.MeshBasicMaterial({ color: col })); m.userData.fx = true; m.userData.v = new THREE.Vector3(); m.userData.life = Math.random(); m.visible = false; g.add(m); ps.push(m); }
  return (dt: number, on: boolean, origin: THREE.Vector3, spread = 2, up = 3) => ps.forEach((m) => {
    m.userData.life -= dt;
    if (m.userData.life <= 0) { if (!on) { m.visible = false; return; } m.position.copy(origin); m.userData.v.set(rnd(spread), up * (0.5 + Math.random()), rnd(spread)); m.userData.life = 0.6 + Math.random() * 0.6; m.visible = true; }
    m.userData.v.y -= 4.9 * dt; m.position.addScaledVector(m.userData.v, dt);
  });
}
