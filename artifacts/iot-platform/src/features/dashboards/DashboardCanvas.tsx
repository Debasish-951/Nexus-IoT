import { useEffect, useRef, useState, useCallback } from "react";
import { GripVertical, Trash2, Copy, RefreshCw, Maximize2, MoreVertical, Clipboard, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GRID_COLS, ROW_H, MIN_W, MIN_H, type Widget } from "./types";
import { WidgetView, widgetDef } from "./registry";
import { nearestFreeSpot, placeWithPush, compactUp } from "./layout";
import { WidgetTimePopover } from "./WidgetTimePopover";
import { newId } from "./useDashboards";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { TimeCfg } from "./timeRange";

// Breathing room around and between widgets. PAD keeps the outermost widgets off
// the panel edges — they used to sit flush against the hierarchy pane and the
// header border, with a gutter only ever appearing between neighbours. GAP is that
// gutter: each widget is inset GAP/2 on every side, so two adjacent widgets end up
// a full GAP apart while the canvas edge keeps PAD + GAP/2.
const PAD = 8;
const GAP = 10;

interface Props {
  widgets: Widget[];
  setWidgets: (updater: (prev: Widget[]) => Widget[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDropWidget: (type: string, x: number, y: number) => void; // dropped widget type + grid position — parent decides whether/when to commit it
  updateConfig: (id: string, patch: Record<string, any>) => void;
  refreshNonces: Record<string, string | number>;
  onRefreshWidget: (id: string) => void;
  onCopyWidget: (w: Widget) => void;
  onEditWidget: (id: string) => void;
  futuristic?: boolean; // neon presentation theme (toggled from the asset tree)
  // The dashboard-wide range, read live by any widget that hasn't set its own
  // (see WidgetView) — not copied into any widget's stored config.
  dashTimeCfg?: TimeCfg | null;
  // View only: widgets cannot be moved, resized, edited or removed.
  readOnly?: boolean;
}

export function DashboardCanvas({
  widgets, setWidgets, selectedId, onSelect, onDropWidget,
  updateConfig, refreshNonces, onRefreshWidget, onCopyWidget, onEditWidget, futuristic, dashTimeCfg, readOnly,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Same node as `ref`, but as state so it can be handed to Radix as a collision
  // boundary — a ref alone is still null on the render that positions the popovers.
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  // Stable identity matters: an inline arrow would be a new ref callback every
  // render, so React would detach (null) and reattach it — and fire setCanvasEl —
  // on every single render, including each pointermove of a drag.
  const attachCanvas = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    setCanvasEl(el);
  }, []);
  const [cellW, setCellW] = useState(90);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const drag = useRef<null | { id: string; mode: "move" | "resize"; sx: number; sy: number; scroll0: number; orig: Widget; layout: Widget[] }>(null);
  // While dragging: the layout being previewed (other widgets make room live) and
  // the pointer offset in pixels, so the dragged widget follows the pointer freely.
  // Nothing is written to the dashboard until the pointer is released.
  const [preview, setPreview] = useState<Widget[] | null>(null);
  const previewRef = useRef<Widget[] | null>(null);
  const [dragView, setDragView] = useState<null | { id: string; mode: "move" | "resize"; dx: number; dy: number }>(null);
  const cellWRef = useRef(cellW);
  cellWRef.current = cellW;

  useEffect(() => {
    if (!ref.current) return;
    // Minus the padding on both sides, so 12 columns span the usable width rather
    // than overflowing it by PAD*2.
    const ro = new ResizeObserver(() => { if (ref.current) setCellW((ref.current.clientWidth - PAD * 2) / GRID_COLS); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // Moving: the widget follows the pointer, and the widgets where it would land
  // make room (a same-size neighbour swaps, others are pushed down), so a widget
  // can be dropped anywhere, not only into empty space. Resizing pushes the
  // widgets below it down instead of stopping at them.
  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const el = ref.current;
    // Scroll the canvas when the pointer nears its top or bottom edge, so a widget
    // can be taken further than the visible area.
    if (el) {
      const r = el.getBoundingClientRect();
      if (e.clientY > r.bottom - 40) el.scrollTop += 14;
      else if (e.clientY < r.top + 40) el.scrollTop -= 14;
    }
    const dxPx = e.clientX - d.sx;
    const dyPx = e.clientY - d.sy + ((el?.scrollTop ?? 0) - d.scroll0);
    const dx = Math.round(dxPx / cellWRef.current), dy = Math.round(dyPx / ROW_H);
    const o = d.orig;
    const target = d.mode === "move"
      ? { x: Math.max(0, Math.min(GRID_COLS - o.w, o.x + dx)), y: Math.max(0, o.y + dy), w: o.w, h: o.h }
      : { x: o.x, y: o.y, w: Math.max(MIN_W, Math.min(GRID_COLS - o.x, o.w + dx)), h: Math.max(MIN_H, o.h + dy) };
    // Then everything floats up, so no gap is left where a widget used to be.
    const next = compactUp(placeWithPush(d.layout, d.id, target, d.mode === "move"));
    previewRef.current = next;
    setPreview(next);
    setDragView({ id: d.id, mode: d.mode, dx: dxPx, dy: dyPx });
  }, []);

  // Listeners live in a ref so add/remove always use the same functions.
  const listeners = useRef<{ move: (e: PointerEvent) => void; up: () => void; key: (e: KeyboardEvent) => void } | null>(null);

  const endDrag = useCallback((commit: boolean) => {
    const l = listeners.current;
    if (l) {
      window.removeEventListener("pointermove", l.move);
      window.removeEventListener("pointerup", l.up);
      window.removeEventListener("keydown", l.key);
      listeners.current = null;
    }
    const next = previewRef.current;
    drag.current = null;
    previewRef.current = null;
    setPreview(null);
    setDragView(null);
    if (commit && next) {
      const pos = new Map(next.map((w) => [w.id, w]));
      setWidgets((prev) => prev.map((w) => {
        const n = pos.get(w.id);
        return n && (n.x !== w.x || n.y !== w.y || n.w !== w.w || n.h !== w.h) ? { ...w, x: n.x, y: n.y, w: n.w, h: n.h } : w;
      }));
    }
  }, [setWidgets]);

  function startDrag(e: React.PointerEvent, w: Widget, mode: "move" | "resize") {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    onSelect(w.id);
    drag.current = { id: w.id, mode, sx: e.clientX, sy: e.clientY, scroll0: ref.current?.scrollTop ?? 0, orig: { ...w }, layout: widgets };
    const l = {
      move: onMove,
      up: () => endDrag(true),
      // Escape puts everything back where it was.
      key: (ev: KeyboardEvent) => { if (ev.key === "Escape") endDrag(false); },
    };
    listeners.current = l;
    window.addEventListener("pointermove", l.move);
    window.addEventListener("pointerup", l.up);
    window.addEventListener("keydown", l.key);
  }

  // Remove listeners if the canvas unmounts mid-drag.
  useEffect(() => () => {
    const l = listeners.current;
    if (!l) return;
    window.removeEventListener("pointermove", l.move);
    window.removeEventListener("pointerup", l.up);
    window.removeEventListener("keydown", l.key);
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer.getData("widget-type");
    if (!type || !ref.current) return;
    const def = widgetDef(type); if (!def) return;
    const rect = ref.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(GRID_COLS - def.w, Math.floor((e.clientX - rect.left - PAD) / cellW)));
    const y = Math.max(0, Math.floor((e.clientY - rect.top + ref.current.scrollTop - PAD) / ROW_H));
    const spot = nearestFreeSpot(widgets, def.w, def.h, x, y);
    onDropWidget(type, spot.x, spot.y);
  }

  // Widgets below a removed one move up into its place.
  const removeWidget = (id: string) => { setWidgets((prev) => compactUp(prev.filter((w) => w.id !== id))); onSelect(null); };
  const dupWidget = (w: Widget) => { const c = { ...w, id: newId("w"), ...nearestFreeSpot(widgets, w.w, w.h, w.x, w.y + w.h) }; setWidgets((prev) => compactUp([...prev, c])); onSelect(c.id); };

  const shown = preview ?? widgets;
  const maxRow = shown.reduce((m, w) => Math.max(m, w.y + w.h), 0);
  const canvasRows = Math.max(maxRow + 4, 16);
  const fullscreenWidget = fullscreenId ? widgets.find((w) => w.id === fullscreenId) ?? null : null;

  return (
    <div
      ref={attachCanvas}
      onClick={() => onSelect(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={cn("relative w-full h-full overflow-auto", futuristic ? "" : "bg-background")}
      style={futuristic ? {
        // Presentation ("futuristic") mode keeps its own fixed dark ground — it is
        // a deliberate single-look wall display, not a themed surface. Re-hued to
        // blue/cyan so it sits in the Electric Blue family instead of the old
        // sky-and-purple pairing.
        backgroundColor: "#060A12",
        backgroundImage: `radial-gradient(circle at 25% 15%, rgba(59,130,246,0.16), transparent 55%), radial-gradient(circle at 85% 90%, rgba(8,145,178,0.14), transparent 55%)`,
        backgroundSize: `auto, auto`,
      } : undefined}
    >
      <div className="relative" style={{ height: canvasRows * ROW_H + PAD * 2 }}>
        {widgets.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm pointer-events-none">
            {readOnly ? "This dashboard has no widgets yet" : 'Click "Add Widget" above, then drag a widget onto the canvas'}
          </div>
        )}
        {/* Where the dragged widget will land. */}
        {dragView && (() => {
          const t = shown.find((x) => x.id === dragView.id);
          return t ? (
            <div className="absolute rounded-lg border-2 border-dashed border-primary bg-primary/10 pointer-events-none"
              style={{ left: PAD + t.x * cellW + GAP / 2, top: PAD + t.y * ROW_H + GAP / 2, width: t.w * cellW - GAP, height: t.h * ROW_H - GAP }} />
          ) : null;
        })()}
        {shown.map((w) => {
          const selected = selectedId === w.id;
          const def = widgetDef(w.type);
          // The dragged widget follows the pointer in pixels from where it started;
          // the others glide to their new places.
          const dragging = dragView?.id === w.id;
          const follow = dragging && dragView.mode === "move";
          const base = follow ? drag.current?.orig ?? w : w;
          return (
            <div
              key={w.id}
              onClick={(e) => { e.stopPropagation(); onSelect(w.id); }}
              className={cn("absolute rounded-lg bg-card border shadow-sm overflow-hidden flex flex-col",
                follow && "shadow-2xl z-20 cursor-grabbing",
                dragView && !dragging && "transition-[left,top,width,height] duration-150 ease-out",
                // Themed, not a fixed blue: the selection ring is a UI accent and
                // must follow --primary, or it drifts out of the palette the next
                // time the theme changes.
                selected ? "border-primary ring-2 ring-primary/30" : "border-border")}
              style={{
                left: PAD + base.x * cellW + GAP / 2 + (follow ? dragView.dx : 0),
                top: PAD + base.y * ROW_H + GAP / 2 + (follow ? dragView.dy : 0),
                width: base.w * cellW - GAP,
                height: base.h * ROW_H - GAP,
              }}
            >
              {/* header / drag handle */}
              <div
                onPointerDown={readOnly ? undefined : (e) => startDrag(e, w, "move")}
                className={cn("flex items-center gap-1 px-1.5 h-6 shrink-0 border-b border-border bg-muted/50 select-none", !readOnly && "cursor-move touch-none")}
              >
                <GripVertical className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-[11px] truncate flex-1">
                  {/* The header is the Widget Title and nothing else — deliberately
                      blank when no title is set. It must NOT fall back to Label or to
                      the widget type: Label already names the series in the legend
                      under the chart, and showing it up here too printed the same
                      text twice on one widget. */}
                  <span className="text-foreground font-medium">{w.config?.title ?? ""}</span>
                  {w.config?.subtitle ? <span className="text-muted-foreground"> · {w.config.subtitle}</span> : null}
                </span>
                <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0 text-muted-foreground">
                  {!readOnly && <WidgetTimePopover widget={w} updateConfig={updateConfig} dashTimeCfg={dashTimeCfg} boundary={canvasEl} />}
                  {!readOnly && <button onClick={() => onEditWidget(w.id)} title="Edit widget" className="p-0.5 hover:text-foreground"><Pencil className="w-3 h-3" /></button>}
                  <button onClick={() => onRefreshWidget(w.id)} title="Refresh" className="p-0.5 hover:text-foreground"><RefreshCw className="w-3 h-3" /></button>
                  <button onClick={() => setFullscreenId(w.id)} title="Fullscreen" className="p-0.5 hover:text-foreground"><Maximize2 className="w-3 h-3" /></button>
                  {!readOnly && <button onClick={() => removeWidget(w.id)} title="Delete widget" className="p-0.5 hover:text-destructive"><Trash2 className="w-3 h-3" /></button>}
                  {!readOnly && <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button title="More options" className="p-0.5 hover:text-foreground"><MoreVertical className="w-3 h-3" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => dupWidget(w)}><Copy className="w-3.5 h-3.5 mr-2" /> Duplicate Widget</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => dupWidget(w)}><Copy className="w-3.5 h-3.5 mr-2" /> Clone Widget</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCopyWidget(w)}><Clipboard className="w-3.5 h-3.5 mr-2" /> Copy to Clipboard</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>}
                </div>
              </div>
              <div className="flex-1 min-h-0 p-1.5 relative">
                {/* The Image widget draws imageUrl itself, at full strength. */}
                {w.config?.imageUrl && w.type !== "image" && (
                  <img src={w.config.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.08] pointer-events-none select-none"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                <div className="relative h-full"><ErrorBoundary scope="widget" resetKey={w}><WidgetView widget={w} refreshNonce={refreshNonces[w.id] ?? 0} dashTimeCfg={dashTimeCfg} /></ErrorBoundary></div>
              </div>
              {/* resize handle */}
              {!readOnly && <div onPointerDown={(e) => startDrag(e, w, "resize")}
                className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize touch-none"
                style={{ background: "linear-gradient(135deg, transparent 50%, hsl(var(--muted-foreground)) 50%)" }} />}
            </div>
          );
        })}
      </div>

      {/* Per-widget fullscreen */}
      <Dialog open={!!fullscreenWidget} onOpenChange={(v) => { if (!v) setFullscreenId(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            {/* Unlike the canvas header this keeps a fallback: a dialog with a blank
                title has no accessible name, and there is no surrounding context
                here to say what you are looking at. */}
            <DialogTitle>{fullscreenWidget?.config?.title || widgetDef(fullscreenWidget?.type ?? "")?.label || "Widget"}</DialogTitle>
          </DialogHeader>
          <div className="h-[60vh] p-1">{fullscreenWidget && <ErrorBoundary scope="widget" resetKey={fullscreenWidget}><WidgetView widget={fullscreenWidget} refreshNonce={refreshNonces[fullscreenWidget.id] ?? 0} dashTimeCfg={dashTimeCfg} /></ErrorBoundary>}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
