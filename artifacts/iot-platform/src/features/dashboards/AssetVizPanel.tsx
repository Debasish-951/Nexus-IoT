import { useEffect, useMemo, useRef, useState } from "react";
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
import { useWsEvents } from "@/hooks/useWsEvents";
import { newId } from "./useDashboards";
import { RANGES, REFRESH_INTERVALS } from "./timeRange";

const wkey = (nodeId: string) => `wsviz:widgets:${nodeId}`;
const CLIPBOARD_KEY = "wsviz:widget-clipboard";

function readClipboard(): Widget | null {
  try { const raw = localStorage.getItem(CLIPBOARD_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// The Dashboard Builder canvas + Widget Library/Config panel for ONE node of the
// Visualization hierarchy. Nodes are organisational only — they carry no device
// or metrics of their own, so nothing is pre-bound here. Each widget picks its
// own asset + metric in the config panel, where the asset's attribute names and
// units are surfaced alongside the raw telemetry tag.
export function AssetVizPanel({ nodeId, nodeName, reloadKey, futuristic }: { nodeId: string | null; nodeName?: string; reloadKey?: number; futuristic?: boolean }) {
  const [customWidgets, setCustomWidgets] = useState<Widget[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState("[]");
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [editWidgetId, setEditWidgetId] = useState<string | null>(null);
  // A dropped-but-not-yet-committed widget. It IS on the canvas (so the user sees
  // it build up live while configuring); cancelling removes it again.
  const [draftWidgetId, setDraftWidgetId] = useState<string | null>(null);
  const editSnapshot = useRef<Widget | null>(null);
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

  // Live WebSocket status — drives the badge. Telemetry can arrive many times a
  // second, so nudge the dashboard at most once per 7s.
  const lastWsRef = useRef(0);
  const wsStatus = useWsEvents({
    telemetry: () => {
      const now = Date.now();
      if (now - lastWsRef.current > 7000) { lastWsRef.current = now; refreshAll(); }
    },
  });

  // Persist widgets per node (localStorage).
  useEffect(() => {
    if (!nodeId) { setCustomWidgets([]); setSavedSnapshot("[]"); return; }
    let loaded: Widget[] = [];
    try {
      const raw = localStorage.getItem(wkey(nodeId));
      loaded = raw ? JSON.parse(raw) : [];
    } catch { loaded = []; }
    setCustomWidgets(loaded);
    setSavedSnapshot(JSON.stringify(loaded));
    setSelectedWidgetId(null);
    setShowLibrary(false);
  }, [nodeId, reloadKey]);
  useEffect(() => {
    if (!nodeId) return;
    try { localStorage.setItem(wkey(nodeId), JSON.stringify(customWidgets)); } catch { /* ignore quota */ }
  }, [nodeId, customWidgets]);

  // ── Toolbar actions ──
  function saveNow() {
    if (!nodeId) return;
    try {
      const snapshot = JSON.stringify(customWidgets);
      localStorage.setItem(wkey(nodeId), snapshot);
      toast({ title: "Saved", description: `${customWidgets.length} widget(s) stored for ${nodeName ?? "this node"}.` });
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
  // Dropping a widget places it on the canvas immediately and opens its config
  // panel, so the dashboard is never blank while you configure.
  function onDropWidget(type: string, x: number, y: number) {
    const def = widgetDef(type);
    const widget: Widget = {
      id: newId("w"), type, x, y,
      w: def?.w ?? 3, h: def?.h ?? 3,
      config: { ...(def?.defaults ?? {}) },
    };
    setEditWidgetId(null);
    editSnapshot.current = null;
    setShowLibrary(false);
    setCustomWidgets((prev) => [...prev, widget]);
    setDraftWidgetId(widget.id);
    setSelectedWidgetId(widget.id);
  }
  function startEdit(id: string) {
    setDraftWidgetId(null);
    setShowLibrary(false);
    editSnapshot.current = customWidgets.find((w) => w.id === id) ?? null;
    setEditWidgetId(id);
  }

  // Live preview: every keystroke in the config panel lands on the canvas widget.
  function applyPanelChange(id: string, type: string, config: Record<string, any>) {
    setCustomWidgets((prev) => prev.map((w) => {
      if (w.id !== id) return w;
      if (w.type === type) return { ...w, config };
      const def = widgetDef(type);   // type switched → adopt the new type's default size
      return { ...w, type, config, w: def?.w ?? w.w, h: def?.h ?? w.h };
    }));
  }

  function commitDraft() { setDraftWidgetId(null); }
  function cancelDraft() {
    if (draftWidgetId) setCustomWidgets((prev) => prev.filter((w) => w.id !== draftWidgetId));
    setDraftWidgetId(null);
    setSelectedWidgetId(null);
  }
  function commitEdit() { editSnapshot.current = null; setEditWidgetId(null); }
  function cancelEdit() {
    const snap = editSnapshot.current;
    if (snap) setCustomWidgets((prev) => prev.map((w) => (w.id === snap.id ? snap : w)));
    editSnapshot.current = null;
    setEditWidgetId(null);
  }
  function closePanel() {
    if (draftWidgetId) cancelDraft();
    else if (editWidgetId) cancelEdit();
    else setShowLibrary(false);
  }
  function onRefreshWidget(id: string) {
    setWidgetRefreshTick((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }
  function onCopyWidget(w: Widget) {
    const { id, ...rest } = w;
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(rest)); } catch { /* ignore quota */ }
    navigator.clipboard?.writeText(JSON.stringify(rest)).catch(() => {});
    setWidgetClipboard(w);
    toast({ title: "Copied to clipboard", description: `"${w.config?.title || widgetDef(w.type)?.label || w.type}" can be pasted into any dashboard.` });
  }
  function pasteWidget() {
    if (!widgetClipboard) return;
    const pasted: Widget = { ...widgetClipboard, id: newId("w") };
    setCustomWidgets((prev) => [...prev, pasted]);
    setSelectedWidgetId(pasted.id);
    toast({ title: "Widget pasted" });
  }

  if (!nodeId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
        <MousePointerClick className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm">Select a node from the hierarchy to build its dashboard.</p>
      </div>
    );
  }

  const wsBadge = wsStatus === "connected"
    ? { cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300", icon: Wifi, label: "Live" }
    : { cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: WifiOff, label: wsStatus === "connecting" ? "Connecting" : "Reconnecting" };

  const editWidget = customWidgets.find((w) => w.id === editWidgetId) ?? null;
  const draftWidget = customWidgets.find((w) => w.id === draftWidgetId) ?? null;
  const dirty = JSON.stringify(customWidgets) !== savedSnapshot;

  const rightPanelMode: "library" | "create" | "edit" | null =
    editWidget ? "edit" : draftWidget ? "create" : showLibrary ? "library" : null;

  return (
    <div className={cn("h-full flex flex-col", fullscreen && "fixed inset-0 z-50 bg-background")}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold truncate">{nodeName ?? "Dashboard"}</h2>
          <p className="text-xs text-muted-foreground">{customWidgets.length} widget{customWidgets.length !== 1 ? "s" : ""}</p>
        </div>

        <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-medium", wsBadge.cls)}>
          <wsBadge.icon className="w-3 h-3" /> {wsBadge.label}
        </span>

        {/* Dashboard-wide auto-refresh */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={refreshAll} title="Refresh all widgets now" className="p-1.5 rounded hover:bg-muted text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5" />
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
          <Button variant="outline" size="sm" onClick={pasteWidget} title={`Paste "${widgetClipboard.config?.title || widgetDef(widgetClipboard.type)?.label || widgetClipboard.type}"`}>
            <ClipboardPaste className="w-4 h-4 mr-1" /> Paste
          </Button>
        )}
        {dirty && (
          <Button size="sm" onClick={saveNow} title="Save widgets"><Save className="w-4 h-4 mr-1" /> Save</Button>
        )}
        <Button
          size="sm"
          onClick={() => {
            if (rightPanelMode) closePanel();
            else { setSelectedWidgetId(null); setShowLibrary(true); }
          }}
          title={rightPanelMode ? "Close panel" : "Add a widget"}
        >
          {rightPanelMode ? <X className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
          {rightPanelMode ? "Close" : "Add Widget"}
        </Button>
      </div>

      {/* Canvas + Widget Library / Config Panel */}
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
                key={`create-${draftWidget.id}`}
                mode="create"
                type={draftWidget.type}
                initialConfig={draftWidget.config}
                onChange={(t, c) => applyPanelChange(draftWidget.id, t, c)}
                onSave={commitDraft}
                onCancel={cancelDraft}
              />
            )}
            {rightPanelMode === "edit" && editWidget && (
              <WidgetConfigPanel
                key={`edit-${editWidget.id}`}
                mode="edit"
                type={editWidget.type}
                initialConfig={editWidget.config}
                onChange={(t, c) => applyPanelChange(editWidget.id, t, c)}
                onSave={commitEdit}
                onCancel={cancelEdit}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
