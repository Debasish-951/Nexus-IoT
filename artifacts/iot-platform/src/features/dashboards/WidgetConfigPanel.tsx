import { useEffect, useRef, useState } from "react";
import { Clock, Move, Image as ImageIcon, Plus, Trash2, X, Settings2, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useListAssets } from "@workspace/api-client-react";
import { WIDGET_CATEGORIES, PALETTE, widgetDef } from "./registry";
import { useMetricChoices } from "./useWidgetData";
import { ColorField } from "./ColorField";
import { AssetPickerDialog } from "./AssetPickerDialog";
import { AttributeSelect } from "./AttributeSelect";

const BINDABLE = new Set(["kpi", "health", "availability", "oee", "downtime", "runtime", "energy", "gauge", "thermometer", "tank", "battery", "progress", "line", "area", "bar", "stackbar", "table", "alarms", "events"]);
const MULTI_SERIES = new Set(["line", "area", "bar", "stackbar"]);
const SPC_TYPES = new Set(["line", "area", "bar", "stackbar"]);

// 12-swatch primary palette (matches the Analytics & KPI widget dialog).
const COLOR_SWATCHES = ["#06b6d4", "#22C55E", "#a855f7", "#F59E0B", "#EF4444", "#6366f1", "#ec4899", "#f97316", "#14b8a6", "#84cc16", "#f59e0b", "#d946ef"];
const SPC_COLORS = [PALETTE.warning, PALETTE.critical, PALETTE.success, PALETTE.primary, "#a855f7", "#f97316", PALETTE.neutral];

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
function OverlaySeriesRow({ overlay, index, assets, defaultAssetId, onChange, onRemove }: {
  overlay: Overlay; index: number; assets: any[]; defaultAssetId?: string;
  onChange: (patch: Partial<Overlay>) => void; onRemove: () => void;
}) {
  const assetId = overlay.assetId ?? defaultAssetId ?? "";
  const metrics = useMetricChoices(assetId);
  const color = overlay.color ?? SPC_COLORS[(index + 1) % SPC_COLORS.length];
  const selCls = "h-7 text-xs rounded-md border border-border bg-background px-1.5 min-w-0";
  const [pickerOpen, setPickerOpen] = useState(false);
  const assetName = assets.find((a) => a.id === assetId)?.name;
  return (
    <div className="rounded-md border border-border p-2 space-y-1.5">
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
        <div className="flex-1 min-w-0">
          <AttributeSelect size="sm" value={overlay.tag ?? ""} options={metrics} disabled={!assetId}
            placeholder="Attribute…" onChange={(key) => onChange({ tag: key })} />
        </div>
        <button onClick={onRemove} title="Remove series" className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
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
      : MULTI_SERIES.has(newType)
      ? { tag: oldSingleTag, xTag: undefined, yTag: undefined, tags: undefined }
      : { tag: oldSingleTag, tags: undefined, xTag: undefined, yTag: undefined, overlays: undefined };
    setDraft((d) => ({ ...d, ...(def?.defaults ?? {}), ...tagPatch }));
    setType(newType);
  }

  const bindable = BINDABLE.has(type);
  const multiSeries = MULTI_SERIES.has(type);
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
            {WIDGET_CATEGORIES.map((cat) => (
              <optgroup key={cat.name} label={cat.name}>
                {cat.items.map((it) => <option key={it.type} value={it.type}>{it.label}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>

        {/* Left empty on purpose — widget types carry no default title, so this is the
            user's to fill. Blank means a blank widget header; it does NOT fall back to
            the Label (that names the series in the legend) or to the widget type. */}
        <Field label="Widget Title"><Input value={draft.title ?? ""} onChange={(e) => set({ title: e.target.value })} className="h-8 text-sm" placeholder="Shown in the widget header — blank for none" /></Field>

        {type === "text" && (
          <Field label="Text"><textarea value={draft.text ?? ""} onChange={(e) => set({ text: e.target.value })} className="w-full rounded-md border border-border p-2 text-sm h-24 resize-y" /></Field>
        )}
        {type === "button" && (
          <Field label="Button label"><Input value={draft.label ?? ""} onChange={(e) => set({ label: e.target.value })} className="h-8 text-sm" /></Field>
        )}
        {["status", "traffic"].includes(type) && (
          <Field label="State">
            <select value={draft.state ?? "ok"} onChange={(e) => set({ state: e.target.value })} className={selCls}>
              <option value="ok">OK</option><option value="warn">Warning</option><option value="critical">Critical</option>
            </select>
          </Field>
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
                  <Label className="text-xs">Attribute</Label>
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
                      <Label className="text-xs font-medium">Overlay Attributes (multi-series)</Label>
                      <button
                        onClick={() => set({ overlays: [...overlays, { assetId: draft.assetId, tag: "" }] })}
                        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-primary/40 text-primary hover:bg-primary/5"
                      >
                        <Plus className="w-2.5 h-2.5" /> Add Series
                      </button>
                    </div>
                    {overlays.map((ov, i) => (
                      <OverlaySeriesRow
                        key={i} overlay={ov} index={i} assets={assets} defaultAssetId={draft.assetId}
                        onChange={(patch) => set({ overlays: overlays.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) })}
                        onRemove={() => set({ overlays: overlays.filter((_, idx) => idx !== i) })}
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

        <Field label="Primary Color">
          <ColorField value={draft.color} onChange={(hex) => set({ color: hex })} presets={COLOR_SWATCHES} />
        </Field>

        <div className="pt-2 mt-1 border-t border-border space-y-1">
          <Label className="text-xs flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Widget Image (optional)</Label>
          <Input value={draft.imageUrl ?? ""} onChange={(e) => set({ imageUrl: e.target.value })} className="h-8 text-sm font-mono" placeholder="Paste image URL or copy from Media Library" />
          <p className="text-[11px] text-muted-foreground">Upload images first in <strong>Asset Management → Media Library</strong>, then copy the URL here.</p>
        </div>
      </div>

      <div className="p-3 border-t border-border shrink-0 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSave(type, draft)}>{mode === "create" ? "Add Widget" : "Update Widget"}</Button>
      </div>
    </div>
  );
}
