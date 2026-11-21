import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type Ref } from "react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Maximize, Minus, Plus } from "lucide-react";
import { symDef, SymbolDefs, PX_CSS } from "./symbols";
import { isPortEnd, isSym, isTag, mediumColour, NOTE_COLOUR, type End, type Item, type NoteItem, type PipeItem, type ProcessScene, type SymItem, type TagItem } from "./scene";
import { distToSeg, endPos, GRID, intersects, itemBox, noteBox, pathD, pipeMid, portDir, portPos, route, routePipe, sceneBounds, snap, symBox, TAG_H, tagW, type Box, type Pt, type RoutedPipe } from "./geom";
import { fmtVal, tagKind, type Runtime } from "./live";

/**
 * The P&ID canvas: draws the scene with its live state and, in edit mode, lets
 * the user select, move, connect and reshape. All changes go through
 * `onChange(fn, live)`; a live change (during a drag) is folded into one undo
 * step by the `onCommit()` that follows it.
 */
export const DRAG_SYMBOL = "application/x-process-symbol";
export interface CanvasApi { fit: () => void; zoom: (f: number) => void; center: () => Pt; getView: () => { x: number; y: number; k: number } }
export type KeyAction = "delete" | "rotate" | "undo" | "redo" | "copy" | "paste" | "duplicate" | "selectAll" | "escape";

type Drag =
  | { mode: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean; clear: boolean }
  | { mode: "move"; start: Pt; ids: Set<string>; pipes: Set<string>; base: ProcessScene; moved: boolean }
  | { mode: "marquee"; start: Pt; cur: Pt; add: boolean; base: Set<string> }
  | { mode: "bend"; pipe: string; idx: number; moved: boolean }
  | { mode: "end"; pipe: string; which: "a" | "b"; moved: boolean }
  | { mode: "resize"; id: string; base: ProcessScene; moved: boolean }
  | { mode: "nend"; id: string; which: 0 | 1; moved: boolean };

interface Props {
  scene: ProcessScene;
  edit: boolean;
  rt: Runtime;
  sel: Set<string>;
  setSel: (s: Set<string>) => void;
  flash?: Set<string>;
  onChange?: (fn: (s: ProcessScene) => ProcessScene, live?: boolean) => void;
  onCommit?: () => void;
  onDropSymbol?: (type: string, at: Pt) => void;
  onKeyAction?: (a: KeyAction) => void;
  apiRef?: MutableRefObject<CanvasApi | null>;
  svgRef?: Ref<SVGSVGElement>;
  compact?: boolean;
}

const moveEnd = (e: End, dx: number, dy: number): End => (isPortEnd(e) ? e : { x: e.x + dx, y: e.y + dy });

export function ProcessCanvas({ scene, edit, rt, sel, setSel, flash, onChange, onCommit, onDropSymbol, onKeyAction, apiRef, svgRef, compact }: Props) {
  const t = useT();
  const inst = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState(scene.view ?? { x: 40, y: 40, k: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const fitted = useRef(!!scene.view);
  const drag = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [wire, setWire] = useState<{ a: End; mid: Pt[]; cur: Pt } | null>(null);
  const space = useRef(false);
  const sceneRef = useRef(scene); sceneRef.current = scene;

  const setSvg = useCallback((el: SVGSVGElement | null) => {
    svg.current = el;
    if (typeof svgRef === "function") svgRef(el); else if (svgRef) (svgRef as MutableRefObject<SVGSVGElement | null>).current = el;
  }, [svgRef]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 500 }));
    ro.observe(el); setSize({ w: el.clientWidth || 800, h: el.clientHeight || 500 });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const b = sceneBounds(sceneRef.current);
    const W = wrap.current?.clientWidth || size.w, H = wrap.current?.clientHeight || size.h;
    if (!b) { setView({ x: 40, y: 40, k: 1 }); return; }
    const pad = compact ? 12 : 40;
    const k = Math.max(0.15, Math.min((W - pad * 2) / Math.max(b.w, 1), (H - pad * 2) / Math.max(b.h, 1), 2));
    setView({ k, x: W / 2 - (b.x + b.w / 2) * k, y: H / 2 - (b.y + b.h / 2) * k });
  }, [size.w, size.h, compact]);
  // Fit once the size is known, and again in a compact (embedded) view when it resizes.
  useEffect(() => { if (!fitted.current || compact) { fitted.current = true; fit(); } }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const itemsKey = scene.items.length;
  useEffect(() => { if (compact) fit(); }, [itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = useCallback((f: number, sx?: number, sy?: number) => {
    setView((v) => {
      const k = Math.max(0.15, Math.min(4, v.k * f));
      const cx = sx ?? (wrap.current?.clientWidth ?? 800) / 2, cy = sy ?? (wrap.current?.clientHeight ?? 500) / 2;
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  }, []);
  const toWorld = useCallback((cx: number, cy: number): Pt => {
    const r = svg.current!.getBoundingClientRect(); const v = viewRef.current;
    return [(cx - r.left - v.x) / v.k, (cy - r.top - v.y) / v.k];
  }, []);
  useImperativeHandle(apiRef, () => ({
    fit, zoom: (f) => zoomAt(f),
    center: () => { const v = viewRef.current; return [((wrap.current?.clientWidth ?? 800) / 2 - v.x) / v.k, ((wrap.current?.clientHeight ?? 500) / 2 - v.y) / v.k]; },
    getView: () => viewRef.current,
  }), [fit, zoomAt]);

  useEffect(() => {
    const el = svg.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const byId = useMemo(() => new Map<string, Item>(scene.items.map((i) => [i.id, i])), [scene.items]);
  const noteById = useMemo(() => new Map<string, NoteItem>((scene.notes ?? []).map((n) => [n.id, n])), [scene.notes]);
  const movable = (id: string) => { const it = byId.get(id) ?? noteById.get(id); return !!it && !it.locked; };
  const routes = useMemo(() => new Map<string, RoutedPipe>(scene.pipes.map((p) => [p.id, routePipe(scene, p, byId)])), [scene, byId]);

  // ── pointer handling ──────────────────────────────────────────────────────
  const hitOf = (e: React.PointerEvent | React.MouseEvent) => {
    const el = (e.target as Element).closest?.("[data-hit]") as SVGElement | null;
    return el ? { kind: el.dataset.hit!, id: el.dataset.id ?? "", port: el.dataset.port, idx: Number(el.dataset.idx ?? -1) } : null;
  };

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    wrap.current?.focus({ preventScroll: true });
    const p = toWorld(e.clientX, e.clientY);
    const hit = hitOf(e);
    const startPan = (clear: boolean) => { drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y, moved: false, clear }; (e.target as Element).setPointerCapture?.(e.pointerId); };
    if (e.button === 1 || e.button === 2 || space.current) { e.preventDefault(); startPan(false); return; }
    if (e.button !== 0) return;
    if (wire) {
      if (hit?.kind === "port" && !(isPortEnd(wire.a) && wire.a.sym === hit.id && wire.a.port === hit.port)) finishWire({ sym: hit.id, port: hit.port! });
      else setWire({ ...wire, mid: [...wire.mid, [snap(p[0]), snap(p[1])]] });
      return;
    }
    if (!edit) {
      if (hit && (hit.kind === "sym" || hit.kind === "tag" || hit.kind === "pipe")) { setSel(new Set([hit.id])); return; }
      startPan(true); return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (hit?.kind === "port") { setWire({ a: { sym: hit.id, port: hit.port! }, mid: [], cur: p }); return; }
    if (hit?.kind === "bend") { drag.current = { mode: "bend", pipe: hit.id, idx: hit.idx, moved: false }; return; }
    if (hit?.kind === "end") { drag.current = { mode: "end", pipe: hit.id, which: hit.idx === 0 ? "a" : "b", moved: false }; return; }
    if (hit?.kind === "resize") { drag.current = { mode: "resize", id: hit.id, base: scene, moved: false }; return; }
    if (hit?.kind === "nend") { drag.current = { mode: "nend", id: hit.id, which: hit.idx === 1 ? 1 : 0, moved: false }; return; }
    if (hit?.kind === "sym" || hit?.kind === "tag" || hit?.kind === "note") {
      let next = sel;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { next = new Set(sel); if (next.has(hit.id)) next.delete(hit.id); else next.add(hit.id); setSel(next); }
      else if (!sel.has(hit.id)) { next = new Set([hit.id]); setSel(next); }
      // Locked items stay where they are.
      const ids = new Set([...next].filter((id) => movable(id)));
      // Tag bubbles follow the symbol they belong to.
      for (const it of scene.items) if (isTag(it) && it.attach && ids.has(it.attach) && !it.locked) ids.add(it.id);
      const pipes = new Set(scene.pipes.filter((pp) => next.has(pp.id) || ((!isPortEnd(pp.a) || ids.has(pp.a.sym)) && (!isPortEnd(pp.b) || ids.has(pp.b.sym)) && (isPortEnd(pp.a) || isPortEnd(pp.b)))).map((pp) => pp.id));
      if (!ids.size && !pipes.size) return; // only locked items under the pointer
      drag.current = { mode: "move", start: p, ids, pipes, base: scene, moved: false };
      return;
    }
    if (hit?.kind === "pipe") {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { const n = new Set(sel); if (n.has(hit.id)) n.delete(hit.id); else n.add(hit.id); setSel(n); }
      else setSel(new Set([hit.id]));
      return;
    }
    drag.current = { mode: "marquee", start: p, cur: p, add: e.shiftKey, base: e.shiftKey ? new Set(sel) : new Set() };
    if (!e.shiftKey) setSel(new Set());
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = toWorld(e.clientX, e.clientY);
    if (wire) { setWire({ ...wire, cur: [snap(p[0]), snap(p[1])] }); return; }
    const d = drag.current; if (!d) return;
    if (d.mode === "pan") {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    } else if (d.mode === "marquee") {
      d.cur = p;
      setMarquee({ x: Math.min(d.start[0], p[0]), y: Math.min(d.start[1], p[1]), w: Math.abs(p[0] - d.start[0]), h: Math.abs(p[1] - d.start[1]) });
    } else if (d.mode === "move") {
      const dx = snap(p[0] - d.start[0]), dy = snap(p[1] - d.start[1]);
      if (!dx && !dy && !d.moved) return;
      d.moved = true;
      const base = d.base;
      onChange?.(() => ({
        ...base,
        items: base.items.map((it) => (d.ids.has(it.id) ? { ...it, x: it.x + dx, y: it.y + dy } : it)),
        pipes: base.pipes.map((pp) => (d.pipes.has(pp.id) ? { ...pp, a: moveEnd(pp.a, dx, dy), b: moveEnd(pp.b, dx, dy), mid: pp.mid.map(([x, y]) => [x + dx, y + dy] as Pt) } : pp)),
        notes: base.notes?.map((n) => (d.ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy, ...(n.x2 != null ? { x2: n.x2 + dx } : {}), ...(n.y2 != null ? { y2: n.y2 + dy } : {}) } : n)),
      }), true);
    } else if (d.mode === "resize") {
      d.moved = true;
      const it = d.base.items.find((i) => i.id === d.id); const nt = d.base.notes?.find((x) => x.id === d.id);
      if (it && isSym(it)) {
        const b = symBox(it);
        const f = Math.max((p[0] - b.x) / Math.max(1, b.w), (p[1] - b.y) / Math.max(1, b.h));
        const scale = Math.round(Math.min(4, Math.max(0.3, it.scale * f)) * 20) / 20;
        onChange?.((s) => ({ ...s, items: s.items.map((i) => (i.id === d.id ? { ...i, scale } : i)) }), true);
      } else if (nt) {
        const w = Math.max(60, snap(p[0] - nt.x)), h = Math.max(40, snap(p[1] - nt.y));
        onChange?.((s) => ({ ...s, notes: s.notes?.map((x) => (x.id === d.id ? { ...x, w, h } : x)) }), true);
      }
    } else if (d.mode === "nend") {
      d.moved = true;
      const q: Pt = [snap(p[0]), snap(p[1])];
      onChange?.((s) => ({ ...s, notes: s.notes?.map((x) => (x.id === d.id ? (d.which === 0 ? { ...x, x: q[0], y: q[1] } : { ...x, x2: q[0], y2: q[1] }) : x)) }), true);
    } else if (d.mode === "bend") {
      d.moved = true;
      const q: Pt = [snap(p[0]), snap(p[1])];
      onChange?.((s) => ({ ...s, pipes: s.pipes.map((pp) => (pp.id === d.pipe ? { ...pp, mid: pp.mid.map((m, i) => (i === d.idx ? q : m)) } : pp)) }), true);
    } else if (d.mode === "end") {
      d.moved = true;
      const q = { x: snap(p[0]), y: snap(p[1]) };
      onChange?.((s) => ({ ...s, pipes: s.pipes.map((pp) => (pp.id === d.pipe ? { ...pp, [d.which]: q } : pp)) }), true);
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (wire) {
      // Drawing by dragging: releasing over another port connects there.
      const el = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest?.("[data-hit=port]") as SVGElement | null;
      const id = el?.dataset.id, port = el?.dataset.port;
      if (id && port && !(isPortEnd(wire.a) && wire.a.sym === id && wire.a.port === port)) finishWire({ sym: id, port });
      return;
    }
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.mode === "pan" && !d.moved && d.clear) setSel(new Set());
    if (d.mode === "marquee") {
      setMarquee(null);
      const box = { x: Math.min(d.start[0], d.cur[0]), y: Math.min(d.start[1], d.cur[1]), w: Math.abs(d.cur[0] - d.start[0]), h: Math.abs(d.cur[1] - d.start[1]) };
      if (box.w > 3 || box.h > 3) {
        const n = new Set(d.base);
        for (const it of scene.items) if (intersects(box, itemBox(it))) n.add(it.id);
        for (const pp of scene.pipes) if ((routes.get(pp.id)?.line ?? []).some(([x, y]) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h)) n.add(pp.id);
        // A zone is picked only when the box holds all of it, so a box drawn inside a zone selects what is in it.
        for (const nt of scene.notes ?? []) {
          const b = noteBox(nt);
          if (nt.kind === "zone" ? b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h : intersects(box, b)) n.add(nt.id);
        }
        setSel(n);
      }
    }
    if ((d.mode === "move" || d.mode === "bend" || d.mode === "end" || d.mode === "resize" || d.mode === "nend") && d.moved) onCommit?.();
    void e;
  }

  function finishWire(b: End) {
    if (!wire) return;
    const pipe: PipeItem = { id: `pipe-${Math.random().toString(36).slice(2, 9)}`, a: wire.a, b, mid: wire.mid, line: "process", medium: "product", arrows: true };
    onChange?.((s) => ({ ...s, pipes: [...s.pipes, pipe] }));
    setWire(null);
    setSel(new Set([pipe.id]));
  }

  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!edit) return;
    const p = toWorld(e.clientX, e.clientY);
    if (wire) {
      // The click before the double click already added this point as a bend.
      const free = { x: snap(p[0]), y: snap(p[1]) };
      const mid = wire.mid.filter((m, i) => !(i >= wire.mid.length - 2 && m[0] === free.x && m[1] === free.y));
      const w = { ...wire, mid };
      setWire(w);
      const pipe: PipeItem = { id: `pipe-${Math.random().toString(36).slice(2, 9)}`, a: w.a, b: free, mid: w.mid, line: "process", medium: "product", arrows: true };
      onChange?.((s) => ({ ...s, pipes: [...s.pipes, pipe] }));
      setWire(null); setSel(new Set([pipe.id]));
      return;
    }
    const hit = hitOf(e);
    if (hit?.kind === "bend") {
      onChange?.((s) => ({ ...s, pipes: s.pipes.map((pp) => (pp.id === hit.id ? { ...pp, mid: pp.mid.filter((_, i) => i !== hit.idx) } : pp)) }));
      return;
    }
    if (hit?.kind === "pipe") {
      const r = routes.get(hit.id); if (!r?.ok) return;
      let best = Infinity, logical = 0;
      for (let i = 0; i < r.line.length - 1; i++) { const dd = distToSeg(p, r.line[i], r.line[i + 1]); if (dd < best) { best = dd; logical = r.seg[i]; } }
      const q: Pt = [snap(p[0]), snap(p[1])];
      onChange?.((s) => ({ ...s, pipes: s.pipes.map((pp) => (pp.id === hit.id ? { ...pp, mid: [...pp.mid.slice(0, logical), q, ...pp.mid.slice(logical)] } : pp)) }));
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const tg = e.target as HTMLElement;
    if (tg.closest("input, textarea, select, [contenteditable=true], [role=combobox], [role=listbox]")) return;
    if (e.key === " ") { space.current = true; e.preventDefault(); return; }
    if (e.key === "Escape") { if (wire) setWire(null); else onKeyAction?.("escape"); return; }
    if (!edit) return;
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    const act: KeyAction | null = (e.key === "Delete" || e.key === "Backspace") ? "delete"
      : mod && k === "z" && e.shiftKey ? "redo" : mod && k === "z" ? "undo" : mod && k === "y" ? "redo"
      : mod && k === "c" ? "copy" : mod && k === "v" ? "paste" : mod && k === "d" ? "duplicate" : mod && k === "a" ? "selectAll"
      : !mod && k === "r" ? "rotate" : null;
    if (act) { e.preventDefault(); onKeyAction?.(act); }
  }

  // ── drawing ───────────────────────────────────────────────────────────────
  const v = view;
  const vis = { x: -v.x / v.k, y: -v.y / v.k, w: size.w / v.k, h: size.h / v.k };
  const centre = (id: string): Pt | null => {
    const it = byId.get(id);
    if (it) { const b = itemBox(it); return [b.x + b.w / 2, b.y + b.h / 2]; }
    const r = routes.get(id); return r?.ok ? pipeMid(r.line) : null;
  };

  const pipeEls = scene.pipes.map((p) => {
    const r = routes.get(p.id); if (!r?.ok || r.line.length < 2) return null;
    const st = rt.pipe(p); const d = pathD(r.line);
    const col = st.status === "crit" ? "#ef4444" : st.status === "warn" ? "#f59e0b" : p.color ?? mediumColour(p.medium);
    const selected = sel.has(p.id);
    const arrows = p.arrows ? r.line.slice(0, -1).map((a, i) => {
      const b = r.line[i + 1]; const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]); if (len < 60) return null;
      const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      return <path key={i} d="M-6 -5 L6 0 L-6 5 Z" transform={`translate(${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}) rotate(${ang})`} fill={p.line === "signal" ? "#94a3b8" : p.line === "electrical" ? "#facc15" : col} opacity=".9" />;
    }) : null;
    const mid = pipeMid(r.line);
    return (
      <g key={p.id} className={cn(flash?.has(p.id) && "px-sym flash")}>
        {p.line === "signal" ? <path d={d} fill="none" stroke="#94a3b8" strokeWidth="1.6" strokeDasharray="6 4" />
          : p.line === "electrical" ? <path d={d} fill="none" stroke="#facc15" strokeWidth="1.6" strokeDasharray="10 3 2 3" />
          : (<>
            <path d={d} fill="none" stroke="#3a4658" strokeWidth={p.line === "utility" ? 6 : 10} strokeLinejoin="round" strokeLinecap="round" />
            <path d={d} fill="none" stroke={col} strokeWidth={p.line === "utility" ? 2.5 : 3.5} strokeDasharray={p.line === "utility" ? "6 10" : "9 13"} strokeDashoffset={st.offset} strokeLinejoin="round" strokeLinecap="round" opacity={st.moving ? 1 : 0.28} />
          </>)}
        {arrows}
        {p.label && p.labelPos !== "hidden" && <text className="px-plbl" x={mid[0]} y={p.labelPos === "below" ? mid[1] + 20 : mid[1] - 10} textAnchor="middle">{p.label}</text>}
        {selected && <path d={d} fill="none" stroke="#f97316" strokeWidth="2" strokeDasharray="5 4" />}
        <path d={d} fill="none" stroke="transparent" strokeWidth="14" data-hit="pipe" data-id={p.id} style={{ cursor: edit ? "pointer" : "default" }} />
      </g>
    );
  });

  const leaders = scene.items.filter(isTag).map((tg) => {
    if (!tg.attach) return null;
    const c = centre(tg.attach); if (!c) return null;
    const w = tagW(tg); const bx = Math.max(tg.x, Math.min(c[0], tg.x + w)), by = Math.max(tg.y, Math.min(c[1], tg.y + TAG_H));
    return <line key={`l-${tg.id}`} x1={bx} y1={by} x2={c[0]} y2={c[1]} stroke="#334155" strokeWidth="1.2" strokeDasharray="3 3" />;
  });

  const symEls = scene.items.filter(isSym).map((s) => {
    const def = symDef(s.type); const w = def.w * s.scale, h = def.h * s.scale; const b = symBox(s);
    const d = { ...rt.draw(s), uid: `${inst}${s.id.replace(/[^a-zA-Z0-9]/g, "")}` };
    if (!(s.drives?.temperature || def.roles[0] === "temperature")) d.heat = null;
    const st = s.style ?? {};
    const pos = st.labelPos ?? (def.group === "custom" ? "hidden" : "below");
    const lbl = def.group === "inst" ? s.label : [st.hideTag ? "" : s.tag, s.label].filter(Boolean).join(" ");
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const lp = pos === "above" ? { x: cx, y: b.y - 8, a: "middle" as const } : pos === "left" ? { x: b.x - 8, y: cy + 4, a: "end" as const } : pos === "right" ? { x: b.x + b.w + 8, y: cy + 4, a: "start" as const }
      : { x: cx, y: b.y + b.h + (d.text && def.roles.includes("value") && def.group !== "custom" ? 30 : 17), a: "middle" as const };
    const vars = { ...(st.fill ? { "--px-fill": st.fill } : {}), ...(st.stroke ? { "--px-stroke": st.stroke } : {}) } as CSSProperties;
    const flip = s.flipX || s.flipY ? `translate(${s.flipX ? def.w : 0} ${s.flipY ? def.h : 0}) scale(${s.flipX ? -1 : 1} ${s.flipY ? -1 : 1})` : undefined;
    return (
      <g key={s.id}>
        <g data-hit="sym" data-id={s.id} className={cn("px-sym", d.status === "warn" && "warn", d.status === "crit" && "crit", flash?.has(s.id) && "flash")}
          transform={`translate(${s.x} ${s.y}) rotate(${s.rot} ${w / 2} ${h / 2}) scale(${s.scale})`}
          style={{ cursor: edit ? (s.locked ? "default" : "move") : "pointer", filter: d.heat ? `drop-shadow(0 0 7px ${d.heat})` : undefined, ...vars }}>
          <rect width={def.w} height={def.h} fill="transparent" />
          {flip ? <g transform={flip}>{def.render(d)}</g> : def.render(d)}
        </g>
        {lbl && pos !== "hidden" && <text className="px-lbl" x={lp.x} y={lp.y} textAnchor={lp.a}>{lbl}</text>}
        {edit && s.locked && <text x={b.x + b.w + 2} y={b.y + 2} fontSize="11" pointerEvents="none">🔒</text>}
      </g>
    );
  });

  const tagEls = scene.items.filter(isTag).map((tg: TagItem) => {
    const r = rt.tagReading(tg); const w = tagW(tg);
    return (
      <g key={tg.id} data-hit="tag" data-id={tg.id} transform={`translate(${tg.x} ${tg.y})`} style={{ cursor: edit ? "move" : "pointer" }}
        className={cn("px-bub", (r.status === "warn" || r.status === "crit") && r.status, r.src === "none" && "nolink", flash?.has(tg.id) && "px-sym flash")}>
        <rect className="bg" width={w} height={TAG_H} rx="6" />
        <text className="bt" x="9" y="16">{[tg.tag, tg.label].filter(Boolean).join(" ")}</text>
        <text className="bv" x="9" y="35">{r.src === "none" ? t("not linked") : fmtVal(r.v, tg.unit || undefined, tg.decimals, tagKind(tg))}</text>
        {(r.src === "demo" || r.src === "history") && <text className="bd" x={w - 7} y="14" textAnchor="end">{r.src === "demo" ? t("demo") : t("history")}</text>}
      </g>
    );
  });

  const selEls = edit ? scene.items.filter((i) => sel.has(i.id)).map((i) => { const b = itemBox(i); return <rect key={`s-${i.id}`} x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10} fill="none" stroke="#f97316" strokeWidth={1.5 / v.k} strokeDasharray="5 4" rx="4" pointerEvents="none" />; }) : null;

  const ports = edit ? scene.items.filter(isSym).flatMap((s) => symDef(s.type).ports.map((pt) => {
    const [x, y] = portPos(s, pt);
    return <circle key={`p-${s.id}-${pt.id}`} className="px-port" cx={x} cy={y} r={Math.max(4, 5 / v.k)} data-hit="port" data-id={s.id} data-port={pt.id} opacity={wire || sel.has(s.id) ? 1 : 0.45} />;
  })) : null;

  const handles = edit ? scene.pipes.filter((p) => sel.has(p.id)).flatMap((p) => [
    ...p.mid.map(([x, y], i) => <circle key={`b-${p.id}-${i}`} className="px-handle" cx={x} cy={y} r={Math.max(4, 5 / v.k)} data-hit="bend" data-id={p.id} data-idx={i} />),
    ...(["a", "b"] as const).filter((w) => !isPortEnd(p[w])).map((w) => { const e = p[w] as { x: number; y: number }; const s = Math.max(8, 10 / v.k); return <rect key={`e-${p.id}-${w}`} className="px-handle" x={e.x - s / 2} y={e.y - s / 2} width={s} height={s} data-hit="end" data-id={p.id} data-idx={w === "a" ? 0 : 1} />; }),
  ]) : null;

  // ── annotations ───────────────────────────────────────────────────────────
  const noteEl = (n: NoteItem) => {
    const c = n.color ?? NOTE_COLOUR[n.kind];
    const hp = { "data-hit": "note", "data-id": n.id, style: { cursor: edit ? (n.locked ? "default" : "move") : "default" } };
    const nb = noteBox(n);
    const lock = edit && n.locked ? <text x={nb.x + nb.w + 2} y={nb.y + 2} fontSize="11" pointerEvents="none">🔒</text> : null;
    if (n.kind === "zone") {
      const w = n.w ?? 300, h = n.h ?? 200;
      return (
        <g key={n.id} className={cn(flash?.has(n.id) && "px-sym flash")}>
          <rect x={n.x} y={n.y} width={w} height={h} rx="8" fill={c} fillOpacity=".05" stroke={c} strokeOpacity=".75" strokeWidth="1.5" strokeDasharray="8 5" pointerEvents="none" />
          {n.text && <text x={n.x + 10} y={n.y + 20} fill={c} style={{ font: "600 13px system-ui, sans-serif", letterSpacing: ".04em" }} pointerEvents="none">{n.text}</text>}
          {edit && <><rect x={n.x} y={n.y} width={w} height={h} rx="8" fill="none" stroke="transparent" strokeWidth="12" {...hp} /><rect x={n.x} y={n.y} width={Math.min(w, Math.max(80, (n.text?.length ?? 0) * 8 + 20))} height="28" fill="transparent" {...hp} /></>}
          {lock}
        </g>
      );
    }
    if (n.kind === "line") {
      const x2 = n.x2 ?? n.x + 160, y2 = n.y2 ?? n.y; const ang = (Math.atan2(y2 - n.y, x2 - n.x) * 180) / Math.PI;
      return (
        <g key={n.id}>
          <line x1={n.x} y1={n.y} x2={x2} y2={y2} stroke={c} strokeWidth="2" strokeDasharray={n.dashed ? "6 4" : undefined} pointerEvents="none" />
          {n.arrow && <path d="M-11 -6 L1 0 L-11 6 Z" fill={c} transform={`translate(${x2} ${y2}) rotate(${ang})`} pointerEvents="none" />}
          {edit && <line x1={n.x} y1={n.y} x2={x2} y2={y2} stroke="transparent" strokeWidth="12" {...hp} />}
          {lock}
        </g>
      );
    }
    const size = n.size ?? 14; const lines = (n.text || t("Text")).split("\n");
    return (
      <g key={n.id}>
        {edit && <rect x={nb.x} y={nb.y} width={nb.w} height={nb.h} fill="transparent" {...hp} />}
        <text x={n.x} y={n.y + size} fill={c} style={{ font: `500 ${size}px system-ui, sans-serif` }} pointerEvents="none">{lines.map((l, i) => <tspan key={i} x={n.x} dy={i ? size * 1.3 : 0}>{l}</tspan>)}</text>
        {lock}
      </g>
    );
  };
  const zoneEls = (scene.notes ?? []).filter((n) => n.kind === "zone").map(noteEl);
  const noteEls = (scene.notes ?? []).filter((n) => n.kind !== "zone").map(noteEl);
  const noteSel = edit ? (scene.notes ?? []).filter((n) => sel.has(n.id) && n.kind !== "line").map((n) => { const b = noteBox(n); return <rect key={`s-${n.id}`} x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10} fill="none" stroke="#f97316" strokeWidth={1.5 / v.k} strokeDasharray="5 4" rx="4" pointerEvents="none" />; }) : null;
  const one = sel.size === 1 ? [...sel][0] : null;
  let resizeEl: React.ReactNode = null;
  if (edit && one) {
    const it = byId.get(one); const nt = noteById.get(one);
    const b = it && isSym(it) && !it.locked ? symBox(it) : nt && nt.kind === "zone" && !nt.locked ? noteBox(nt) : null;
    if (b) { const sz = Math.max(8, 10 / v.k); resizeEl = <rect className="px-handle" x={b.x + b.w + 5 - sz / 2} y={b.y + b.h + 5 - sz / 2} width={sz} height={sz} data-hit="resize" data-id={one} style={{ cursor: "nwse-resize" }} />; }
  }
  const lineEnds = edit ? (scene.notes ?? []).filter((n) => n.kind === "line" && sel.has(n.id) && !n.locked).flatMap((n) => ([[n.x, n.y], [n.x2 ?? n.x + 160, n.y2 ?? n.y]] as Pt[]).map(([x, y], i) => (
    <circle key={`ne-${n.id}-${i}`} className="px-handle" cx={x} cy={y} r={Math.max(4, 5 / v.k)} data-hit="nend" data-id={n.id} data-idx={i} />
  ))) : null;

  let wireEl: React.ReactNode = null;
  if (wire) {
    const a = endPos(scene, wire.a, byId);
    if (a) { const r = route([a.p, ...wire.mid, wire.cur], a.dir, null); wireEl = <path d={pathD(r.line)} fill="none" stroke="#f97316" strokeWidth={2 / v.k} strokeDasharray="6 4" pointerEvents="none" />; }
  }

  return (
    <div ref={wrap} tabIndex={0} onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === " ") space.current = false; }}
      className={cn("relative w-full h-full overflow-hidden outline-none select-none", compact ? "rounded" : "rounded-md")} style={{ background: "#0b1220" }}
      onDragOver={(e) => { if (onDropSymbol && e.dataTransfer.types.includes(DRAG_SYMBOL)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(e) => { const type = e.dataTransfer.getData(DRAG_SYMBOL); if (type && onDropSymbol) { e.preventDefault(); onDropSymbol(type, toWorld(e.clientX, e.clientY)); } }}>
      <svg ref={setSvg} width="100%" height="100%" className="block" role="img" aria-label={t("Process diagram")}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: wire ? "crosshair" : drag.current?.mode === "pan" ? "grabbing" : undefined, touchAction: "none" }}>
        <style>{PX_CSS}</style>
        <defs>
          <SymbolDefs />
          <pattern id={`${inst}grid`} width={GRID * 2} height={GRID * 2} patternUnits="userSpaceOnUse">
            <path d={`M ${GRID * 2} 0 L 0 0 0 ${GRID * 2}`} fill="none" stroke="#152031" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="#0b1220" />
        <g transform={`translate(${v.x} ${v.y}) scale(${v.k})`}>
          {edit && <rect x={vis.x} y={vis.y} width={vis.w} height={vis.h} fill={`url(#${inst}grid)`} pointerEvents="none" />}
          {zoneEls}
          {pipeEls}
          {leaders}
          {symEls}
          {noteEls}
          {tagEls}
          {selEls}
          {noteSel}
          {handles}
          {lineEnds}
          {resizeEl}
          {ports}
          {wireEl}
          {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="#f9731615" stroke="#f97316" strokeWidth={1 / v.k} strokeDasharray="4 3" pointerEvents="none" />}
        </g>
      </svg>
      {!compact && (
        <div className="absolute right-2 bottom-2 flex flex-col gap-1">
          <button className="w-7 h-7 rounded border border-slate-600 bg-slate-900/80 text-slate-100 hover:bg-slate-800 flex items-center justify-center" onClick={() => zoomAt(1.2)} aria-label={t("Zoom in")}><Plus className="w-3.5 h-3.5" /></button>
          <button className="w-7 h-7 rounded border border-slate-600 bg-slate-900/80 text-slate-100 hover:bg-slate-800 flex items-center justify-center" onClick={() => zoomAt(1 / 1.2)} aria-label={t("Zoom out")}><Minus className="w-3.5 h-3.5" /></button>
          <button className="w-7 h-7 rounded border border-slate-600 bg-slate-900/80 text-slate-100 hover:bg-slate-800 flex items-center justify-center" onClick={fit} aria-label={t("Fit to view")} title={t("Fit to view")}><Maximize className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {!compact && (
        <div className="absolute left-2 bottom-2 font-mono text-[11px] text-slate-400 pointer-events-none">
          {wire ? t("Click to add a bend · click a port to connect · double-click to end the pipe here · Esc to cancel")
            : edit ? t("Drag symbols from the palette · click or drag from a port to draw a pipe · double-click a pipe to add a bend · scroll to zoom · Space+drag to pan")
            : t("Drag to pan · scroll to zoom · click an element to see its readings")}
        </div>
      )}
    </div>
  );
}

/** Ports of a symbol in world coordinates, with their direction. */
export function symPorts(s: SymItem) { return symDef(s.type).ports.map((p) => ({ id: p.id, pos: portPos(s, p), dir: portDir(s, p) })); }
