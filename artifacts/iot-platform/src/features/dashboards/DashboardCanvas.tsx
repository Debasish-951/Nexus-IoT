import { useEffect, useRef, useState, useCallback } from "react";
import { Lock, GripVertical, Trash2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { GRID_COLS, ROW_H, type Widget } from "./types";
import { WidgetView, widgetDef } from "./registry";
import { newId } from "./useDashboards";

interface Props {
  widgets: Widget[];
  setWidgets: (updater: (prev: Widget[]) => Widget[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  preview: boolean;
  defaultConfig?: Record<string, any>; // pre-bind new widgets (assetId/tag from the opened asset)
}

export function DashboardCanvas({ widgets, setWidgets, selectedId, onSelect, preview, defaultConfig }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [cellW, setCellW] = useState(90);
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
      return { ...w, w: Math.max(2, Math.min(GRID_COLS - w.x, d.orig.w + dx)), h: Math.max(2, d.orig.h + dy) };
    }));
  }, [cellW, setWidgets]);

  const onUp = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove]);

  function startDrag(e: React.PointerEvent, w: Widget, mode: "move" | "resize") {
    if (preview || w.locked) return;
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
    const wgt: Widget = { id: newId("w"), type, x, y, w: def.w, h: def.h, config: { ...(def.defaults ?? {}), ...(defaultConfig ?? {}) } };
    setWidgets((prev) => [...prev, wgt]);
    onSelect(wgt.id);
  }

  const removeWidget = (id: string) => { setWidgets((prev) => prev.filter((w) => w.id !== id)); onSelect(null); };
  const dupWidget = (w: Widget) => { const c = { ...w, id: newId("w"), x: Math.min(GRID_COLS - w.w, w.x + 1), y: w.y + 1 }; setWidgets((prev) => [...prev, c]); onSelect(c.id); };
  const toggleLock = (id: string) => setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, locked: !w.locked } : w)));

  const maxRow = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
  const canvasRows = Math.max(maxRow + 4, 16);

  return (
    <div
      ref={ref}
      onClick={() => onSelect(null)}
      onDragOver={(e) => { if (!preview) e.preventDefault(); }}
      onDrop={onDrop}
      className="relative w-full h-full overflow-auto bg-white"
      style={!preview ? {
        backgroundImage: `linear-gradient(to right, #eef2f7 1px, transparent 1px), linear-gradient(to bottom, #eef2f7 1px, transparent 1px)`,
        backgroundSize: `${cellW}px ${ROW_H}px`,
      } : undefined}
    >
      <div className="relative" style={{ height: canvasRows * ROW_H }}>
        {widgets.length === 0 && !preview && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm pointer-events-none">
            Drag widgets here from the Widget Library →
          </div>
        )}
        {widgets.map((w) => {
          const selected = selectedId === w.id;
          const def = widgetDef(w.type);
          return (
            <div
              key={w.id}
              onClick={(e) => { e.stopPropagation(); onSelect(w.id); }}
              className={cn("absolute rounded-lg bg-white border shadow-sm overflow-hidden flex flex-col",
                selected ? "border-[#2563EB] ring-2 ring-[#2563EB]/30" : "border-slate-200")}
              style={{ left: w.x * cellW, top: w.y * ROW_H, width: w.w * cellW - 6, height: w.h * ROW_H - 6 }}
            >
              {/* header / drag handle */}
              {!preview && (
                <div
                  onPointerDown={(e) => startDrag(e, w, "move")}
                  className="flex items-center gap-1 px-1.5 h-6 shrink-0 border-b border-slate-100 bg-slate-50/70 cursor-move select-none"
                >
                  <GripVertical className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="text-[11px] truncate flex-1">
                    <span className="text-slate-600 font-medium">{w.config?.title ?? def?.label ?? w.type}</span>
                    {w.config?.subtitle ? <span className="text-slate-400"> · {w.config.subtitle}</span> : null}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); toggleLock(w.id); }} title="Lock" className={cn("p-0.5", w.locked ? "text-[#2563EB]" : "text-slate-300 hover:text-slate-500")}><Lock className="w-3 h-3" /></button>
                  <button onClick={(e) => { e.stopPropagation(); dupWidget(w); }} title="Duplicate" className="p-0.5 text-slate-300 hover:text-slate-500"><Copy className="w-3 h-3" /></button>
                  <button onClick={(e) => { e.stopPropagation(); removeWidget(w.id); }} title="Delete" className="p-0.5 text-slate-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                </div>
              )}
              <div className="flex-1 min-h-0 p-1.5">
                <WidgetView widget={w} />
              </div>
              {/* resize handle */}
              {!preview && !w.locked && (
                <div onPointerDown={(e) => startDrag(e, w, "resize")}
                  className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
                  style={{ background: "linear-gradient(135deg, transparent 50%, #94a3b8 50%)" }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
