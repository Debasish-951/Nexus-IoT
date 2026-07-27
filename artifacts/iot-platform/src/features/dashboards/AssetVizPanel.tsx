import { useEffect, useMemo, useState } from "react";
import {
  MousePointerClick, RefreshCw, Maximize2, Minimize2, Wifi, WifiOff,
  Save, Plus, X, Clock, ClipboardPaste, CalendarDays,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DashboardCanvas } from "./DashboardCanvas";
import { WidgetPanel } from "./WidgetPanel";
import { WidgetConfigPanel } from "./WidgetConfigPanel";
import { widgetDef } from "./registry";
import type { Widget } from "./types";
import { resolveTags } from "./assetBinding";
import { useWsEvents } from "@/hooks/useWsEvents";
import { newId } from "./useDashboards";
import { RANGES, REFRESH_INTERVALS } from "./timeRange";
import type { Asset } from "@/pages/assetShared";

const wkey = (assetId: string) => `wsviz:widgets:${assetId}`;
const CLIPBOARD_KEY = "wsviz:widget-clipboard";

function readClipboard(): Widget | null {
  try { const raw = localStorage.getItem(CLIPBOARD_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// The Dashboard Builder canvas + Widget Library/Properties, scoped to one
// asset. Drag a widget from the Library onto the canvas to add it — each
// widget binds to its own asset/metric via the Properties panel, so a
// project's dashboard can pull in any child asset's telemetry.
export function AssetVizPanel({ assetId, assetName, assets, reloadKey, futuristic }: { assetId: string | null; assetName?: string; assets: Asset[]; reloadKey?: number; futuristic?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [customWidgets, setCustomWidgets] = useState<Widget[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState("[]");
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [editWidgetId, setEditWidgetId] = useState<string | null>(null);
  const [draftWidget, setDraftWidget] = useState<{ type: string; x: number; y: number } | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [rangePopoverOpen, setRangePopoverOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const { toast } = useToast();

  // Dashboard-wide auto-refresh — bumps globalRefreshTick, which every
  // widget's data hook includes as a refetch dependency.
  const [dashRefreshEnabled, setDashRefreshEnabled] = useState(false);
  const [dashRefreshInterval, setDashRefreshInterval] = useState(1_000);
  const [globalRefreshTick, setGlobalRefreshTick] = useState(0);
  const [widgetRefreshTick, setWidgetRefreshTick] = useState<Record<string, number>>({});
  const [widgetClipboard, setWidgetClipboard] = useState<Widget | null>(() => readClipboard());

  function refreshAll() { setGlobalRefreshTick((t) => t + 1); }
  useEffect(() => {
    if (!dashRefreshEnabled) return;
    const iv = setInterval(refreshAll, dashRefreshInterval);
    return () => clearInterval(iv);
  }, [dashRefreshEnabled, dashRefreshInterval]);

  const refreshNonces = useMemo(() => {
    const m: Record<string, string> = {};
    for (const w of customWidgets) m[w.id] = `${globalRefreshTick}:${widgetRefreshTick[w.id] ?? 0}`;
    return m;
  }, [customWidgets, globalRefreshTick, widgetRefreshTick]);

  // Live WebSocket status — drives the badge. When a device attaches or a new
  // metric appears, re-resolve this asset's owner/tags (throttled to 7s).
  const wsStatus = useWsEvents({
    telemetry: () => {
      setTick((t) => t + 1);
    },
  });

  // Persist widgets per asset (localStorage).
  useEffect(() => {
    if (!assetId) { setCustomWidgets([]); setSavedSnapshot("[]"); return; }
    let loaded: Widget[] = [];
    try {
      const raw = localStorage.getItem(wkey(assetId));
      loaded = raw ? JSON.parse(raw) : [];
    } catch { loaded = []; }
    setCustomWidgets(loaded);
    setSavedSnapshot(JSON.stringify(loaded));
    setSelectedWidgetId(null);
    setShowLibrary(false);
  }, [assetId, reloadKey]);
  useEffect(() => {
    if (!assetId) return;
    try { localStorage.setItem(wkey(assetId), JSON.stringify(customWidgets)); } catch { /* ignore quota */ }
  }, [assetId, customWidgets]);

  // Resolve the selected asset's device owner + available tags (used to
  // pre-bind newly dropped widgets to this asset's first metric).
  useEffect(() => {
    if (!assetId) { setOwnerId(null); setAllTags([]); return; }
    let cancelled = false;
    setLoading(true);
    resolveTags(assetId, assets)
      .then(({ ownerId, tags }) => { if (!cancelled) { setOwnerId(ownerId); setAllTags(tags); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId, assets, tick]);

  // ── Toolbar actions ──
  function saveNow() {
    if (!assetId) return;
    try {
      const snapshot = JSON.stringify(customWidgets);
      localStorage.setItem(wkey(assetId), snapshot);
      toast({ title: "Saved", description: `${customWidgets.length} widget(s) stored for ${assetName ?? "asset"}.` });
      setSavedSnapshot(snapshot);
      setShowLibrary(false);
      setSelectedWidgetId(null);
    }
    catch { toast({ title: "Save failed", variant: "destructive" }); }
  }

  function applyGlobalRange(minutes: number) {
    setCustomWidgets((prev) => prev.map((w) => (
      w.config?.allowOverride === false
        ? w
        : { ...w, config: { ...w.config, rangeMinutes: minutes, rangeHours: undefined, customFrom: undefined, customTo: undefined } }
    )));
  }
  function applyGlobalCustomRange() {
    if (!customFrom || !customTo) return;
    setCustomWidgets((prev) => prev.map((w) => (
      w.config?.allowOverride === false
        ? w
        : { ...w, config: { ...w.config, rangeMinutes: -1, customFrom, customTo, rangeHours: undefined } }
    )));
    setRangePopoverOpen(false);
  }

  function updateConfig(id: string, patch: Record<string, any>) {
    setCustomWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, config: { ...w.config, ...patch } } : w)));
  }
  function updateWidget(id: string, patch: Partial<Widget>) {
    setCustomWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }
  // Dropping a widget from the Library only opens the config panel — it is not
  // added to customWidgets (and therefore not persisted) until the panel is saved.
  function onDropWidget(type: string, x: number, y: number) {
    setEditWidgetId(null);
    setShowLibrary(false);
    setDraftWidget({ type, x, y });
  }
  function startEdit(id: string) {
    setDraftWidget(null);
    setShowLibrary(false);
    setEditWidgetId(id);
  }
  function saveDraftWidget(type: string, config: Record<string, any>) {
    if (!draftWidget) return;
    const def = widgetDef(type);
    const widget: Widget = { id: newId("w"), type, x: draftWidget.x, y: draftWidget.y, w: def?.w ?? 3, h: def?.h ?? 3, config };
    setCustomWidgets((prev) => [...prev, widget]);
    setDraftWidget(null);
    setSelectedWidgetId(widget.id);
  }
  function saveEditWidget(type: string, config: Record<string, any>) {
    if (!editWidgetId) return;
    const current = customWidgets.find((w) => w.id === editWidgetId);
    if (current && type !== current.type) {
      const def = widgetDef(type);
      updateWidget(editWidgetId, { type, w: def?.w ?? current.w, h: def?.h ?? current.h });
    }
    updateConfig(editWidgetId, config);
    setEditWidgetId(null);
  }
  function onRefreshWidget(id: string) {
    setWidgetRefreshTick((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }
  function onCopyWidget(w: Widget) {
    const { id, ...rest } = w;
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(rest)); } catch { /* ignore quota */ }
    navigator.clipboard?.writeText(JSON.stringify(rest)).catch(() => {});
    setWidgetClipboard(w);
    toast({ title: "Copied to clipboard", description: `"${w.config?.title ?? w.type}" can be pasted into any dashboard.` });
  }
  function pasteWidget() {
    if (!widgetClipboard) return;
    const pasted: Widget = { ...widgetClipboard, id: newId("w") };
    setCustomWidgets((prev) => [...prev, pasted]);
    setSelectedWidgetId(pasted.id);
    toast({ title: "Widget pasted" });
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

  const editWidget = customWidgets.find((w) => w.id === editWidgetId) ?? null;
  const dirty = JSON.stringify(customWidgets) !== savedSnapshot;

  const rightPanelMode: "library" | "create" | "edit" | null =
    editWidget ? "edit" : draftWidget ? "create" : showLibrary ? "library" : null;
  const draftInitialConfig = draftWidget
    ? { ...(widgetDef(draftWidget.type)?.defaults ?? {}), assetId: ownerId ?? undefined, tag: allTags[0] ?? undefined }
    : null;

  return (
    <div className={cn("h-full flex flex-col", fullscreen && "fixed inset-0 z-50 bg-background")}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold truncate">{assetName ?? "Asset"}</h2>
          <p className="text-xs text-muted-foreground">{allTags.length} metric{allTags.length !== 1 ? "s" : ""} available</p>
        </div>

        <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-medium", wsBadge.cls)}>
          <wsBadge.icon className="w-3 h-3" /> {wsBadge.label}
        </span>

        {/* Dashboard-wide auto-refresh */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={refreshAll} title="Refresh all widgets now" className="p-1.5 rounded hover:bg-muted text-muted-foreground">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <Switch checked={dashRefreshEnabled} onCheckedChange={setDashRefreshEnabled} className="scale-90" />
          <span className={cn("text-xs", dashRefreshEnabled ? "text-green-600" : "text-muted-foreground")}>{dashRefreshEnabled ? "On" : "Off"}</span>
          <Select value={String(dashRefreshInterval)} onValueChange={(v) => setDashRefreshInterval(Number(v))}>
            <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{REFRESH_INTERVALS.map((r) => <SelectItem key={r.ms} value={String(r.ms)}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {/* Dashboard-wide time range */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <Select onValueChange={(v) => applyGlobalRange(Number(v))}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Set all ranges…" /></SelectTrigger>
            <SelectContent>{RANGES.filter((r) => r.minutes > 0).map((r) => <SelectItem key={r.minutes} value={String(r.minutes)}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
          <Popover open={rangePopoverOpen} onOpenChange={setRangePopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" title="Custom date range for all widgets"><CalendarDays className="w-4 h-4" /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3 space-y-2">
              <p className="text-xs font-semibold">Custom range — all widgets</p>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">From</Label>
                <Input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">To</Label>
                <Input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 text-xs" />
              </div>
              <Button size="sm" className="w-full" disabled={!customFrom || !customTo} onClick={applyGlobalCustomRange}>Apply to all</Button>
            </PopoverContent>
          </Popover>
        </div>

        <Button variant="outline" size="sm" onClick={() => setFullscreen((f) => !f)} title="Fullscreen">{fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</Button>
        {widgetClipboard && (
          <Button variant="outline" size="sm" onClick={pasteWidget} title={`Paste "${widgetClipboard.config?.title ?? widgetClipboard.type}"`}>
            <ClipboardPaste className="w-4 h-4 mr-1" /> Paste
          </Button>
        )}
        {dirty && (
          <Button size="sm" onClick={saveNow} title="Save widgets"><Save className="w-4 h-4 mr-1" /> Save</Button>
        )}
        <Button
          size="sm"
          onClick={() => {
            setSelectedWidgetId(null);
            if (rightPanelMode) { setEditWidgetId(null); setDraftWidget(null); setShowLibrary(false); }
            else setShowLibrary(true);
          }}
          title={rightPanelMode ? "Close panel" : "Add a widget"}
        >
          {rightPanelMode ? <X className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
          {rightPanelMode ? "Close" : "Add Widget"}
        </Button>
      </div>

      {/* Canvas + Widget Library / Config Panel — the Dashboard Builder, scoped to this asset */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          <DashboardCanvas
            widgets={customWidgets}
            setWidgets={setCustomWidgets}
            selectedId={selectedWidgetId}
            onSelect={setSelectedWidgetId}
            onDropWidget={onDropWidget}
            updateConfig={updateConfig}
            refreshNonces={refreshNonces}
            onRefreshWidget={onRefreshWidget}
            onCopyWidget={onCopyWidget}
            onEditWidget={startEdit}
            futuristic={futuristic}
          />
        </div>
        {rightPanelMode && (
          <div className={cn("shrink-0 border-l border-border", rightPanelMode === "library" ? "w-72" : "w-80")}>
            {rightPanelMode === "library" && <WidgetPanel onClose={() => setShowLibrary(false)} />}
            {rightPanelMode === "create" && draftWidget && (
              <WidgetConfigPanel
                key={`create-${draftWidget.type}-${draftWidget.x}-${draftWidget.y}`}
                mode="create"
                type={draftWidget.type}
                initialConfig={draftInitialConfig ?? {}}
                onSave={saveDraftWidget}
                onCancel={() => setDraftWidget(null)}
              />
            )}
            {rightPanelMode === "edit" && editWidget && (
              <WidgetConfigPanel
                key={`edit-${editWidget.id}`}
                mode="edit"
                type={editWidget.type}
                initialConfig={editWidget.config}
                onSave={saveEditWidget}
                onCancel={() => setEditWidgetId(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
