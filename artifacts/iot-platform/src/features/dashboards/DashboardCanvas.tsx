import { useEffect, useRef, useState, useCallback } from "react";
import { GripVertical, Trash2, Copy, RefreshCw, Maximize2, MoreVertical, Clipboard, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GRID_COLS, ROW_H, MIN_W, MIN_H, type Widget } from "./types";
import { WidgetView, widgetDef } from "./registry";
import { largestFreeSize, nearestFreeSpot } from "./layout";
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
  const drag = useRef<null | { id: string; mode: "move" | "resize"; sx: number; sy: number; orig: Widget }>(null);

  useEffect(() => {
    if (!ref.current) return;
    // Minus the padding on both sides, so 12 columns span the usable width rather
    // than overflowing it by PAD*2.
    const ro = new ResizeObserver(() => { if (ref.current) setCellW((ref.current.clientWidth - PAD * 2) / GRID_COLS); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = Math.round((e.clientX - d.sx) / cellW);
    const dy = Math.round((e.clientY - d.sy) / ROW_H);
    setWidgets((prev) => prev.map((w) => {
      if (w.id !== d.id) return w;
      const others = prev.filter((o) => o.id !== d.id);
      if (d.mode === "move") return { ...w, ...nearestFreeSpot(others, w.w, w.h, d.orig.x + dx, d.orig.y + dy) };
      return { ...w, ...largestFreeSize(others, w, Math.max(MIN_W, Math.min(GRID_COLS - w.x, d.orig.w + dx)), Math.max(MIN_H, d.orig.h + dy)) };
    }));
  }, [cellW, setWidgets]);

  const onUp = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove]);

  function startDrag(e: React.PointerEvent, w: Widget, mode: "move" | "resize") {
    e.preventDefault(); e.stopPropagation();
    onSelect(w.id);
    drag.current = { id: w.id, mode, sx: e.clientX, sy: e.clientY, orig: { ...w } };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

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

  const removeWidget = (id: string) => { setWidgets((prev) => prev.filter((w) => w.id !== id)); onSelect(null); };
  const dupWidget = (w: Widget) => { const c = { ...w, id: newId("w"), ...nearestFreeSpot(widgets, w.w, w.h, w.x, w.y + w.h) }; setWidgets((prev) => [...prev, c]); onSelect(c.id); };

  const maxRow = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
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
        {widgets.map((w) => {
          const selected = selectedId === w.id;
          const def = widgetDef(w.type);
          return (
            <div
              key={w.id}
              onClick={(e) => { e.stopPropagation(); onSelect(w.id); }}
              className={cn("absolute rounded-lg bg-card border shadow-sm overflow-hidden flex flex-col",
                // Themed, not a fixed blue: the selection ring is a UI accent and
                // must follow --primary, or it drifts out of the palette the next
                // time the theme changes.
                selected ? "border-primary ring-2 ring-primary/30" : "border-border")}
              style={{
                left: PAD + w.x * cellW + GAP / 2,
                top: PAD + w.y * ROW_H + GAP / 2,
                width: w.w * cellW - GAP,
                height: w.h * ROW_H - GAP,
              }}
            >
              {/* header / drag handle */}
              <div
                onPointerDown={readOnly ? undefined : (e) => startDrag(e, w, "move")}
                className={cn("flex items-center gap-1 px-1.5 h-6 shrink-0 border-b border-border bg-muted/50 select-none", !readOnly && "cursor-move")}
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
                className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
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
