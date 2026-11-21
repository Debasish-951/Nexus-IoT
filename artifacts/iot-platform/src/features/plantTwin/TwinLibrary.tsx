import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Box, ChevronDown, ChevronRight, GripVertical, Search, Sparkles, X } from "lucide-react";
import { useModelThumb } from "./engine/thumbs";
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
/** Close-up twins offered on the Asset twin: one machine on its own, ready to link for a POC. */
const DETAILED: { type: string; name: string; about: string }[] = [
  { type: "wind", name: "Detailed wind turbine", about: "One wind turbine in close-up with drivetrain X-ray, yaw, pitch and eleven readings. Opens as its own twin, ready to link for a POC." },
  { type: "solar", name: "Detailed solar PV plant", about: "One solar PV plant in close-up with strings, inverter, transformer and weather station. Opens as its own twin, ready to link for a POC." },
  { type: "bess", name: "Detailed battery storage (BMS)", about: "One battery container in close-up with racks, cell temperatures, state of charge and BMS readings. Opens as its own twin, ready to link for a POC." },
];

/** One machine as a tile of the grid library: 3D thumbnail and name; drag onto the view or click. */
function Tile({ k, name, reads, onAdd }: { k: string; name: string; reads: string[]; onAdd: (type: string) => void }) {
  const t = useT();
  const thumb = useModelThumb(k);
  return (
    <button draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, k); e.dataTransfer.setData("text/plain", name); e.dataTransfer.effectAllowed = "copy"; }}
      onClick={() => onAdd(k)} data-model={k}
      title={reads.length ? `${t(name)}\n${reads.map((r) => t(r)).join(" · ")}` : t(name)}
      className="group flex flex-col items-center justify-start gap-1 rounded-md border border-border bg-card/60 hover:border-primary/60 hover:bg-muted px-1.5 pt-1.5 pb-2 cursor-grab active:cursor-grabbing min-h-[96px]">
      <span className="w-full h-14 flex items-center justify-center">
        {thumb ? <img src={thumb} alt="" draggable={false} className="max-h-14 max-w-full object-contain pointer-events-none" /> : <Box className="w-7 h-7 text-muted-foreground/60" />}
      </span>
      <span className="text-[11.5px] leading-tight text-center line-clamp-2">{t(name)}</span>
    </button>
  );
}

export function TwinLibrary({ onAdd, onClose, onDetailedSkid, onDetailed, industry, layout = "list" }: {
  onAdd: (type: string) => void;
  onClose: () => void;
  /** "grid": tiles with 3D thumbnails in a left-hand panel (default view); "list": the earlier list. */
  layout?: "list" | "grid";
  /** Offered on the Asset twin: the separate, more detailed pump skid. */
  onDetailedSkid?: () => void;
  /** Offered on the Asset twin: open one machine of this type in close-up as its own twin. */
  onDetailed?: (type: string) => void;
  /** 3D Builder: lay out a whole plant from an industry template. */
  industry?: { current: string | null; onLoad: (key: string) => void };
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [pack, setPack] = useState<string>(industry?.current ?? "textile");
  const grid = layout === "grid";
  // The grid starts with every group collapsed (expand on click); the list opens only the first.
  const [open, setOpen] = useState<Set<string>>(() => new Set(grid ? [] : ["rotating"]));
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

  if (grid) return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Machines")} <span className="font-mono">{total}</span></h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label={t("Close library")} title={t("Hide the library")}><X className="w-4 h-4" /></button>
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search: pump, gearbox, meter…")} aria-label={t("Search machines")} className="pl-7 h-8 text-xs" />
      </div>
      {industry && !searching && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-1.5">
          <Label className="text-xs font-semibold">{t("Industry template")}</Label>
          <div className="flex gap-1.5">
            <Select value={pack} onValueChange={setPack}>
              <SelectTrigger className="h-8 text-xs flex-1" aria-label={t("Industry")}><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PACKS).map(([k, p]) => <SelectItem key={k} value={k}>{t(p.name)}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" className="h-8" onClick={() => industry.onLoad(pack)}>{t("Load")}</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{PACKS[pack]?.areas.filter((a) => !a.util).map((a) => t(a.name)).join(" → ")}</p>
        </div>
      )}
      {(onDetailedSkid || onDetailed) && !searching && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Sparkles className="w-3 h-3 text-primary" /> {t("Close-up twins")}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {onDetailedSkid && (
              <button onClick={onDetailedSkid} title={t("One pump in close-up with X-ray, heat map and six readings. Opens as its own twin.")}
                className="rounded-md border border-primary/40 bg-primary/5 hover:bg-primary/10 px-2 py-1.5 text-left text-[11.5px] font-medium leading-tight">{t("Detailed pump skid")}</button>
            )}
            {onDetailed && DETAILED.filter((d) => MODELS[d.type]).map((d) => (
              <button key={d.type} onClick={() => onDetailed(d.type)} title={t(d.about)}
                className="rounded-md border border-primary/40 bg-primary/5 hover:bg-primary/10 px-2 py-1.5 text-left text-[11.5px] font-medium leading-tight">{t(d.name)}</button>
            ))}
          </div>
        </div>
      )}
      {groups.length === 0 && <p className="text-xs text-muted-foreground">{t("No machine matches \"{q}\". Try Generic machine under Other for anything not in the list.", { q })}</p>}
      {groups.map(({ f, label, models }) => {
        const isOpen = searching || open.has(f);
        return (
          <div key={f} className="space-y-1.5">
            <button className="w-full flex items-center gap-1 text-sm font-semibold" aria-expanded={isOpen}
              onClick={() => setOpen((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; })}>
              <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} />
              <span className="flex-1 text-left">{t(label)}</span>
              <span className="text-xs font-normal text-muted-foreground">{models.length}</span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-2 gap-1.5">
                {models.map((m) => <Tile key={m.k} k={m.k} name={m.name} reads={m.reads} onAdd={onAdd} />)}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">{t("Drag a machine onto the 3D view, or click it. Then click the machine and pick its Data Source so live data drives it.")}</p>
    </div>
  );

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
      {onDetailed && !searching && DETAILED.filter((d) => MODELS[d.type]).map((d) => (
        <button key={d.type} onClick={() => onDetailed(d.type)} className="w-full text-left rounded-md border border-primary/40 bg-primary/5 hover:bg-primary/10 px-2.5 py-2">
          <span className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="w-3.5 h-3.5 text-primary" /> {t(d.name)}</span>
          <span className="block text-[11px] text-muted-foreground">{t(d.about)}</span>
        </button>
      ))}
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
