import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTwinLink, type TwinLink } from "./twinLink";
import { useT } from "@/i18n";
import { saveTone } from "./saveTone";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ArrowLeft, Radio, Plus, Trash2, Pencil, Maximize2, Minimize2, Wifi, WifiOff, Crosshair, RotateCw, Check, X, Save, FilePlus, Camera } from "lucide-react";
import { createPortal } from "react-dom";
import { useListAssets } from "@workspace/api-client-react";
import { useProjectScope } from "@/hooks/useProjectScope";
import { useProject } from "@/contexts/ProjectContext";
import { useCurrentUser } from "@/contexts/UserContext";
import { useWsEvents } from "@/hooks/useWsEvents";
import { REFRESH_INTERVALS } from "@/features/dashboards/timeRange";
import { createPlantEngine, type LabelMode, type PlantEngine, type Scenario } from "./engine/engine";
import { PACKS } from "./engine/packs";
import { listPlantTwins, getPlantTwin, createPlantTwin, updatePlantTwin, deletePlantTwin, fetchPlantValues, type PlantTwinSummary } from "./api";
import { FlowBar, ProcessTree, Inspector, AddMachine, GlbUpload, DuplicateDialog, fetchGlbBytes } from "./panels";
import { MODELS } from "./engine/models";
import { useAlarmLimits } from "./shared/alarmLimits";
import { usePlayback, PlaybackButton } from "./shared/playback";
import { TwinAlarms } from "./shared/TwinAlarms";
import { TwinLibrary, DRAG_TYPE } from "./TwinLibrary";
import { FEATURES } from "@/lib/features";
import { LiveTags } from "./LiveTags";
import type { SceneDoc } from "./engine/types";
import "./plantTwin.css";

/**
 * Live Twin → 3D plant twins.
 *
 * A twin is a whole plant laid out by process (industry → area → sub-process →
 * machine), stored on the server (plant_twins). Each machine can be linked to an
 * asset; its readings then come from that asset's telemetry and drive the moving
 * parts. Readings that are not linked show "not linked", or simulated values
 * clearly marked "demo" while the twin's demo switch is on.
 */

type SaveState = "saved" | "dirty" | "saving" | "error" | "readonly";
const LAST_KEY = "plant-twin:last";
const readLast = (project: string | null) => { try { return localStorage.getItem(`${LAST_KEY}:${project ?? "-"}`); } catch { return null; } };
const writeLast = (project: string | null, id: string) => { try { localStorage.setItem(`${LAST_KEY}:${project ?? "-"}`, id); } catch { /* per-browser convenience only */ } };

/** Plant-wide demo scenarios, as on the concept demo. */
const SCENARIOS: [Scenario, string][] = [["normal", "Normal running"], ["fault", "Machine fault"], ["cavitation", "Cavitation"], ["overheat", "Bearing overheat"], ["trip", "Pump trip"], ["cloud", "Cloud cover"], ["storm", "Storm / high wind"], ["lowwind", "Low wind"], ["charge", "Battery charging"], ["discharge", "Battery discharging"]];

/** An asset twin starts as an empty floor; machines come from the library. */
const EMPTY_SCENE: SceneDoc = { version: 1, pack: "textile", demo: true, areas: [], flows: [], items: [], conns: [] };

/**
 * `floor`: the saved plant, view only and large (3D Plant Floor). `builder`: the editor.
 * `twinKind` "asset": a free canvas of machines added from the library (no
 * industry template, process areas or stages), saved with `scene.kind = "asset"`.
 */
export default function PlantTwinView({ variant = "builder", onOpenBuilder, link, twinKind = "plant", onDetailedSkid }: {
  variant?: "floor" | "builder"; onOpenBuilder?: () => void; link?: TwinLink;
  twinKind?: "plant" | "asset"; onDetailedSkid?: () => void;
}) {
  const floor = variant === "floor";
  const t = useT();
  const asset = twinKind === "asset";
  const assetRef = useRef(asset); assetRef.current = asset;
  const sceneOut = useCallback((e: PlantEngine): SceneDoc => (assetRef.current ? ({ ...e.serialize(), kind: "asset" } as SceneDoc & { kind: string }) : e.serialize()), []);
  const [libOpen, setLibOpen] = useState(false);
  // Library as a left-hand tile grid (default), or the earlier list on the right (VITE_TWIN_LIBRARY_LIST=true).
  const gridLib = !FEATURES.twinLibraryList;
  const [palOpen, setPalOpenState] = useState(() => { try { return localStorage.getItem("plant-twin:palette") !== "0"; } catch { return true; } });
  const setPalOpen = (v: boolean) => { setPalOpenState(v); try { localStorage.setItem("plant-twin:palette", v ? "1" : "0"); } catch { /* per browser only */ } };
  const listLib = !gridLib && libOpen;
  const libShown = gridLib ? palOpen : libOpen;
  const floorRef = useRef(floor); floorRef.current = floor;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currentProjectId } = useProject();
  const { canModule } = useCurrentUser();
  const canCreate = canModule("live_twin", "write");
  const canDelete = canModule("live_twin", "delete");
  const { inScope } = useProjectScope();
  const { data: assetsData } = useListAssets();
  const assets = useMemo(() => ((assetsData as any[] | undefined) ?? []).filter((a: any) => inScope(a.id, { strict: true })).map((a: any) => ({ id: a.id as string, name: a.name as string, identifier: (a.identifier ?? null) as string | null })), [assetsData, inScope]);
  // Alarm rules give the limits of linked readings; history playback replaces live values.
  const limits = useAlarmLimits();
  const limitsRef = useRef(limits); limitsRef.current = limits;
  const playbackRef = useRef<ReturnType<typeof usePlayback> | null>(null);

  const listQ = useQuery({ queryKey: ["plant-twins"], queryFn: listPlantTwins });
  const twins = useMemo(() => (listQ.data ?? []).filter((t) => (t.kind ?? "plant") === twinKind && (!t.projectId || !currentProjectId || t.projectId === currentProjectId)), [listQ.data, currentProjectId, twinKind]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const current: PlantTwinSummary | null = twins.find((t) => t.id === currentId) ?? null;

  const stageRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), overlayRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<PlantEngine | null>(null);
  const valuesRef = useRef(new Map<string, number | null>());
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => (t + 1) % 1_000_000), []);

  // ── saving ────────────────────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveErr, setSaveErr] = useState("");
  const currentRef = useRef<string | null>(null), canEditRef = useRef(false), loadingRef = useRef(false), engineRef = useRef<PlantEngine | null>(null);
  // Set while there are unsaved changes. Edits no longer save on a timer: the
  // Save button stays light orange until it is pressed. Pending changes are
  // still written when another twin is opened or the view closes, so nothing is
  // lost. (-1 marks "pending"; clearTimeout(-1) is a no-op.)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | number | undefined>(undefined);
  const doSave = useCallback(async () => {
    clearTimeout(saveTimer.current as any); saveTimer.current = undefined;
    const id = currentRef.current, e = engineRef.current; if (!id || !e || !canEditRef.current) return;
    setSaveState("saving");
    try { await updatePlantTwin(id, { scene: sceneOut(e) }); setSaveState("saved"); setSaveErr(""); }
    catch (err: any) { setSaveState("error"); setSaveErr(err?.message ?? String(err)); }
  }, [sceneOut]);
  const scheduleSave = useCallback(() => {
    if (loadingRef.current || !canEditRef.current || !currentRef.current) return;
    setSaveState("dirty"); saveTimer.current = -1;
  }, [doSave]);
  const flushSave = useCallback(async () => { if (saveTimer.current) await doSave(); }, [doSave]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (saveTimer.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ── engine ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const e = createPlantEngine({
      canvas: canvasRef.current!, host: stageRef.current!, overlay: overlayRef.current!,
      getLive: (a, m) => { const pb = playbackRef.current; return pb?.active ? pb.valueAt(a, m) : valuesRef.current.get(a + "\u0000" + m); },
      getLimits: (a, m) => limitsRef.current(a, m),
      fetchGlb: fetchGlbBytes,
      onChange: bump, onEdit: scheduleSave,
    });
    engineRef.current = e; setEngine(e); e.start();
    const ticker = setInterval(() => { if (document.visibilityState === "visible") bump(); }, 400);
    return () => { clearInterval(ticker); if (saveTimer.current) void doSave(); e.dispose(); engineRef.current = null; };
  }, [bump, scheduleSave, doSave]);

  // Draft: an unsaved plant to explore and edit, used when there is no twin yet
  // or after "New 3D twin". "Save as twin" stores it.
  const [draftMode, setDraftMode] = useState(false);
  // Pick a twin: the last one opened in this project, else the newest.
  useEffect(() => {
    if (!listQ.isSuccess && !listQ.isError) return;
    if (draftMode) return;
    if (currentId && twins.some((t) => t.id === currentId)) return;
    const last = readLast(currentProjectId);
    setCurrentId(twins.find((t) => t.id === last)?.id ?? twins[0]?.id ?? null);
  }, [listQ.isSuccess, listQ.isError, twins, currentId, currentProjectId, draftMode]);

  const [loading, setLoading] = useState(false);
  useEffect(() => {
    currentRef.current = currentId;
    if (!engine) return;
    if (!currentId) {
      canEditRef.current = false;
      engine.setReadOnly(floorRef.current);
      if (assetRef.current || !floorRef.current) engine.loadScene(EMPTY_SCENE); else engine.loadPack(engine.pack || "textile");
      placeDetail(engine);
      return;
    }
    let cancelled = false; setLoading(true);
    writeLast(currentProjectId, currentId);
    getPlantTwin(currentId).then((t) => {
      if (cancelled) return;
      loadingRef.current = true;
      canEditRef.current = t.canEdit && !floorRef.current; engine.setReadOnly(!t.canEdit || floorRef.current);
      engine.loadScene(t.scene, t.scene?.pack);
      loadingRef.current = false;
      setSaveState(t.canEdit ? "saved" : "readonly");
    }).catch((err) => toast({ title: t("Could not open this twin"), description: err?.message ?? String(err), variant: "destructive" }))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentId, engine, currentProjectId, toast]);

  // Detailed close-up: a new, unsaved twin with just one machine, framed close,
  // with demo values on, to link to its asset and save as a POC.
  const detailRef = useRef<string | null>(null);
  function placeDetail(e: PlantEngine) {
    const type = detailRef.current; if (!type) return;
    detailRef.current = null;
    e.loadScene(EMPTY_SCENE);
    const id = e.addMachine(type, "");
    if (id) { e.select(id); e.frameClose(id); }
  }
  const openDetailed = async (type: string) => {
    if (!engine || !MODELS[type]) return;
    await flushSave(); setLibOpen(false); detailRef.current = type;
    if (!currentId) { currentRef.current = null; setDraftMode(true); placeDetail(engine); return; }
    engine.select(null); currentRef.current = null; canEditRef.current = false; setDraftMode(true); setCurrentId(null);
  };
  const switchTo = async (id: string) => { await flushSave(); engine?.select(null); setDraftMode(false); setCurrentId(id); };
  const startDraft = async () => { await flushSave(); engine?.select(null); setDraftMode(true); setCurrentId(null); };
  // The side panel picks twins; the floor view has no drafts of its own to start.
  useTwinLink(link, currentId, (id) => { if (id) void switchTo(id); else void startDraft(); });

  // ── live values ───────────────────────────────────────────────────────────
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshMs, setRefreshMs] = useState(20_000);
  const [nonce, setNonce] = useState(0);
  const lastWs = useRef(0);
  const wsStatus = useWsEvents({ telemetry: () => { if (!autoRefresh) return; const now = Date.now(); if (now - lastWs.current > 3000) { lastWs.current = now; setNonce((n) => n + 1); } } });
  useEffect(() => { if (!autoRefresh) return; const id = setInterval(() => setNonce((n) => n + 1), refreshMs); return () => clearInterval(id); }, [autoRefresh, refreshMs]);
  const pairs = engine?.pairs() ?? [];
  const pairsKey = pairs.map((p) => p.assetId + ":" + p.metric).sort().join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playbackPairs = useMemo(() => pairs, [pairsKey]);
  const playback = usePlayback(playbackPairs);
  playbackRef.current = playback;
  useEffect(() => { engine?.setPlayback(playback.active); }, [engine, playback.active]);
  const [dupId, setDupId] = useState<string | null>(null);
  const linkedAssetIds = useMemo(() => Array.from(new Set((engine?.items ?? []).map((i) => i.assetId).filter((x): x is string => !!x))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, engine?.items.map((i) => i.assetId ?? "").join("|")]);
  const focusAsset = (assetId: string) => { const it = engine?.items.find((i) => i.assetId === assetId); if (it && engine) { engine.select(it.id); engine.fitItem(it.id); } };
  const snapshot = () => {
    if (!engine) return;
    const a = document.createElement("a"); a.href = engine.snapshot();
    a.download = `${(current?.name ?? (asset ? "asset-twin" : "plant-twin")).replace(/[^\w.-]+/g, "_")}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  useEffect(() => {
    if (!pairs.length) { valuesRef.current = new Map(); return; }
    let cancelled = false;
    fetchPlantValues(pairs.slice(0, 500)).then((rows) => {
      if (cancelled) return;
      const m = new Map<string, number | null>(); rows.forEach((r) => m.set(r.assetId + "\u0000" + r.metric, r.value)); valuesRef.current = m;
    }).catch(() => { /* keep the last values; the badge shows the connection state */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, pairsKey, currentId]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tgt = ev.target as HTMLElement;
      if (!engine || /INPUT|SELECT|TEXTAREA/.test(tgt.tagName) || tgt.isContentEditable || tgt.closest("[role=dialog],[role=listbox]")) return;
      if (ev.key === "Escape") { engine.startConnect(null); engine.pickPart(null); return; }
      const sel = engine.selected; if (!sel || engine.readOnly) return;
      if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); engine.removeItem(sel.id); }
      else if (ev.key === "r" || ev.key === "R") engine.rotateItem(sel.id);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  // ── create / rename / delete ──────────────────────────────────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  // Template switch: immediate on a draft, confirmed on a saved twin.
  const [pendingPack, setPendingPack] = useState<string | null>(null);
  function loadTemplate(key: string) {
    if (!engine) return;
    if (current || engine.items.length) { setPendingPack(key); return; }
    engine.loadPack(key);
  }
  function confirmTemplate() {
    if (!engine || !pendingPack) return;
    engine.loadPack(pendingPack); setPendingPack(null); scheduleSave();
  }
  const [creating, setCreating] = useState(false);
  async function create() {
    if (!engine || !newName.trim()) return;
    setCreating(true);
    try {
      const id = `pt-${crypto.randomUUID()}`;
      const row = await createPlantTwin({ id, name: newName.trim(), projectId: currentProjectId ?? null, scene: { ...sceneOut(engine), ...(link?.folderId ? { parent: link.folderId } : {}) } });
      qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => [row, ...(old ?? [])]);
      setNewOpen(false); setNewName(""); setDraftMode(false); setCurrentId(id);
    } catch (err: any) {
      toast({ title: t("Could not create the twin"), description: err?.message ?? String(err), variant: "destructive" });
    } finally { setCreating(false); }
  }
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  async function rename() {
    if (!current || !nameDraft.trim()) { setRenaming(false); return; }
    try { const row = await updatePlantTwin(current.id, { name: nameDraft.trim() }); qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => (old ?? []).map((t) => (t.id === row.id ? { ...t, name: row.name } : t))); }
    catch (err: any) { toast({ title: t("Could not rename"), description: err?.message ?? String(err), variant: "destructive" }); }
    setRenaming(false);
  }
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function remove() {
    if (!current) return;
    try {
      clearTimeout(saveTimer.current as any); saveTimer.current = undefined;
      await deletePlantTwin(current.id);
      qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => (old ?? []).filter((t) => t.id !== current.id));
      setCurrentId(null); setDraftMode(false);
    } catch (err: any) { toast({ title: t("Could not delete"), description: err?.message ?? String(err), variant: "destructive" }); }
    setConfirmDelete(false);
  }

  const [fullscreen, setFullscreen] = useState(false);
  const [labelMode, setLabelMode] = useState<LabelMode>("smart");
  const [auto, setAuto] = useState(false);
  useEffect(() => { engine?.setLabelMode(labelMode); }, [engine, labelMode]);
  useEffect(() => { engine?.setAuto(auto); }, [engine, auto]);
  // Clicking a machine shows its data source; a machine just added from the library keeps the library open.
  const addingRef = useRef(false);
  const selId = engine?.selected?.id ?? null;
  useEffect(() => {
    if (addingRef.current) { addingRef.current = false; return; }
    if (selId) setLibOpen(false);
  }, [selId]);
  const [scenario, setScenario] = useState<Scenario>("normal");
  useEffect(() => { engine?.setScenario(scenario); }, [engine, scenario]);
  const [xray, setXray] = useState(false);
  const [heat, setHeat] = useState(false);
  useEffect(() => { engine?.setXray(xray); }, [engine, xray]);
  useEffect(() => { engine?.setHeat(heat); }, [engine, heat]);

  const isDraft = !currentId && (listQ.isSuccess || listQ.isError);
  const readOnly = floor || (isDraft ? false : !current?.canEdit);
  const stats = engine?.areaStats() ?? [];
  const alarm = engine?.topAlarm() ?? null;
  const unlinked = engine?.unlinkedCount() ?? 0;
  const hasTwin = !!current || isDraft;
  const wsBadge = wsStatus === "connected"
    ? { cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300", icon: Wifi, label: t("Live") }
    : { cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: WifiOff, label: wsStatus === "connecting" ? t("Connecting") : t("Reconnecting") };
  const saveText = { saved: t("Saved"), dirty: t("Unsaved changes…"), saving: t("Saving…"), error: t("Not saved: {err}", { err: saveErr }), readonly: t("View only: owned by someone else") }[saveState];
  const single = engine && engine.items.length === 1 ? MODELS[engine.items[0].type] : undefined;
  const openSave = () => { setNewName(asset ? (single ? `${t(single.name)} ${twins.length + 1}` : t("Asset twin {n}", { n: twins.length + 1 })) : `${PACKS[engine?.pack ?? "textile"]?.name ?? "Plant"} ${twins.length + 1}`); setNewOpen(true); };
  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap">
      {link
        ? (current || listQ.isLoading) && <span className="text-sm font-semibold truncate max-w-[14rem]">{listQ.isLoading ? t("Loading…") : current?.name}</span>
        : <Select value={currentId ?? ""} onValueChange={(v) => void switchTo(v)}>
        <SelectTrigger className="h-8 w-56 text-sm"><SelectValue placeholder={listQ.isLoading ? "Loading…" : isDraft ? "Draft (not saved)" : "— select a twin —"} /></SelectTrigger>
        <SelectContent>{twins.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} <span className="text-muted-foreground">({t.machines})</span></SelectItem>)}</SelectContent>
      </Select>}
      {floor && onOpenBuilder && <Button size="sm" variant="outline" onClick={onOpenBuilder}><Pencil className="w-4 h-4 mr-1" /> {isDraft ? t("Build your plant") : t("Edit in 3D Builder")}</Button>}
      {!floor && !isDraft && canCreate && <Button size="sm" variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-500/10 hover:text-orange-600 dark:text-orange-400" onClick={() => void startDraft()} title={t("Start a new, empty twin")}><FilePlus className="w-4 h-4 mr-1" /> {t("New")}</Button>}
      {!floor && !readOnly && hasTwin && <Button size="sm" variant={libShown ? "default" : "outline"} onClick={() => (gridLib ? setPalOpen(!palOpen) : setLibOpen(!libOpen))}><Plus className="w-4 h-4 mr-1" /> {t("Add twin")}</Button>}
      {!floor && current?.canEdit && !renaming && (
        <>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setNameDraft(current.name); setRenaming(true); }} aria-label={t("Rename twin")} title={t("Rename")}><Pencil className="w-4 h-4" /></Button>
          {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => setConfirmDelete(true)} aria-label={t("Delete twin")} title={t("Delete")}><Trash2 className="w-4 h-4" /></Button>}
        </>
      )}
      {renaming && (
        <div className="flex items-center gap-1">
          <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(false); }} className="h-8 w-48" autoFocus aria-label={t("Twin name")} />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void rename()} aria-label={t("Save name")}><Check className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setRenaming(false)} aria-label={t("Cancel rename")}><X className="w-4 h-4" /></Button>
        </div>
      )}
      {!floor && hasTwin && engine && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1">
          <Switch checked={engine.demo} disabled={readOnly} onCheckedChange={(b) => engine.setDemo(b)} className="scale-90" /> {t("Demo values")}
        </label>
      )}
      {!floor && current && (saveState === "error" || saveState === "readonly") && <span className={cn("text-xs", saveState === "error" ? "text-red-500" : "text-muted-foreground")}>{saveText}</span>}

      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", wsBadge.cls)}><wsBadge.icon className="w-3 h-3" /> {wsBadge.label}</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-90" /> {t("Auto")}</label>
        <Select value={String(refreshMs)} onValueChange={(v) => setRefreshMs(Number(v))}>
          <SelectTrigger className="h-8 w-20 text-xs" aria-label={t("Refresh interval")}><SelectValue /></SelectTrigger>
          <SelectContent>{REFRESH_INTERVALS.map((r) => <SelectItem key={r.ms} value={String(r.ms)}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={labelMode} onValueChange={(v) => setLabelMode(v as LabelMode)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label={t("Labels")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="smart">{t("Labels: smart")}</SelectItem>
            <SelectItem value="all">{t("Labels: all")}</SelectItem>
            <SelectItem value="off">{t("Labels: off")}</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8" onClick={() => engine?.fitAll()} title={t("Frame everything and return to the starting angle")}><Crosshair className="w-3.5 h-3.5 mr-1" />{t("Fit")}</Button>
        {hasTwin && <PlaybackButton playback={playback} />}
        {hasTwin && <Button size="icon" variant="outline" className="h-8 w-8" onClick={snapshot} aria-label={t("Save a PNG picture of the 3D view")} title={t("Save a PNG picture of the 3D view")}><Camera className="w-4 h-4" /></Button>}
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setFullscreen(!fullscreen)} aria-label={fullscreen ? t("Exit full screen") : t("Full screen")}>
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </Button>
        {!floor && canCreate && (isDraft || current?.canEdit) && (
          <Button size="sm" onClick={() => { if (isDraft) openSave(); else void doSave(); }} disabled={saveState === "saving"}
            className={cn("h-8", saveTone(isDraft ? "new" : saveState))}
            title={isDraft ? t("Not saved yet: save this twin") : saveState === "saved" ? t("All changes saved") : saveState === "error" ? t("Not saved: {err}", { err: saveErr }) : saveState === "saving" ? t("Saving…") : t("Unsaved changes: press Save")}>
            <Save className="w-4 h-4 mr-1" /> {t("Save")}
          </Button>
        )}
      </div>
    </div>
  );
  const chip = (on: boolean, set: (b: boolean) => void, label: string) => (
    <button onClick={() => set(!on)} aria-pressed={on}
      className={cn("font-mono text-xs px-2.5 py-1 rounded border", on ? "bg-blue-600/80 border-blue-400 text-white" : "bg-slate-900/70 border-blue-500/60 text-slate-100 hover:bg-slate-800/80")}>{label}</button>
  );

  return (
    <div className={cn("flex-1 min-h-0 flex flex-col", fullscreen && "fixed inset-0 z-50 bg-background p-4")}>
      <div className="flex-1 min-h-0 flex flex-col">
        {link?.toolbar && !fullscreen ? createPortal(toolbar, link.toolbar) : <div className="p-3 border-b border-border shrink-0">{toolbar}</div>}

        {isDraft && (
          <div className="px-3 py-1.5 text-xs border-b border-border shrink-0 bg-primary/5 text-foreground">
            {floor
              ? <>{t("Sample plant ({name}). No plant is saved in this project yet. Open 3D Builder to lay out your own plant and link machines to assets.", { name: t(PACKS[engine?.pack ?? "textile"]?.name ?? "") })}</>
              : asset
              ? (canCreate ? <>{t("Click Add twin to choose machines, click a machine to connect its data source, then Save.")}</> : <>{t("Preview. Saving a twin needs Live Twin write access.")}</>)
              : canCreate
              ? <>{t("Click Add twin, pick an industry and Load it (or add single machines), untick stages the plant does not have, then Save.")}</>
              : <>{t("Template preview. You can look around; saving a twin needs Live Twin write access.")}</>}
            {listQ.isError && <span className="text-red-500"> Saved twins could not be loaded: {(listQ.error as Error)?.message}</span>}
          </div>
        )}
        {hasTwin && engine && unlinked > 0 && (
          <div className={cn("px-3 py-1.5 text-xs border-b border-border shrink-0", engine.demo ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "text-muted-foreground")}>
            {engine.demo
              ? t("{n} reading(s) not linked to an asset show simulated demo values, marked \"demo\". They are not plant data. Link machines to assets, or turn Demo values off.", { n: unlinked })
              : t("{n} reading(s) not linked to an asset show \"not linked\".", { n: unlinked })}
          </div>
        )}
        {hasTwin && playback.bar && <div className="px-3 pt-2 shrink-0">{playback.bar}</div>}
        {hasTwin && engine && (() => { const g = engine.glbStatus(); return g.loading || g.failed.length ? (
          <div className="px-3 py-1.5 text-xs border-b border-border shrink-0 text-muted-foreground">
            {g.loading > 0 && t("Loading {n} uploaded 3D model(s)…", { n: g.loading })} {g.failed.length > 0 && <span className="text-red-500">{t("Could not load: {names}. They stay in the twin; check access to Visualization uploads.", { names: g.failed.join(", ") })}</span>}
          </div>) : null; })()}
        {hasTwin && engine && !asset && <div className="px-3 pt-2 shrink-0"><FlowBar engine={engine} stats={stats} plantName={PACKS[engine.pack]?.name ?? "Plant"} /></div>}

        <div className="flex-1 min-h-0 flex">
          {gridLib && !floor && !readOnly && hasTwin && engine && palOpen && (
            <div className="w-72 shrink-0 border-r border-border overflow-y-auto p-3">
              <TwinLibrary layout="grid" onAdd={(type) => { addingRef.current = true; engine.addMachine(type, asset ? "" : engine.focusId ?? ""); if (asset) engine.frameView(); }} onClose={() => setPalOpen(false)} onDetailedSkid={asset ? onDetailedSkid : undefined} onDetailed={asset ? (type) => void openDetailed(type) : undefined}
                industry={asset ? undefined : { current: engine.items.length ? engine.pack : null, onLoad: (key) => { addingRef.current = true; loadTemplate(key); } }} />
            </div>
          )}
          <div ref={stageRef} className="pt-stage flex-1 min-w-0 m-3 mt-2 rounded-md"
            onDragOver={(e) => { if (!readOnly && e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
            onDrop={(e) => {
              const type = e.dataTransfer.getData(DRAG_TYPE); if (!type || readOnly || !engine) return;
              e.preventDefault();
              addingRef.current = true;
              engine.addMachine(type, asset ? "" : engine.focusId ?? "", engine.floorPoint(e.clientX, e.clientY) ?? undefined); if (asset) engine.frameView();
            }}>
            <canvas ref={canvasRef} aria-label="3D plant twin" />
            <div ref={overlayRef} className="pt-overlay" />
            {engine && (
              <div className="absolute right-2 top-2 flex gap-1.5 z-10">
                {chip(xray, setXray, t("X-ray"))}{chip(auto, setAuto, t("Auto-rotate"))}{chip(heat, setHeat, t("Heat map"))}
              </div>
            )}
            {alarm && (
              <button onClick={() => { engine?.select(alarm.id); engine?.fitItem(alarm.id); }}
                className={cn("absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate text-left font-mono text-xs px-2.5 py-1.5 rounded-md border text-white",
                  alarm.status === "crit" ? "bg-red-950/80 border-red-500 pt-blink" : "bg-amber-950/70 border-amber-500")}>
                {alarm.status === "crit" ? t("ALARM") : t("WARNING")}  {alarm.area ? `${alarm.area} › ` : ""}{alarm.name} · {alarm.reading}{alarm.more > 0 ? `  (+${alarm.more})` : ""}
              </button>
            )}
            <div className="absolute left-3 bottom-2 text-[11px] font-mono text-slate-400 pointer-events-none">
              {engine?.pickingPart ? t("Click a part of the model · Esc cancels") : engine?.connectingFrom ? t("Click the machine that {name} feeds · Esc cancels", { name: engine.connectingFrom.name }) : readOnly ? t("Drag to rotate · scroll to zoom · click a machine") : t("Click to select · drag a machine to move it · drag the floor to rotate · scroll to zoom")}
            </div>
            {!floor && engine && engine.items.length === 0 && !loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-slate-300 pointer-events-none">
                <p className="text-sm max-w-xs">{readOnly ? t("This twin has no machines yet.") : libShown ? (asset ? t("Drag a machine here from the library, or click it.") : t("Load an industry template, or drag single machines here.")) : asset ? t("Click Add twin above to choose machines: pumps, motors, gearboxes, valves, conveyors, tanks and more.") : t("Click Add twin above, then pick an industry template or single machines.")}</p>
              </div>
            )}
            {loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300 bg-black/30">{t("Loading…")}</div>}
          </div>

          {hasTwin && engine && !(!floor && engine.items.length === 0 && !listLib) && (
            <div className="w-80 shrink-0 border-l border-border overflow-y-auto p-3 space-y-5">
              {listLib && !readOnly ? (
                <TwinLibrary onAdd={(type) => { addingRef.current = true; engine.addMachine(type, asset ? "" : engine.focusId ?? ""); if (asset) engine.frameView(); }} onClose={() => setLibOpen(false)} onDetailedSkid={asset ? onDetailedSkid : undefined} onDetailed={asset ? (type) => void openDetailed(type) : undefined}
                  industry={asset ? undefined : { current: engine.items.length ? engine.pack : null, onLoad: (key) => { addingRef.current = true; loadTemplate(key); } }} />
              ) : <>
              {engine.demo && engine.items.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Scenario")}</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {/* Only scenarios that apply to the machines on the floor: no pump scenarios without a pump. */}
                    {SCENARIOS.filter(([sc]) => engine.scenarioFits()[sc] || sc === scenario).map(([sc, l]) => <Button key={sc} size="sm" variant={scenario === sc ? "default" : "outline"} className="h-8 text-xs justify-start" onClick={() => setScenario(sc)}>{t(l)}</Button>)}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t("Moves demo values only. Linked readings always show plant data.")}</p>
                </div>
              )}
              <Inspector engine={engine} assets={assets} readOnly={readOnly} onDuplicate={setDupId} />
              {!engine.selected && <TwinAlarms assetIds={linkedAssetIds} onFocus={focusAsset} label={(id) => engine.items.find((i) => i.assetId === id)?.name} />}
              {!engine.selected && <LiveTags engine={engine} title={asset ? t("Live tags") : t("Live tags · plant")} />}
              {!readOnly && asset && !engine.selected && (
                <div className="space-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Your own 3D model")}</h3>
                  <GlbUpload engine={engine} areaId="" onMessage={(text, error) => toast({ title: error ? t("Upload failed") : t("Model added"), description: text, variant: error ? "destructive" : undefined })} />
                </div>
              )}
              {!asset && <ProcessTree engine={engine} readOnly={readOnly} />}
              {floor && (
                <div className="rounded-md border border-border p-3 space-y-1.5 text-xs">
                  <h3 className="text-sm font-semibold">{t("3D Plant Floor")}</h3>
                  <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                    <li>{t("One beacon per machine: green running, amber warning, red alarm, grey no data")}</li>
                    <li>{t("Red ring under a machine in alarm")}</li>
                    <li>{t("Each label shows the machine's main reading, marked demo until it is linked")}</li>
                    <li>{t("Click a machine for all its readings and its data source")}</li>
                    <li>{t("Edit the layout in 3D Builder")}</li>
                  </ul>
                </div>
              )}
              {!readOnly && !asset && <AddMachine engine={engine} onMessage={(text, error) => toast({ title: error ? t("Upload failed") : t("Model added"), description: text, variant: error ? "destructive" : undefined })} />}
              </>}
            </div>
          )}
        </div>
      </div>

      {engine && <DuplicateDialog engine={engine} itemId={dupId} assets={assets} onClose={() => setDupId(null)} onDone={(text) => toast({ title: t("Copies added"), description: text })} />}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Save twin")}</DialogTitle>
            <DialogDescription>{asset ? t("Saves these machines and their asset links for everyone in the project. More machines can be added afterwards.") : t("Saves this plant ({name}) for everyone in the project, with your changes so far. Machines can be linked to assets afterwards.", { name: t(PACKS[engine?.pack ?? "textile"]?.name ?? "") })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>{t("Name")}</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) void create(); }} /></div>
            {link && <p className="text-xs text-muted-foreground">{t("Saved in:")} <b>{link.folderName ?? t("Top level")}</b>. {t("Pick a folder in the left panel to save there; drag twins between folders later.")}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>{t("Cancel")}</Button>
            <Button onClick={() => void create()} disabled={creating || !newName.trim()}>{creating ? t("Saving…") : t("Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingPack} onOpenChange={(o) => { if (!o) setPendingPack(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Replace the layout with {name}?", { name: pendingPack ? t(PACKS[pendingPack]?.name ?? "") : "" })}</AlertDialogTitle>
            <AlertDialogDescription>{current ? <>{t("The machines, settings and asset links of \"{name}\" are replaced by the template. This is saved for everyone.", { name: current.name })}</> : t("The machines on the floor are replaced by the template.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmTemplate}>{t("Replace")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete \"{name}\"?", { name: current?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("The 3D layout, machine settings and asset links of this twin are removed for everyone. Assets and their telemetry are not affected.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="bg-red-600 hover:bg-red-700">{t("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
