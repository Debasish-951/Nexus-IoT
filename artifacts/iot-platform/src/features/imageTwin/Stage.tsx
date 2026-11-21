import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { sanitizeSvgDocument, type Part } from "./sanitize";
import { STATUS_COLOR, type ItemView } from "./evaluate";
import { unchunk, type ImageScene, type TwinItem } from "./types";

/**
 * Renders a 2D twin: background (sanitised SVG drawing, raster image or URL),
 * the mapped items on top, and their live state. One <svg> holds everything so
 * a PNG snapshot captures what is on screen.
 *
 * SVG parts are styled in place (colour, show/hide, blink, rotate, fill level).
 * Regions and pins are drawn in an overlay in the same coordinate space.
 * Wheel zooms around the cursor, dragging the background pans, Fit resets.
 */
export type Tool = "select" | "rect" | "ellipse" | "polygon" | "point";
export interface Box { x: number; y: number; w: number; h: number }

export interface StageHandle { fit: () => void; svg: () => SVGSVGElement | null }

/**
 * A copy of the stage's <svg> without the on-screen zoom and pan, sized to at
 * most `long` px on its long side and placed off screen, for a PNG snapshot.
 * Call the returned cleanup when done.
 */
export function snapshotCopy(svg: SVGSVGElement, W: number, H: number, long = 2000): { el: SVGSVGElement; done: () => void } {
  const s = long / Math.max(W, H);
  const el = svg.cloneNode(true) as SVGSVGElement;
  el.removeAttribute("style");
  el.setAttribute("width", String(Math.round(W * s))); el.setAttribute("height", String(Math.round(H * s)));
  el.style.position = "fixed"; el.style.left = "-100000px"; el.style.top = "0";
  document.body.appendChild(el);
  return { el, done: () => el.remove() };
}

interface Props {
  scene: ImageScene;
  views: Map<string, ItemView>;
  prefix: string;
  editable?: boolean;
  tool?: Tool;
  selectedId?: string | null;
  selectedRef?: string | null;
  flash?: { ids: string[]; n: number };
  onParts?: (parts: Part[]) => void;
  onPickPart?: (ref: string) => void;
  onPickItem?: (id: string | null) => void;
  onCreate?: (item: Partial<TwinItem> & { kind: TwinItem["kind"] }) => void;
  onMove?: (id: string, patch: Partial<TwinItem>) => void;
  onToolDone?: () => void;
  compact?: boolean;
}

const stageCss = (p: string) => `
.${p}root .tw-col, .${p}root .tw-col *:not(g) { fill: var(--tw-fill) !important; }
.${p}root line.tw-col, .${p}root polyline.tw-col, .${p}root .tw-col line, .${p}root .tw-col polyline { stroke: var(--tw-fill) !important; }
.${p}root .tw-hide { display: none; }
.${p}root .tw-ghost { opacity: 0.25; }
.${p}root .tw-blink { animation: ${p}blink 0.9s step-end infinite; }
.${p}root .tw-flash { animation: ${p}flash 0.45s ease-in-out 4; }
.${p}root .tw-sel { outline: none; filter: drop-shadow(0 0 2px #3b82f6) drop-shadow(0 0 4px #3b82f6); }
.${p}root.tw-edit [data-part]:hover { filter: drop-shadow(0 0 2px #60a5fa); cursor: pointer; }
@keyframes ${p}blink { 50% { opacity: 0.15; } }
@keyframes ${p}flash { 50% { opacity: 0.1; } }
`;

const pct = (v: number | undefined, of: number) => ((v ?? 0) * of) / 100;
/** For an attribute selector [id="…"]: quotes and backslashes escaped. */
const escId = (s: string) => s.replace(/["\\]/g, (c) => `\\${c}`);

export function itemCentre(it: TwinItem, boxes: Map<string, Box>, W: number, H: number): { x: number; y: number } | null {
  if (it.kind === "part") { const b = it.ref ? boxes.get(it.ref) : undefined; return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null; }
  if (it.kind === "point") return { x: pct(it.x, W), y: pct(it.y, H) };
  if (it.kind === "polygon") { const p = it.pts ?? []; if (!p.length) return null; return { x: pct(p.reduce((s, q) => s + q[0], 0) / p.length, W), y: pct(p.reduce((s, q) => s + q[1], 0) / p.length, H) }; }
  return { x: pct((it.x ?? 0) + (it.w ?? 0) / 2, W), y: pct((it.y ?? 0) + (it.h ?? 0) / 2, H) };
}

export const Stage = forwardRef<StageHandle, Props>(function Stage(props, ref) {
  const { scene, views, prefix, editable = false, tool = "select", selectedId, selectedRef, flash, compact } = props;
  const t = useT();
  const W = scene.w, H = scene.h;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawRef = useRef<SVGGElement>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view); viewRef.current = view;
  const autoFit = useRef(true);
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const [drawErr, setDrawErr] = useState("");
  const propsRef = useRef(props); propsRef.current = props;
  const viewsRef = useRef(views); viewsRef.current = views;

  // ── fit / zoom / pan ───────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const el = wrapRef.current; if (!el) return;
    const cw = el.clientWidth, ch = el.clientHeight; if (!cw || !ch) return;
    const k = Math.min(cw / W, ch / H) * 0.96;
    setView({ k, tx: (cw - W * k) / 2, ty: (ch - H * k) / 2 });
    autoFit.current = true;
  }, [W, H]);
  useImperativeHandle(ref, () => ({ fit, svg: () => svgRef.current }), [fit]);
  useLayoutEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (autoFit.current) fit(); });
    ro.observe(el); return () => ro.disconnect();
  }, [fit]);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const v = viewRef.current;
      const k = Math.max(0.02, Math.min(v.k * Math.exp(-e.deltaY * 0.0015), 60));
      autoFit.current = false;
      setView({ k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const toContent = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect(); const v = viewRef.current;
    return { x: (e.clientX - r.left - v.tx) / v.k, y: (e.clientY - r.top - v.ty) / v.k };
  };

  // ── drawing (sanitised at every render of a new text) ─────────────────────
  const svgText = useMemo(() => unchunk(scene.svg), [scene.svg]);
  const imageUrl = useMemo(() => (scene.image ? unchunk(scene.image) : scene.url ?? ""), [scene.image, scene.url]);
  useEffect(() => {
    const g = drawRef.current; if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    setBoxes(new Map()); setDrawErr("");
    if (!svgText) { propsRef.current.onParts?.([]); return; }
    try {
      const r = sanitizeSvgDocument(svgText, { prefix, allIds: scene.allIds });
      r.root.setAttribute("width", String(W)); r.root.setAttribute("height", String(H));
      g.appendChild(document.importNode(r.root, true));
      propsRef.current.onParts?.(r.parts);
      requestAnimationFrame(() => measure(r.parts));
    } catch (e: any) { setDrawErr(e?.message ?? String(e)); propsRef.current.onParts?.([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgText, prefix, scene.allIds, W, H]);

  const partEl = useCallback((r: string) => drawRef.current?.querySelector<SVGGraphicsElement>(`[id="${escId(prefix + r)}"]`) ?? null, [prefix]);
  const measure = (parts: Part[]) => {
    const wrap = wrapRef.current; if (!wrap) return;
    const wr = wrap.getBoundingClientRect(); const v = viewRef.current;
    const m = new Map<string, Box>();
    for (const p of parts) {
      const el = partEl(p.ref); if (!el) continue;
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      m.set(p.ref, { x: (b.left - wr.left - v.tx) / v.k, y: (b.top - wr.top - v.ty) / v.k, w: b.width / v.k, h: b.height / v.k });
    }
    setBoxes(m);
  };

  // ── apply live state to SVG parts ─────────────────────────────────────────
  const rot = useRef(new Map<string, { a: number; cx: number; cy: number; g: SVGGElement }>());
  const ensureWrap = (el: SVGGraphicsElement): SVGGElement => {
    const p = el.parentNode as SVGGElement | null;
    if (p && (p as Element).getAttribute?.("data-tw-wrap") === "1") return p;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-tw-wrap", "1");
    p!.insertBefore(g, el); g.appendChild(el);
    return g;
  };
  useEffect(() => {
    const root = drawRef.current; if (!root) return;
    const seen = new Set<string>();
    for (const it of scene.items) {
      if (it.kind !== "part" || !it.ref) continue;
      const el = partEl(it.ref); if (!el) continue;
      const v = views.get(it.id);
      seen.add(it.ref);
      el.classList.toggle("tw-col", !!v?.fillColor && !v?.fill);
      if (v?.fillColor) el.style.setProperty("--tw-fill", v.fillColor);
      el.classList.toggle("tw-hide", !!v?.hidden && !editable);
      el.classList.toggle("tw-ghost", !!v?.hidden && editable);
      el.classList.toggle("tw-blink", !!v?.blink);
      el.classList.toggle("tw-sel", selectedId === it.id);
      // text replace on <text> parts
      if (el.tagName.toLowerCase() === "text" && it.behaviours.includes("text")) {
        if (el.dataset.twOrig === undefined) el.dataset.twOrig = el.textContent ?? "";
        el.textContent = v?.label ?? el.dataset.twOrig;
      }
      // rotation
      if (v && v.speed > 0) {
        if (!rot.current.has(it.id)) {
          const g = ensureWrap(el); const b = g.getBBox();
          rot.current.set(it.id, { a: 0, cx: b.x + b.width / 2, cy: b.y + b.height / 2, g });
        }
      }
      // fill level
      const wrapG = el.parentNode as SVGGElement;
      // Structure: wrap > [part, clipPath(use → part), g(clip-path) > rect(transform = part's)].
      // The clip is in the wrapper's space, where <use> draws the part with its own
      // transform; the rect is sized from the part's local box and given the same transform.
      let fillRect = wrapG?.getAttribute?.("data-tw-wrap") === "1" ? wrapG.querySelector<SVGRectElement>("rect[data-tw-fill]") : null;
      if (v?.fill != null) {
        const g = ensureWrap(el);
        if (!fillRect) {
          const ns = "http://www.w3.org/2000/svg";
          const cp = document.createElementNS(ns, "clipPath"); const cid = `${prefix}clip-${it.id}`;
          cp.setAttribute("id", cid);
          const use = document.createElementNS(ns, "use"); use.setAttribute("href", `#${prefix}${it.ref}`); cp.appendChild(use);
          const fg = document.createElementNS(ns, "g"); fg.setAttribute("clip-path", `url(#${cid})`); fg.setAttribute("pointer-events", "none");
          fillRect = document.createElementNS(ns, "rect"); fillRect.setAttribute("data-tw-fill", "1");
          fg.appendChild(fillRect);
          g.appendChild(cp); g.appendChild(fg);
        }
        const b = el.getBBox();
        const tr = el.getAttribute("transform");
        if (tr) fillRect.setAttribute("transform", tr); else fillRect.removeAttribute("transform");
        fillRect.setAttribute("x", String(b.x)); fillRect.setAttribute("width", String(b.width));
        fillRect.setAttribute("y", String(b.y + b.height * (1 - v.fill))); fillRect.setAttribute("height", String(b.height * v.fill));
        fillRect.setAttribute("fill", v.fillColor ?? "#3b82f6"); fillRect.setAttribute("fill-opacity", "0.8");
      } else if (fillRect) fillRect.setAttribute("height", "0");
    }
    // Parts no longer mapped go back to how the drawing has them.
    root.querySelectorAll<SVGGraphicsElement>("[data-part]").forEach((el) => {
      const r = el.getAttribute("data-part")!;
      if (seen.has(r)) return;
      el.classList.remove("tw-col", "tw-hide", "tw-ghost", "tw-blink", "tw-sel");
      if (el.dataset.twOrig !== undefined) el.textContent = el.dataset.twOrig;
    });
    if (selectedRef && !scene.items.some((i) => i.ref === selectedRef)) partEl(selectedRef)?.classList.add("tw-sel");
  }, [scene.items, views, selectedId, selectedRef, editable, partEl, prefix, svgText]);

  // rotation loop
  useEffect(() => {
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      rot.current.forEach((r, id) => {
        const sp = viewsRef.current.get(id)?.speed ?? 0;
        r.a = (r.a + sp * dt) % 360;
        r.g.setAttribute("transform", `rotate(${r.a.toFixed(2)} ${r.cx} ${r.cy})`);
      });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => { rot.current.clear(); }, [svgText, prefix, scene.allIds, W, H]);

  // flash
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!flash?.n) return;
    const ids = new Set(flash.ids); setFlashing(ids);
    const els: Element[] = [];
    for (const it of scene.items) if (ids.has(it.id) && it.kind === "part" && it.ref) { const el = partEl(it.ref); if (el) { el.classList.remove("tw-flash"); void (el as any).getBBox?.(); el.classList.add("tw-flash"); els.push(el); } }
    const h = window.setTimeout(() => { setFlashing(new Set()); els.forEach((e) => e.classList.remove("tw-flash")); }, 1900);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.n]);

  // ── pointer: draw, select, move, pan ──────────────────────────────────────
  const [draft, setDraft] = useState<{ kind: Tool; a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [poly, setPoly] = useState<{ x: number; y: number }[]>([]);
  const [hover, setHover] = useState<{ id?: string; ref?: string; x: number; y: number } | null>(null);
  const drag = useRef<null | { mode: "pan" | "move" | "label" | "draw"; id?: string; sx: number; sy: number; c0: { x: number; y: number }; v0: typeof view; orig?: TwinItem; moved: boolean }>(null);
  useEffect(() => { setPoly([]); setDraft(null); }, [tool]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPoly([]); setDraft(null); }
      if (e.key === "Enter" && poly.length >= 3) finishPoly();
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  const toPct = (p: { x: number; y: number }) => ({ x: +(p.x / W * 100).toFixed(3), y: +(p.y / H * 100).toFixed(3) });
  const finishPoly = () => {
    if (poly.length >= 3) { props.onCreate?.({ kind: "polygon", pts: poly.map((p) => { const q = toPct(p); return [q.x, q.y] as [number, number]; }) }); props.onToolDone?.(); }
    setPoly([]);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const c = toContent(e);
    const target = e.target as Element;
    const itemId = target.closest?.("[data-item]")?.getAttribute("data-item") ?? undefined;
    const labelId = target.closest?.("[data-label]")?.getAttribute("data-label") ?? undefined;
    const partRef = target.closest?.("[data-part]")?.getAttribute("data-part") ?? undefined;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (editable && e.button === 0 && tool !== "select") {
      if (tool === "point") { props.onCreate?.({ kind: "point", ...toPct(c) }); props.onToolDone?.(); return; }
      if (tool === "polygon") {
        if (poly.length >= 3) { const f = poly[0]; const tol = 8 / viewRef.current.k; if (Math.hypot(f.x - c.x, f.y - c.y) < tol) { finishPoly(); return; } }
        setPoly((p) => [...p, c]); return;
      }
      drag.current = { mode: "draw", sx: e.clientX, sy: e.clientY, c0: c, v0: viewRef.current, moved: false };
      setDraft({ kind: tool, a: c, b: c });
      return;
    }
    if (editable && labelId && e.button === 0) {
      const it = propsRef.current.scene.items.find((i) => i.id === labelId);
      drag.current = { mode: "label", id: labelId, sx: e.clientX, sy: e.clientY, c0: c, v0: viewRef.current, orig: it, moved: false };
      props.onPickItem?.(labelId); return;
    }
    if (itemId && e.button === 0) {
      const it = propsRef.current.scene.items.find((i) => i.id === itemId);
      drag.current = editable ? { mode: "move", id: itemId, sx: e.clientX, sy: e.clientY, c0: c, v0: viewRef.current, orig: it ? JSON.parse(JSON.stringify(it)) : undefined, moved: false } : null;
      props.onPickItem?.(itemId);
      if (!editable) drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, c0: c, v0: viewRef.current, moved: false };
      return;
    }
    if (partRef && e.button === 0) {
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, c0: c, v0: viewRef.current, moved: false };
      (drag.current as any).part = partRef;
      return;
    }
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, c0: c, v0: viewRef.current, moved: false };
    (drag.current as any).empty = true;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const c = toContent(e);
    if (!d) {
      const target = e.target as Element;
      const id = target.closest?.("[data-item]")?.getAttribute("data-item") ?? target.closest?.("[data-label]")?.getAttribute("data-label") ?? undefined;
      const r = target.closest?.("[data-part]")?.getAttribute("data-part") ?? undefined;
      const wr = wrapRef.current!.getBoundingClientRect();
      if (id || r) setHover({ id, ref: id ? undefined : r, x: e.clientX - wr.left, y: e.clientY - wr.top }); else if (hover) setHover(null);
      if (poly.length) setDraft({ kind: "polygon", a: c, b: c });
      return;
    }
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    if (d.mode === "pan") { autoFit.current = false; setView({ ...d.v0, tx: d.v0.tx + e.clientX - d.sx, ty: d.v0.ty + e.clientY - d.sy }); return; }
    if (d.mode === "draw") { setDraft((x) => (x ? { ...x, b: c } : x)); return; }
    const dx = ((c.x - d.c0.x) / W) * 100, dy = ((c.y - d.c0.y) / H) * 100;
    const o = d.orig; if (!o || !d.id || !d.moved) return;
    if (d.mode === "label") { props.onMove?.(d.id, { lx: +((o.lx ?? 0) + dx).toFixed(2), ly: +((o.ly ?? (o.kind === "point" ? -3 : 0)) + dy).toFixed(2) }); return; }
    if (o.kind === "polygon") props.onMove?.(d.id, { pts: (o.pts ?? []).map(([x, y]) => [+(x + dx).toFixed(3), +(y + dy).toFixed(3)] as [number, number]) });
    else if (o.kind !== "part") props.onMove?.(d.id, { x: +((o.x ?? 0) + dx).toFixed(3), y: +((o.y ?? 0) + dy).toFixed(3) });
  };
  const onPointerUp = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.mode === "draw" && draft) {
      const a = toPct(draft.a), b = toPct(draft.b);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      if (w > 0.4 && h > 0.4) { props.onCreate?.({ kind: draft.kind as "rect" | "ellipse", x, y, w, h }); props.onToolDone?.(); }
      setDraft(null); return;
    }
    if (d.mode === "pan" && !d.moved) {
      const part = (d as any).part as string | undefined;
      if (part) props.onPickPart?.(part);
      else if ((d as any).empty) props.onPickItem?.(null);
    }
  };

  // ── overlay ───────────────────────────────────────────────────────────────
  const fs = Math.max(W, H) * 0.0135;
  const labelOf = (it: TwinItem, v: ItemView | undefined) => {
    if (!v?.label || v.hidden && !editable) return null;
    if (it.kind === "part" && it.ref && partEl(it.ref)?.tagName.toLowerCase() === "text" && it.behaviours.includes("text") && !it.behaviours.includes("value")) return null;
    const c = itemCentre(it, boxes, W, H); if (!c) return null;
    const x = c.x + pct(it.lx, W), y = c.y + pct(it.ly ?? (it.kind === "point" ? -3 : 0), H);
    const text = v.label; const w = Math.max(fs * 2.2, text.length * fs * 0.62 + fs * 0.9);
    const col = v.status === "crit" ? "#ef4444" : v.status === "warn" ? "#f59e0b" : "#334155";
    return (
      <g key={`l-${it.id}`} data-label={editable ? it.id : undefined} style={{ cursor: editable ? "move" : "default" }} className={cn(v.blink && "tw-blink", flashing.has(it.id) && "tw-flash")}>
        <rect x={x - w / 2} y={y - fs * 0.85} width={w} height={fs * 1.7} rx={fs * 0.35} fill="rgba(15,23,42,0.86)" stroke={col} strokeWidth={fs * 0.09} />
        <text x={x} y={y + fs * 0.36} textAnchor="middle" fontSize={fs} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#f8fafc">{text}</text>
        {v.src === "demo" && <circle cx={x + w / 2 - fs * 0.25} cy={y - fs * 0.6} r={fs * 0.22} fill="#f59e0b" />}
      </g>
    );
  };

  const shapeFor = (it: TwinItem, extra: Record<string, unknown>) => {
    if (it.kind === "rect") return <rect x={pct(it.x, W)} y={pct(it.y, H)} width={pct(it.w, W)} height={pct(it.h, H)} {...extra} />;
    if (it.kind === "ellipse") return <ellipse cx={pct((it.x ?? 0) + (it.w ?? 0) / 2, W)} cy={pct((it.y ?? 0) + (it.h ?? 0) / 2, H)} rx={pct((it.w ?? 0) / 2, W)} ry={pct((it.h ?? 0) / 2, H)} {...extra} />;
    if (it.kind === "polygon") return <polygon points={(it.pts ?? []).map(([x, y]) => `${pct(x, W)},${pct(y, H)}`).join(" ")} {...extra} />;
    return null;
  };
  const regionBox = (it: TwinItem): Box => {
    if (it.kind === "polygon") { const xs = (it.pts ?? []).map((p) => pct(p[0], W)), ys = (it.pts ?? []).map((p) => pct(p[1], H)); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; }
    return { x: pct(it.x, W), y: pct(it.y, H), w: pct(it.w, W), h: pct(it.h, H) };
  };

  const hovered = hover ? (hover.id ? scene.items.find((i) => i.id === hover.id) : scene.items.find((i) => i.kind === "part" && i.ref === hover.ref)) : undefined;
  const hv = hovered ? views.get(hovered.id) : undefined;
  const sw = Math.max(W, H) * 0.0018;

  return (
    <div ref={wrapRef} className={cn("relative w-full h-full overflow-hidden select-none bg-muted/20 touch-none", tool !== "select" && editable ? "cursor-crosshair" : "cursor-grab")}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHover(null)}
      onDoubleClick={() => { if (tool === "polygon") finishPoly(); }}>
      <svg ref={svgRef} className={cn(`${prefix}root`, editable && "tw-edit")} width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg"
        style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`, overflow: "visible" }}>
        <style>{stageCss(prefix)}</style>
        {!svgText && imageUrl && <image href={imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />}
        {!svgText && !imageUrl && <rect x={0} y={0} width={W} height={H} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeDasharray={`${sw * 4} ${sw * 4}`} strokeWidth={sw} />}
        <g ref={drawRef} />
        <defs>
          {scene.items.filter((i) => i.kind !== "part" && i.kind !== "point" && views.get(i.id)?.fill != null).map((it) => (
            <clipPath key={it.id} id={`${prefix}rc-${it.id}`}>{shapeFor(it, {})}</clipPath>
          ))}
        </defs>
        {scene.items.map((it) => {
          if (it.kind === "part") return null;
          const v = views.get(it.id);
          const sel = selectedId === it.id;
          const cls = cn(v?.blink && "tw-blink", flashing.has(it.id) && "tw-flash", v?.hidden && (editable ? "tw-ghost" : "tw-hide"));
          if (it.kind === "point") {
            const col = v?.fillColor ?? (v?.status && v.status !== "none" ? STATUS_COLOR[v.status] : "#3b82f6");
            return (
              <g key={it.id} data-item={it.id} className={cls} style={{ cursor: editable ? "move" : "pointer" }}>
                <circle cx={pct(it.x, W)} cy={pct(it.y, H)} r={fs * 0.55} fill={col} stroke={sel ? "#fff" : "rgba(15,23,42,0.8)"} strokeWidth={fs * (sel ? 0.22 : 0.12)} />
              </g>
            );
          }
          const b = regionBox(it);
          const show = editable || !!v?.fillColor || sel;
          return (
            <g key={it.id} data-item={it.id} className={cls} style={{ cursor: editable ? "move" : "pointer" }}>
              {shapeFor(it, {
                fill: v?.fillColor && v.fill == null ? v.fillColor : editable ? "rgba(59,130,246,0.10)" : "rgba(0,0,0,0.001)",
                fillOpacity: v?.fillColor && v.fill == null ? 0.45 : 1,
                stroke: sel ? "#3b82f6" : show ? (v?.fillColor ?? "rgba(59,130,246,0.7)") : "none",
                strokeWidth: sel ? sw * 2 : sw, strokeDasharray: editable && !sel ? `${sw * 3} ${sw * 2}` : undefined,
              })}
              {v?.fill != null && (
                <rect clipPath={`url(#${prefix}rc-${it.id})`} x={b.x} width={b.w} y={b.y + b.h * (1 - v.fill)} height={b.h * v.fill} fill={v.fillColor ?? "#3b82f6"} fillOpacity={0.75} pointerEvents="none" />
              )}
            </g>
          );
        })}
        {scene.items.map((it) => labelOf(it, views.get(it.id)))}
        {draft && draft.kind !== "polygon" && (() => {
          const x = Math.min(draft.a.x, draft.b.x), y = Math.min(draft.a.y, draft.b.y), w = Math.abs(draft.a.x - draft.b.x), h = Math.abs(draft.a.y - draft.b.y);
          return draft.kind === "ellipse"
            ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth={sw * 1.5} />
            : <rect x={x} y={y} width={w} height={h} fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth={sw * 1.5} />;
        })()}
        {poly.length > 0 && (
          <g pointerEvents="none">
            <polyline points={[...poly, draft?.b ?? poly[poly.length - 1]].map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth={sw * 1.5} />
            {poly.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={sw * (i === 0 ? 4 : 2.5)} fill={i === 0 ? "#fff" : "#3b82f6"} stroke="#3b82f6" strokeWidth={sw} />)}
          </g>
        )}
      </svg>
      {drawErr && <div className="absolute inset-x-4 top-4 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{t("The drawing could not be shown: {err}", { err: drawErr })}</div>}
      {editable && tool === "polygon" && <div className="absolute left-3 bottom-3 text-xs rounded bg-background/90 border border-border px-2 py-1">{t("Click to add corners. Click the first corner, double-click or press Enter to finish; Esc cancels.")}</div>}
      {hover && (hovered || hover.ref) && !drag.current && (
        <div className="pointer-events-none absolute z-10 max-w-[16rem] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md" style={{ left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 9999) - 220), top: hover.y + 14 }}>
          <div className="font-semibold truncate">{hovered?.name ?? hover.ref}</div>
          {hovered ? (
            <>
              <div className="font-mono">{hv?.v == null ? t("No value") : `${hv.label ?? hv.v}`}{hv?.src && hv.src !== "none" && <span className="ml-1 text-muted-foreground">({t(hv.src)})</span>}</div>
              {hv?.status && hv.status !== "none" && <div style={{ color: STATUS_COLOR[hv.status] }}>{hv.status === "ok" ? t("Normal") : hv.status === "warn" ? t("Warning") : t("Alarm")}{hv.fromRules ? ` · ${t("alarm rule limits")}` : ""}</div>}
              {hv?.ts && <div className="text-muted-foreground">{t("Updated {time}", { time: new Date(hv.ts).toLocaleString() })}</div>}
              {!hovered.assetId && <div className="text-muted-foreground">{t("Not linked")}</div>}
            </>
          ) : <div className="text-muted-foreground">{t("Not mapped. Click to map it.")}</div>}
        </div>
      )}
      {!compact && <div className="absolute right-2 bottom-2 text-[10px] font-mono text-muted-foreground pointer-events-none">{Math.round(view.k * 100)}%</div>}
    </div>
  );
});
