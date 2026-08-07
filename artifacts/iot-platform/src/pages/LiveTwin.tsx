import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Radio, Plus, Trash2, Image as ImageIcon, Wifi, WifiOff, MapPin,
  Save, Maximize2, Minimize2, MousePointerClick, X, Pencil,
} from "lucide-react";
import { useListAssets } from "@workspace/api-client-react";
import { useTelemetrySeries, useMetricChoices, aggregate } from "@/features/dashboards/useWidgetData";
import { REFRESH_INTERVALS } from "@/features/dashboards/timeRange";
import { ColorField } from "@/features/dashboards/ColorField";
import { useWsEvents } from "@/hooks/useWsEvents";
import { newId } from "@/features/dashboards/useDashboards";
import { SERIES } from "@/lib/chartColors";

// ── Live Twin ────────────────────────────────────────────────────────────────
// A digital-twin view: drop a plant layout / machine photo in as the backdrop,
// pin hotspots onto it, and bind each hotspot to an asset attribute. Values
// stream live (WebSocket nudge + optional polling), so the diagram doubles as an
// at-a-glance status board. Twins are stored per-browser in localStorage.
const TWINS_KEY = "wsviz:twins";
const MEDIA_KEY = "ws-media-library-v1";

interface Hotspot {
  id: string;
  label: string;
  /** Position as a % of image size, so it survives any container resize. */
  x: number;
  y: number;
  assetId?: string;
  tag?: string;
  unit?: string;
  decimals?: number;
  color?: string;
  warn?: string;
  critical?: string;
}
interface Twin {
  id: string;
  name: string;
  image: string;
  hotspots: Hotspot[];
}
interface MediaItem { id: string; name: string; url: string }

/** Shared, CVD-validated series order — see src/lib/chartColors.ts. */
const PALETTE = SERIES;

function readTwins(): Twin[] {
  try { const r = localStorage.getItem(TWINS_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}
function readMedia(): MediaItem[] {
  try { const r = localStorage.getItem(MEDIA_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}

export default function LiveTwin() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: assetsData } = useListAssets();
  const assets = (assetsData as any[] | undefined) ?? [];

  const [twins, setTwins] = useState<Twin[]>(() => readTwins());
  const [currentId, setCurrentId] = useState<string | null>(() => readTwins()[0]?.id ?? null);
  const [selectedHotspot, setSelectedHotspot] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshMs, setRefreshMs] = useState(20_000);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const media = useMemo(() => readMedia(), [currentId]);
  const imgWrapRef = useRef<HTMLDivElement>(null);

  const persist = useCallback((next: Twin[]) => {
    setTwins(next);
    try { localStorage.setItem(TWINS_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }, []);

  const twin = twins.find((t) => t.id === currentId) ?? null;

  // Live nudge: telemetry arrives far faster than we want to refetch, so cap it.
  const lastWsRef = useRef(0);
  const wsStatus = useWsEvents({
    telemetry: () => {
      if (!autoRefresh) return;
      const now = Date.now();
      if (now - lastWsRef.current > 5000) { lastWsRef.current = now; setRefreshNonce((n) => n + 1); }
    },
  });

  const updateTwin = useCallback((id: string, patch: Partial<Twin>) => {
    persist(readTwins().map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, [persist]);

  function addTwin() {
    const name = window.prompt("Twin name", `Twin ${twins.length + 1}`);
    if (!name?.trim()) return;
    const t: Twin = { id: newId("twin"), name: name.trim(), image: "", hotspots: [] };
    persist([...readTwins(), t]);
    setCurrentId(t.id);
    setSelectedHotspot(null);
  }
  function deleteTwin(id: string) {
    const t = twins.find((x) => x.id === id);
    if (t && !confirm(`Delete twin "${t.name}"? Its hotspots will be removed.`)) return;
    const next = readTwins().filter((x) => x.id !== id);
    persist(next);
    if (currentId === id) { setCurrentId(next[0]?.id ?? null); setSelectedHotspot(null); }
  }

  function updateHotspot(hid: string, patch: Partial<Hotspot>) {
    if (!twin) return;
    updateTwin(twin.id, { hotspots: twin.hotspots.map((h) => (h.id === hid ? { ...h, ...patch } : h)) });
  }
  function removeHotspot(hid: string) {
    if (!twin) return;
    updateTwin(twin.id, { hotspots: twin.hotspots.filter((h) => h.id !== hid) });
    if (selectedHotspot === hid) setSelectedHotspot(null);
  }

  // Click-to-place: converts the click into a percentage offset within the image.
  function onImageClick(e: React.MouseEvent) {
    if (!placing || !twin || !imgWrapRef.current) return;
    const rect = imgWrapRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const h: Hotspot = {
      id: newId("hs"),
      label: `Point ${twin.hotspots.length + 1}`,
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
      color: PALETTE[twin.hotspots.length % PALETTE.length],
      decimals: 1,
    };
    updateTwin(twin.id, { hotspots: [...twin.hotspots, h] });
    setSelectedHotspot(h.id);
    setPlacing(false);
  }

  // Drag an existing hotspot to reposition it.
  const dragRef = useRef<string | null>(null);
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const hid = dragRef.current;
      if (!hid || !twin || !imgWrapRef.current) return;
      const rect = imgWrapRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      updateHotspot(hid, { x, y });
    }
    function onUp() { dragRef.current = null; }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }); // re-bound each render so `twin` stays current

  const selected = twin?.hotspots.find((h) => h.id === selectedHotspot) ?? null;
  const wsBadge = wsStatus === "connected"
    ? { cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300", icon: Wifi, label: "Live" }
    : { cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: WifiOff, label: wsStatus === "connecting" ? "Connecting" : "Reconnecting" };

  return (
    <div className={cn("p-6 space-y-3 h-full flex flex-col", fullscreen && "fixed inset-0 z-50 bg-background p-4")}>
      {!fullscreen && (
        <>
          <button onClick={() => navigate("/data-explorer")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground shrink-0">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="shrink-0">
            <h1 className="text-xl font-bold flex items-center gap-2"><Radio className="w-5 h-5 text-primary" /> Live Twin</h1>
            <p className="text-sm text-muted-foreground">
              Pin live readings onto a plant layout or machine photo. Each point binds to an asset attribute and updates in real time.
            </p>
          </div>
        </>
      )}

      <Card className="flex-1 min-h-0 overflow-hidden shadow-sm flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap shrink-0">
          <Select value={currentId ?? ""} onValueChange={(v) => { setCurrentId(v); setSelectedHotspot(null); }}>
            <SelectTrigger className="h-8 w-48 text-sm"><SelectValue placeholder="— select a twin —" /></SelectTrigger>
            <SelectContent>{twins.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={addTwin}><Plus className="w-4 h-4 mr-1" /> New Twin</Button>
          {twin && (
            <>
              <Button size="sm" variant="outline" onClick={() => { setRenaming(true); setNameDraft(twin.name); }} title="Rename twin"><Pencil className="w-4 h-4" /></Button>
              <Button size="sm" variant="outline" onClick={() => deleteTwin(twin.id)} title="Delete twin" className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
              <div className="w-px h-5 bg-border" />
              <Button size="sm" variant={placing ? "default" : "outline"} onClick={() => setPlacing((p) => !p)} disabled={!twin.image}
                title={twin.image ? "Then click the image to drop a point" : "Set a background image first"}>
                <MapPin className="w-4 h-4 mr-1" /> {placing ? "Click image…" : "Add Point"}
              </Button>
            </>
          )}
          <div className="flex-1" />
          <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-medium", wsBadge.cls)}>
            <wsBadge.icon className="w-3 h-3" /> {wsBadge.label}
          </span>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground select-none">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-90" /> Auto
          </label>
          <Select value={String(refreshMs)} onValueChange={(v) => setRefreshMs(Number(v))}>
            <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{REFRESH_INTERVALS.map((r) => <SelectItem key={r.ms} value={String(r.ms)}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setFullscreen((f) => !f)} title="Fullscreen">
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>

        {renaming && twin && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
            <Label className="text-xs shrink-0">Twin name</Label>
            <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus className="h-8 text-sm max-w-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameDraft.trim()) { updateTwin(twin.id, { name: nameDraft.trim() }); setRenaming(false); }
                if (e.key === "Escape") setRenaming(false);
              }} />
            <Button size="sm" disabled={!nameDraft.trim()} onClick={() => { updateTwin(twin.id, { name: nameDraft.trim() }); setRenaming(false); }}>
              <Save className="w-3.5 h-3.5 mr-1" /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
          </div>
        )}

        {!twin ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground p-8 text-center">
            <Radio className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm mb-3">No twin yet — create one, then set its background image.</p>
            <Button size="sm" onClick={addTwin}><Plus className="w-4 h-4 mr-1" /> New Twin</Button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* Canvas */}
            <div className="flex-1 min-w-0 overflow-auto p-4 bg-muted/20">
              {!twin.image ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center gap-3">
                  <ImageIcon className="w-10 h-10 opacity-20" />
                  <p className="text-sm max-w-sm">Set a background image to start pinning live values onto it.</p>
                  <div className="w-full max-w-md space-y-2">
                    <Input placeholder="Paste an image URL…" className="h-9 text-sm"
                      onKeyDown={(e) => {
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (e.key === "Enter" && v) updateTwin(twin.id, { image: v });
                      }} />
                    {media.length > 0 && (
                      <>
                        <p className="text-xs">…or pick from Media Library:</p>
                        <div className="grid grid-cols-3 gap-2 max-h-52 overflow-auto">
                          {media.map((m) => (
                            <button key={m.id} onClick={() => updateTwin(twin.id, { image: m.url })}
                              className="border border-border rounded-md overflow-hidden hover:border-primary" title={m.name}>
                              <img src={m.url} alt={m.name} className="w-full h-16 object-cover" />
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  ref={imgWrapRef}
                  onClick={onImageClick}
                  className={cn("relative inline-block max-w-full", placing && "cursor-crosshair")}
                >
                  <img src={twin.image} alt={twin.name} className="max-w-full block rounded-md select-none" draggable={false} />
                  {twin.hotspots.map((h) => (
                    <HotspotPin
                      key={h.id}
                      hotspot={h}
                      selected={selectedHotspot === h.id}
                      refreshSec={autoRefresh ? Math.max(1, Math.round(refreshMs / 1000)) : 0}
                      nonce={refreshNonce}
                      onSelect={() => setSelectedHotspot(h.id)}
                      onDragStart={() => { dragRef.current = h.id; }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Inspector */}
            <div className="w-80 shrink-0 border-l border-border flex flex-col">
              {selected ? (
                <HotspotInspector
                  hotspot={selected}
                  assets={assets}
                  onChange={(patch) => updateHotspot(selected.id, patch)}
                  onRemove={() => removeHotspot(selected.id)}
                  onClose={() => setSelectedHotspot(null)}
                />
              ) : (
                <div className="p-3 space-y-3">
                  <p className="text-sm font-semibold flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary" /> Points</p>
                  {twin.image && (
                    <div className="space-y-1">
                      <Label className="text-xs">Background image</Label>
                      <Input value={twin.image} onChange={(e) => updateTwin(twin.id, { image: e.target.value })} className="h-8 text-xs font-mono" />
                    </div>
                  )}
                  {twin.hotspots.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Click <strong>Add Point</strong>, then click the image where the reading belongs.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {twin.hotspots.map((h) => (
                        <button key={h.id} onClick={() => setSelectedHotspot(h.id)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-border hover:border-primary text-left text-xs">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: h.color ?? PALETTE[0] }} />
                          <span className="flex-1 truncate">{h.label}</span>
                          {!h.tag && <span className="text-[10px] text-amber-600 shrink-0">unbound</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── A single live reading pinned on the image ────────────────────────────────
function HotspotPin({ hotspot, selected, refreshSec, nonce, onSelect, onDragStart }: {
  hotspot: Hotspot; selected: boolean; refreshSec: number; nonce: number;
  onSelect: () => void; onDragStart: () => void;
}) {
  // Short window — we only need the newest sample for a live readout.
  const { data } = useTelemetrySeries(hotspot.assetId, hotspot.tag, { rangeMinutes: 60 }, refreshSec, nonce);
  const value = aggregate(data, "last");

  const color = (() => {
    if (value != null) {
      if (hotspot.critical && hotspot.critical !== "" && value >= Number(hotspot.critical)) return "#EF4444";
      if (hotspot.warn && hotspot.warn !== "" && value >= Number(hotspot.warn)) return "#F59E0B";
    }
    return hotspot.color ?? PALETTE[0];
  })();
  const dec = hotspot.decimals ?? 1;
  const shown = value == null ? "—" : value.toFixed(dec);

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
      style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onPointerDown={(e) => { e.stopPropagation(); onDragStart(); }}
    >
      <div className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-md shadow-lg cursor-move select-none backdrop-blur-sm",
        selected ? "ring-2 ring-offset-1 ring-primary" : "",
      )} style={{ background: "rgba(15,23,42,0.85)", border: `1px solid ${color}` }}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse" style={{ background: color }} />
        <span className="text-[10px] text-slate-300 max-w-[7rem] truncate">{hotspot.label}</span>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>
          {shown}<span className="text-[9px] text-slate-400 ml-0.5">{hotspot.unit ?? ""}</span>
        </span>
      </div>
    </div>
  );
}

// ── Bind a hotspot to an asset attribute + presentation options ──────────────
function HotspotInspector({ hotspot, assets, onChange, onRemove, onClose }: {
  hotspot: Hotspot; assets: any[];
  onChange: (patch: Partial<Hotspot>) => void; onRemove: () => void; onClose: () => void;
}) {
  const metrics = useMetricChoices(hotspot.assetId);
  const selCls = "w-full h-8 rounded-md border border-border text-sm px-2 bg-background";

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
        <p className="text-sm font-semibold flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary" /> Point</p>
        <button onClick={onClose} title="Close" className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Label</Label>
          <Input value={hotspot.label} onChange={(e) => onChange({ label: e.target.value })} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Asset</Label>
          <select value={hotspot.assetId ?? ""} onChange={(e) => onChange({ assetId: e.target.value, tag: "" })} className={selCls}>
            <option value="">— select asset —</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Attribute / Metric</Label>
          <select value={hotspot.tag ?? ""} onChange={(e) => onChange({ tag: e.target.value })} className={selCls} disabled={!hotspot.assetId}>
            <option value="">{hotspot.assetId ? "— select attribute —" : "pick an asset first"}</option>
            {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <p className="text-[11px] text-muted-foreground">Shows the newest value, updating live.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Unit</Label>
            <Input value={hotspot.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value })} className="h-8 text-sm" placeholder="°C, kW" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Decimals</Label>
            <Input type="number" min={0} max={4} value={hotspot.decimals ?? 1}
              onChange={(e) => onChange({ decimals: Number(e.target.value) })} className="h-8 text-sm" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Colour</Label>
          <ColorField value={hotspot.color} onChange={(hex) => onChange({ color: hex })} presets={PALETTE} />
        </div>
        <div className="pt-2 border-t border-border space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Thresholds</p>
          <p className="text-[11px] text-muted-foreground">The point turns amber, then red, once the value reaches these.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Warn ≥</Label>
              <Input type="number" value={hotspot.warn ?? ""} onChange={(e) => onChange({ warn: e.target.value })} className="h-8 text-sm" placeholder="—" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Critical ≥</Label>
              <Input type="number" value={hotspot.critical ?? ""} onChange={(e) => onChange({ critical: e.target.value })} className="h-8 text-sm" placeholder="—" />
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 pt-1">
          <MousePointerClick className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          Drag the point on the image to reposition it.
        </p>
      </div>
      <div className="p-3 border-t border-border shrink-0">
        <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive" onClick={onRemove}>
          <Trash2 className="w-4 h-4 mr-1.5" /> Delete point
        </Button>
      </div>
    </div>
  );
}
