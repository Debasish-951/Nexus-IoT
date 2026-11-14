import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronRight, GripVertical, Search, Sparkles, X } from "lucide-react";
import { MODELS, FAM } from "./engine/models";
import { PACKS } from "./engine/packs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

/** dataTransfer type used when a library card is dragged onto the 3D view. */
export const DRAG_TYPE = "application/x-plant-twin-model";

const defaults = (type: string) => Object.fromEntries(Object.entries(MODELS[type].params).map(([k, d]) => [k, (d as { v: unknown }).v]));

/**
 * "Add twin" library: every machine model, grouped like the Visualization widget
 * library. Drag a card onto the 3D view to place it there, or click it to add it
 * next to the others. Each card lists the readings the model understands, which
 * is what gets linked to an asset's telemetry afterwards.
 */
export function TwinLibrary({ onAdd, onClose, onDetailedSkid, industry }: {
  onAdd: (type: string) => void;
  onClose: () => void;
  /** Offered on the Asset twin: the separate, more detailed pump skid. */
  onDetailedSkid?: () => void;
  /** 3D Builder: lay out a whole plant from an industry template. */
  industry?: { current: string | null; onLoad: (key: string) => void };
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [pack, setPack] = useState<string>(industry?.current ?? "textile");
  const [open, setOpen] = useState<Set<string>>(() => new Set(["rotating"]));
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.entries(FAM).map(([f, label]) => ({
      f, label,
      models: Object.entries(MODELS).filter(([k, md]) => md.fam === f && !md.hidden).map(([k, md]) => {
        let reads: string[] = [];
        try { reads = md.tags(defaults(k)).map((t) => t.n); } catch { /* listed without readings */ }
        return { k, name: md.name, reads };
      }).filter((m) => !needle || m.name.toLowerCase().includes(needle) || label.toLowerCase().includes(needle) || m.reads.some((r) => r.toLowerCase().includes(needle))),
    })).filter((g) => g.models.length);
  }, [q]);
  const total = groups.reduce((n, g) => n + g.models.length, 0);
  const searching = !!q.trim();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Add twin · {n} machines", { n: total })}</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label={t("Close library")}><X className="w-4 h-4" /></button>
      </div>
      <p className="text-xs text-muted-foreground">{t("Drag a machine onto the 3D view, or click it. Then click the machine and pick its Data Source so live data drives it.")}</p>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search: pump, gearbox, conveyor, temperature…")} aria-label={t("Search machines")} className="pl-7 h-8 text-xs" />
      </div>
      {industry && !searching && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 space-y-1.5">
          <Label className="text-xs font-semibold">{t("Industry template")}</Label>
          <div className="flex gap-1.5">
            <Select value={pack} onValueChange={setPack}>
              <SelectTrigger className="h-8 text-sm flex-1" aria-label={t("Industry")}><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PACKS).map(([k, p]) => <SelectItem key={k} value={k}>{t(p.name)}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" className="h-8" onClick={() => industry.onLoad(pack)}>{t("Load")}</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{PACKS[pack]?.areas.filter((a) => !a.util).map((a) => t(a.name)).join(" → ")}. {t("Loads the whole plant by process; then add or remove single machines below.")}</p>
        </div>
      )}
      {onDetailedSkid && !searching && (
        <button onClick={onDetailedSkid} className="w-full text-left rounded-md border border-primary/40 bg-primary/5 hover:bg-primary/10 px-2.5 py-2">
          <span className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="w-3.5 h-3.5 text-primary" /> {t("Detailed pump skid")}</span>
          <span className="block text-[11px] text-muted-foreground">{t("One pump in close-up with X-ray, heat map and six readings. Opens as its own twin.")}</span>
        </button>
      )}
      {groups.length === 0 && <p className="text-xs text-muted-foreground">{t("No machine matches \"{q}\". Try Generic machine under Other for anything not in the list.", { q })}</p>}
      <div className="space-y-1">
        {groups.map(({ f, label, models }) => {
          const isOpen = searching || open.has(f);
          return (
            <div key={f} className="rounded-md border border-border">
              <button className="w-full flex items-center justify-between px-2 py-1.5 text-sm font-medium" aria-expanded={isOpen}
                onClick={() => setOpen((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; })}>
                <span>{t(label)} <span className="text-xs text-muted-foreground">({models.length})</span></span>
                <ChevronRight className={cn("w-4 h-4 transition-transform", isOpen && "rotate-90")} />
              </button>
              {isOpen && (
                <div className="grid grid-cols-1 gap-1 px-1.5 pb-1.5">
                  {models.map((m) => (
                    <button key={m.k} draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, m.k); e.dataTransfer.setData("text/plain", m.name); e.dataTransfer.effectAllowed = "copy"; }}
                      onClick={() => onAdd(m.k)} title={t("Add {name}", { name: m.name })} data-model={m.k}
                      className="group text-left rounded border border-border/70 hover:border-primary/60 hover:bg-muted px-2 py-1.5 flex gap-1.5 cursor-grab active:cursor-grabbing">
                      <GripVertical className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium">{t(m.name)}</span>
                        {m.reads.length > 0 && <span className="block text-[10.5px] text-muted-foreground truncate">{m.reads.map((r) => t(r)).join(" · ")}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
