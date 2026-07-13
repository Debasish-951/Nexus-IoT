import { useEffect, useState, useRef } from "react";
import {
  MousePointerClick, RefreshCw, Plus, X, Maximize2, Minimize2, Wifi, WifiOff, LayoutGrid,
  Eye, EyeOff, Copy, Share2, Upload, Download, Save, Clock3, MoreVertical, Settings2, Clipboard, Trash2,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PALETTE, WidgetView, widgetDef } from "./registry";
import { newId } from "./useDashboards";
import type { Widget } from "./types";
import { resolveTags } from "./assetBinding";
import { useWsEvents } from "@/hooks/useWsEvents";
import type { Asset } from "@/pages/assetShared";

// Global time range presets (value = hours). Applies to all widgets at once.
const RANGES = [
  { v: 0.25, l: "Last 15 minutes" },
  { v: 0.5,  l: "Last 30 minutes" },
  { v: 1,    l: "Last 1 hour" },
  { v: 3,    l: "Last 3 hours" },
  { v: 6,    l: "Last 6 hours" },
  { v: 12,   l: "Last 12 hours" },
  { v: 24,   l: "Last 24 hours" },
  { v: 48,   l: "Last 48 hours" },
  { v: 168,  l: "Last 7 days" },
  { v: 336,  l: "Last 14 days" },
  { v: 720,  l: "Last 30 days" },
];
const COLOR_SWATCHES = [PALETTE.primary, PALETTE.success, PALETTE.warning, PALETTE.critical, PALETTE.neutral, "#a855f7", "#06b6d4"];

// Widget types offered by the Add Widget dialog.
const ADD_TYPES = [
  { type: "kpi",       label: "KPI Card",     desc: "Large number display for a critical metric." },
  { type: "line",      label: "Line Chart",   desc: "Continuous time-series line. Best for sensor readings." },
  { type: "area",      label: "Area Chart",   desc: "Filled area under a line. Cumulative values." },
  { type: "bar",       label: "Bar Chart",    desc: "Vertical bars per time bucket." },
  { type: "stackbar",  label: "Stacked Bar",  desc: "Multiple series stacked. Compare components." },
  { type: "gauge",     label: "Gauge",        desc: "Circular dial with min/max. Point-in-time." },
  { type: "donut",     label: "Donut Chart",  desc: "Proportional slices with a center hole." },
  { type: "table",     label: "Table",        desc: "Sortable tabular metric view." },
  { type: "sparkline", label: "Sparkline",    desc: "Compact trend line, no axes." },
];
const OVERLAY_TYPES = new Set(["line", "area", "bar", "stackbar"]); // support up to 4 overlay metrics
// Small = compact tiles in a row; everything else = big full-width charts.
const SMALL_TYPES = new Set(["kpi", "gauge", "donut", "sparkline"]);

const wkey = (assetId: string) => `wsviz:widgets:${assetId}`;

export function AssetVizPanel({ assetId, assetName, assets }: { assetId: string | null; assetName?: string; assets: Asset[] }) {
  const [rangeHours, setRangeHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [customWidgets, setCustomWidgets] = useState<Widget[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Widget | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Live WebSocket status — drives the badge. Telemetry pushes can arrive many
  // times/sec, so THROTTLE the refresh to at most once per 7s (otherwise the panel
  // refetches faster than the query completes and stays stuck on "Loading…").
  const lastWsRef = useRef(0);
  const wsStatus = useWsEvents({
    telemetry: () => {
      if (!autoRefresh) return;
      const now = Date.now();
      if (now - lastWsRef.current > 7000) { lastWsRef.current = now; setTick((t) => t + 1); }
    },
  });

  // Persist added widgets per asset (localStorage).
  useEffect(() => {
    if (!assetId) { setCustomWidgets([]); return; }
    try {
      const raw = localStorage.getItem(wkey(assetId));
      setCustomWidgets(raw ? JSON.parse(raw) : []);
    } catch { setCustomWidgets([]); }
  }, [assetId]);
  useEffect(() => {
    if (!assetId) return;
    try { localStorage.setItem(wkey(assetId), JSON.stringify(customWidgets)); } catch { /* ignore quota */ }
  }, [assetId, customWidgets]);

  // Resolve the selected asset's device owner + available tags (drives the Add
  // Widget dialog + custom widgets). No auto KPI cards / trends are fetched here.
  useEffect(() => {
    if (!assetId) { setOwnerId(null); setAllTags([]); return; }
    let cancelled = false;
    setLoading(true);
    resolveTags(assetId, assets)
      .then(({ ownerId, tags }) => { if (!cancelled) { setOwnerId(ownerId); setAllTags(tags); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId, assets, tick]);

  const refreshSec = autoRefresh ? 10 : 0;

  // ── Toolbar actions (operate on this asset's widget set) ──
  function saveNow() {
    if (!assetId) return;
    try { localStorage.setItem(wkey(assetId), JSON.stringify(customWidgets)); toast({ title: "Saved", description: `${customWidgets.length} widget(s) stored for ${assetName ?? "asset"}.` }); }
    catch { toast({ title: "Save failed", variant: "destructive" }); }
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify({ assetName, widgets: customWidgets }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${(assetName || "asset").replace(/\s+/g, "_")}_widgets.json`; a.click(); URL.revokeObjectURL(url);
  }
  async function share() {
    try { await navigator.clipboard.writeText(JSON.stringify({ assetName, widgets: customWidgets })); toast({ title: "Copied", description: "Widget JSON copied — paste via Import to share." }); }
    catch { toast({ title: "Copy failed", variant: "destructive" }); }
  }
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const w = Array.isArray(obj.widgets) ? obj.widgets : (Array.isArray(obj) ? obj : []);
      setCustomWidgets(w);
      toast({ title: "Imported", description: `${w.length} widget(s) loaded.` });
    } catch { toast({ title: "Import failed", description: "Not a valid widget JSON.", variant: "destructive" }); }
  }
  function editWidget(w: Widget) { setEditing(w); setAddOpen(true); }
  function duplicateWidget(w: Widget) {
    const copy: Widget = { ...w, id: newId("w"), config: { ...w.config, title: `${w.config?.title ?? "Widget"} (copy)` } };
    setCustomWidgets((prev) => [...prev, copy]);
  }
  async function copyWidget(w: Widget) {
    try { await navigator.clipboard.writeText(JSON.stringify(w)); toast({ title: "Widget copied to clipboard" }); }
    catch { toast({ title: "Copy failed", variant: "destructive" }); }
  }
  function cloneTo(targetAssetId: string) {
    try {
      localStorage.setItem(wkey(targetAssetId), JSON.stringify(customWidgets));
      const name = assets.find((a) => a.id === targetAssetId)?.name ?? "asset";
      toast({ title: "Cloned", description: `Layout copied to ${name}.` });
    } catch { toast({ title: "Clone failed", variant: "destructive" }); }
    setCloneOpen(false);
  }

  if (!assetId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
        <MousePointerClick className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm">Select an asset from the tree to see its dashboard.</p>
      </div>
    );
  }

  const wsBadge = wsStatus === "connected"
    ? { cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300", icon: Wifi, label: "Live" }
    : { cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: WifiOff, label: wsStatus === "connecting" ? "Connecting" : "Reconnecting" };

  return (
    <div className={cn("h-full overflow-auto p-5", fullscreen && "fixed inset-0 z-50 bg-background")}>
      {/* Header / toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold truncate">{assetName ?? "Asset"}</h2>
          <p className="text-xs text-muted-foreground">{allTags.length} metric{allTags.length !== 1 ? "s" : ""} available</p>
        </div>

        {/* WS status badge */}
        <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-medium", wsBadge.cls)}>
          <wsBadge.icon className="w-3 h-3" /> {wsBadge.label}
        </span>

        {/* Global time range */}
        <Select value={String(rangeHours)} onValueChange={(v) => setRangeHours(Number(v))}>
          <SelectTrigger className="h-8 w-40 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{RANGES.map((r) => <SelectItem key={r.v} value={String(r.v)}>{r.l}</SelectItem>)}</SelectContent>
        </Select>

        {/* Auto-refresh toggle + indicator */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground px-1 select-none">
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-90" />
          <span className="inline-flex items-center gap-1">
            {autoRefresh && <span className={cn("w-1.5 h-1.5 rounded-full bg-green-500", loading ? "animate-ping" : "animate-pulse")} />}
            Auto
          </span>
        </label>

        <Button variant="outline" size="sm" onClick={() => setPreview((p) => !p)} title={preview ? "Exit preview" : "Preview"}>{preview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button>
        <Button variant="outline" size="sm" onClick={() => setCloneOpen(true)} disabled={!customWidgets.length} title="Clone layout to another asset"><Copy className="w-4 h-4" /></Button>
        <Button variant="outline" size="sm" onClick={share} disabled={!customWidgets.length} title="Share (copy JSON)"><Share2 className="w-4 h-4" /></Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} title="Import widgets"><Upload className="w-4 h-4" /></Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />
        <Button variant="outline" size="sm" onClick={exportJson} disabled={!customWidgets.length} title="Export widgets"><Download className="w-4 h-4" /></Button>
        <Button variant="outline" size="sm" onClick={() => setTick((t) => t + 1)} title="Refresh now"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></Button>
        <Button variant="outline" size="sm" onClick={() => setFullscreen((f) => !f)} title="Fullscreen">{fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</Button>
        {!preview && <Button size="sm" onClick={() => setAddOpen(true)} disabled={!ownerId}><Plus className="w-4 h-4 mr-1" /> Add Widget</Button>}
        <Button size="sm" onClick={saveNow} title="Save widgets"><Save className="w-4 h-4 mr-1" /> Save</Button>
      </div>

      {/* Widgets (only what you add — no auto cards/trends). Small tiles in a row,
          big charts full-width and tall. */}
      {customWidgets.length > 0 ? (
        <div className="space-y-4">
          {customWidgets.some((w) => SMALL_TYPES.has(w.type)) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {customWidgets.filter((w) => SMALL_TYPES.has(w.type)).map((w) => (
                <WidgetCard key={w.id} w={w} rangeHours={rangeHours} refreshSec={refreshSec} preview={preview}
                  onRemove={() => setCustomWidgets((prev) => prev.filter((x) => x.id !== w.id))}
                  onUpdate={(patch) => setCustomWidgets((prev) => prev.map((x) => (x.id === w.id ? { ...x, config: { ...x.config, ...patch } } : x)))}
                  onEdit={() => editWidget(w)} onDuplicate={() => duplicateWidget(w)} onCopy={() => copyWidget(w)}
                  className="h-40" />
              ))}
            </div>
          )}
          {customWidgets.filter((w) => !SMALL_TYPES.has(w.type)).map((w) => (
            <WidgetCard key={w.id} w={w} rangeHours={rangeHours} refreshSec={refreshSec} preview={preview}
              onRemove={() => setCustomWidgets((prev) => prev.filter((x) => x.id !== w.id))}
              onUpdate={(patch) => setCustomWidgets((prev) => prev.map((x) => (x.id === w.id ? { ...x, config: { ...x.config, ...patch } } : x)))}
              onEdit={() => editWidget(w)} onDuplicate={() => duplicateWidget(w)} onCopy={() => copyWidget(w)}
              className="h-[420px]" />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <LayoutGrid className="w-8 h-8 mx-auto mb-2 opacity-20" />
          {loading ? "Loading…" : "No widgets yet — click Add Widget to build this dashboard."}
        </div>
      )}

      <AddWidgetDialog
        open={addOpen}
        onOpenChange={(v) => { setAddOpen(v); if (!v) setEditing(null); }}
        assets={assets}
        currentAssetId={assetId}
        currentTags={allTags}
        currentOwnerId={ownerId}
        edit={editing}
        onAdd={(w) => {
          // Close the dialog first, then mount/replace on the next frame — mounting a
          // recharts chart in the same commit that unmounts the Radix dialog portal
          // triggers a "removeChild" reconciliation error.
          setAddOpen(false); setEditing(null);
          requestAnimationFrame(() => setCustomWidgets((prev) =>
            prev.some((x) => x.id === w.id) ? prev.map((x) => (x.id === w.id ? w : x)) : [...prev, w]));
        }}
      />

      {/* Clone this asset's widget layout to another asset */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Copy className="w-4 h-4" /> Clone Layout</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Copy these {customWidgets.length} widget(s) to another asset (replaces its widgets).</p>
          <div className="max-h-72 overflow-auto space-y-1">
            {assets.filter((a) => a.id !== assetId).map((a) => (
              <button key={a.id} onClick={() => cloneTo(a.id)} className="w-full text-left px-3 py-2 rounded-md border border-border hover:border-primary hover:bg-primary/5 text-sm">{a.name}</button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const AGG_OPTS = [["last", "Last"], ["avg", "Average"], ["max", "Max"], ["min", "Min"], ["sum", "Sum"]] as const;
const GRAN_OPTS = [["auto", "Auto"], ["1m", "1 minute"], ["5m", "5 minutes"], ["15m", "15 minutes"], ["1h", "1 hour"]] as const;
const REFRESH_OPTS = [["1", "1 s"], ["5", "5 s"], ["10", "10 s"], ["30", "30 s"], ["60", "60 s"]] as const;

// ── A single rendered widget card (clock popover: Time Range & Aggregation) ────
function WidgetCard({
  w, rangeHours, refreshSec, preview, onRemove, onUpdate, onEdit, onDuplicate, onCopy, className,
}: {
  w: Widget; rangeHours: number; refreshSec: number; preview: boolean;
  onRemove: () => void; onUpdate: (patch: Record<string, any>) => void;
  onEdit: () => void; onDuplicate: () => void; onCopy: () => void; className?: string;
}) {
  const [expand, setExpand] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const c = w.config ?? {};
  // Per-widget override wins; otherwise the widget follows the global toolbar range.
  const useOwn = !!c.override;
  const effCfg = useOwn
    ? { ...c }
    : { ...c, rangeHours, refreshSec };

  const body = (
    <>
      <div className="flex items-center gap-1 mb-1">
        <p className="text-xs font-medium truncate flex-1 pl-1" title={c.title}>{c.title ?? widgetDef(w.type)?.label ?? w.type}</p>
        {!preview && (
          <>
            <Popover open={cfgOpen} onOpenChange={setCfgOpen}>
              <PopoverTrigger asChild>
                <button className="p-0.5 rounded text-muted-foreground hover:text-primary shrink-0" title="Time range & aggregation"><Clock3 className="w-3.5 h-3.5" /></button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-3">
                <TimeAggPanel config={c} onApply={(patch) => { onUpdate(patch); setCfgOpen(false); }} />
              </PopoverContent>
            </Popover>
            <button onClick={() => setExpand(true)} className="p-0.5 rounded text-muted-foreground hover:text-primary shrink-0" title="Expand"><Maximize2 className="w-3.5 h-3.5" /></button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-0.5 rounded text-muted-foreground hover:text-primary shrink-0" title="More"><MoreVertical className="w-3.5 h-3.5" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={onEdit}><Settings2 className="w-3.5 h-3.5 mr-2" /> Edit Widget</DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}><Copy className="w-3.5 h-3.5 mr-2" /> Duplicate Widget</DropdownMenuItem>
                <DropdownMenuItem onClick={onCopy}><Clipboard className="w-3.5 h-3.5 mr-2" /> Copy to Clipboard</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive"><Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Widget</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      <div className="h-[calc(100%-1.5rem)]">
        <WidgetView widget={{ ...w, config: effCfg }} />
      </div>
    </>
  );

  return (
    <>
      <Card className={cn("p-2 relative", className)}>{body}</Card>
      <Dialog open={expand} onOpenChange={setExpand}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader><DialogTitle>{c.title ?? widgetDef(w.type)?.label ?? w.type}</DialogTitle></DialogHeader>
          <div className="h-[70vh]"><WidgetView widget={{ ...w, config: effCfg }} /></div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Time Range & Aggregation popover panel.
function TimeAggPanel({ config, onApply }: { config: Record<string, any>; onApply: (patch: Record<string, any>) => void }) {
  const [override, setOverride] = useState(!!config.override);
  const [range, setRange] = useState(String(config.rangeHours ?? 24));
  const [agg, setAgg] = useState(String(config.agg ?? "last"));
  const [gran, setGran] = useState(String(config.granularity ?? "auto"));
  const [interp, setInterp] = useState(!!config.interpolated);
  const [refreshOn, setRefreshOn] = useState((config.refreshSec ?? 0) > 0);
  const [refresh, setRefresh] = useState(String(config.refreshSec && config.refreshSec > 0 ? config.refreshSec : 10));
  const selCls = "w-full h-8 rounded-md border border-border text-sm px-2 bg-background";

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-primary"><Clock3 className="w-4 h-4" /> Time Range &amp; Aggregation</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">Time Range</Label>
          <select value={range} onChange={(e) => setRange(e.target.value)} className={selCls} disabled={!override}>
            {RANGES.map((r) => <option key={r.v} value={String(r.v)}>{r.l}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Aggregation Type</Label>
          <select value={agg} onChange={(e) => setAgg(e.target.value)} className={selCls}>
            {AGG_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Granularity</Label>
          <select value={gran} onChange={(e) => setGran(e.target.value)} className={selCls}>
            {GRAN_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs mt-5">
          <input type="checkbox" checked={interp} onChange={(e) => setInterp(e.target.checked)} /> Interpolated
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={refreshOn} onCheckedChange={setRefreshOn} className="scale-90" />
        <span className="text-xs">Refresh</span>
        <select value={refresh} onChange={(e) => setRefresh(e.target.value)} className={cn(selCls, "flex-1")} disabled={!refreshOn}>
          {REFRESH_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <Switch checked={override} onCheckedChange={setOverride} className="scale-90" /> Allow Override (use this widget's own range)
      </label>

      <div className="flex justify-end">
        <Button size="sm" className="h-8" onClick={() => onApply({
          override, rangeHours: Number(range), agg, granularity: gran, interpolated: interp,
          refreshSec: refreshOn ? Number(refresh) : 0,
        })}>Apply</Button>
      </div>
    </div>
  );
}

// ── Add Widget dialog ─────────────────────────────────────────────────────────
type Resolved = Record<string, { ownerId: string | null; tags: string[] }>;

function AddWidgetDialog({
  open, onOpenChange, assets, currentAssetId, currentTags, currentOwnerId, onAdd, edit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assets: Asset[];
  currentAssetId: string;
  currentTags: string[];
  currentOwnerId: string | null;
  onAdd: (w: Widget) => void;
  edit?: Widget | null;
}) {
  const [type, setType] = useState<string>("line");
  const [assetId, setAssetId] = useState<string>(currentAssetId);
  const [primary, setPrimary] = useState<string>("");
  const [overlays, setOverlays] = useState<{ assetId: string; tag: string }[]>([]);
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const [uom, setUom] = useState("");
  const [color, setColor] = useState<string>(PALETTE.primary);
  const [ucl, setUcl] = useState(""); const [lcl, setLcl] = useState(""); const [cl, setCl] = useState("");
  const [image, setImage] = useState("");
  const [resolved, setResolved] = useState<Resolved>({});

  const ensure = (id: string) => {
    if (!id) return;
    setResolved((prev) => {
      if (prev[id]) return prev;
      resolveTags(id, assets).then((r) => setResolved((p) => ({ ...p, [id]: r })));
      return prev;
    });
  };

  useEffect(() => {
    if (!open) return;
    if (edit) {
      const ec = edit.config ?? {};
      const ownerId = ec.assetId ?? null;
      const eTags: string[] = Array.isArray(ec.tags) ? ec.tags : (ec.tag ? [ec.tag] : []);
      setType(edit.type);
      setAssetId(ownerId ?? currentAssetId);
      setPrimary(ec.tag ?? eTags[0] ?? "");
      setOverlays(eTags.slice(1).map((t) => ({ assetId: ownerId ?? currentAssetId, tag: t })));
      setTitle(ec.title ?? ""); setLabel(ec.subtitle ?? ""); setUom(ec.unit ?? "");
      setColor(ec.color ?? PALETTE.primary);
      setUcl(ec.ucl != null ? String(ec.ucl) : ""); setLcl(ec.lcl != null ? String(ec.lcl) : ""); setCl(ec.cl != null ? String(ec.cl) : "");
      setImage(ec.image ?? "");
      setResolved(ownerId ? { [ownerId]: { ownerId, tags: eTags.length ? eTags : currentTags } } : {});
      return;
    }
    setType("line"); setAssetId(currentAssetId); setPrimary(""); setOverlays([]);
    setTitle(""); setLabel(""); setUom(""); setColor(PALETTE.primary); setUcl(""); setLcl(""); setCl(""); setImage("");
    setResolved(currentAssetId ? { [currentAssetId]: { ownerId: currentOwnerId, tags: currentTags } } : {});
  }, [open]); // eslint-disable-line

  useEffect(() => { if (open) ensure(assetId); }, [assetId, open]); // eslint-disable-line

  const owner = resolved[assetId]?.ownerId ?? null;
  const primaryTags = resolved[assetId]?.tags ?? [];
  const supportsOverlay = OVERLAY_TYPES.has(type);
  const canAdd = !!(owner && primary);

  function addSeries() {
    if (overlays.length >= 4) return;
    setOverlays((cur) => [...cur, { assetId, tag: "" }]);
    ensure(assetId);
  }
  function setSeriesAsset(i: number, id: string) {
    setOverlays((cur) => cur.map((s, j) => (j === i ? { assetId: id, tag: "" } : s)));
    ensure(id);
  }
  function setSeriesTag(i: number, tag: string) {
    setOverlays((cur) => cur.map((s, j) => (j === i ? { ...s, tag } : s)));
  }
  function removeSeries(i: number) { setOverlays((cur) => cur.filter((_, j) => j !== i)); }

  function submit() {
    if (!canAdd || !owner) return;
    const def = widgetDef(type);
    // Overlays that resolve to the SAME device owner plot on the same chart.
    const overlayTags = overlays
      .filter((s) => s.tag && resolved[s.assetId]?.ownerId === owner)
      .map((s) => s.tag);
    const chosenTags = [primary, ...overlayTags].slice(0, 5);
    const w: Widget = {
      id: edit?.id ?? newId("w"),
      type,
      x: edit?.x ?? 0, y: edit?.y ?? 0, w: edit?.w ?? def?.w ?? 6, h: edit?.h ?? def?.h ?? 4,
      config: {
        ...(def?.defaults ?? {}),
        ...(edit?.config ?? {}),
        assetId: owner,
        title: title.trim() || def?.label || primary,
        subtitle: label.trim() || undefined,
        tag: primary,
        tags: chosenTags,
        unit: uom.trim() || undefined,
        color,
        agg: "last",
        max: 100,
        ucl: ucl.trim() || undefined,
        lcl: lcl.trim() || undefined,
        cl: cl.trim() || undefined,
        image: image.trim() || undefined,
        src: image.trim() || undefined,
      },
    };
    onAdd(w);
  }

  const selCls = "w-full h-8 rounded-md border border-border text-sm px-2 bg-background";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{edit ? "Edit Widget" : "Add Widget"}</DialogTitle>
          <p className="text-sm text-muted-foreground">Configure your visualization widget</p>
        </DialogHeader>
        <div className="space-y-3 max-h-[65vh] overflow-auto pr-1">
          <div className="space-y-1">
            <Label className="text-xs">Widget Type</Label>
            <select value={type} onChange={(e) => setType(e.target.value)} className={selCls}>
              {ADD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Title <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto-generated if blank" className="h-8 text-sm" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Asset</Label>
            <select value={assetId} onChange={(e) => { setAssetId(e.target.value); setPrimary(""); }} className={selCls}>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Primary Metric</Label>
            <select value={primary} onChange={(e) => setPrimary(e.target.value)} className={selCls} disabled={!owner || primaryTags.length === 0}>
              <option value="">{primaryTags.length ? "— select —" : "no tags for asset"}</option>
              {primaryTags.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Short display name" className="h-8 text-sm" /></div>
            <div className="space-y-1"><Label className="text-xs">UoM</Label><Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="e.g. kWh, °C" className="h-8 text-sm" /></div>
          </div>

          {supportsOverlay && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Overlay Metrics <span className="text-muted-foreground font-normal">(multi-series)</span></Label>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={overlays.length >= 4} onClick={addSeries}><Plus className="w-3 h-3 mr-1" /> Add Series</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Add extra series to overlay on the same chart from any asset.</p>
              {overlays.map((s, i) => {
                const sTags = resolved[s.assetId]?.tags ?? [];
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <select value={s.assetId} onChange={(e) => setSeriesAsset(i, e.target.value)} className={cn(selCls, "flex-1")}>
                      {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <select value={s.tag} onChange={(e) => setSeriesTag(i, e.target.value)} className={cn(selCls, "flex-1")}>
                      <option value="">{sTags.length ? "— metric —" : "…"}</option>
                      {sTags.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button onClick={() => removeSeries(i)} className="p-1 text-muted-foreground hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
            </div>
          )}

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground border-t border-border pt-2">
            <RefreshCw className="w-3 h-3" /> Time range applies globally from the toolbar.
          </p>

          {supportsOverlay && (
            <div className="space-y-1.5">
              <Label className="text-xs">Control Limit Lines (SPC)</Label>
              <p className="text-[11px] text-muted-foreground">Enter a Y-axis value to draw a horizontal reference line. Leave blank to hide.</p>
              {([["UCL", ucl, setUcl], ["LCL", lcl, setLcl], ["CL", cl, setCl]] as const).map(([lbl, val, setter]) => (
                <div key={lbl} className="flex items-center gap-2 rounded-md border border-border overflow-hidden">
                  <span className="text-xs font-semibold text-primary px-2 shrink-0 w-12">{lbl}</span>
                  <Input type="number" value={val} onChange={(e) => setter(e.target.value)} className="h-8 text-sm border-0 focus-visible:ring-0" placeholder="—" />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Primary Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_SWATCHES.map((col) => (
                <button key={col} onClick={() => setColor(col)} className={cn("w-6 h-6 rounded-full border-2", color === col ? "border-slate-800 dark:border-white" : "border-transparent")} style={{ background: col }} />
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Widget Image <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="Paste image URL or copy from Media Library" className="h-8 text-sm" />
            <p className="text-[11px] text-muted-foreground">Upload images first in <strong>Asset Management → Media Library</strong>, then copy the URL here.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canAdd} onClick={submit}>{edit ? "Save Widget" : "Add Widget"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
