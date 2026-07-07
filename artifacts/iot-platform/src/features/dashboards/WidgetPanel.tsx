import { useMemo, useState } from "react";
import { Search, Settings2, LayoutGrid, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useListAssets } from "@workspace/api-client-react";
import { WIDGET_CATEGORIES, PALETTE } from "./registry";
import { useMetricOptions } from "./useWidgetData";
import type { Widget } from "./types";

const BINDABLE = new Set(["kpi", "health", "availability", "oee", "downtime", "runtime", "energy", "gauge", "thermometer", "tank", "battery", "progress", "line", "area", "bar", "table", "alarms", "events"]);
const SINGLE_VALUE = new Set(["kpi", "health", "availability", "oee", "downtime", "runtime", "energy", "gauge", "thermometer", "tank", "battery", "progress"]);
const RANGES = [{ v: 1, l: "1 hour" }, { v: 6, l: "6 hours" }, { v: 24, l: "24 hours" }, { v: 168, l: "7 days" }, { v: 720, l: "30 days" }];

const COLOR_SWATCHES = [PALETTE.primary, PALETTE.success, PALETTE.warning, PALETTE.critical, PALETTE.neutral, "#a855f7", "#06b6d4"];

export function WidgetPanel({
  selected, updateConfig, onDelete,
}: {
  selected: Widget | null;
  updateConfig: (id: string, patch: Record<string, any>) => void;
  onDelete: (id: string) => void;
}) {
  if (selected) return <Properties widget={selected} updateConfig={updateConfig} onDelete={onDelete} />;
  return <Library />;
}

function Library() {
  const [q, setQ] = useState("");
  const cats = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return WIDGET_CATEGORIES;
    return WIDGET_CATEGORIES.map((c) => ({ ...c, items: c.items.filter((i) => i.label.toLowerCase().includes(query)) })).filter((c) => c.items.length);
  }, [q]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-1.5 mb-2 text-sm font-semibold"><LayoutGrid className="w-4 h-4 text-primary" /> Widget Library</div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

function Properties({ widget, updateConfig, onDelete }: { widget: Widget; updateConfig: (id: string, patch: Record<string, any>) => void; onDelete: (id: string) => void }) {
  const c = widget.config ?? {};
  const set = (patch: Record<string, any>) => updateConfig(widget.id, patch);
  const numericTypes = ["kpi", "health", "availability", "oee", "downtime", "runtime", "energy", "gauge", "thermometer", "tank", "battery", "progress", "alarmcount", "assetcount"];
  const isNumeric = numericTypes.includes(widget.type);
  const bindable = BINDABLE.has(widget.type);
  const singleValue = SINGLE_VALUE.has(widget.type);
  const multiSeries = ["line", "area", "bar"].includes(widget.type);
  const isScatter = widget.type === "scatter";

  const { data: assetsData } = useListAssets();
  const assets = (assetsData as any[] | undefined) ?? [];
  const metrics = useMetricOptions(c.assetId);
  const selCls = "w-full h-8 rounded-md border border-border text-sm px-2 bg-background";

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center gap-1.5 text-sm font-semibold"><Settings2 className="w-4 h-4 text-primary" /> Widget Properties</div>
      <div className="flex-1 overflow-auto p-3 space-y-3">
        <Field label="Title"><Input value={c.title ?? ""} onChange={(e) => set({ title: e.target.value })} className="h-8 text-sm" /></Field>
        <Field label="Subtitle"><Input value={c.subtitle ?? ""} onChange={(e) => set({ subtitle: e.target.value })} className="h-8 text-sm" /></Field>

        {widget.type === "text" && (
          <Field label="Text"><textarea value={c.text ?? ""} onChange={(e) => set({ text: e.target.value })} className="w-full rounded-md border border-border p-2 text-sm h-24 resize-y" /></Field>
        )}
        {widget.type === "button" && (
          <Field label="Button label"><Input value={c.label ?? ""} onChange={(e) => set({ label: e.target.value })} className="h-8 text-sm" /></Field>
        )}
        {isNumeric && (
          <>
            <Field label="Value"><Input type="number" value={c.value ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} className="h-8 text-sm" /></Field>
            <Field label="Unit"><Input value={c.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} className="h-8 text-sm" /></Field>
            {["gauge", "thermometer", "tank"].includes(widget.type) && (
              <Field label="Max"><Input type="number" value={c.max ?? 100} onChange={(e) => set({ max: Number(e.target.value) })} className="h-8 text-sm" /></Field>
            )}
          </>
        )}
        {["status", "traffic"].includes(widget.type) && (
          <Field label="State">
            <select value={c.state ?? "ok"} onChange={(e) => set({ state: e.target.value })} className="w-full h-8 rounded-md border border-border text-sm px-2">
              <option value="ok">OK</option><option value="warn">Warning</option><option value="critical">Critical</option>
            </select>
          </Field>
        )}

        <Field label="Color">
          <div className="flex flex-wrap gap-1.5">
            {COLOR_SWATCHES.map((col) => (
              <button key={col} onClick={() => set({ color: col })} className={cn("w-6 h-6 rounded-md border-2", c.color === col ? "border-slate-800" : "border-transparent")} style={{ background: col }} />
            ))}
          </div>
        </Field>

        {bindable && (
          <div className="pt-2 mt-1 border-t border-border space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Data</p>
            <Field label="Asset">
              <select value={c.assetId ?? ""} onChange={(e) => set({ assetId: e.target.value, tag: "", tags: [], xTag: "", yTag: "" })} className={selCls}>
                <option value="">— none (sample data) —</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            {isScatter ? (
              <>
                <Field label="X Tag">
                  <select value={c.xTag ?? ""} onChange={(e) => set({ xTag: e.target.value })} className={selCls} disabled={!c.assetId}>
                    <option value="">— select —</option>{metrics.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Y Tag">
                  <select value={c.yTag ?? ""} onChange={(e) => set({ yTag: e.target.value })} className={selCls} disabled={!c.assetId}>
                    <option value="">— select —</option>{metrics.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
              </>
            ) : multiSeries ? (
              <Field label="Telemetry Tags (pick several)">
                <div className="max-h-44 overflow-auto border border-border rounded-md p-1.5 space-y-1">
                  {!c.assetId ? <p className="text-xs text-muted-foreground px-1">pick an asset first</p> :
                    metrics.map((m) => {
                      const cur: string[] = Array.isArray(c.tags) ? c.tags : (c.tag ? [c.tag] : []);
                      const sel = cur.includes(m);
                      return (
                        <label key={m} className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input type="checkbox" checked={sel} onChange={(e) => set({ tags: e.target.checked ? [...cur, m] : cur.filter((x) => x !== m) })} />
                          <span className="truncate" title={m}>{m}</span>
                        </label>
                      );
                    })}
                </div>
              </Field>
            ) : (
              <Field label="Telemetry Tag">
                <select value={c.tag ?? ""} onChange={(e) => set({ tag: e.target.value })} className={selCls} disabled={!c.assetId}>
                  <option value="">{c.assetId ? "— select tag —" : "pick an asset first"}</option>
                  {metrics.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            )}
            {singleValue && (
              <Field label="Aggregation">
                <select value={c.agg ?? "last"} onChange={(e) => set({ agg: e.target.value })} className={selCls}>
                  <option value="last">Last</option><option value="avg">Average</option><option value="max">Max</option><option value="min">Min</option><option value="sum">Sum</option>
                </select>
              </Field>
            )}
            <Field label="Time Range">
              <select value={c.rangeHours ?? 24} onChange={(e) => set({ rangeHours: Number(e.target.value) })} className={selCls}>
                {RANGES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </Field>
            <Field label="Refresh">
              <select value={c.refreshSec ?? 0} onChange={(e) => set({ refreshSec: Number(e.target.value) })} className={selCls}>
                <option value={0}>Off</option><option value={10}>10s</option><option value={30}>30s</option><option value={60}>60s</option>
              </select>
            </Field>
            {isNumeric && (
              <>
                <Field label="Decimals"><Input type="number" min={0} max={4} value={c.decimals ?? 1} onChange={(e) => set({ decimals: Number(e.target.value) })} className="h-8 text-sm" /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Warn ≥"><Input type="number" value={c.warn ?? ""} onChange={(e) => set({ warn: e.target.value })} className="h-8 text-sm" placeholder="—" /></Field>
                  <Field label="Critical ≥"><Input type="number" value={c.critical ?? ""} onChange={(e) => set({ critical: e.target.value })} className="h-8 text-sm" placeholder="—" /></Field>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="p-2 border-t border-border">
        <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive" onClick={() => onDelete(widget.id)}>
          <Trash2 className="w-4 h-4 mr-1.5" /> Delete widget
        </Button>
      </div>
    </div>
  );
}
