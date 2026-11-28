import { useEffect, useRef, useState } from "react";
import { Clock, Move, Image as ImageIcon, Plus, Trash2, X, Settings2, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useListAssets } from "@workspace/api-client-react";
import { offeredWidgetCategories, PALETTE, SERIES_COLORS, widgetDef, CARD_ICONS, CARD_ICON_KEYS, GROUPED_TYPES, MULTI_SERIES_TYPES, GAUGE_STYLES } from "./registry";
import { useMetricChoices } from "./useWidgetData";
import { ColorField } from "./ColorField";
import { AssetPickerDialog } from "./AssetPickerDialog";
import { AttributeSelect } from "./AttributeSelect";
import { CombinedFields } from "./CombinedFields";
import { ProFields, PRO_SINGLE_TYPES, PRO_SCOPE_TYPES, proDef } from "./pro";
import { SitesMapFields, LiveTwinFields } from "@/features/sitesMap/widgetFields";
import { useCurrentUser } from "@/contexts/UserContext";

// Gauge/Thermometer/Tank/Progress/Battery moved from single assetId+tag binding
// to the grouped `metrics` model (same as Card) — their editor lives in the
// GROUPED_TYPES block below, not here. Status/Traffic were never bindable —
// they pick a state, still per-metric now instead of once for the whole widget.
// Sourced from the registry rather than restated, so a chart type added to the
// catalogue cannot end up rendering correctly while offering no way to bind data
// to it — which is what a second hand-maintained copy of this list invites.
// Sparkline and Heatmap read the single primary attribute; Scatter reads its
// X/Y pair (both editors live in the Data block below). The Alarm Table is not
// here: it lists alarms, not an attribute, and has its own asset filter below.
// Pro widgets with one Data Source + Attribute join the same editor; their
// multi-series siblings are already in MULTI_SERIES_TYPES.
const BINDABLE = new Set([...MULTI_SERIES_TYPES, "table", "events", "sparkline", "scatter", "heatmap", ...PRO_SINGLE_TYPES]);
// Pro widgets that take an optional asset (that asset and everything below it),
// like the Alarm Table, rather than an attribute.
const SCOPE_TYPES = new Set(PRO_SCOPE_TYPES);
const MULTI_SERIES = new Set(MULTI_SERIES_TYPES);
// Control limits are drawn against a vertical value axis, so they are offered
// only where one exists. Horizontal Bar has its value axis on the bottom, and
// Radar/Radial have no cartesian axes at all — a UCL line means nothing there.
const SPC_TYPES = new Set(["line", "area", "bar", "stackbar", "step", "stackarea", "combo"]);
const GROUPED_SET = new Set<string>(GROUPED_TYPES);
// Within GROUPED_TYPES, these two have no numeric value — a per-tile state pick
// instead of a Data Source/Attribute binding.
const STATE_TYPES = new Set(["status", "traffic"]);
// These read a value against a 0..max scale — the rest (status/traffic, and
// Card's plain text) don't.
const SCALED_TYPES = new Set(["gauge", "thermometer", "tank", "battery"]);
// Value-driven color coding (statusColor's critical/warn thresholds) applies to
// every numeric mark, progress included — it just has no separate "max" since
// it's always 0-100%.
const THRESHOLD_TYPES = new Set(["gauge", "thermometer", "tank", "battery", "progress"]);

/**
 * Widget colour swatches. The first five are the validated categorical series
 * colours (see SERIES_COLORS) so the obvious choice is also the correct one; the
 * rest are extra options, since a colour the user picks deliberately is theirs to
 * pick. The old list opened with amber and red, which quietly encouraged painting
 * ordinary series in alarm colours.
 */
const COLOR_SWATCHES = [...SERIES_COLORS, "#0D9488", "#D946EF", "#7C3AED", "#0EA5E9", "#A16207", "#DB2777", PALETTE.neutral];

/** Control-limit lines. Status colours ARE right here — a UCL/LCL breach is a state. */
const SPC_COLORS = [PALETTE.warning, PALETTE.critical, PALETTE.success, PALETTE.primary, PALETTE.neutral];

interface Overlay { assetId?: string; tag?: string; color?: string; label?: string; unit?: string }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

function Note({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
      <p>{children}</p>
    </div>
  );
}

function SpcRow({ label, valueKey, colorKey, styleKey, draft, set }: {
  label: string; valueKey: string; colorKey: string; styleKey: string;
  draft: Record<string, any>; set: (patch: Record<string, any>) => void;
}) {
  const val = draft[valueKey] ?? "";
  const color = draft[colorKey] ?? PALETTE.critical;
  const style = draft[styleKey] ?? "dashed";
  return (
    <div className="rounded-md border border-border p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium w-8 shrink-0" style={{ color }}>{label}</span>
        <Input type="number" value={val} onChange={(e) => set({ [valueKey]: e.target.value })} className="h-7 text-xs flex-1" placeholder="—" />
        {val !== "" && <button onClick={() => set({ [valueKey]: "" })} className="text-muted-foreground hover:text-foreground text-xs px-1">✕</button>}
      </div>
      {val !== "" && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] w-10 shrink-0 text-muted-foreground">Color</span>
            {SPC_COLORS.map((sc) => (
              <button key={sc} onClick={() => set({ [colorKey]: sc })} className="w-4 h-4 rounded-full border-2 shrink-0" style={{ background: sc, borderColor: color === sc ? "#1e293b" : "transparent" }} />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] w-10 shrink-0 text-muted-foreground">Style</span>
            <button onClick={() => set({ [styleKey]: "dashed" })} className={cn("px-2 py-0.5 rounded text-[10px] border", style === "dashed" ? "border-primary text-primary" : "border-border text-muted-foreground")}>Dashed</button>
            <button onClick={() => set({ [styleKey]: "solid" })} className={cn("px-2 py-0.5 rounded text-[10px] border", style === "solid" ? "border-primary text-primary" : "border-border text-muted-foreground")}>Solid</button>
          </div>
        </>
      )}
    </div>
  );
}

// One overlay series row — its own asset + metric (cross-asset overlays), color,
// label and UoM. Fetches metric options for whichever asset the row points at.
function OverlaySeriesRow({ overlay, index, assets, defaultAssetId, onChange, onRemove, role }: {
  overlay: Overlay; index: number; assets: any[]; defaultAssetId?: string;
  onChange: (patch: Partial<Overlay>) => void; onRemove: () => void;
  /** What this input means, for equipment widgets with named inputs. */
  role?: string;
}) {
  const assetId = overlay.assetId ?? defaultAssetId ?? "";
  const metrics = useMetricChoices(assetId);
  // An added series gets the NEXT categorical colour, not an SPC/status colour —
  // index+1 because the primary series already holds slot 0. Defaulting these to
  // the SPC list (as before) meant series two and three arrived amber and red.
  const color = overlay.color ?? SERIES_COLORS[(index + 1) % SERIES_COLORS.length];
  const selCls = "h-7 text-xs rounded-md border border-border bg-background px-1.5 min-w-0";
  const [pickerOpen, setPickerOpen] = useState(false);
  const assetName = assets.find((a) => a.id === assetId)?.name;
  return (
    <div className="rounded-md border border-border p-2 space-y-1.5">
      {role && <p className="text-[11px] font-medium">{index + 2}. {role}</p>}
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        {/* Same hierarchy picker as the primary source — an overlay may point at a
            different asset, so it needs the same disambiguation. */}
        <button type="button" onClick={() => setPickerOpen(true)}
          className={cn(selCls, "flex-1 text-left truncate", !assetName && "text-muted-foreground")}>
          {assetName ?? "Data source…"}
        </button>
        <AssetPickerDialog
          open={pickerOpen} assets={assets} value={assetId}
          onClose={() => setPickerOpen(false)}
          onSelect={(id) => onChange({ assetId: id, tag: "" })}
        />
        <button onClick={onRemove} title="Remove series" className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {/* On its own line: the dropdown is as wide as this field, and attribute names are long. */}
      <AttributeSelect size="sm" value={overlay.tag ?? ""} options={metrics} disabled={!assetId}
        placeholder="Attribute…" onChange={(key) => onChange({ tag: key })} />
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] w-10 shrink-0 text-muted-foreground">Color</span>
        <div className="flex-1 min-w-0">
          <ColorField value={color} onChange={(hex) => onChange({ color: hex })} presets={COLOR_SWATCHES} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Input value={overlay.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder="Label" className="h-7 text-xs" />
        <Input value={overlay.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value })} placeholder="UoM" className="h-7 text-xs" />
      </div>
    </div>
  );
}

interface GroupedMetric {
  assetId?: string; tag?: string; label?: string; unit?: string; color?: string;
  icon?: string;
  /** A pasted emoji (or short glyph) wins over `icon` when set — the curated
   *  preset list is a fast default, not a ceiling. */
  customIcon?: string;
  /** Tile fill. Unset = the default neutral tile. When set, label/value/icon
   *  switch to an auto-computed black-or-white so a bright fill never buries
   *  its own text (see contrastText in registry.tsx) — unless textColor below
   *  is also set, which wins over that automatic choice. */
  bgColor?: string;
  /** Manual override for the auto-contrast text color on a filled tile. Only
   *  meaningful (and only shown) once bgColor is set. */
  textColor?: string;
  /** Scale ceiling for Gauge/Thermometer/Tank/Battery (progress is always 0-100%). */
  max?: number;
  /** statusColor thresholds — Gauge/Thermometer/Tank/Battery/Progress. */
  critical?: number; warn?: number;
  /** Status/Traffic's own state, per tile now instead of once for the widget. */
  state?: string;
}

/**
 * One tile in a grouped widget (Card, or an Industrial mark — Gauge,
 * Thermometer, Tank, Progress, Battery, Status, Traffic). `kind` is the
 * widget's type and switches which extra fields apply: status/traffic pick a
 * state instead of binding a Data Source; the four scaled marks get a Max;
 * every numeric mark (progress included) gets Critical/Warn thresholds.
 *
 * Fields stack full-width rather than pairing up beside each other: the asset
 * and attribute pickers both open searchable popups sized to their trigger, so
 * squeezing the trigger into half a row squeezed the popup too — the classic
 * "Chiller ..." / "Elevat..." truncation. Full width fixes both at once.
 */
function MetricRow({ metric, index, assets, kind, onChange, onRemove }: {
  metric: GroupedMetric; index: number; assets: any[]; kind: string;
  onChange: (patch: Partial<GroupedMetric>) => void; onRemove: () => void;
}) {
  const assetId = metric.assetId ?? "";
  const metricChoices = useMetricChoices(assetId);
  const color = metric.color || SERIES_COLORS[index % SERIES_COLORS.length];
  const selCls = "h-8 text-sm rounded-md border border-border bg-background px-2 min-w-0 w-full";
  const [pickerOpen, setPickerOpen] = useState(false);
  const assetName = assets.find((a) => a.id === assetId)?.name;
  const customIcon = (metric.customIcon ?? "").trim();
  const Icon = CARD_ICONS[metric.icon ?? ""] ?? CARD_ICONS.activity;
  const isStateKind = STATE_TYPES.has(kind);
  const isScaled = SCALED_TYPES.has(kind);
  const hasThreshold = THRESHOLD_TYPES.has(kind);

  return (
    <div className="rounded-md border border-border p-2.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Metric {index + 1}</span>
        <button onClick={onRemove} title="Remove metric" className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>

      {isStateKind ? (
        <Field label="State">
          <select value={metric.state ?? "ok"} onChange={(e) => onChange({ state: e.target.value })} className={selCls}>
            <option value="ok">OK</option><option value="warn">Warning</option><option value="critical">Critical</option>
          </select>
        </Field>
      ) : (
        <>
          <Field label="Data Source">
            <button type="button" onClick={() => setPickerOpen(true)}
              className={cn(selCls, "text-left truncate", !assetName && "text-muted-foreground")}>
              {assetName ?? "Data source…"}
            </button>
            <AssetPickerDialog
              open={pickerOpen} assets={assets} value={assetId}
              onClose={() => setPickerOpen(false)}
              onSelect={(id) => onChange({ assetId: id, tag: "" })}
            />
          </Field>

          <Field label="Attribute">
            <AttributeSelect value={metric.tag ?? ""} options={metricChoices} disabled={!assetId}
              placeholder="— select attribute —" onChange={(key) => onChange({ tag: key })} />
          </Field>
        </>
      )}

      <Field label="Icon">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 shrink-0 rounded-md border border-border bg-background flex items-center justify-center">
            {customIcon ? <span style={{ fontSize: 16, lineHeight: 1 }}>{customIcon}</span> : <Icon className="w-4 h-4" style={{ color }} />}
          </div>
          <select value={metric.icon ?? "activity"} onChange={(e) => onChange({ icon: e.target.value })} className={cn(selCls, "flex-1")}>
            {CARD_ICON_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <Input value={metric.customIcon ?? ""} onChange={(e) => onChange({ customIcon: e.target.value })}
          placeholder="Or paste your own emoji — overrides the preset above" className="h-8 text-sm mt-1.5" maxLength={4} />
      </Field>

      {isScaled && (
        <Field label="Max"><Input type="number" value={metric.max ?? 100} onChange={(e) => onChange({ max: Number(e.target.value) || 100 })} className="h-8 text-sm" /></Field>
      )}

      {hasThreshold && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Warn ≥"><Input type="number" value={metric.warn ?? ""} onChange={(e) => onChange({ warn: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="—" className="h-8 text-sm" /></Field>
          <Field label="Critical ≥"><Input type="number" value={metric.critical ?? ""} onChange={(e) => onChange({ critical: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="—" className="h-8 text-sm" /></Field>
        </div>
      )}

      <Field label="Color">
        <ColorField value={color} onChange={(hex) => onChange({ color: hex })} presets={COLOR_SWATCHES} />
      </Field>

      <Field label="Background Color">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0"><ColorField value={metric.bgColor} onChange={(hex) => onChange({ bgColor: hex })} presets={COLOR_SWATCHES} /></div>
          {metric.bgColor && (
            <button type="button" onClick={() => onChange({ bgColor: undefined })} title="Clear background" className="shrink-0 text-[11px] px-2 h-8 rounded-md border border-border text-muted-foreground hover:text-foreground">
              Clear
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">Fills the whole tile — text switches to black or white automatically so it stays readable.</p>
      </Field>

      {metric.bgColor && (
        <Field label="Text Color">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0"><ColorField value={metric.textColor} onChange={(hex) => onChange({ textColor: hex })} presets={COLOR_SWATCHES} /></div>
            {metric.textColor && (
              <button type="button" onClick={() => onChange({ textColor: undefined })} title="Back to automatic" className="shrink-0 text-[11px] px-2 h-8 rounded-md border border-border text-muted-foreground hover:text-foreground">
                Auto
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Overrides the automatic black/white — pick this if the auto choice doesn't read well.</p>
        </Field>
      )}

      <Field label="Label"><Input value={metric.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder="Attribute Name" className="h-8 text-sm" /></Field>
      {!isStateKind && <Field label="UoM"><Input value={metric.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value })} placeholder="From attribute" className="h-8 text-sm" /></Field>}
    </div>
  );
}

// Right-side panel for adding/configuring a widget — occupies the same slot as
// the Widget Library. Nothing is committed to the dashboard until Save; the
// parent owns whether that means appending a new widget or patching an existing one.
export function WidgetConfigPanel({
  mode, type: initialType, initialConfig, onSave, onCancel, onChange,
}: {
  mode: "create" | "edit";
  type: string;
  initialConfig: Record<string, any>;
  onSave: (type: string, config: Record<string, any>) => void;
  onCancel: () => void;
  /** Fires on every edit so the widget on the canvas can preview live. */
  onChange?: (type: string, config: Record<string, any>) => void;
}) {
  const [type, setType] = useState(initialType);
  const [draft, setDraft] = useState<Record<string, any>>(initialConfig);
  // Types the user may add; a saved widget of any other type keeps its own entry below.
  const { canModule } = useCurrentUser();
  const offeredCategories = offeredWidgetCategories(canModule);

  const set = (patch: Record<string, any>) => setDraft((d) => ({ ...d, ...patch }));

  // Push each change up for the live canvas preview. Kept in a ref so callers can
  // pass an inline closure without the identity change re-firing the effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => { onChangeRef.current?.(type, draft); }, [type, draft]);

  function handleTypeChange(newType: string) {
    const def = widgetDef(newType);
    const oldSingleTag = draft.tag ?? (Array.isArray(draft.tags) ? draft.tags[0] : undefined) ?? draft.xTag;
    const tagPatch = newType === "scatter"
      ? { xTag: oldSingleTag, yTag: undefined, tag: undefined, tags: undefined, overlays: undefined }
      : GROUPED_SET.has(newType)
      ? { tag: undefined, tags: undefined, xTag: undefined, yTag: undefined, overlays: undefined }
      : MULTI_SERIES.has(newType)
      ? { tag: oldSingleTag, xTag: undefined, yTag: undefined, tags: undefined }
      : { tag: oldSingleTag, tags: undefined, xTag: undefined, yTag: undefined, overlays: undefined };
    setDraft((d) => ({ ...d, ...(def?.defaults ?? {}), ...tagPatch }));
    setType(newType);
  }

  const bindable = BINDABLE.has(type);
  const multiSeries = MULTI_SERIES.has(type);
  // Equipment widgets name each input (primary = input 1, overlay i = input i + 1).
  const roles = proDef(type)?.roles;
  const isScatter = type === "scatter";
  const showSpc = SPC_TYPES.has(type);

  const { data: assetsData } = useListAssets();
  const assets = (assetsData as any[] | undefined) ?? [];
  const metrics = useMetricChoices(draft.assetId);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  /** "Textile Industry › energy_analytics › rf_dryer" — the path, so a duplicated
   *  leaf name (two "All_machine" nodes) still reads unambiguously once chosen. */
  const selectedAssetPath = (() => {
    if (!draft.assetId) return "";
    const byId = new Map(assets.map((a) => [a.id, a]));
    const parts: string[] = [];
    let cur = byId.get(draft.assetId);
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  })();
  const overlays: Overlay[] = Array.isArray(draft.overlays) ? draft.overlays : [];
  const selCls = "w-full h-8 rounded-md border border-border text-sm px-2 bg-background";

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Settings2 className="w-4 h-4 text-primary" /> {mode === "create" ? "Add Widget" : "Edit Widget"}
          </div>
          <button onClick={onCancel} title="Close" className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Configure your visualization widget</p>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        <Field label="Widget Type">
          <select value={type} onChange={(e) => handleTypeChange(e.target.value)} className={selCls}>
            {offeredCategories.map((cat) => (
              <optgroup key={cat.name} label={cat.name}>
                {cat.items.map((it) => <option key={it.type} value={it.type}>{it.label}</option>)}
              </optgroup>
            ))}
            {/* A saved widget of a type that is now switched off still needs its
                own entry, or the dropdown would show some other type. */}
            {!offeredCategories.some((c) => c.items.some((it) => it.type === type)) && <option value={type}>{widgetDef(type)?.label ?? type} (not available)</option>}
          </select>
        </Field>

        {/* Left empty on purpose — widget types carry no default title, so this is the
            user's to fill. Blank means a blank widget header; it does NOT fall back to
            the Label (that names the series in the legend) or to the widget type. */}
        {type === "combined" && <CombinedFields config={draft} onChange={set} />}
        <Field label="Widget Title"><Input value={draft.title ?? ""} onChange={(e) => set({ title: e.target.value })} className="h-8 text-sm" placeholder="Shown in the widget header — blank for none" /></Field>

        {type === "text" && (
          <Field label="Text"><textarea value={draft.text ?? ""} onChange={(e) => set({ text: e.target.value })} className="w-full rounded-md border border-border p-2 text-sm h-24 resize-y" /></Field>
        )}
        {type === "button" && (
          <Field label="Button label"><Input value={draft.label ?? ""} onChange={(e) => set({ label: e.target.value })} className="h-8 text-sm" /></Field>
        )}
        {type === "sitesmap" && <SitesMapFields draft={draft} set={set} />}
        {type === "livetwin" && <LiveTwinFields draft={draft} set={set} />}
        {GROUPED_SET.has(type) && (
          <div className="pt-2 mt-1 border-t border-border space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Metrics</p>
              <button
                onClick={() => set({ metrics: [...(Array.isArray(draft.metrics) ? draft.metrics : []), {}] })}
                className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-orange-300 text-black hover:bg-orange-400"
              >
                <Plus className="w-2.5 h-2.5" /> <span className="font-bold">Add Metric</span>
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1.5">One metric for a single value, or several to group readings into one grid.</p>
            <div className="space-y-1.5">
              {(Array.isArray(draft.metrics) ? draft.metrics : []).map((m: GroupedMetric, i: number) => (
                <MetricRow
                  key={i} metric={m} index={i} assets={assets} kind={type}
                  onChange={(patch) => set({ metrics: draft.metrics.map((x: GroupedMetric, idx: number) => (idx === i ? { ...x, ...patch } : x)) })}
                  onRemove={() => set({ metrics: draft.metrics.filter((_: GroupedMetric, idx: number) => idx !== i) })}
                />
              ))}
            </div>

            <div className="pt-2 mt-1 border-t border-border space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Layout</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Columns"><Input type="number" min={1} max={8} value={draft.columns ?? 2} onChange={(e) => set({ columns: Math.max(1, Number(e.target.value) || 1) })} className="h-8 text-sm" /></Field>
                <Field label="Grid Gap (px)"><Input type="number" min={0} value={draft.gridGap ?? 8} onChange={(e) => set({ gridGap: Math.max(0, Number(e.target.value) || 0) })} className="h-8 text-sm" /></Field>
              </div>
              {/* Only Card's tiles are plain label+value text — every Industrial
                  mark (a gauge, a bar, a set of lights) has its own fixed internal
                  layout that "vertical/horizontal" has no meaning for. */}
              {type === "card" && (
                <Field label="Text Orientation">
                  <div className="flex gap-4 text-xs">
                    <label className="flex items-center gap-1.5"><input type="radio" checked={(draft.textOrientation ?? "vertical") === "vertical"} onChange={() => set({ textOrientation: "vertical" })} /> Vertical</label>
                    <label className="flex items-center gap-1.5"><input type="radio" checked={draft.textOrientation === "horizontal"} onChange={() => set({ textOrientation: "horizontal" })} /> Horizontal</label>
                  </div>
                </Field>
              )}
              {type === "gauge" && (
                <Field label="Gauge Style">
                  <select value={draft.gaugeStyle ?? "arc"} onChange={(e) => set({ gaugeStyle: e.target.value })} className={selCls}>
                    {GAUGE_STYLES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                  {draft.gaugeStyle === "zone" && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Bands come from each metric's Warn and Critical values below. With
                      neither set, the dial draws a single plain track.
                    </p>
                  )}
                </Field>
              )}
              {!STATE_TYPES.has(type) && (
                <Field label="Unit Placement">
                  <div className="flex gap-4 text-xs">
                    <label className="flex items-center gap-1.5"><input type="radio" checked={(draft.unitPlacement ?? "suffix") === "suffix"} onChange={() => set({ unitPlacement: "suffix" })} /> Suffix</label>
                    <label className="flex items-center gap-1.5"><input type="radio" checked={draft.unitPlacement === "prefix"} onChange={() => set({ unitPlacement: "prefix" })} /> Prefix</label>
                  </div>
                </Field>
              )}
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={!!draft.showFullText} onChange={(e) => set({ showFullText: e.target.checked })} /> Show full text (don't truncate labels)</label>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Radius"><Input type="number" min={0} value={draft.radius ?? 10} onChange={(e) => set({ radius: Math.max(0, Number(e.target.value) || 0) })} className="h-8 text-sm" /></Field>
                <Field label="Title Size"><Input type="number" min={8} value={draft.titleFontSize ?? 13} onChange={(e) => set({ titleFontSize: Number(e.target.value) || 13 })} className="h-8 text-sm" /></Field>
                <Field label="Value Size"><Input type="number" min={8} value={draft.valueFontSize ?? 20} onChange={(e) => set({ valueFontSize: Number(e.target.value) || 20 })} className="h-8 text-sm" /></Field>
              </div>
            </div>
          </div>
        )}

        {(type === "alarms" || SCOPE_TYPES.has(type)) && (
          <div className="pt-2 mt-1 border-t border-border space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Data</p>
            <Field label="Data Source">
              <button type="button" onClick={() => setAssetPickerOpen(true)}
                className={cn(selCls, "flex items-center justify-between gap-2 text-left")}>
                <span className={cn("truncate", !draft.assetId && "text-muted-foreground")}>
                  {selectedAssetPath || "— all assets —"}
                </span>
                <Layers className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              </button>
            </Field>
            {draft.assetId && (
              <button type="button" onClick={() => set({ assetId: "" })} className="text-[11px] text-muted-foreground hover:text-foreground underline">
                {type === "alarms" ? "Show alarms from all assets" : "Clear data source"}
              </button>
            )}
            {type === "alarms" && <p className="text-[11px] text-muted-foreground">Lists open (active and acknowledged) alarms. With a data source, only alarms on that asset or anything below it.</p>}
            <AssetPickerDialog
              open={assetPickerOpen}
              assets={assets}
              value={draft.assetId ?? ""}
              onClose={() => setAssetPickerOpen(false)}
              onSelect={(assetId) => set({ assetId })}
            />
          </div>
        )}

        {bindable && (
          <div className="pt-2 mt-1 border-t border-border space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Data</p>
            {/* Picked from the hierarchy, not a flat list: two assets can share a
                name under different parents, and the path is what disambiguates. */}
            <Field label="Data Source">
              <button type="button" onClick={() => setAssetPickerOpen(true)}
                className={cn(selCls, "flex items-center justify-between gap-2 text-left")}>
                <span className={cn("truncate", !draft.assetId && "text-muted-foreground")}>
                  {selectedAssetPath || "— none (sample data) —"}
                </span>
                <Layers className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              </button>
            </Field>
            <AssetPickerDialog
              open={assetPickerOpen}
              assets={assets}
              value={draft.assetId ?? ""}
              onClose={() => setAssetPickerOpen(false)}
              onSelect={(assetId) => set({ assetId, tag: "", tags: [], xTag: "", yTag: "", overlays: [] })}
            />

            {isScatter ? (
              <>
                <Field label="X Attribute">
                  <AttributeSelect value={draft.xTag ?? ""} options={metrics} disabled={!draft.assetId}
                    placeholder={draft.assetId ? "— select attribute —" : "pick a data source first"}
                    onChange={(key) => set({ xTag: key })} />
                </Field>
                <Field label="Y Attribute">
                  <AttributeSelect value={draft.yTag ?? ""} options={metrics} disabled={!draft.assetId}
                    placeholder={draft.assetId ? "— select attribute —" : "pick a data source first"}
                    onChange={(key) => set({ yTag: key })} />
                </Field>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">{roles ? `1. ${roles[0]}` : "Attribute"}</Label>
                  <AttributeSelect value={draft.tag ?? ""} options={metrics} disabled={!draft.assetId}
                    placeholder={draft.assetId ? "— select attribute —" : "pick a data source first"}
                    onChange={(key) => set({ tag: key })} />
                  <p className="text-[11px] text-muted-foreground">Shown by Attribute Name; falls back to the raw payload tag if it was never renamed.</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Label"><Input value={draft.label ?? ""} onChange={(e) => set({ label: e.target.value })} className="h-8 text-sm" placeholder="Attribute Name" /></Field>
                  <Field label="UoM"><Input value={draft.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} className="h-8 text-sm" placeholder="From attribute" /></Field>
                </div>
                {/* Both are overrides, not requirements — the chart already names the
                    series from the Attribute Name and takes the unit from the
                    attribute's UoM. Saying so stops these reading as blanks to fill. */}
                <p className="text-[11px] text-muted-foreground -mt-1.5">
                  Optional overrides. Left blank, the series is named after the <strong>Attribute Name</strong> (shown in the legend below the chart) and the <strong>UoM</strong> comes from the attribute itself (shown on the Y-axis).
                </p>

                {multiSeries && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">{roles ? "Further inputs, in order" : "Overlay Attributes (multi-series)"}</Label>
                      <button
                        onClick={() => set({ overlays: [...overlays, { assetId: draft.assetId, tag: "" }] })}
                        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-orange-300 text-black hover:bg-orange-400"
                      >
                        <Plus className="w-2.5 h-2.5" /> {roles && roles[overlays.length + 1] ? `Add: ${roles[overlays.length + 1].replace(/ \(.*$/, "")}` : "Add Series"}
                      </button>
                    </div>
                    {overlays.map((ov, i) => (
                      <OverlaySeriesRow
                        key={i} overlay={ov} index={i} assets={assets} defaultAssetId={draft.assetId}
                        onChange={(patch) => set({ overlays: overlays.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) })}
                        onRemove={() => set({ overlays: overlays.filter((_, idx) => idx !== i) })}
                        role={roles ? (roles[i + 1] ?? roles[roles.length - 1]) : undefined}
                      />
                    ))}
                    {overlays.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">Add extra series to overlay on the same chart, from this or any other asset.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <ProFields type={type} draft={draft} set={set} />

        <Note icon={Clock}>
          Time range, granularity, and aggregation are configured per-widget via the <strong>clock icon</strong> in the widget header after saving. WTD, MTD, YTD and custom date ranges are also available there.
        </Note>
        <Note icon={Move}>
          Drag the bottom-right corner of a widget on the dashboard to resize height and width simultaneously. Drag the grip icon in the header to move it.
        </Note>

        {showSpc && (
          <div className="pt-2 mt-1 border-t border-border space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Control Limit Lines (SPC)</p>
            <p className="text-[11px] text-muted-foreground">Enter a Y-axis value to draw a horizontal reference line on the chart. Leave blank to hide.</p>
            <SpcRow label="UCL" valueKey="ucl" colorKey="uclColor" styleKey="uclStyle" draft={draft} set={set} />
            <SpcRow label="LCL" valueKey="lcl" colorKey="lclColor" styleKey="lclStyle" draft={draft} set={set} />
            <SpcRow label="CL" valueKey="cl" colorKey="clColor" styleKey="clStyle" draft={draft} set={set} />
          </div>
        )}

        {/* Grouped widgets have no single primary color — every metric tile
            picks its own, right in its row above. */}
        {!GROUPED_SET.has(type) && type !== "sitesmap" && type !== "livetwin" && (
          <Field label="Primary Color">
            <ColorField value={draft.color} onChange={(hex) => set({ color: hex })} presets={COLOR_SWATCHES} />
          </Field>
        )}

        <div className="pt-2 mt-1 border-t border-border space-y-1">
          <Label className="text-xs flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> {type === "image" ? "Image URL" : "Widget Image (optional)"}</Label>
          <Input value={draft.imageUrl ?? ""} onChange={(e) => set({ imageUrl: e.target.value })} className="h-8 text-sm font-mono" placeholder="Paste image URL or copy from Media Library" />
          <p className="text-[11px] text-muted-foreground">Upload images first in <strong>Asset Hub → Media Library</strong>, then copy the URL here.</p>
        </div>
      </div>

      <div className="p-3 border-t border-border shrink-0 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSave(type, draft)}>{mode === "create" ? "Add Widget" : "Update Widget"}</Button>
      </div>
    </div>
  );
}
