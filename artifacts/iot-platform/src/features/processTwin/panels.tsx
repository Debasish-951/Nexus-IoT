import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ChevronRight, Copy, CornerDownRight, MessageSquarePlus, RotateCcw, RotateCw, Search, Trash2, ArrowLeftRight, ImagePlus, X, Lock, FlipHorizontal2, FlipVertical2,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter } from "lucide-react";
import { useMetricChoices } from "@/features/dashboards/useWidgetData";
import { fetchAssetMetrics } from "@/features/plantTwin/api";
import { ReadingTrend } from "@/features/plantTwin/ReadingTrend";
import type { LimitLookup } from "@/features/plantTwin/shared/alarmLimits";
import { GROUPS, SYMBOLS, symDef, SymbolPreview, mineDef, type MineSym } from "./symbols";
import { DRAG_SYMBOL } from "./canvas";
import { isSym, isTag, LINE_TYPES, MEDIA, mediumColour, NOTE_COLOUR, type Binding, type Drive, type Item, type LabelPos, type LimitsCfg, type LineType, type Medium, type NoteItem, type PipeItem, type ProcessScene, type Role, type SymItem, type SymStyle, type TagItem } from "./scene";
import { fmtVal, KIND_UNIT, SCENARIOS, tagKind, driveKind, type Reading, type Runtime, type Scenario } from "./live";

export type Asset = { id: string; name: string };
const NONE = "__none";
const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>;

// ── metric matching ──────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const WORDS: Record<string, string[]> = {
  flow: ["flow", "flowrate"], pressure: ["pressure", "pres"], dp: ["differentialpressure", "dp", "deltap"], temp: ["temperature", "temp"],
  level: ["level"], speed: ["speed", "rpm"], agitator: ["agitator", "agitatorspeed", "speed"], opening: ["opening", "position", "valve"],
  analysis: ["ph", "analysis", "conductivity"], energy: ["energy", "kwh"], value: [],
  cond: ["conductivity", "cond", "tds"], o2: ["oxygen", "o2", "do", "dissolvedoxygen"], freq: ["frequency", "freq", "hz"],
};
/** Best metric of an asset for a reading, from its tag, label and kind; "" when nothing fits. */
export function autoMatch(hints: string[], kind: string, metrics: string[], used = new Set<string>()): string {
  const want = [...hints.map(norm).filter(Boolean), ...(WORDS[kind] ?? [])];
  const bare = (m: string) => norm(m.includes(".") ? m.split(".").slice(1).join(".") : m);
  for (const w of want) { const m = metrics.find((x) => !used.has(x) && (bare(x) === w || norm(x) === w)); if (m) return m; }
  for (const w of want) { if (w.length < 3) continue; const m = metrics.find((x) => !used.has(x) && bare(x).includes(w)); if (m) return m; }
  return "";
}

// ── palette ──────────────────────────────────────────────────────────────────
/** Annotation tiles of the palette (not symbols: they are kept in scene.notes). */
export const NOTE_TILES: { type: string; name: string; icon: React.ReactNode }[] = [
  { type: "note:text", name: "Text", icon: <svg width="36" height="36" viewBox="0 0 36 36"><text x="18" y="25" textAnchor="middle" fill="#cbd5e1" style={{ font: "600 18px system-ui, sans-serif" }}>Aa</text></svg> },
  { type: "note:zone", name: "Area / zone", icon: <svg width="36" height="36" viewBox="0 0 36 36"><rect x="3" y="6" width="30" height="24" rx="3" fill="#38bdf8" fillOpacity=".08" stroke="#38bdf8" strokeDasharray="4 3" /><rect x="6" y="9" width="12" height="3" fill="#38bdf8" /></svg> },
  { type: "note:line", name: "Line", icon: <svg width="36" height="36" viewBox="0 0 36 36"><line x1="4" y1="28" x2="32" y2="8" stroke="#94a3b8" strokeWidth="2" /></svg> },
  { type: "note:arrow", name: "Arrow", icon: <svg width="36" height="36" viewBox="0 0 36 36"><line x1="4" y1="28" x2="28" y2="11" stroke="#94a3b8" strokeWidth="2" /><path d="M32 8 L22 10 L28 17 Z" fill="#94a3b8" /></svg> },
];

export function Palette({ onAdd, mine = [], onUpload, onForget }: {
  onAdd: (type: string) => void;
  /** "My symbols": uploads kept in this browser and those used in the open diagram. */
  mine?: (MineSym & { saved?: boolean })[];
  onUpload?: () => void;
  onForget?: (id: string) => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set<string>());
  const needle = q.trim().toLowerCase();
  const hit = (name: string, extra = "") => !needle || t(name).toLowerCase().includes(needle) || name.toLowerCase().includes(needle) || extra.includes(needle);
  const groups = GROUPS.map(([g, label]) => ({
    g, label,
    list: SYMBOLS.filter((s) => s.group === g && (hit(s.name, s.keywords ?? "") || s.prefix.toLowerCase() === needle)),
  })).filter((x) => x.list.length);
  const mineList = mine.filter((m) => hit(m.name, "my custom upload"));
  const notes = NOTE_TILES.filter((n) => hit(n.name, "annotation note label zone area arrow"));
  const toggle = (g: string) => setOpen((o) => { const n = new Set(o); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const head = (g: string, label: string, count: number) => (
    <button className="w-full flex items-center gap-1 text-xs font-semibold py-1 hover:text-foreground text-muted-foreground" onClick={() => toggle(g)} aria-expanded={!!needle || open.has(g)}>
      <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", (!!needle || open.has(g)) && "rotate-90")} /> {t(label)} <span className="ml-auto font-mono font-normal">{count}</span>
    </button>
  );
  const tile = (type: string, name: string, icon: React.ReactNode, extra?: React.ReactNode) => (
    <div key={type} className="relative group">
      <button draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_SYMBOL, type); e.dataTransfer.effectAllowed = "copy"; }}
        onClick={() => onAdd(type)} title={t("Drag onto the diagram, or click to add")}
        className="w-full flex flex-col items-center gap-0.5 rounded border border-border bg-[#0b1220] hover:border-primary p-1.5 text-[10px] leading-tight text-slate-300">
        {icon}
        <span className="text-center line-clamp-2">{name}</span>
      </button>
      {extra}
    </div>
  );
  return (
    <div className="space-y-2">
      <H3>{t("Symbols")}</H3>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search: pump, valve, FT…")} className="pl-7 h-8 text-xs" aria-label={t("Search symbols")} />
      </div>
      {groups.map(({ g, label, list }) => (
        <div key={g}>
          {head(g, label, list.length)}
          {(!!needle || open.has(g)) && <div className="grid grid-cols-2 gap-1">{list.map((s) => tile(s.type, t(s.name), <SymbolPreview def={s} />))}</div>}
        </div>
      ))}
      {(onUpload || mineList.length > 0) && (
        <div>
          {head("mine", "My symbols", mineList.length)}
          {(!!needle || open.has("mine")) && (
            <div className="space-y-1">
              <div className="grid grid-cols-2 gap-1">
                {mineList.map((m) => tile(`my-${m.id}`, m.name, <SymbolPreview def={mineDef(m)} />,
                  m.saved && onForget ? <button className="absolute top-0.5 right-0.5 hidden group-hover:flex w-4 h-4 items-center justify-center rounded bg-slate-800 text-slate-300 hover:text-red-400" onClick={() => onForget(m.id)} aria-label={t("Remove from My symbols")} title={t("Remove from My symbols (diagrams that use it keep it)")}><X className="w-3 h-3" /></button> : undefined))}
              </div>
              {onUpload && <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={onUpload}><ImagePlus className="w-3.5 h-3.5 mr-1" />{t("Upload SVG or image…")}</Button>}
            </div>
          )}
        </div>
      )}
      {notes.length > 0 && (
        <div>
          {head("notes", "Annotations", notes.length)}
          {(!!needle || open.has("notes")) && <div className="grid grid-cols-2 gap-1">{notes.map((n) => tile(n.type, t(n.name), n.icon))}</div>}
        </div>
      )}
    </div>
  );
}

// ── small editors ────────────────────────────────────────────────────────────
function NumField({ label, value, onChange, disabled, step = "any" }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; disabled?: boolean; step?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="space-y-0.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input type="number" step={step} className="h-7 text-xs" disabled={disabled} value={draft ?? (value ?? "")}
        onChange={(e) => { setDraft(e.target.value); const n = e.target.value === "" ? undefined : Number(e.target.value); if (n === undefined || Number.isFinite(n)) onChange(n); }}
        onBlur={() => setDraft(null)} />
    </div>
  );
}

export function BindingEditor({ value, onChange, assets, hints, kind, readOnly }: {
  value: Binding | undefined; onChange: (b: Binding | undefined) => void; assets: Asset[]; hints: string[]; kind: string; readOnly?: boolean;
}) {
  const t = useT();
  const metrics = useMetricChoices(value?.assetId);
  async function pickAsset(id: string) {
    if (id === NONE) { onChange(undefined); return; }
    const ms = await fetchAssetMetrics(id);
    onChange({ assetId: id, metric: autoMatch(hints, kind, ms) });
  }
  return (
    <div className="grid grid-cols-2 gap-1">
      <Select value={value?.assetId ?? NONE} onValueChange={(v) => void pickAsset(v)} disabled={readOnly}>
        <SelectTrigger className="h-7 text-xs" aria-label={t("Asset")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("Not linked")}</SelectItem>
          {value?.assetId && !assets.some((a) => a.id === value.assetId) && <SelectItem value={value.assetId}>{t("Asset outside this project")}</SelectItem>}
          {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={value?.metric || NONE} onValueChange={(v) => value && onChange({ ...value, metric: v === NONE ? "" : v })} disabled={readOnly || !value?.assetId}>
        <SelectTrigger className="h-7 text-xs" aria-label={t("Metric")}><SelectValue placeholder={t("Metric")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("Pick a metric")}</SelectItem>
          {value?.metric && !metrics.some((m) => m.key === value.metric) && <SelectItem value={value.metric}>{value.metric}</SelectItem>}
          {metrics.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function LimitsEditor({ value, onChange, readOnly, fromRules }: { value: LimitsCfg | undefined; onChange: (l: LimitsCfg | undefined) => void; readOnly?: boolean; fromRules: boolean }) {
  const t = useT();
  const set = (k: keyof LimitsCfg, v: number | undefined) => { const n = { ...(value ?? {}), [k]: v }; onChange(Object.values(n).some((x) => x !== undefined) ? n : undefined); };
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-4 gap-1">
        <NumField label={t("Alarm low")} value={value?.lowCrit} onChange={(v) => set("lowCrit", v)} disabled={readOnly} />
        <NumField label={t("Warn low")} value={value?.low} onChange={(v) => set("low", v)} disabled={readOnly} />
        <NumField label={t("Warn high")} value={value?.warn} onChange={(v) => set("warn", v)} disabled={readOnly} />
        <NumField label={t("Alarm high")} value={value?.crit} onChange={(v) => set("crit", v)} disabled={readOnly} />
      </div>
      {fromRules && <p className="text-[11px] text-sky-600 dark:text-sky-400">{t("Alarm rules exist for this reading; their limits are used instead.")}</p>}
    </div>
  );
}

const SrcBadge = ({ r }: { r: Reading }) => {
  const t = useT();
  if (r.src === "none") return <span className="text-muted-foreground">{t("not linked")}</span>;
  return <span className={cn("ml-1 text-[10px] rounded px-1", r.src === "live" ? "bg-green-500/15 text-green-600 dark:text-green-400" : r.src === "history" ? "bg-sky-500/15 text-sky-600 dark:text-sky-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400")}>{t(r.src)}</span>;
};
const stCls = (s: string) => (s === "crit" ? "text-red-500" : s === "warn" ? "text-amber-500" : "");

const ROLE_LABEL: Record<Role, string> = { level: "Level (fills the vessel)", speed: "Speed / running (turns the rotor)", opening: "Valve opening", temperature: "Temperature (heat colour)", value: "Value (shown on the instrument)" };
const ROLE_DEF: Record<Role, [number, number]> = { level: [0, 100], speed: [0, 1500], opening: [0, 100], temperature: [20, 100], value: [0, 100] };

function DriveEditor({ role, sym, drive, onDrive, assets, rt, limitsOf, readOnly }: {
  role: Role; sym: SymItem; drive: Drive | undefined; onDrive: (d: Drive | undefined) => void; assets: Asset[]; rt: Runtime; limitsOf: LimitLookup; readOnly: boolean;
}) {
  const t = useT();
  const kind = driveKind(sym, role);
  const r = rt.driveReading(sym, role);
  const [dmin, dmax] = role === "speed" && kind === "agitator" ? [0, 150] : ROLE_DEF[role];
  const set = (patch: Partial<Drive>) => onDrive({ ...(drive ?? {}), ...patch });
  return (
    <div className="rounded-md border border-border p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{t(ROLE_LABEL[role])}</span>
        <span className={cn("font-mono tabular-nums", stCls(r.status))}>{r.src !== "none" && fmtVal(r.v, drive?.unit, drive?.decimals, kind)}<SrcBadge r={r} /></span>
      </div>
      <BindingEditor value={drive?.bind} onChange={(b) => set({ bind: b })} assets={assets} hints={[sym.tag, sym.label, role]} kind={kind} readOnly={readOnly} />
      <div className="grid grid-cols-2 gap-1">
        <NumField label={t("Range from")} value={drive?.min ?? dmin} onChange={(v) => set({ min: v })} disabled={readOnly} />
        <NumField label={t("Range to")} value={drive?.max ?? dmax} onChange={(v) => set({ max: v })} disabled={readOnly} />
      </div>
      {role === "value" && (
        <div className="grid grid-cols-2 gap-1">
          <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">{t("Unit")}</Label><Input className="h-7 text-xs" value={drive?.unit ?? ""} placeholder={KIND_UNIT[kind]} onChange={(e) => set({ unit: e.target.value || undefined })} disabled={readOnly} maxLength={20} /></div>
          <NumField label={t("Decimals")} value={drive?.decimals} onChange={(v) => set({ decimals: v === undefined ? undefined : Math.max(0, Math.min(6, Math.round(v))) })} disabled={readOnly} step="1" />
        </div>
      )}
      <LimitsEditor value={drive?.limits} onChange={(l) => set({ limits: l })} readOnly={readOnly} fromRules={!!limitsOf(drive?.bind?.assetId, drive?.bind?.metric)} />
    </div>
  );
}

// ── properties of the selection ──────────────────────────────────────────────
export interface PanelActions {
  update: (id: string, fn: (it: any) => any, key?: string) => void;
  remove: () => void;
  rotate: (dir: 1 | -1) => void;
  duplicate: () => void;
  addTag: (sym: SymItem, role?: Role) => void;
  flip: (axis: "x" | "y") => void;
  align: (mode: AlignMode) => void;
  lock: (locked: boolean) => void;
}
export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hdist" | "vdist";
const ALIGN: [AlignMode, string, React.ComponentType<{ className?: string }>][] = [
  ["left", "Align left", AlignStartVertical], ["hcenter", "Align centres", AlignCenterVertical], ["right", "Align right", AlignEndVertical],
  ["top", "Align top", AlignStartHorizontal], ["vcenter", "Align middles", AlignCenterHorizontal], ["bottom", "Align bottom", AlignEndHorizontal],
  ["hdist", "Distribute horizontally", AlignHorizontalDistributeCenter], ["vdist", "Distribute vertically", AlignVerticalDistributeCenter],
];

function LockSwitch({ locked, onChange, readOnly }: { locked?: boolean; onChange: (v: boolean) => void; readOnly?: boolean }) {
  const t = useT();
  return <label className="flex items-center gap-1.5 text-xs" title={t("A locked item cannot be moved, resized or deleted")}><Switch checked={!!locked} onCheckedChange={onChange} disabled={readOnly} className="scale-90" /><Lock className="w-3 h-3" />{t("Lock")}</label>;
}
function ColourField({ label, value, fallback, onChange, readOnly }: { label: string; value?: string; fallback: string; onChange: (v: string | undefined) => void; readOnly?: boolean }) {
  const t = useT();
  return (
    <div className="space-y-0.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        <input type="color" value={value ?? fallback} onChange={(e) => onChange(e.target.value)} disabled={readOnly} aria-label={label} className="h-7 w-10 rounded border border-border bg-transparent p-0.5 cursor-pointer disabled:cursor-default" />
        {value && !readOnly && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onChange(undefined)}>{t("Default")}</Button>}
      </div>
    </div>
  );
}
const LABEL_POS: [LabelPos, string][] = [["below", "Below"], ["above", "Above"], ["left", "Left"], ["right", "Right"], ["hidden", "Hidden"]];

export function SelectionPanel({ scene, sel, assets, rt, limitsOf, readOnly, act }: {
  scene: ProcessScene; sel: Set<string>; assets: Asset[]; rt: Runtime; limitsOf: LimitLookup; readOnly: boolean; act: PanelActions;
}) {
  const t = useT();
  const items = scene.items.filter((i) => sel.has(i.id));
  const pipes = scene.pipes.filter((p) => sel.has(p.id));
  const notes = (scene.notes ?? []).filter((n) => sel.has(n.id));
  if (items.length + pipes.length + notes.length > 1) {
    const boxes = items.length + notes.length;
    const anyLocked = [...items, ...notes].some((x) => x.locked);
    return (
      <div className="space-y-3">
        <H3>{t("{n} elements selected", { n: items.length + pipes.length + notes.length })}</H3>
        {!readOnly && (
          <>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" className="h-7" onClick={() => act.rotate(1)}><RotateCw className="w-3.5 h-3.5 mr-1" />{t("Rotate")}</Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => act.flip("x")} title={t("Flip horizontally")}><FlipHorizontal2 className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => act.flip("y")} title={t("Flip vertically")}><FlipVertical2 className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" className="h-7" onClick={act.duplicate}><Copy className="w-3.5 h-3.5 mr-1" />{t("Duplicate")}</Button>
              <Button size="sm" variant="outline" className="h-7 text-red-500" onClick={act.remove}><Trash2 className="w-3.5 h-3.5 mr-1" />{t("Delete")}</Button>
            </div>
            {boxes > 1 && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t("Align and distribute")}</Label>
                <div className="flex flex-wrap gap-1">
                  {ALIGN.filter(([m]) => boxes > 2 || (m !== "hdist" && m !== "vdist")).map(([m, label, Icon]) => (
                    <Button key={m} size="icon" variant="outline" className="h-7 w-7" onClick={() => act.align(m)} title={t(label)} aria-label={t(label)}><Icon className="w-3.5 h-3.5" /></Button>
                  ))}
                </div>
              </div>
            )}
            <LockSwitch locked={anyLocked} onChange={act.lock} />
          </>
        )}
      </div>
    );
  }
  const it = items[0]; const pipe = pipes[0]; const note = notes[0];
  if (note) return <NotePanel n={note} readOnly={readOnly} act={act} />;
  if (it && isSym(it)) return <SymPanel s={it} assets={assets} rt={rt} limitsOf={limitsOf} readOnly={readOnly} act={act} />;
  if (it && isTag(it)) return <TagPanel tg={it} scene={scene} assets={assets} rt={rt} limitsOf={limitsOf} readOnly={readOnly} act={act} />;
  if (pipe) return <PipePanel p={pipe} assets={assets} rt={rt} limitsOf={limitsOf} readOnly={readOnly} act={act} />;
  void t;
  return null;
}

function TextField({ label, value, onChange, readOnly, max = 80 }: { label: string; value: string; onChange: (v: string) => void; readOnly?: boolean; max?: number }) {
  return (
    <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">{label}</Label><Input className="h-7 text-xs" value={value} onChange={(e) => onChange(e.target.value)} disabled={readOnly} maxLength={max} /></div>
  );
}

function SymPanel({ s, assets, rt, limitsOf, readOnly, act }: { s: SymItem; assets: Asset[]; rt: Runtime; limitsOf: LimitLookup; readOnly: boolean; act: PanelActions }) {
  const t = useT();
  const def = symDef(s.type);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SymbolPreview def={def} size={40} />
        <div className="min-w-0"><H3>{t(def.name)}</H3><p className="text-sm font-semibold truncate">{s.tag || "—"}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <TextField label={t("Tag")} value={s.tag} onChange={(v) => act.update(s.id, (x) => ({ ...x, tag: v }), "tag")} readOnly={readOnly} max={40} />
        <TextField label={t("Label")} value={s.label} onChange={(v) => act.update(s.id, (x) => ({ ...x, label: v }), "label")} readOnly={readOnly} />
      </div>
      {!readOnly && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground"><span>{t("Size")}</span><span className="font-mono">{Math.round(s.scale * 100)}%</span></div>
          <Slider min={0.3} max={4} step={0.05} value={[s.scale]} onValueChange={([v]) => act.update(s.id, (x) => ({ ...x, scale: v }), "scale")} />
          <div className="flex flex-wrap gap-1 pt-1">
            <Button size="sm" variant="outline" className="h-7" onClick={() => act.rotate(-1)} title={t("Rotate left")}><RotateCcw className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="outline" className="h-7" onClick={() => act.rotate(1)} title={t("Rotate right (R)")}><RotateCw className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="outline" className={cn("h-7", s.flipX && "border-primary")} onClick={() => act.flip("x")} title={t("Flip horizontally")}><FlipHorizontal2 className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="outline" className={cn("h-7", s.flipY && "border-primary")} onClick={() => act.flip("y")} title={t("Flip vertically")}><FlipVertical2 className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="outline" className="h-7" onClick={act.duplicate}><Copy className="w-3.5 h-3.5 mr-1" />{t("Duplicate")}</Button>
            {!s.locked && <Button size="sm" variant="outline" className="h-7 text-red-500" onClick={act.remove}><Trash2 className="w-3.5 h-3.5 mr-1" />{t("Delete")}</Button>}
          </div>
          <div className="pt-1"><LockSwitch locked={s.locked} onChange={act.lock} /></div>
        </div>
      )}
      <StyleEditor s={s} readOnly={readOnly} onStyle={(st) => act.update(s.id, (x: SymItem) => ({ ...x, style: { ...(x.style ?? {}), ...st } }), "style")} />
      {def.roles.length > 0 ? (
        <div className="space-y-2">
          <H3>{t("Live behaviour")}</H3>
          {def.roles.map((role) => (
            <DriveEditor key={role} role={role} sym={s} drive={s.drives?.[role]} assets={assets} rt={rt} limitsOf={limitsOf} readOnly={readOnly}
              onDrive={(d) => act.update(s.id, (x: SymItem) => ({ ...x, drives: { ...(x.drives ?? {}), [role]: d } }), `drive-${role}`)} />
          ))}
        </div>
      ) : <p className="text-xs text-muted-foreground">{t("This symbol has no live behaviour. Attach a tag bubble to show a reading next to it.")}</p>}
      {!readOnly && (
        <Button size="sm" variant="outline" className="w-full h-8" onClick={() => act.addTag(s, def.roles[0])}><MessageSquarePlus className="w-4 h-4 mr-1" />{t("Add tag bubble")}</Button>
      )}
    </div>
  );
}

/** Colours and label placement of one symbol. */
function StyleEditor({ s, readOnly, onStyle }: { s: SymItem; readOnly: boolean; onStyle: (st: Partial<SymStyle>) => void }) {
  const t = useT();
  const st = s.style ?? {};
  const isMine = symDef(s.type).group === "mine";
  return (
    <div className="rounded-md border border-border p-2 space-y-2">
      <span className="text-xs font-medium">{t("Style")}</span>
      {!isMine && (
        <div className="grid grid-cols-2 gap-1.5">
          <ColourField label={t("Fill colour")} value={st.fill} fallback="#1a2433" onChange={(v) => onStyle({ fill: v })} readOnly={readOnly} />
          <ColourField label={t("Line colour")} value={st.stroke} fallback="#5a6b85" onChange={(v) => onStyle({ stroke: v })} readOnly={readOnly} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5 items-end">
        <div className="space-y-0.5">
          <Label className="text-[11px] text-muted-foreground">{t("Label position")}</Label>
          <Select value={st.labelPos ?? (symDef(s.type).group === "custom" ? "hidden" : "below")} onValueChange={(v) => onStyle({ labelPos: v as LabelPos })} disabled={readOnly}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{LABEL_POS.map(([k, l]) => <SelectItem key={k} value={k}>{t(l)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-1.5 text-xs pb-1"><Switch checked={!st.hideTag} onCheckedChange={(v) => onStyle({ hideTag: v ? undefined : true })} disabled={readOnly} className="scale-90" />{t("Show tag number")}</label>
      </div>
    </div>
  );
}

function NotePanel({ n, readOnly, act }: { n: NoteItem; readOnly: boolean; act: PanelActions }) {
  const t = useT();
  const up = (patch: Partial<NoteItem>, key: string) => act.update(n.id, (x) => ({ ...x, ...patch }), key);
  const title = n.kind === "zone" ? t("Area / zone") : n.kind === "line" ? (n.arrow ? t("Arrow") : t("Line")) : t("Text");
  return (
    <div className="space-y-3">
      <H3>{title}</H3>
      {n.kind !== "line" && (
        <div className="space-y-0.5">
          <Label className="text-[11px] text-muted-foreground">{n.kind === "zone" ? t("Title") : t("Text")}</Label>
          {n.kind === "text"
            ? <textarea className="w-full min-h-[64px] rounded-md border border-input bg-transparent px-2 py-1 text-xs" value={n.text ?? ""} onChange={(e) => up({ text: e.target.value.slice(0, 300) }, "text")} disabled={readOnly} />
            : <Input className="h-7 text-xs" value={n.text ?? ""} onChange={(e) => up({ text: e.target.value }, "text")} disabled={readOnly} maxLength={80} />}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5 items-end">
        <ColourField label={t("Colour")} value={n.color} fallback={NOTE_COLOUR[n.kind]} onChange={(v) => up({ color: v }, "color")} readOnly={readOnly} />
        {n.kind === "text" && <NumField label={t("Text size")} value={n.size ?? 14} onChange={(v) => up({ size: v === undefined ? undefined : Math.max(8, Math.min(72, Math.round(v))) }, "size")} disabled={readOnly} step="1" />}
      </div>
      {n.kind === "line" && (
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!n.arrow} onCheckedChange={(v) => up({ arrow: v || undefined }, "arrow")} disabled={readOnly} className="scale-90" />{t("Arrow head")}</label>
          <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!n.dashed} onCheckedChange={(v) => up({ dashed: v || undefined }, "dashed")} disabled={readOnly} className="scale-90" />{t("Dashed")}</label>
        </div>
      )}
      {n.kind === "zone" && <p className="text-[11px] text-muted-foreground">{t("Drag the corner handle to resize. Zones are drawn behind the symbols.")}</p>}
      {!readOnly && (
        <div className="flex items-center gap-2 flex-wrap">
          <LockSwitch locked={n.locked} onChange={act.lock} />
          <Button size="sm" variant="outline" className="h-7" onClick={act.duplicate}><Copy className="w-3.5 h-3.5 mr-1" />{t("Duplicate")}</Button>
          {!n.locked && <Button size="sm" variant="outline" className="h-7 text-red-500" onClick={act.remove}><Trash2 className="w-3.5 h-3.5 mr-1" />{t("Delete")}</Button>}
        </div>
      )}
    </div>
  );
}

function TagPanel({ tg, scene, assets, rt, limitsOf, readOnly, act }: { tg: TagItem; scene: ProcessScene; assets: Asset[]; rt: Runtime; limitsOf: LimitLookup; readOnly: boolean; act: PanelActions }) {
  const t = useT();
  const r = rt.tagReading(tg);
  const kind = tagKind(tg);
  const targets = [
    ...scene.items.filter(isSym).map((s) => ({ id: s.id, n: [s.tag, s.label].filter(Boolean).join(" ") || t(symDef(s.type).name) })),
    ...scene.pipes.map((p) => ({ id: p.id, n: `${t("Pipe")} ${p.label ?? p.id.slice(-4)}` })),
  ];
  const up = (patch: Partial<TagItem>, key: string) => act.update(tg.id, (x) => ({ ...x, ...patch }), key);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <H3>{t("Tag bubble")}</H3>
        <span className={cn("font-mono text-sm tabular-nums", stCls(r.status))}>{r.src !== "none" && fmtVal(r.v, tg.unit || undefined, tg.decimals, kind)}<SrcBadge r={r} /></span>
      </div>
      <ReadingTrend value={r.v} source={r.src === "history" ? "live" : r.src} status={r.status} assetId={tg.bind?.assetId} metric={tg.bind?.metric} />
      <div className="grid grid-cols-2 gap-1.5">
        <TextField label={t("Tag")} value={tg.tag} onChange={(v) => up({ tag: v }, "tag")} readOnly={readOnly} max={40} />
        <TextField label={t("Label")} value={tg.label} onChange={(v) => up({ label: v }, "label")} readOnly={readOnly} />
        <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">{t("Unit")}</Label><Input className="h-7 text-xs" value={tg.unit ?? ""} placeholder={KIND_UNIT[kind]} onChange={(e) => up({ unit: e.target.value }, "unit")} disabled={readOnly} maxLength={20} /></div>
        <NumField label={t("Decimals")} value={tg.decimals} onChange={(v) => up({ decimals: v === undefined ? undefined : Math.max(0, Math.min(6, Math.round(v))) }, "dec")} disabled={readOnly} step="1" />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">{t("Reading")}</Label>
        <BindingEditor value={tg.bind} onChange={(b) => up({ bind: b }, "bind")} assets={assets} hints={[tg.tag, tg.label]} kind={kind} readOnly={readOnly} />
      </div>
      <LimitsEditor value={tg.limits} onChange={(l) => up({ limits: l }, "limits")} readOnly={readOnly} fromRules={!!limitsOf(tg.bind?.assetId, tg.bind?.metric)} />
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-0.5">
          <Label className="text-[11px] text-muted-foreground">{t("Belongs to")}</Label>
          <Select value={tg.attach ?? NONE} onValueChange={(v) => up({ attach: v === NONE ? null : v }, "attach")} disabled={readOnly}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>{t("Nothing")}</SelectItem>{targets.map((x) => <SelectItem key={x.id} value={x.id}>{x.n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[11px] text-muted-foreground">{t("Demo shows")}</Label>
          <Select value={kind} onValueChange={(v) => up({ demoKind: v }, "demo")} disabled={readOnly}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.keys(KIND_UNIT).map((k) => <SelectItem key={k} value={k}>{t(KIND_NAME[k] ?? k)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {!readOnly && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground"><span>{t("Width")}</span><span className="font-mono">{tg.w ?? 120}</span></div>
          <Slider min={80} max={260} step={10} value={[tg.w ?? 120]} onValueChange={([v]) => up({ w: v }, "w")} />
          <div className="flex gap-1 pt-1 items-center flex-wrap">
            <Button size="sm" variant="outline" className="h-7" onClick={act.duplicate}><Copy className="w-3.5 h-3.5 mr-1" />{t("Duplicate")}</Button>
            {!tg.locked && <Button size="sm" variant="outline" className="h-7 text-red-500" onClick={act.remove}><Trash2 className="w-3.5 h-3.5 mr-1" />{t("Delete")}</Button>}
            <LockSwitch locked={tg.locked} onChange={act.lock} />
          </div>
        </div>
      )}
    </div>
  );
}
export const KIND_NAME: Record<string, string> = { flow: "Flow", pressure: "Pressure", dp: "Differential pressure", temp: "Temperature", level: "Level", speed: "Speed", agitator: "Agitator speed", opening: "Valve opening", analysis: "Analysis (pH)", energy: "Energy", cond: "Conductivity", o2: "Dissolved oxygen", freq: "Frequency", value: "Other value" };

function PipePanel({ p, assets, rt, limitsOf, readOnly, act }: { p: PipeItem; assets: Asset[]; rt: Runtime; limitsOf: LimitLookup; readOnly: boolean; act: PanelActions }) {
  const t = useT();
  const up = (patch: Partial<PipeItem>, key: string) => act.update(p.id, (x) => ({ ...x, ...patch }), key);
  const signal = p.line === "signal" || p.line === "electrical";
  const r = signal ? null : rt.read(p.flow?.bind, "flow", `${p.id}|flow`, p.flow?.limits);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <H3>{t("Pipe")}</H3>
        {r && <span className={cn("font-mono text-sm tabular-nums", stCls(r.status))}>{r.src !== "none" && fmtVal(r.v, undefined, undefined, "flow")}<SrcBadge r={r} /></span>}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-0.5">
          <Label className="text-[11px] text-muted-foreground">{t("Line type")}</Label>
          <Select value={p.line} onValueChange={(v) => up({ line: v as LineType }, "line")} disabled={readOnly}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{LINE_TYPES.map(([k, l]) => <SelectItem key={k} value={k}>{t(l)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[11px] text-muted-foreground">{t("Medium")}</Label>
          <Select value={p.medium} onValueChange={(v) => up({ medium: v as Medium }, "medium")} disabled={readOnly || signal}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{MEDIA.map(([k, l, c]) => <SelectItem key={k} value={k}><span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: c }} />{t(l)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <TextField label={t("Label")} value={p.label ?? ""} onChange={(v) => up({ label: v || undefined }, "label")} readOnly={readOnly} />
      <div className="grid grid-cols-2 gap-1.5 items-end">
        {!signal ? <ColourField label={t("Colour")} value={p.color} fallback={mediumColour(p.medium)} onChange={(v) => up({ color: v }, "color")} readOnly={readOnly} /> : <span />}
        <div className="space-y-0.5">
          <Label className="text-[11px] text-muted-foreground">{t("Label position")}</Label>
          <Select value={p.labelPos ?? "above"} onValueChange={(v) => up({ labelPos: v as PipeItem["labelPos"] }, "lpos")} disabled={readOnly}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{LABEL_POS.filter(([k]) => k === "above" || k === "below" || k === "hidden").map(([k, l]) => <SelectItem key={k} value={k}>{t(l)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs"><Switch checked={p.arrows} onCheckedChange={(v) => up({ arrows: v }, "arrows")} disabled={readOnly} className="scale-90" />{t("Flow arrows")}</label>
        {!readOnly && <Button size="sm" variant="outline" className="h-7" onClick={() => up({ a: p.b, b: p.a, mid: [...p.mid].reverse() }, "rev")}><ArrowLeftRight className="w-3.5 h-3.5 mr-1" />{t("Reverse")}</Button>}
      </div>
      {!signal && (
        <div className="rounded-md border border-border p-2 space-y-1.5">
          <span className="text-xs font-medium">{t("Flow (moves the dashes; stopped at 0)")}</span>
          <BindingEditor value={p.flow?.bind} onChange={(b) => up({ flow: { ...(p.flow ?? {}), bind: b } }, "flowbind")} assets={assets} hints={[p.label ?? "", "flow"]} kind="flow" readOnly={readOnly} />
          <div className="grid grid-cols-2 gap-1">
            <NumField label={t("Range from")} value={p.flow?.min ?? 0} onChange={(v) => up({ flow: { ...(p.flow ?? {}), min: v } }, "fmin")} disabled={readOnly} />
            <NumField label={t("Full speed at")} value={p.flow?.max ?? 150} onChange={(v) => up({ flow: { ...(p.flow ?? {}), max: v } }, "fmax")} disabled={readOnly} />
          </div>
          <LimitsEditor value={p.flow?.limits} onChange={(l) => up({ flow: { ...(p.flow ?? {}), limits: l } }, "flim")} readOnly={readOnly} fromRules={!!limitsOf(p.flow?.bind?.assetId, p.flow?.bind?.metric)} />
        </div>
      )}
      {!readOnly && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground flex items-start gap-1"><CornerDownRight className="w-3 h-3 mt-0.5 shrink-0" />{t("Double-click the pipe to add a bend; drag the white points to reshape; double-click a point to remove it.")}</p>
          <Button size="sm" variant="outline" className="h-7 text-red-500" onClick={act.remove}><Trash2 className="w-3.5 h-3.5 mr-1" />{t("Delete")}</Button>
        </div>
      )}
    </div>
  );
}

// ── overview: scenario, link-all and all readings ────────────────────────────
export function ReadingsPanel({ scene, assets, rt, readOnly, demo, scenario, setScenario, onLinkAll, onBindTag, onSelect }: {
  scene: ProcessScene; assets: Asset[]; rt: Runtime; readOnly: boolean; demo: boolean; scenario: Scenario; setScenario: (s: Scenario) => void;
  onLinkAll: (assetId: string) => void; onBindTag: (id: string, b: Binding | undefined) => void; onSelect: (id: string) => void;
}) {
  const t = useT();
  const tags = useMemo(() => scene.items.filter(isTag), [scene.items]);
  return (
    <div className="space-y-5">
      {demo && (
        <div className="space-y-2">
          <H3>{t("Demo scenario")}</H3>
          <div className="grid grid-cols-2 gap-1.5">
            {SCENARIOS.map(([s, l]) => <Button key={s} size="sm" variant={scenario === s ? "default" : "outline"} className="h-8 text-xs justify-start" onClick={() => setScenario(s)}>{t(l)}</Button>)}
          </div>
          <p className="text-xs text-muted-foreground">{t("Affects demo values only. Linked readings always show plant data.")}</p>
        </div>
      )}
      <div className="space-y-2">
        <H3>{t("Link all readings to one asset")}</H3>
        <Select value="" onValueChange={(v) => onLinkAll(v)} disabled={readOnly}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Choose an asset…")} /></SelectTrigger>
          <SelectContent>{assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("Tag bubbles, symbol behaviours and pipe flows are matched to the asset's metrics by tag and name. Change any match afterwards.")}</p>
      </div>
      <div>
        <H3>{t("Readings")}</H3>
        {!tags.length && <p className="text-xs text-muted-foreground mt-1">{t("No tag bubbles yet. Select a symbol and use Add tag bubble.")}</p>}
        {tags.map((tg) => {
          const r = rt.tagReading(tg);
          return (
            <div key={tg.id} className="py-2 border-b border-border/60 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <button className="truncate text-left hover:underline" onClick={() => onSelect(tg.id)}><span className="font-mono text-[11px] mr-1.5">{tg.tag}</span><span className="text-muted-foreground">{tg.label}</span></button>
                <span className={cn("font-mono tabular-nums shrink-0", stCls(r.status))}>{r.src !== "none" && fmtVal(r.v, tg.unit || undefined, tg.decimals, tagKind(tg))}<SrcBadge r={r} /></span>
              </div>
              <ReadingTrend value={r.v} source={r.src === "history" ? "live" : r.src} status={r.status} assetId={tg.bind?.assetId} metric={tg.bind?.metric} />
              <BindingEditor value={tg.bind} onChange={(b) => onBindTag(tg.id, b)} assets={assets} hints={[tg.tag, tg.label]} kind={tagKind(tg)} readOnly={readOnly} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { Item };
