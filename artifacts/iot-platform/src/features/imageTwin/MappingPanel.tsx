import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useMetricChoices } from "@/features/dashboards/useWidgetData";
import { Circle, Hexagon, MapPin, Plus, Search, Square, Trash2, X } from "lucide-react";
import { BEHAVIOURS, type Behaviour, type TwinItem } from "./types";
import { STATUS_COLOR, type ItemView } from "./evaluate";
import type { Part } from "./sanitize";
import type { Limits } from "@/features/plantTwin/shared/alarmLimits";

const NONE = "__none";
export interface AssetChoice { id: string; name: string; identifier?: string | null }

const KIND_ICON = { part: Hexagon, rect: Square, ellipse: Circle, polygon: Hexagon, point: MapPin } as const;

function NumField({ label, value, onChange, disabled, placeholder }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <div className="space-y-0.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input type="number" className="h-7 text-xs" value={value ?? ""} placeholder={placeholder ?? "—"} disabled={disabled}
        onChange={(e) => { const s = e.target.value; const n = Number(s); onChange(s === "" || !Number.isFinite(n) ? undefined : n); }} />
    </div>
  );
}

/** Editor for the selected item: link, behaviours, limits and options. */
export function ItemEditor({ item, view, assets, readOnly, rules, onChange, onDelete, onClose }: {
  item: TwinItem; view?: ItemView; assets: AssetChoice[]; readOnly: boolean; rules?: Limits;
  onChange: (patch: Partial<TwinItem>) => void; onDelete: () => void; onClose: () => void;
}) {
  const t = useT();
  const metrics = useMetricChoices(item.assetId);
  const b = new Set(item.behaviours);
  const toggle = (k: Behaviour, on: boolean) => onChange({ behaviours: on ? [...item.behaviours.filter((x) => x !== k), k] : item.behaviours.filter((x) => x !== k) });
  const needsRange = b.has("fill") || b.has("scale") || b.has("rotate");
  return (
    <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-2.5">
      <div className="flex items-center gap-1.5">
        <Input value={item.name} onChange={(e) => onChange({ name: e.target.value.slice(0, 120) })} disabled={readOnly} className="h-7 text-sm font-medium" aria-label={t("Name")} />
        {!readOnly && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 shrink-0" onClick={onDelete} title={item.kind === "part" ? t("Remove mapping") : t("Delete region")}><Trash2 className="w-3.5 h-3.5" /></Button>}
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onClose} aria-label={t("Close")}><X className="w-3.5 h-3.5" /></Button>
      </div>
      {item.kind === "part" && <p className="text-[11px] text-muted-foreground font-mono truncate">{t("SVG element")} #{item.ref}</p>}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-0.5">
          <Label className="text-[11px] text-muted-foreground">{t("Asset")}</Label>
          <Select value={item.assetId ?? NONE} onValueChange={(v) => onChange({ assetId: v === NONE ? undefined : v, metric: undefined })} disabled={readOnly}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("Not linked")}</SelectItem>
              {item.assetId && !assets.some((a) => a.id === item.assetId) && <SelectItem value={item.assetId}>{t("Asset outside this project")}</SelectItem>}
              {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[11px] text-muted-foreground">{t("Metric")}</Label>
          <Select value={item.metric || NONE} onValueChange={(v) => onChange({ metric: v === NONE ? undefined : v })} disabled={readOnly || !item.assetId}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={t("Metric")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("Pick a metric")}</SelectItem>
              {item.metric && !metrics.some((m) => m.key === item.metric) && <SelectItem value={item.metric}>{item.metric}</SelectItem>}
              {metrics.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">{t("Behaviour (choose one or more)")}</Label>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {BEHAVIOURS.map((x) => (
            <label key={x.k} className={cn("flex items-center gap-1.5 text-xs", x.k === "rotate" && item.kind !== "part" && "opacity-50")} title={t(x.hint)}>
              <Checkbox checked={b.has(x.k)} disabled={readOnly || (x.k === "rotate" && item.kind !== "part")} onCheckedChange={(c) => toggle(x.k, !!c)} />{t(x.label)}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">{t("Unit")}</Label><Input className="h-7 text-xs" value={item.unit ?? ""} maxLength={20} disabled={readOnly} onChange={(e) => onChange({ unit: e.target.value || undefined })} /></div>
        <NumField label={t("Decimals")} value={item.decimals} disabled={readOnly} placeholder={t("auto")} onChange={(v) => onChange({ decimals: v == null ? undefined : Math.max(0, Math.min(6, Math.round(v))) })} />
      </div>
      {(b.has("status") || b.has("blink")) && (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{t("Alarm limits")}</Label>
          {rules ? (
            <p className="text-[11px] rounded bg-muted px-2 py-1">{t("Taken from the alarm rules for this reading:")} {[rules.lowCrit != null && `≤ ${rules.lowCrit} ${t("alarm")}`, rules.low != null && `≤ ${rules.low} ${t("warning")}`, rules.warn != null && `≥ ${rules.warn} ${t("warning")}`, rules.crit != null && `≥ ${rules.crit} ${t("alarm")}`].filter(Boolean).join(", ")}</p>
          ) : (
            <div className="grid grid-cols-4 gap-1">
              <NumField label={t("Low alarm")} value={item.lowCrit} disabled={readOnly} onChange={(v) => onChange({ lowCrit: v })} />
              <NumField label={t("Low warn")} value={item.low} disabled={readOnly} onChange={(v) => onChange({ low: v })} />
              <NumField label={t("High warn")} value={item.warn} disabled={readOnly} onChange={(v) => onChange({ warn: v })} />
              <NumField label={t("High alarm")} value={item.crit} disabled={readOnly} onChange={(v) => onChange({ crit: v })} />
            </div>
          )}
        </div>
      )}
      {needsRange && (
        <div className="grid grid-cols-3 gap-1">
          <NumField label={t("Min")} value={item.min} disabled={readOnly} placeholder="0" onChange={(v) => onChange({ min: v })} />
          <NumField label={t("Max")} value={item.max} disabled={readOnly} placeholder="100" onChange={(v) => onChange({ max: v })} />
          {b.has("rotate") && <NumField label={t("°/s at max")} value={item.speed} disabled={readOnly} placeholder="360" onChange={(v) => onChange({ speed: v })} />}
        </div>
      )}
      {b.has("visible") && <NumField label={t("Shown when value is above")} value={item.threshold} disabled={readOnly} placeholder="0" onChange={(v) => onChange({ threshold: v })} />}
      {b.has("text") && (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{t("Text for values (from this value up)")}</Label>
          {(item.texts ?? []).map((r, i) => (
            <div key={i} className="flex gap-1">
              <Input type="number" className="h-7 w-20 text-xs" value={r.v} disabled={readOnly} onChange={(e) => { const n = Number(e.target.value); const texts = [...(item.texts ?? [])]; texts[i] = { ...r, v: Number.isFinite(n) ? n : 0 }; onChange({ texts }); }} />
              <Input className="h-7 text-xs" value={r.text} maxLength={40} disabled={readOnly} onChange={(e) => { const texts = [...(item.texts ?? [])]; texts[i] = { ...r, text: e.target.value }; onChange({ texts }); }} />
              {!readOnly && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onChange({ texts: (item.texts ?? []).filter((_, j) => j !== i) })}><X className="w-3 h-3" /></Button>}
            </div>
          ))}
          {!readOnly && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange({ texts: [...(item.texts ?? []), { v: (item.texts?.length ?? 0), text: (item.texts?.length ?? 0) === 0 ? t("Stopped") : t("Running") }] })}><Plus className="w-3 h-3 mr-1" />{t("Add text")}</Button>}
        </div>
      )}
      {view && (
        <p className="text-[11px] text-muted-foreground">
          {t("Now")}: <span className="font-mono text-foreground">{view.label ?? (view.v ?? "—")}</span> {view.src !== "none" && `(${t(view.src)})`}
          {view.status !== "none" && <span className="ml-1" style={{ color: STATUS_COLOR[view.status] }}>● {view.status === "ok" ? t("Normal") : view.status === "warn" ? t("Warning") : t("Alarm")}</span>}
        </p>
      )}
    </div>
  );
}

/** Searchable list of everything mappable: mapped items plus unmapped SVG parts. */
export function MappingList({ items, parts, views, assets, selectedId, selectedRef, readOnly, onSelect, onMapPart }: {
  items: TwinItem[]; parts: Part[]; views: Map<string, ItemView>; assets: AssetChoice[]; selectedId: string | null; selectedRef: string | null; readOnly: boolean;
  onSelect: (id: string) => void; onMapPart: (p: Part) => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [unmapped, setUnmapped] = useState(false);
  const names = useMemo(() => new Map(assets.map((a) => [a.id, a.name])), [assets]);
  const mappedRefs = useMemo(() => new Set(items.filter((i) => i.kind === "part").map((i) => i.ref)), [items]);
  const needle = q.trim().toLowerCase();
  const isLinked = (i: TwinItem) => !!(i.assetId && i.metric);
  const rows = items.filter((i) => (!unmapped || !isLinked(i)) && (!needle || i.name.toLowerCase().includes(needle) || (i.ref ?? "").toLowerCase().includes(needle) || (i.metric ?? "").toLowerCase().includes(needle)));
  const free = parts.filter((p) => !mappedRefs.has(p.ref) && (!needle || p.name.toLowerCase().includes(needle) || p.ref.toLowerCase().includes(needle)));
  const linked = items.filter(isLinked).length;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Mapping")}</h3>
        <span className="text-[11px] text-muted-foreground">{t("{a} of {b} linked", { a: linked, b: items.length + parts.filter((p) => !mappedRefs.has(p.ref)).length })}</span>
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search parts, regions, metrics…")} className="pl-7 h-7 text-xs" />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={unmapped} onCheckedChange={setUnmapped} className="scale-75" />{t("Not linked only")}</label>
      <div className="space-y-0.5">
        {rows.map((i) => {
          const v = views.get(i.id); const Icon = KIND_ICON[i.kind];
          return (
            <button key={i.id} onClick={() => onSelect(i.id)} className={cn("w-full flex items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted", selectedId === i.id && "bg-primary/10 ring-1 ring-primary/40")}>
              <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{i.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{isLinked(i) ? `${names.get(i.assetId!) ?? t("Asset outside this project")} · ${i.metric}` : t("Not linked")}</span>
              </span>
              <span className="font-mono tabular-nums shrink-0" style={{ color: v && v.status !== "none" && v.status !== "ok" ? STATUS_COLOR[v.status] : undefined }}>{v?.label ?? (v?.v != null ? v.v.toFixed(1) : "")}</span>
              {v?.src === "demo" && <span className="text-[10px] rounded px-1 bg-amber-500/15 text-amber-600 dark:text-amber-400">{t("demo")}</span>}
            </button>
          );
        })}
        {free.map((p) => (
          <div key={p.ref} className={cn("flex items-center gap-2 rounded px-2 py-1 text-xs", selectedRef === p.ref && "bg-primary/10 ring-1 ring-primary/40")}>
            <Hexagon className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.name}</span>
            {!readOnly && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onMapPart(p)}>{t("Map")}</Button>}
          </div>
        ))}
        {!rows.length && !free.length && <p className="text-xs text-muted-foreground py-2">{needle || unmapped ? t("Nothing matches.") : t("No parts or regions yet.")}</p>}
      </div>
    </div>
  );
}
