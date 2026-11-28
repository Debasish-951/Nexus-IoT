import { useMemo, useState } from "react";
import { Search, LayoutGrid, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { offeredWidgetCategories } from "./registry";
import { useCurrentUser } from "@/contexts/UserContext";

export function WidgetPanel({ onClose }: { onClose?: () => void }) {
  const [q, setQ] = useState("");
  const { canModule } = useCurrentUser();
  const cats = useMemo(() => {
    const offered = offeredWidgetCategories(canModule);
    const query = q.trim().toLowerCase();
    if (!query) return offered;
    return offered.map((c) => ({ ...c, items: c.items.filter((i) => i.label.toLowerCase().includes(query)) })).filter((c) => c.items.length);
  }, [q, canModule]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold"><LayoutGrid className="w-4 h-4 text-primary" /> Widget Library</div>
          {onClose && (
            <button onClick={onClose} title="Close" className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search widgets…" className="pl-7 h-8 text-sm" />
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {cats.map((c) => (
          <div key={c.name}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{c.name}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {c.items.map((it) => (
                <div
                  key={it.type}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("widget-type", it.type); e.dataTransfer.effectAllowed = "copy"; }}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-border bg-card hover:border-primary hover:bg-primary/5 cursor-grab active:cursor-grabbing text-xs"
                  title={`Drag "${it.label}" onto the canvas`}
                >
                  <it.icon className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="truncate">{it.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {cats.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No widgets match.</p>}
      </div>
      <p className="p-2 text-[11px] text-muted-foreground border-t border-border">Drag any widget onto the canvas.</p>
    </div>
  );
}
