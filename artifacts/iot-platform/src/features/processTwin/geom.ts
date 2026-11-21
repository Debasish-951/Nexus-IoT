import { symDef, type Port } from "./symbols";
import { isPortEnd, isSym, isTag, type End, type Item, type NoteItem, type PipeItem, type ProcessScene, type SymItem, type TagItem } from "./scene";

/** Geometry of the P&ID: symbol boxes, port positions and orthogonal pipe routes. */
export type Pt = [number, number];
export interface Box { x: number; y: number; w: number; h: number }

export const GRID = 10;
export const snap = (v: number) => Math.round(v / GRID) * GRID;
export const TAG_H = 44;
export const tagW = (t: TagItem) => t.w ?? 120;

/** Box of a symbol after scale and rotation (rotation is about its centre). */
export function symBox(s: SymItem): Box {
  const d = symDef(s.type);
  const w = d.w * s.scale, h = d.h * s.scale;
  const cx = s.x + w / 2, cy = s.y + h / 2;
  const sw = s.rot % 180 === 0 ? w : h, sh = s.rot % 180 === 0 ? h : w;
  return { x: cx - sw / 2, y: cy - sh / 2, w: sw, h: sh };
}
export const tagBox = (t: TagItem): Box => ({ x: t.x, y: t.y, w: tagW(t), h: TAG_H });
export const itemBox = (i: Item): Box => (isSym(i) ? symBox(i) : tagBox(i));

/** Box of an annotation (text size is estimated from its length). */
export function noteBox(n: NoteItem): Box {
  if (n.kind === "zone") return { x: n.x, y: n.y, w: n.w ?? 300, h: n.h ?? 200 };
  if (n.kind === "line") { const x2 = n.x2 ?? n.x + 160, y2 = n.y2 ?? n.y; return { x: Math.min(n.x, x2), y: Math.min(n.y, y2), w: Math.abs(x2 - n.x), h: Math.abs(y2 - n.y) }; }
  const size = n.size ?? 14; const lines = (n.text || " ").split("\n");
  return { x: n.x, y: n.y, w: Math.max(20, Math.max(...lines.map((l) => l.length)) * size * 0.58), h: lines.length * size * 1.3 };
}

function rotate(s: SymItem, lx: number, ly: number): Pt {
  const d = symDef(s.type);
  if (s.flipX) lx = d.w - lx;
  if (s.flipY) ly = d.h - ly;
  const w = d.w * s.scale, h = d.h * s.scale;
  const px = lx * s.scale - w / 2, py = ly * s.scale - h / 2;
  const r = (s.rot * Math.PI) / 180, c = Math.round(Math.cos(r)), n = Math.round(Math.sin(r));
  return [s.x + w / 2 + px * c - py * n, s.y + h / 2 + px * n + py * c];
}
export const portPos = (s: SymItem, p: Port): Pt => rotate(s, p.x, p.y);

/** Outward direction of a port: "h" (leaves sideways) or "v" (leaves up/down). */
export function portDir(s: SymItem, p: Port): "h" | "v" {
  const d = symDef(s.type);
  const dx = (p.x - d.w / 2) / d.w, dy = (p.y - d.h / 2) / d.h;
  const local: "h" | "v" = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
  return s.rot % 180 === 0 ? local : local === "h" ? "v" : "h";
}

export function endPos(scene: ProcessScene, e: End, byId?: Map<string, Item>): { p: Pt; dir: "h" | "v" | null } | null {
  if (!isPortEnd(e)) return { p: [e.x, e.y], dir: null };
  const s = (byId ? byId.get(e.sym) : scene.items.find((i) => i.id === e.sym)) as SymItem | undefined;
  if (!s || !isSym(s)) return null;
  const port = symDef(s.type).ports.find((p) => p.id === e.port);
  if (!port) { const b = symBox(s); return { p: [b.x + b.w / 2, b.y + b.h / 2], dir: null }; }
  return { p: portPos(s, port), dir: portDir(s, port) };
}

/**
 * Orthogonal route through the given corner points. Between two points that do
 * not line up an elbow is added: vertical first when leaving a top/bottom port,
 * and the last run enters the end port along its direction.
 * Returns the polyline and, for each of its segments, the index of the logical
 * segment (between `pts[i]` and `pts[i+1]`) it belongs to.
 */
export function route(pts: Pt[], startDir: "h" | "v" | null, endDir: "h" | "v" | null): { line: Pt[]; seg: number[] } {
  const line: Pt[] = [pts[0]]; const seg: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    if (Math.abs(ax - bx) > 0.5 && Math.abs(ay - by) > 0.5) {
      let vFirst = false;
      if (i === 0 && startDir) vFirst = startDir === "v";
      else if (i === pts.length - 2 && endDir) vFirst = endDir === "h";
      else if (i > 0) { const [px, py] = pts[i - 1]; vFirst = Math.abs(py - ay) < 0.5 && Math.abs(px - ax) > 0.5; }
      line.push(vFirst ? [ax, by] : [bx, ay]); seg.push(i);
    }
    line.push([bx, by]); seg.push(i);
  }
  return { line, seg };
}

export interface RoutedPipe { line: Pt[]; seg: number[]; pts: Pt[]; ok: boolean }
export function routePipe(scene: ProcessScene, p: PipeItem, byId?: Map<string, Item>): RoutedPipe {
  const a = endPos(scene, p.a, byId), b = endPos(scene, p.b, byId);
  if (!a || !b) return { line: [], seg: [], pts: [], ok: false };
  const pts: Pt[] = [a.p, ...p.mid, b.p];
  return { ...route(pts, a.dir, b.dir), pts, ok: true };
}

export const pathD = (line: Pt[]) => line.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

/** Midpoint of the longest run, for labels and leader lines. */
export function pipeMid(line: Pt[]): Pt {
  let best = 0, at: Pt = line[0] ?? [0, 0];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1]; const l = Math.abs(bx - ax) + Math.abs(by - ay);
    if (l > best) { best = l; at = [(ax + bx) / 2, (ay + by) / 2]; }
  }
  return at;
}

export function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export const intersects = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function sceneBounds(scene: ProcessScene): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (b: Box) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); };
  scene.items.forEach((i) => add(itemBox(i)));
  (scene.notes ?? []).forEach((n) => add(noteBox(n)));
  const byId = new Map(scene.items.map((i) => [i.id, i]));
  scene.pipes.forEach((p) => routePipe(scene, p, byId).line.forEach(([x, y]) => add({ x, y, w: 0, h: 0 })));
  if (!Number.isFinite(x0)) return null;
  // Room for labels under the symbols.
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 + 24 };
}

export const isTagItem = isTag;
