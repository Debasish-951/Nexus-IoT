import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { widgetDef, migrateLegacyWidget } from "./registry";
import type { Widget } from "./types";
import { useWsEvents } from "@/hooks/useWsEvents";
import { newId } from "./useDashboards";
import { RANGES, REFRESH_INTERVALS, type TimeCfg } from "./timeRange";
import { STALE_AFTER_MS } from "@/pages/assetShared";

const wkey = (nodeId: string) => `wsviz:widgets:${nodeId}`;
const dashCfgKey = (nodeId: string) => `wsviz:dash-range:${nodeId}`;
const dashRefreshKey = (nodeId: string) => `wsviz:dash-refresh:${nodeId}`;
const CLIPBOARD_KEY = "wsviz:widget-clipboard";

// Every asset actually bound by a widget on the open dashboard — a Card's
// metrics, a chart's overlays, and a plain single-attribute binding all count.
// Used to answer "is THIS dashboard live", not "is anything anywhere live".
function boundAssetIds(widgets: Widget[]): string[] {
  const ids = new Set<string>();
  for (const w of widgets) {
    const c = w.config ?? {};
    if (c.assetId) ids.add(c.assetId);
    if (Array.isArray(c.overlays)) for (const o of c.overlays) if (o?.assetId) ids.add(o.assetId);
    if (Array.isArray(c.metrics)) for (const m of c.metrics) if (m?.assetId) ids.add(m.assetId);
  }
  return [...ids];
}

// Polls each bound asset's health and reduces it to one live/inactive verdict
// for the dashboard as a whole — reuses the same staleness window that drives
// the "Offline" badge on the Asset Management pages, so "live" means the same
// thing everywhere in the app. "none" = nothing bound yet (no widgets, or only
// non-data ones like Text/Button) — treated as inactive by the caller.
function useDashboardLiveStatus(assetIds: string[], refreshNonce: number): "live" | "inactive" | "none" {
  const [status, setStatus] = useState<"live" | "inactive" | "none">("none");
  const key = assetIds.join(",");
  useEffect(() => {
    if (assetIds.length === 0) { setStatus("none"); return; }
    let cancelled = false;
    async function check() {
      const results = await Promise.all(assetIds.map(async (id) => {
        try {
          const res = await fetch(`/api/assets/${id}/health`, { credentials: "include" });
          if (!res.ok) return false;
          const health = await res.json();
          if (!health?.lastSeen) return false;
          const age = Date.now() - new Date(health.lastSeen).getTime();
          return !isNaN(age) && age <= STALE_AFTER_MS;
        } catch { return false; }
      }));
      if (!cancelled) setStatus(results.some(Boolean) ? "live" : "inactive");
    }
    check();
    const iv = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshNonce]);
  return status;
}

function readClipboard(): Widget | null {
  try { const raw = localStorage.getItem(CLIPBOARD_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// The Dashboard Builder canvas + Widget Library/Config panel for ONE node of the
// Visualization hierarchy. Nodes are organisational only — they carry no device
// or metrics of their own, so nothing is pre-bound here. Each widget picks its
// own asset + metric in the config panel, where the asset's attribute names and
// units are surfaced alongside the raw telemetry tag.
export function AssetVizPanel({ nodeId, nodeName, reloadKey, futuristic, toolbarTarget }: {
  nodeId: string | null; nodeName?: string; reloadKey?: number; futuristic?: boolean;
  /** Element in the page header to render the toolbar into, so it shares a row
   *  with "← Back / Visualization" instead of costing the canvas its own strip. */
  toolbarTarget?: HTMLElement | null;
}) {
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
  // Anchored to the calendar button beside the range selector — a date range belongs
  // next to the control it changes, not in a modal in the middle of the canvas.
  const [rangePopoverOpen, setRangePopoverOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // The dashboard-wide range. Unlike the old design, this is NOT copied into each
  // widget's own config — a widget that hasn't set its own range (no `timeIsCustom`)
  // reads this LIVE, at render time, in WidgetView. Two problems that caused solved
  // by that alone: a plain page reload used to lose this (it was pure component
  // state with no persistence — restored below, same as the widgets themselves are),
  // and a widget that never asked to follow the dashboard would still be left
  // carrying a permanently-stamped copy of whatever this was set to at the moment
  // someone touched the selector, even after the selector itself moved on.
  const [dashTimeCfg, setDashTimeCfg] = useState<TimeCfg | null>(null);
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

  // Whether THIS dashboard's own bound assets are actually receiving telemetry —
  // separate from wsStatus below, which only says the browser's socket to our
  // own server is up. A dashboard with a live socket but no recent data from any
  // asset it's bound to is Inactive, not Live (see useDashboardLiveStatus).
  const dashboardAssetIds = useMemo(() => boundAssetIds(customWidgets), [customWidgets]);
  const liveStatus = useDashboardLiveStatus(dashboardAssetIds, globalRefreshTick);

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
      // Upgrades any pre-existing Custom KPI / Health Score / OEE / … widget to
      // the general Card widget on load, so a dashboard saved before that
      // consolidation still renders instead of quietly breaking.
      loaded = raw ? (JSON.parse(raw) as Widget[]).map(migrateLegacyWidget) : [];
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

  // Persist the dashboard-wide range per node, same pattern as the widgets above.
  useEffect(() => {
    if (!nodeId) { setDashTimeCfg(null); return; }
    try {
      const raw = localStorage.getItem(dashCfgKey(nodeId));
      setDashTimeCfg(raw ? JSON.parse(raw) : null);
    } catch { setDashTimeCfg(null); }
  }, [nodeId, reloadKey]);
  useEffect(() => {
    if (!nodeId) return;
    try {
      if (dashTimeCfg) localStorage.setItem(dashCfgKey(nodeId), JSON.stringify(dashTimeCfg));
      else localStorage.removeItem(dashCfgKey(nodeId));
    } catch { /* ignore quota */ }
  }, [nodeId, dashTimeCfg]);

  // Same for the dashboard-wide refresh toggle/interval — it was pure component
  // state before, so a page reload silently turned it back off.
  useEffect(() => {
    if (!nodeId) { setDashRefreshEnabled(false); setDashRefreshInterval(1_000); return; }
    try {
      const raw = localStorage.getItem(dashRefreshKey(nodeId));
      const saved = raw ? JSON.parse(raw) : null;
      setDashRefreshEnabled(!!saved?.enabled);
      setDashRefreshInterval(saved?.intervalMs ?? 1_000);
    } catch { setDashRefreshEnabled(false); setDashRefreshInterval(1_000); }
  }, [nodeId, reloadKey]);
  useEffect(() => {
    if (!nodeId) return;
    try { localStorage.setItem(dashRefreshKey(nodeId), JSON.stringify({ enabled: dashRefreshEnabled, intervalMs: dashRefreshInterval })); } catch { /* ignore quota */ }
  }, [nodeId, dashRefreshEnabled, dashRefreshInterval]);

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

  // Sets the dashboard-wide range itself — nothing is written into any widget's
  // config. A widget picks this up live (in WidgetView) unless it has its own
  // `timeIsCustom` range, so there is nothing here to keep in sync and nothing
  // stale left behind once a widget stops following it.
  // Seeded from whatever range is already applied, so reopening shows the current
  // dates instead of two blank fields.
  function seedCustomRange() {
    setCustomFrom(dashTimeCfg?.customFrom ?? "");
    setCustomTo(dashTimeCfg?.customTo ?? "");
  }
  // Only ranges that are complete on their own reach here — "Custom range" is not
  // offered in the selector precisely because it would need two dates this has no
  // way to ask for. The calendar button's popover owns that path.
  function applyGlobalRange(minutes: number) {
    setDashTimeCfg({ rangeMinutes: minutes });
  }
  function applyGlobalCustomRange() {
    if (!customFrom || !customTo) return;
    setDashTimeCfg({ rangeMinutes: -1, customFrom, customTo });
    setRangePopoverOpen(false);
  }

  // Stable identity (empty deps — it only ever uses the functional setState form)
  // so widgets that WidgetView.memo skips re-rendering during a drag/resize don't
  // get invalidated just because this prop's reference changed.
  const updateConfig = useCallback((id: string, patch: Record<string, any>) => {
    setCustomWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, config: { ...w.config, ...patch } } : w)));
  }, []);
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

  // Socket down/connecting takes priority — nothing about data freshness is
  // knowable without it. Once connected, the badge reports whether THIS
  // dashboard's bound assets are actually receiving telemetry, not merely
  // whether the browser has a socket open to our own server (that's always
  // "up" locally regardless of whether any device is really sending data).
  const wsBadge = wsStatus !== "connected"
    ? { cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: WifiOff, label: wsStatus === "connecting" ? "Connecting" : "Reconnecting" }
    : liveStatus === "live"
    ? { cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300", icon: Wifi, label: "Live" }
    : { cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", icon: WifiOff, label: "Inactive" };

  const editWidget = customWidgets.find((w) => w.id === editWidgetId) ?? null;
  const draftWidget = customWidgets.find((w) => w.id === draftWidgetId) ?? null;
  const dirty = JSON.stringify(customWidgets) !== savedSnapshot;
  const isDashCustom = dashTimeCfg?.rangeMinutes === -1;
  // An inverted range is accepted by the API but yields an empty chart with nothing
  // on screen to explain why, so block it at the source.
  const customRangeInvalid = !!customFrom && !!customTo && new Date(customFrom) >= new Date(customTo);

  const rightPanelMode: "library" | "create" | "edit" | null =
    editWidget ? "edit" : draftWidget ? "create" : showLibrary ? "library" : null;

  // Hoisted into the page header when a slot is offered (see Visualization.tsx),
  // which reclaims this toolbar's entire strip for the canvas. Fullscreen is the
  // exception: the panel goes `fixed inset-0` and covers the header, so a portalled
  // toolbar would be hidden underneath — it renders in place there instead.
  const inHeader = !!toolbarTarget && !fullscreen;

  const toolbar = (
    <>
      <div className="flex items-baseline gap-1.5 min-w-0">
        {inHeader && <span className="text-muted-foreground shrink-0">›</span>}
        <h2 className="text-sm font-bold truncate leading-tight">{nodeName ?? "Dashboard"}</h2>
        <span className="text-[11px] text-muted-foreground leading-tight whitespace-nowrap">
          {customWidgets.length} widget{customWidgets.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* `ml-auto` rather than a flex-1 title: keeps the controls hard right whether
          this renders in the page header or as the panel's own bar. */}
      <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
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

        {/* Dashboard-wide time range — read LIVE by any widget that has not set its
            own range in its clock-icon popover; never copied into a widget's config. */}
        <div className="flex items-center gap-1.5 shrink-0" title="Applies to widgets that haven't set their own time range">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          {/* Every range that this control can apply on its own. WTD/MTD/YTD belong
              here — getFromTo implements all three and they need no extra input — but
              "Custom range" does not: it is meaningless without two dates, and the
              calendar button beside this is where those are entered. */}
          <Select value={dashTimeCfg?.rangeMinutes != null ? String(dashTimeCfg.rangeMinutes) : ""} onValueChange={(v) => applyGlobalRange(Number(v))}>
            <SelectTrigger className="h-8 w-40 text-xs">
              {/* Children override: with no "Custom range" item left to supply the
                  trigger's text, an active custom range would otherwise leave this
                  looking empty — as though no range were set at all. */}
              <SelectValue placeholder="Set all ranges…">{isDashCustom ? "Custom range" : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RANGES.filter((r) => r.minutes !== -1).map((r) => <SelectItem key={r.minutes} value={String(r.minutes)}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Popover
            open={rangePopoverOpen}
            onOpenChange={(o) => { if (o) seedCustomRange(); setRangePopoverOpen(o); }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm"
                title={isDashCustom ? "Edit the custom date range" : "Custom date range for all widgets"}>
                <CalendarDays className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} collisionPadding={10}
              className="w-72 max-w-[calc(100vw-1.25rem)] p-3 space-y-3">
              <div>
                <p className="text-xs font-semibold">Custom range — all widgets</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Applies to every widget that hasn't set its own range.
                </p>
              </div>
              {/* Stacked, full width: two datetime-local inputs side by side cannot fit
                  this width — they overflowed the panel's own edge before. */}
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">From</Label>
                <Input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-full min-w-0 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">To</Label>
                <Input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-full min-w-0 text-xs" />
              </div>
              {customRangeInvalid && (
                <p className="text-[10px] text-destructive">"From" must be earlier than "To".</p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setRangePopoverOpen(false)}>Cancel</Button>
                <Button size="sm" className="h-7 text-xs" disabled={!customFrom || !customTo || customRangeInvalid} onClick={applyGlobalCustomRange}>
                  Apply to all
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <Button variant="outline" size="sm" onClick={() => setFullscreen((f) => !f)} title="Fullscreen">{fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</Button>
        {widgetClipboard && (
          <Button variant="outline" size="sm" onClick={pasteWidget} title={`Paste "${widgetClipboard.config?.title || widgetDef(widgetClipboard.type)?.label || widgetClipboard.type}"`}>
            <ClipboardPaste className="w-4 h-4 mr-1" /> Paste
          </Button>
        )}
        {/* Always visible — a conditionally-hidden Save button is a Save button
            nobody can find when they actually need it. Disabled + "Saved" is the
            signal that nothing is pending; any edit (drag, resize, config change,
            even a single keystroke in the panel) flips `dirty` immediately since it
            diffs the full widget list against the last saved snapshot. */}
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty}
          onClick={saveNow}
          title={dirty ? "Save widgets" : "All changes saved"}
        >
          <Save className="w-4 h-4 mr-1" /> {dirty ? "Save" : "Saved"}
        </Button>
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
    </>
  );

  return (
    <div className={cn("h-full flex flex-col", fullscreen && "fixed inset-0 z-50 bg-background")}>
      {inHeader
        ? createPortal(toolbar, toolbarTarget!)
        : <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap shrink-0">{toolbar}</div>}

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
            dashTimeCfg={dashTimeCfg}
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
