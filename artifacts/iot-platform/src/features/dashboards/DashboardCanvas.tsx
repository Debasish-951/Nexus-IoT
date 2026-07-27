import { useEffect, useRef, useState, useCallback } from "react";
import { GripVertical, Trash2, Copy, RefreshCw, Maximize2, MoreVertical, Clipboard, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GRID_COLS, ROW_H, MIN_W, MIN_H, type Widget } from "./types";
import { WidgetView, widgetDef } from "./registry";
import { WidgetTimePopover } from "./WidgetTimePopover";
import { newId } from "./useDashboards";

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
}

export function DashboardCanvas({
  widgets, setWidgets, selectedId, onSelect, onDropWidget,
  updateConfig, refreshNonces, onRefreshWidget, onCopyWidget, onEditWidget, futuristic,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [cellW, setCellW] = useState(90);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const drag = useRef<null | { id: string; mode: "move" | "resize"; sx: number; sy: number; orig: Widget }>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => { if (ref.current) setCellW(ref.current.clientWidth / GRID_COLS); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = Math.round((e.clientX - d.sx) / cellW);
    const dy = Math.round((e.clientY - d.sy) / ROW_H);
    setWidgets((prev) => prev.map((w) => {
      if (w.id !== d.id) return w;
      if (d.mode === "move") return { ...w, x: Math.max(0, Math.min(GRID_COLS - w.w, d.orig.x + dx)), y: Math.max(0, d.orig.y + dy) };
      return { ...w, w: Math.max(MIN_W, Math.min(GRID_COLS - w.x, d.orig.w + dx)), h: Math.max(MIN_H, d.orig.h + dy) };
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
    const x = Math.max(0, Math.min(GRID_COLS - def.w, Math.floor((e.clientX - rect.left) / cellW)));
    const y = Math.max(0, Math.floor((e.clientY - rect.top + ref.current.scrollTop) / ROW_H));
    onDropWidget(type, x, y);
  }

  const removeWidget = (id: string) => { setWidgets((prev) => prev.filter((w) => w.id !== id)); onSelect(null); };
  const dupWidget = (w: Widget) => { const c = { ...w, id: newId("w"), x: Math.min(GRID_COLS - w.w, w.x + 1), y: w.y + 1 }; setWidgets((prev) => [...prev, c]); onSelect(c.id); };

  const maxRow = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
  const canvasRows = Math.max(maxRow + 4, 16);
  const fullscreenWidget = fullscreenId ? widgets.find((w) => w.id === fullscreenId) ?? null : null;

  return (
    <div
      ref={ref}
      onClick={() => onSelect(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={cn("relative w-full h-full overflow-auto", futuristic ? "" : "bg-background")}
      style={futuristic ? {
        backgroundColor: "#050914",
        backgroundImage: `radial-gradient(circle at 25% 15%, rgba(56,189,248,0.14), transparent 55%), radial-gradient(circle at 85% 90%, rgba(168,85,247,0.14), transparent 55%)`,
        backgroundSize: `auto, auto`,
      } : undefined}
    >
      <div className="relative" style={{ height: canvasRows * ROW_H }}>
        {widgets.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm pointer-events-none">
            Click "Add Widget" above, then drag a widget onto the canvas
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
                selected ? "border-[#2563EB] ring-2 ring-[#2563EB]/30" : "border-border")}
              style={{ left: w.x * cellW, top: w.y * ROW_H, width: w.w * cellW - 6, height: w.h * ROW_H - 6 }}
            >
              {/* header / drag handle */}
              <div
                onPointerDown={(e) => startDrag(e, w, "move")}
                className="flex items-center gap-1 px-1.5 h-6 shrink-0 border-b border-border bg-muted/50 cursor-move select-none"
              >
                <GripVertical className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-[11px] truncate flex-1">
                  <span className="text-foreground font-medium">{w.config?.title ?? def?.label ?? w.type}</span>
                  {w.config?.subtitle ? <span className="text-muted-foreground"> · {w.config.subtitle}</span> : null}
                </span>
                <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0 text-muted-foreground">
                  <WidgetTimePopover widget={w} updateConfig={updateConfig} />
                  <button onClick={() => onEditWidget(w.id)} title="Edit widget" className="p-0.5 hover:text-foreground"><Pencil className="w-3 h-3" /></button>
                  <button onClick={() => onRefreshWidget(w.id)} title="Refresh" className="p-0.5 hover:text-foreground"><RefreshCw className="w-3 h-3" /></button>
                  <button onClick={() => setFullscreenId(w.id)} title="Fullscreen" className="p-0.5 hover:text-foreground"><Maximize2 className="w-3 h-3" /></button>
                  <button onClick={() => removeWidget(w.id)} title="Delete widget" className="p-0.5 hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button title="More options" className="p-0.5 hover:text-foreground"><MoreVertical className="w-3 h-3" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => dupWidget(w)}><Copy className="w-3.5 h-3.5 mr-2" /> Duplicate Widget</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => dupWidget(w)}><Copy className="w-3.5 h-3.5 mr-2" /> Clone Widget</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCopyWidget(w)}><Clipboard className="w-3.5 h-3.5 mr-2" /> Copy to Clipboard</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="flex-1 min-h-0 p-1.5 relative">
                {w.config?.imageUrl && (
                  <img src={w.config.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.08] pointer-events-none select-none"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                <div className="relative h-full"><WidgetView widget={w} refreshNonce={refreshNonces[w.id] ?? 0} /></div>
              </div>
              {/* resize handle */}
              <div onPointerDown={(e) => startDrag(e, w, "resize")}
                className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
                style={{ background: "linear-gradient(135deg, transparent 50%, #94a3b8 50%)" }} />
            </div>
          );
        })}
      </div>

      {/* Per-widget fullscreen */}
      <Dialog open={!!fullscreenWidget} onOpenChange={(v) => { if (!v) setFullscreenId(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{fullscreenWidget?.config?.title ?? widgetDef(fullscreenWidget?.type ?? "")?.label ?? "Widget"}</DialogTitle>
          </DialogHeader>
          <div className="h-[60vh] p-1">{fullscreenWidget && <WidgetView widget={fullscreenWidget} refreshNonce={refreshNonces[fullscreenWidget.id] ?? 0} />}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
