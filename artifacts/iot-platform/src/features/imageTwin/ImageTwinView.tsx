import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Camera, Check, Circle, FilePlus, FileSpreadsheet, Hexagon, ImageUp, Link2, Maximize, MapPin, MousePointer2, Pencil, Save, Square, Trash2, Upload, Wand2, X,
} from "lucide-react";
import { useListAssets } from "@workspace/api-client-react";
import { useProjectScope } from "@/hooks/useProjectScope";
import { useProject } from "@/contexts/ProjectContext";
import { useCurrentUser } from "@/contexts/UserContext";
import { useMetricChoices } from "@/features/dashboards/useWidgetData";
import { listPlantTwins, getPlantTwin, createPlantTwin, updatePlantTwin, deletePlantTwin, type PlantTwinSummary } from "@/features/plantTwin/api";
import { useTwinLink, type TwinLink } from "@/features/plantTwin/twinLink";
import { saveTone } from "@/features/plantTwin/saveTone";
import { usePlayback, PlaybackButton } from "@/features/plantTwin/shared/playback";
import { TwinAlarms } from "@/features/plantTwin/shared/TwinAlarms";
import { snapshotSvg } from "@/features/plantTwin/shared/snapshot";
import { Stage, snapshotCopy, type StageHandle, type Tool } from "./Stage";
import { ItemEditor, MappingList, type AssetChoice } from "./MappingPanel";
import { backgroundFromFile, backgroundFromUrl, type Background } from "./background";
import { applyCsv, toCsv, type CsvResult } from "./csv";
import { useItemViews } from "./live";
import { emptyScene, newItemId, normaliseScene, type ImageScene, type TwinItem } from "./types";
import type { Part } from "./sanitize";

const CLASSIC_KEY = "wsviz:twins";
const MAX_SCENE = 990_000;
let instance = 0;

function useProjectAssets(): AssetChoice[] {
  const { inScope } = useProjectScope();
  const { data } = useListAssets();
  return useMemo(() => ((data as any[] | undefined) ?? []).filter((a: any) => inScope(a.id, { strict: true }))
    .map((a: any) => ({ id: a.id as string, name: a.name as string, identifier: (a.identifier as string | null) ?? null })), [data, inScope]);
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.:/]+/g, "");

function readClassic(): any[] {
  try { const r = localStorage.getItem(CLASSIC_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Preview + apply: parts and regions whose names match an asset's metrics. */
function AutoMatchDialog({ open, onOpenChange, assets, items, parts, onApply }: {
  open: boolean; onOpenChange: (o: boolean) => void; assets: AssetChoice[]; items: TwinItem[]; parts: Part[];
  onApply: (assetId: string, matches: { key: string; ref?: string; itemId?: string; name: string; metric: string }[]) => void;
}) {
  const t = useT();
  const [assetId, setAssetId] = useState<string>("");
  const metrics = useMetricChoices(assetId || undefined);
  const [off, setOff] = useState<Set<string>>(new Set());
  const matches = useMemo(() => {
    if (!assetId) return [];
    const byNorm = new Map<string, string>();
    for (const m of metrics) { byNorm.set(norm(m.key), m.key); byNorm.set(norm(m.label), m.key); }
    const out: { key: string; ref?: string; itemId?: string; name: string; metric: string; replaces: boolean }[] = [];
    const seenRefs = new Set<string>();
    for (const it of items) {
      const m = byNorm.get(norm(it.name)) ?? (it.ref ? byNorm.get(norm(it.ref)) : undefined);
      if (it.ref) seenRefs.add(it.ref);
      if (m) out.push({ key: it.id, itemId: it.id, ref: it.ref, name: it.name, metric: m, replaces: !!(it.metric && (it.metric !== m || it.assetId !== assetId)) });
    }
    for (const p of parts) {
      if (seenRefs.has(p.ref)) continue;
      const m = byNorm.get(norm(p.name)) ?? byNorm.get(norm(p.ref));
      if (m) out.push({ key: `p:${p.ref}`, ref: p.ref, name: p.name, metric: m, replaces: false });
    }
    return out;
  }, [assetId, metrics, items, parts]);
  useEffect(() => { setOff(new Set()); }, [assetId]);
  const chosen = matches.filter((m) => !off.has(m.key));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Auto-match parts to metrics")}</DialogTitle>
          <DialogDescription>{t("Parts and regions whose name matches a metric of the asset are linked, ignoring case, spaces, - and _ (TT-101 matches tt101).")}</DialogDescription>
        </DialogHeader>
        <Select value={assetId} onValueChange={setAssetId}>
          <SelectTrigger className="h-8"><SelectValue placeholder={t("Choose an asset…")} /></SelectTrigger>
          <SelectContent>{assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
        {assetId && (
          <div className="max-h-72 overflow-auto rounded border border-border">
            {!matches.length ? <p className="p-3 text-sm text-muted-foreground">{t("No part or region name matches a metric of this asset.")}</p> : matches.map((m) => (
              <label key={m.key} className="flex items-center gap-2 px-2.5 py-1.5 text-xs border-b border-border/60 last:border-0">
                <Checkbox checked={!off.has(m.key)} onCheckedChange={(c) => setOff((s) => { const n = new Set(s); if (c) n.delete(m.key); else n.add(m.key); return n; })} />
                <span className="flex-1 truncate font-medium">{m.name}</span>
                <span className="font-mono text-muted-foreground truncate">→ {m.metric}</span>
                {m.replaces && <span className="text-[10px] rounded px-1 bg-amber-500/15 text-amber-600 dark:text-amber-400">{t("replaces link")}</span>}
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button disabled={!chosen.length} onClick={() => { onApply(assetId, chosen); onOpenChange(false); }}>{t("Link {n}", { n: chosen.length })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ImageTwinView({ link }: { link: TwinLink }) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currentProjectId } = useProject();
  const { canModule } = useCurrentUser();
  const canCreate = canModule("live_twin", "write");
  const canDelete = canModule("live_twin", "delete");
  const assets = useProjectAssets();
  const prefix = useMemo(() => `itw${++instance}-`, []);

  const listQ = useQuery({ queryKey: ["plant-twins"], queryFn: listPlantTwins });
  const twins = useMemo(() => (listQ.data ?? []).filter((x) => x.kind === "image" && (!x.projectId || !currentProjectId || x.projectId === currentProjectId)), [listQ.data, currentProjectId]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const current: PlantTwinSummary | null = twins.find((x) => x.id === currentId) ?? null;
  const [scene, setScene] = useState<ImageScene>(() => emptyScene());
  const [parts, setParts] = useState<Part[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [flash, setFlash] = useState<{ ids: string[]; n: number }>({ ids: [], n: 0 });
  const stageRef = useRef<StageHandle>(null);
  useTwinLink(link, currentId, (id) => { setDraft(!id); setCurrentId(id); });

  useEffect(() => {
    if (!listQ.isSuccess || draft) return;
    if (currentId && twins.some((x) => x.id === currentId)) return;
    setCurrentId(twins[0]?.id ?? null);
  }, [listQ.isSuccess, twins, currentId, draft]);

  const loading = useRef(false);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    setSelectedId(null); setTool("select");
    if (!currentId) { setScene(emptyScene()); return; }
    let cancelled = false; loading.current = true; setOpening(true);
    getPlantTwin(currentId).then((row) => { if (!cancelled) setScene(normaliseScene(row.scene)); })
      .catch((err) => toast({ title: t("Could not open this twin"), description: err?.message ?? String(err), variant: "destructive" }))
      .finally(() => { if (!cancelled) setOpening(false); setTimeout(() => { loading.current = false; }, 0); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const isDraft = !currentId;
  const editable = isDraft || !!current?.canEdit;

  // ── saving ────────────────────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [saveErr, setSaveErr] = useState("");
  const pending = useRef<{ id: string; body: ImageScene } | null>(null);
  const sceneOut = useCallback((s: ImageScene): ImageScene => { const { parent: _p, ...rest } = s; return rest as ImageScene; }, []);
  const change = useCallback((fn: (s: ImageScene) => ImageScene) => {
    setScene((s) => {
      const next = fn(s);
      if (!loading.current && current?.canEdit) { setSaveState("dirty"); pending.current = { id: current.id, body: next }; }
      return next;
    });
  }, [current]);
  useEffect(() => () => {
    const p = pending.current; if (!p) return; pending.current = null;
    updatePlantTwin(p.id, { scene: sceneOut(p.body) as any }).catch(() => { /* best effort on leave */ });
  }, [currentId, sceneOut]);
  useEffect(() => { setSaveState("saved"); setSaveErr(""); }, [currentId]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const tooBig = (s: ImageScene) => JSON.stringify(sceneOut(s)).length > MAX_SCENE;
  const saveNow = () => {
    if (!current) return;
    if (tooBig(scene)) { setSaveState("error"); setSaveErr(t("the twin is larger than 1 MB; use a smaller background")); return; }
    pending.current = null; setSaveState("saving");
    updatePlantTwin(current.id, { scene: sceneOut(scene) as any }).then(() => { setSaveState("saved"); setSaveErr(""); qc.invalidateQueries({ queryKey: ["plant-twins"] }); })
      .catch((err) => { setSaveState("error"); setSaveErr(err?.message ?? String(err)); });
  };
  const [saveOpen, setSaveOpen] = useState(false), [name, setName] = useState(""), [busy, setBusy] = useState(false);
  async function saveAs() {
    if (tooBig(scene)) { toast({ title: t("Could not save the twin"), description: t("The twin is larger than 1 MB. Use a smaller background image."), variant: "destructive" }); return; }
    setBusy(true);
    try {
      const id = `pt-${crypto.randomUUID()}`;
      const row = await createPlantTwin({ id, name: name.trim(), projectId: currentProjectId ?? null, scene: { ...(sceneOut(scene) as any), ...(link.folderId ? { parent: link.folderId } : {}) } });
      qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => [row, ...(old ?? [])]);
      setSaveOpen(false); setDraft(false); setCurrentId(id);
    } catch (err: any) { toast({ title: t("Could not save the twin"), description: err?.message ?? String(err), variant: "destructive" }); }
    setBusy(false);
  }
  const [renaming, setRenaming] = useState(false), [nameDraft, setNameDraft] = useState("");
  async function rename() {
    if (current && nameDraft.trim()) {
      try { const row = await updatePlantTwin(current.id, { name: nameDraft.trim() }); qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => (old ?? []).map((x) => (x.id === row.id ? { ...x, name: row.name } : x))); }
      catch (err: any) { toast({ title: t("Could not rename"), description: err?.message ?? String(err), variant: "destructive" }); }
    }
    setRenaming(false);
  }
  const [confirmDel, setConfirmDel] = useState(false);
  async function remove() {
    if (!current) return;
    try { await deletePlantTwin(current.id); pending.current = null; qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => (old ?? []).filter((x) => x.id !== current.id)); setCurrentId(null); }
    catch (err: any) { toast({ title: t("Could not delete"), description: err?.message ?? String(err), variant: "destructive" }); }
    setConfirmDel(false);
  }

  // ── live state ────────────────────────────────────────────────────────────
  const pairsForPlayback = useMemo(() => scene.items.filter((i) => i.assetId && i.metric).map((i) => ({ assetId: i.assetId!, metric: i.metric! })), [scene.items]);
  const playback = usePlayback(pairsForPlayback);
  const { views, wsStatus, limits } = useItemViews(scene.items, { demo: scene.demo, playback });

  // ── background ────────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [bgBusy, setBgBusy] = useState(false);
  const applyBackground = (bg: Background) => {
    change((s) => ({ ...s, w: bg.w, h: bg.h, svg: bg.svg, image: bg.image, url: bg.url }));
    setTimeout(() => stageRef.current?.fit(), 50);
    if (bg.parts) toast({ title: t("Drawing loaded"), description: t("{n} named parts found. Click a part (or Map in the list) to link it.", { n: bg.parts.length }) });
  };
  const loadFile = async (f: File | undefined) => {
    if (!f || !editable) return;
    setBgBusy(true);
    try { applyBackground(await backgroundFromFile(f)); }
    catch (e: any) { toast({ title: t("Could not use that file"), description: e?.message ?? String(e), variant: "destructive" }); }
    setBgBusy(false);
  };
  const [urlOpen, setUrlOpen] = useState(false), [urlDraft, setUrlDraft] = useState("");
  const loadUrl = async () => {
    setBgBusy(true);
    try { applyBackground(await backgroundFromUrl(urlDraft)); setUrlOpen(false); }
    catch (e: any) { toast({ title: t("Could not use that address"), description: e?.message ?? String(e), variant: "destructive" }); }
    setBgBusy(false);
  };
  const hasBackground = !!(scene.svg || scene.image || scene.url);

  // ── items ─────────────────────────────────────────────────────────────────
  const selected = scene.items.find((i) => i.id === selectedId) ?? null;
  const patchItem = (id: string, patch: Partial<TwinItem>) => change((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const addItem = (it: TwinItem) => { change((s) => ({ ...s, items: [...s.items, it] })); setSelectedId(it.id); };
  const mapPart = (p: Part) => {
    const existing = scene.items.find((i) => i.kind === "part" && i.ref === p.ref);
    if (existing) { setSelectedId(existing.id); return; }
    addItem({ id: newItemId(), kind: "part", ref: p.ref, name: p.name, behaviours: ["value", "status"] });
  };
  const onCreate = (x: Partial<TwinItem> & { kind: TwinItem["kind"] }) => {
    const n = scene.items.filter((i) => i.kind === x.kind).length + 1;
    const base = x.kind === "point" ? t("Point {n}", { n }) : t("Region {n}", { n });
    addItem({ id: newItemId(), name: base, behaviours: ["value", "status"], ...x } as TwinItem);
  };
  const deleteSelected = () => { if (!selected) return; change((s) => ({ ...s, items: s.items.filter((i) => i.id !== selected.id) })); setSelectedId(null); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected && editable) { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  const flashIds = (ids: string[]) => setFlash((f) => ({ ids, n: f.n + 1 }));
  const missingParts = useMemo(() => { if (!scene.svg) return 0; const refs = new Set(parts.map((p) => p.ref)); return scene.items.filter((i) => i.kind === "part" && i.ref && !refs.has(i.ref)).length; }, [scene.items, scene.svg, parts]);

  // ── auto-match, CSV ───────────────────────────────────────────────────────
  const [matchOpen, setMatchOpen] = useState(false);
  const applyMatches = (assetId: string, ms: { ref?: string; itemId?: string; name: string; metric: string }[]) => {
    change((s) => {
      const items = s.items.map((i) => { const m = ms.find((x) => x.itemId === i.id); return m ? { ...i, assetId, metric: m.metric } : i; });
      for (const m of ms) if (!m.itemId && m.ref) items.push({ id: newItemId(), kind: "part", ref: m.ref, name: m.name, assetId, metric: m.metric, behaviours: ["value", "status"] });
      return { ...s, items };
    });
    toast({ title: t("{n} linked", { n: ms.length }) });
  };
  const [csvReport, setCsvReport] = useState<CsvResult | null>(null);
  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    const r = applyCsv(await f.text(), scene.items, parts, assets);
    if (r.applied) change((s) => ({ ...s, items: r.items }));
    setCsvReport(r);
  };
  const exportCsv = () => download(`${(current?.name ?? "2d-twin").replace(/[^\w.-]+/g, "_")}-mapping.csv`, "﻿" + toCsv(scene.items, assets), "text/csv;charset=utf-8");

  // ── migration of browser-saved (classic) twins ───────────────────────────
  const [classic, setClassic] = useState<any[]>(() => readClassic());
  const [migrating, setMigrating] = useState(false);
  const imported = useMemo(() => new Set((listQ.data ?? []).map((x) => x.name)), [listQ.data]);
  const toImport = classic.filter((c) => c && typeof c.name === "string" && !imported.has(c.name));
  async function migrate() {
    setMigrating(true);
    let ok = 0; const failed: string[] = [];
    for (const c of toImport) {
      try {
        let bg: Background | null = null;
        if (typeof c.image === "string" && c.image) {
          try { bg = await backgroundFromUrl(c.image); } catch { bg = /^https?:|^\//.test(c.image) ? { w: 1000, h: 750, url: c.image } : null; }
        }
        const items: TwinItem[] = (Array.isArray(c.hotspots) ? c.hotspots : []).map((h: any) => ({
          id: newItemId(), kind: "point", name: String(h.label || t("Point")).slice(0, 120), x: Number(h.x) || 0, y: Number(h.y) || 0,
          assetId: h.assetId || undefined, metric: h.tag || undefined, unit: h.unit || undefined, decimals: typeof h.decimals === "number" ? h.decimals : undefined,
          warn: h.warn !== undefined && h.warn !== "" && Number.isFinite(Number(h.warn)) ? Number(h.warn) : undefined,
          crit: h.critical !== undefined && h.critical !== "" && Number.isFinite(Number(h.critical)) ? Number(h.critical) : undefined,
          color: h.color || undefined, behaviours: ["value", "status"],
        }));
        const sc: ImageScene = { ...emptyScene(), demo: false, ...(bg ? { w: bg.w, h: bg.h, svg: bg.svg, image: bg.image, url: bg.url } : {}), items };
        const row = await createPlantTwin({ id: `pt-${crypto.randomUUID()}`, name: String(c.name).slice(0, 200), projectId: currentProjectId ?? null, scene: sc as any });
        qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => [row, ...(old ?? [])]);
        ok++;
      } catch (e: any) { failed.push(`${c.name}: ${e?.message ?? e}`); }
    }
    setMigrating(false);
    toast({ title: t("{n} 2D twins imported", { n: ok }), description: failed.length ? failed.join("; ") : t("The copies saved in this browser were left as they are."), variant: failed.length ? "destructive" : undefined });
    setClassic(readClassic());
  }

  // ── toolbar ───────────────────────────────────────────────────────────────
  const saveText = { saved: t("Saved"), dirty: t("Unsaved changes…"), saving: t("Saving…"), error: t("Not saved: {err}", { err: saveErr }) }[saveState];
  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap">
      {(current || listQ.isLoading) && <span className="text-sm font-semibold truncate max-w-[14rem]">{listQ.isLoading ? t("Loading…") : current?.name}</span>}
      {!isDraft && canCreate && <Button size="sm" variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-500/10 hover:text-orange-600 dark:text-orange-400" onClick={() => { setDraft(true); setCurrentId(null); }} title={t("Start a new twin")}><FilePlus className="w-4 h-4 mr-1" /> {t("New")}</Button>}
      {current?.canEdit && !renaming && (
        <>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setNameDraft(current.name); setRenaming(true); }} aria-label={t("Rename")} title={t("Rename")}><Pencil className="w-4 h-4" /></Button>
          {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => setConfirmDel(true)} aria-label={t("Delete")} title={t("Delete")}><Trash2 className="w-4 h-4" /></Button>}
        </>
      )}
      {renaming && (
        <div className="flex items-center gap-1">
          <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(false); }} className="h-8 w-48" autoFocus />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void rename()} aria-label={t("Save name")}><Check className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setRenaming(false)} aria-label={t("Cancel")}><X className="w-4 h-4" /></Button>
        </div>
      )}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1"><Switch checked={scene.demo} disabled={!editable} onCheckedChange={(v) => change((s) => ({ ...s, demo: v }))} className="scale-90" /> {t("Demo values")}</label>
      <PlaybackButton playback={playback} />
      {current && (saveState === "error" || !current.canEdit) && <span className={cn("text-xs", saveState === "error" ? "text-red-500" : "text-muted-foreground")}>{current.canEdit ? saveText : t("View only: owned by someone else")}</span>}
      <span className={cn("ml-auto inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", wsStatus === "connected" ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300")}>{wsStatus === "connected" ? t("Live") : t("Reconnecting")}</span>
      {canCreate && (isDraft || current?.canEdit) && (
        <Button size="sm" onClick={() => { if (isDraft) { setName(t("2D twin {n}", { n: twins.length + 1 })); setSaveOpen(true); } else saveNow(); }} disabled={saveState === "saving"} className={cn("h-8", saveTone(isDraft ? "new" : saveState))}
          title={isDraft ? t("Not saved yet: save this twin") : saveState === "saved" ? t("All changes saved") : saveState === "error" ? t("Not saved: {err}", { err: saveErr }) : saveState === "saving" ? t("Saving…") : t("Unsaved changes: press Save")}><Save className="w-4 h-4 mr-1" /> {t("Save")}</Button>
      )}
    </div>
  );

  const TOOLS: { k: Tool; icon: typeof Square; label: string }[] = [
    { k: "select", icon: MousePointer2, label: "Select and move" },
    { k: "rect", icon: Square, label: "Draw rectangle region" },
    { k: "ellipse", icon: Circle, label: "Draw ellipse region" },
    { k: "polygon", icon: Hexagon, label: "Draw polygon region" },
    { k: "point", icon: MapPin, label: "Place a point" },
  ];
  const unlinked = scene.items.filter((i) => !(i.assetId && i.metric)).length;
  const linkedAssets = useMemo(() => Array.from(new Set(scene.items.map((i) => i.assetId).filter((x): x is string => !!x))), [scene.items]);
  const assetName = (id: string) => assets.find((a) => a.id === id)?.name;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {link.toolbar ? createPortal(toolbar, link.toolbar) : <div className="p-3 border-b border-border shrink-0">{toolbar}</div>}
      {canCreate && toImport.length > 0 && (
        <div className="px-3 py-1.5 text-xs border-b border-border shrink-0 flex items-center gap-2 bg-primary/5">
          <span>{t("{n} 2D twins are saved only in this browser.", { n: toImport.length })}</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" disabled={migrating} onClick={() => void migrate()}><Upload className="w-3 h-3 mr-1" />{migrating ? t("Importing…") : t("Import to server")}</Button>
        </div>
      )}
      {(isDraft || (scene.demo && unlinked > 0) || missingParts > 0) && hasBackground && (
        <div className={cn("px-3 py-1.5 text-xs border-b border-border shrink-0", scene.demo && unlinked ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "text-muted-foreground")}>
          {isDraft && <>{canCreate ? t("Map parts to readings on the right, then Save.") : t("You can try mapping here, but you cannot save twins.")} </>}
          {scene.demo && unlinked > 0 && t("{n} item(s) show simulated demo values, marked \"demo\". They are not plant data.", { n: unlinked })}
          {missingParts > 0 && <> {t("{n} mapped part(s) are not in the current drawing.", { n: missingParts })}</>}
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        <div className="relative flex-1 min-w-0 flex flex-col">
          {hasBackground && (
            <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-border shrink-0">
              {editable && TOOLS.map((x) => (
                <Button key={x.k} size="icon" variant={tool === x.k ? "default" : "ghost"} className="h-7 w-7" onClick={() => setTool(x.k)} title={t(x.label)} aria-label={t(x.label)}><x.icon className="w-3.5 h-3.5" /></Button>
              ))}
              {editable && <span className="w-px h-5 bg-border mx-1" />}
              {editable && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => fileRef.current?.click()} disabled={bgBusy}><ImageUp className="w-3.5 h-3.5 mr-1" />{t("Change background")}</Button>}
              {editable && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMatchOpen(true)}><Wand2 className="w-3.5 h-3.5 mr-1" />{t("Auto-match")}</Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="h-7 text-xs"><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />CSV</Button></DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={exportCsv}>{t("Export mapping (CSV)")}</DropdownMenuItem>
                  {editable && <DropdownMenuItem onClick={() => csvRef.current?.click()}>{t("Import mapping (CSV)…")}</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
              {scene.svg && editable && (
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground ml-1" title={t("Also list elements with ids an editor made up, such as path123")}>
                  <Switch checked={!!scene.allIds} onCheckedChange={(v) => change((s) => ({ ...s, allIds: v }))} className="scale-75" />{t("All ids")}
                </label>
              )}
              <span className="flex-1" />
              <Button size="icon" variant="ghost" className="h-7 w-7" title={t("Save as PNG")} aria-label={t("Save as PNG")}
                onClick={() => {
                  const svg = stageRef.current?.svg(); if (!svg) return;
                  const copy = snapshotCopy(svg, scene.w, scene.h);
                  snapshotSvg(copy.el, current?.name ?? "2d-twin")
                    .catch(() => toast({ title: t("Could not create the picture"), description: scene.url ? t("Images from another address cannot be included in a picture.") : undefined, variant: "destructive" }))
                    .finally(copy.done);
                }}><Camera className="w-3.5 h-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title={t("Fit to view")} aria-label={t("Fit to view")} onClick={() => stageRef.current?.fit()}><Maximize className="w-3.5 h-3.5" /></Button>
            </div>
          )}
          {playback.bar && <div className="px-2 py-1.5 border-b border-border shrink-0">{playback.bar}</div>}
          <div className="relative flex-1 min-h-0"
            onDragOver={(e) => { if (editable && e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
            onDrop={(e) => { if (!editable) return; e.preventDefault(); void loadFile(e.dataTransfer.files?.[0]); }}>
            {hasBackground ? (
              <Stage ref={stageRef} scene={scene} views={views} prefix={prefix} editable={editable} tool={tool} selectedId={selectedId} flash={flash}
                onParts={setParts}
                onPickPart={(r) => { const it = scene.items.find((i) => i.kind === "part" && i.ref === r); if (it) setSelectedId(it.id); else if (editable) { const p = parts.find((x) => x.ref === r); if (p) mapPart(p); } }}
                onPickItem={setSelectedId}
                onCreate={onCreate}
                onMove={patchItem}
                onToolDone={() => setTool("select")} />
            ) : opening ? (
              <div className="p-6 text-sm text-muted-foreground">{t("Loading…")}</div>
            ) : (
              <div className="h-full flex items-center justify-center p-6">
                <div className="max-w-md w-full text-center space-y-4">
                  <button disabled={!editable} onClick={() => fileRef.current?.click()} className="w-full rounded-lg border-2 border-dashed border-border hover:border-primary/60 hover:bg-primary/5 p-8 space-y-2 disabled:opacity-60">
                    <ImageUp className="w-8 h-8 mx-auto text-muted-foreground" />
                    <div className="font-semibold">{t("Upload a drawing or image")}</div>
                    <div className="text-xs text-muted-foreground">{t("SVG (best: every named part can be mapped), or PNG, JPEG, GIF, WebP, BMP, AVIF. Drop a file here or click.")}</div>
                  </button>
                  {editable && <Button size="sm" variant="ghost" onClick={() => { setUrlDraft(""); setUrlOpen(true); }}><Link2 className="w-3.5 h-3.5 mr-1" />{t("Use an image address instead")}</Button>}
                  <div className="text-left rounded-md border border-border p-3 text-xs space-y-1">
                    <div className="font-semibold">{t("How mapping works")}</div>
                    <p>1. {t("Upload the drawing. In an SVG, every element with an id or a layer name becomes a part.")}</p>
                    <p>2. {t("Click a part, or draw a region or point on any image, and choose its asset and metric.")}</p>
                    <p>3. {t("Pick what it does: show the value, colour by alarm status, fill level, rotate, blink or show text. Then Save.")}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="w-80 shrink-0 border-l border-border overflow-y-auto p-3 space-y-4">
          {selected && (
            <ItemEditor item={selected} view={views.get(selected.id)} assets={assets} readOnly={!editable} rules={limits(selected.assetId, selected.metric)}
              onChange={(p) => patchItem(selected.id, p)} onDelete={deleteSelected} onClose={() => setSelectedId(null)} />
          )}
          <MappingList items={scene.items} parts={parts} views={views} assets={assets} selectedId={selectedId} selectedRef={null} readOnly={!editable}
            onSelect={(id) => { setSelectedId(id); flashIds([id]); }} onMapPart={mapPart} />
          <TwinAlarms assetIds={linkedAssets} label={assetName} onFocus={(a) => flashIds(scene.items.filter((i) => i.assetId === a).map((i) => i.id))} />
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*,.svg,.bmp,.ico,.avif" className="hidden" onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { void importCsv(e.target.files?.[0]); e.target.value = ""; }} />

      <AutoMatchDialog open={matchOpen} onOpenChange={setMatchOpen} assets={assets} items={scene.items} parts={parts} onApply={applyMatches} />
      <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("Image address")}</DialogTitle><DialogDescription>{t("An http(s) address, a path on this server or a data:image URL. External addresses may be blocked by this server's security policy; uploading the file is more reliable.")}</DialogDescription></DialogHeader>
          <Input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://…" onKeyDown={(e) => { if (e.key === "Enter") void loadUrl(); }} autoFocus />
          <DialogFooter><Button variant="outline" onClick={() => setUrlOpen(false)}>{t("Cancel")}</Button><Button onClick={() => void loadUrl()} disabled={bgBusy || !urlDraft.trim()}>{t("Use")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!csvReport} onOpenChange={(o) => { if (!o) setCsvReport(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("Mapping imported")}</DialogTitle><DialogDescription>{t("{a} row(s) applied, {c} new part mapping(s).", { a: csvReport?.applied ?? 0, c: csvReport?.created ?? 0 })}</DialogDescription></DialogHeader>
          {!!csvReport?.problems.length && (
            <div className="max-h-60 overflow-auto rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-0.5">
              {csvReport.problems.map((p, i) => <div key={i}>{p}</div>)}
            </div>
          )}
          <DialogFooter><Button onClick={() => setCsvReport(null)}>{t("Close")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("Save twin")}</DialogTitle><DialogDescription>{link.folderName ? t("Saves this twin in the folder \"{f}\" for everyone in the project.", { f: link.folderName }) : t("Saves this twin with its asset links for everyone in the project.")}</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label>{t("Name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void saveAs(); }} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setSaveOpen(false)}>{t("Cancel")}</Button><Button onClick={() => void saveAs()} disabled={busy || !name.trim()}>{busy ? t("Saving…") : t("Save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("Delete \"{name}\"?", { name: current?.name ?? "" })}</AlertDialogTitle><AlertDialogDescription>{t("The twin and its asset links are removed for everyone. Assets and telemetry are not affected.")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("Cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void remove()} className="bg-red-600 hover:bg-red-700">{t("Delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * View-only, compact live render of a saved 2D twin, for a dashboard widget.
 * Demo values follow the twin's own setting.
 */
export function ImageTwinEmbed({ twinId }: { twinId: string }) {
  const t = useT();
  const prefix = useMemo(() => `itw${++instance}-`, []);
  const q = useQuery({ queryKey: ["plant-twin", twinId], queryFn: () => getPlantTwin(twinId), enabled: !!twinId, staleTime: 60_000 });
  const scene = useMemo(() => normaliseScene(q.data?.scene), [q.data]);
  const { views } = useItemViews(scene.items, { demo: scene.demo, enabled: !!q.data });
  if (q.isLoading) return <div className="p-3 text-xs text-muted-foreground">{t("Loading…")}</div>;
  if (q.isError || !q.data) return <div className="p-3 text-xs text-muted-foreground">{t("This 2D twin could not be opened. It may have been deleted, or you may not have access.")}</div>;
  if (q.data.kind && q.data.kind !== "image") return <div className="p-3 text-xs text-muted-foreground">{t("That twin is not a 2D twin.")}</div>;
  if (!scene.svg && !scene.image && !scene.url) return <div className="p-3 text-xs text-muted-foreground">{t("This 2D twin has no drawing yet.")}</div>;
  return <div className="w-full h-full min-h-0"><Stage scene={scene} views={views} prefix={prefix} compact /></div>;
}

