import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTwinLink, type TwinLink } from "../twinLink";
import { saveTone } from "../saveTone";
import { ReadingTrend } from "../ReadingTrend";
import { DataSourceCard } from "../DataSource";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Check, FilePlus, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useListAssets } from "@workspace/api-client-react";
import { useProjectScope } from "@/hooks/useProjectScope";
import { useProject } from "@/contexts/ProjectContext";
import { useCurrentUser } from "@/contexts/UserContext";
import { useWsEvents } from "@/hooks/useWsEvents";
import { useMetricChoices } from "@/features/dashboards/useWidgetData";
import { listPlantTwins, getPlantTwin, createPlantTwin, updatePlantTwin, deletePlantTwin, fetchPlantValues, fetchAssetMetrics, type PlantTwinSummary } from "../api";
import { TAGS, createDemoSim, fmt, matchMetric, type Scenario, type Src } from "./tags";
import type { Getter } from "./MachineStage";

type Bind = Record<string, { assetId: string; metric: string }>;
interface TagScene { version: 1; kind: "machine" | "process"; demo: boolean; bind: Bind }
const NONE = "__none";
const SCENARIOS: [Scenario, string][] = [["normal", "Normal running"], ["cavitation", "Cavitation"], ["overheat", "Bearing overheat"], ["trip", "Pump trip"]];

function ReadingRow({ k, assets, b, value, readOnly, onAsset, onMetric }: {
  k: string; assets: { id: string; name: string }[]; b?: { assetId: string; metric: string }; value: { v: number | null; src: Src; status: string };
  readOnly: boolean; onAsset: (a: string | null) => void; onMetric: (m: string) => void;
}) {
  const metrics = useMetricChoices(b?.assetId);
  const tr = useT();
  const t = TAGS[k];
  return (
    <div className="py-2 border-b border-border/60 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate"><span className="font-mono text-[11px] mr-1.5">{t.tag}</span><span className="text-muted-foreground">{tr(t.n)}</span></span>
        <span className={cn("font-mono tabular-nums shrink-0", value.status === "crit" ? "text-red-500" : value.status === "warn" ? "text-amber-500" : "")}>
          {value.src === "none" ? tr("not linked") : fmt(k, value.v)}
          {value.src !== "none" && <span className={cn("ml-1 text-[10px] rounded px-1", value.src === "live" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400")}>{tr(value.src)}</span>}
        </span>
      </div>
      <ReadingTrend value={value.v} source={value.src} status={value.status} assetId={b?.assetId} metric={b?.metric} />
      <div className="grid grid-cols-2 gap-1">
        <Select value={b?.assetId ?? NONE} onValueChange={(v) => onAsset(v === NONE ? null : v)} disabled={readOnly}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{tr("Not linked")}</SelectItem>
            {b?.assetId && !assets.some((a) => a.id === b.assetId) && <SelectItem value={b.assetId}>{tr("Asset outside this project")}</SelectItem>}
            {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={b?.metric || NONE} onValueChange={(v) => onMetric(v === NONE ? "" : v)} disabled={readOnly || !b?.assetId}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={tr("Metric")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{tr("Pick a metric")}</SelectItem>
            {b?.metric && !metrics.some((m) => m.key === b.metric) && <SelectItem value={b.metric}>{b.metric}</SelectItem>}
            {metrics.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function TagTwinView({ kind, keys, Stage, demoValve, link }: {
  kind: "machine" | "process"; keys: string[]; Stage: (p: { get: Getter }) => React.ReactElement; demoValve?: boolean; link?: TwinLink;
}) {
  const { toast } = useToast();
  const t = useT();
  const qc = useQueryClient();
  const { currentProjectId } = useProject();
  const { canModule } = useCurrentUser();
  const canCreate = canModule("visualization", "write");
  const { inScope } = useProjectScope();
  const { data: assetsData } = useListAssets();
  const assets = useMemo(() => ((assetsData as any[] | undefined) ?? []).filter((a: any) => inScope(a.id, { strict: true })).map((a: any) => ({ id: a.id as string, name: a.name as string })), [assetsData, inScope]);
  const label = kind === "machine" ? "machine twin" : "process twin";

  const listQ = useQuery({ queryKey: ["plant-twins"], queryFn: listPlantTwins });
  const twins = useMemo(() => (listQ.data ?? []).filter((t) => t.kind === kind && (!t.projectId || !currentProjectId || t.projectId === currentProjectId)), [listQ.data, kind, currentProjectId]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const current: PlantTwinSummary | null = twins.find((t) => t.id === currentId) ?? null;
  const [bind, setBind] = useState<Bind>({});
  const [demo, setDemo] = useState(true);
  const readOnly = current ? !current.canEdit : false;
  useTwinLink(link, currentId, (id) => { setDraft(!id); setCurrentId(id); });

  useEffect(() => {
    if (!listQ.isSuccess || draft) return;
    if (currentId && twins.some((t) => t.id === currentId)) return;
    setCurrentId(twins[0]?.id ?? null);
  }, [listQ.isSuccess, twins, currentId, draft]);
  const loading = useRef(false);
  useEffect(() => {
    if (!currentId) { setBind({}); setDemo(true); return; }
    let cancelled = false; loading.current = true;
    getPlantTwin(currentId).then((t) => {
      if (cancelled) return;
      const s = t.scene as Partial<TagScene>;
      setBind((s.bind as Bind) ?? {}); setDemo(s.demo !== false);
    }).catch((err) => toast({ title: t("Could not open this twin"), description: err?.message ?? String(err), variant: "destructive" }))
      .finally(() => { setTimeout(() => { loading.current = false; }, 0); });
    return () => { cancelled = true; };
  }, [currentId, toast]);

  // ── autosave ──────────────────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [saveErr, setSaveErr] = useState("");
  const scene = useCallback((): TagScene => ({ version: 1, kind, demo, bind }), [kind, demo, bind]);
  const first = useRef(true);
  const pending = useRef<{ id: string; body: any } | null>(null);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!current?.canEdit || loading.current) return;
    // No timer: the Save button stays light orange until it is pressed.
    setSaveState("dirty");
    pending.current = { id: current.id, body: scene() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bind, demo]);
  // Unsaved changes are still written when another twin opens or the view closes.
  useEffect(() => () => {
    const p = pending.current; if (!p) return; pending.current = null;
    updatePlantTwin(p.id, { scene: p.body }).catch(() => { /* best effort on leave */ });
  }, [currentId]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ── live values + demo simulation ─────────────────────────────────────────
  const valuesRef = useRef(new Map<string, number | null>());
  const [nonce, setNonce] = useState(0);
  const lastWs = useRef(0);
  const wsStatus = useWsEvents({ telemetry: () => { const now = Date.now(); if (now - lastWs.current > 3000) { lastWs.current = now; setNonce((n) => n + 1); } } });
  useEffect(() => { const id = setInterval(() => setNonce((n) => n + 1), 20_000); return () => clearInterval(id); }, []);
  const pairs = keys.map((k) => bind[k]).filter((b): b is { assetId: string; metric: string } => !!b?.assetId && !!b.metric);
  const pairsKey = pairs.map((p) => p.assetId + ":" + p.metric).join("|");
  useEffect(() => {
    if (!pairs.length) { valuesRef.current = new Map(); return; }
    let cancelled = false;
    fetchPlantValues(pairs).then((rows) => { if (!cancelled) { const m = new Map<string, number | null>(); rows.forEach((r) => m.set(r.assetId + "\u0000" + r.metric, r.value)); valuesRef.current = m; } }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, pairsKey]);
  const sim = useRef(createDemoSim()).current;
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [valve, setValve] = useState(70);
  useEffect(() => { sim.scenario = scenario; sim.valve = valve; }, [scenario, valve, sim]);
  useEffect(() => { let raf = 0, last = performance.now(); const f = (now: number) => { raf = requestAnimationFrame(f); sim.step(Math.min(0.05, (now - last) / 1000)); last = now; }; raf = requestAnimationFrame(f); return () => cancelAnimationFrame(raf); }, [sim]);

  const stateRef = useRef({ bind, demo }); stateRef.current = { bind, demo };
  const get: Getter = useCallback((k: string) => {
    const { bind: bd, demo: dm } = stateRef.current;
    const b = bd[k];
    if (b?.assetId && b.metric) {
      const v = valuesRef.current.get(b.assetId + "\u0000" + b.metric);
      if (v != null) return { v, src: "live", status: TAGS[k] ? TAGS[k].status(v) : "ok" };
      return { v: null, src: "none", status: "nolink" };
    }
    if (dm) { const v = sim.S[k]; return { v, src: "demo", status: TAGS[k] ? TAGS[k].status(v) : "ok" }; }
    return { v: null, src: "none", status: "nolink" };
  }, [sim]);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => (t + 1) % 1e6), 400); return () => clearInterval(id); }, []);

  // ── linking ───────────────────────────────────────────────────────────────
  async function linkAsset(k: string, assetId: string | null) {
    if (!assetId) { setBind((b) => { const n = { ...b }; delete n[k]; return n; }); return; }
    const ms = await fetchAssetMetrics(assetId);
    setBind((b) => ({ ...b, [k]: { assetId, metric: matchMetric(k, ms) } }));
  }
  async function linkAll(assetId: string) {
    const ms = await fetchAssetMetrics(assetId); const used = new Set<string>();
    setBind(() => { const n: Bind = {}; keys.forEach((k) => { const m = matchMetric(k, ms, used); if (m) used.add(m); n[k] = { assetId, metric: m }; }); return n; });
  }

  // ── save / rename / delete ────────────────────────────────────────────────
  const [saveOpen, setSaveOpen] = useState(false), [name, setName] = useState(""), [busy, setBusy] = useState(false);
  async function saveAs() {
    setBusy(true);
    try {
      const id = `pt-${crypto.randomUUID()}`;
      const row = await createPlantTwin({ id, name: name.trim(), projectId: currentProjectId ?? null, scene: { ...(scene() as any), ...(link?.folderId ? { parent: link.folderId } : {}) } });
      qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => [row, ...(old ?? [])]);
      setSaveOpen(false); setDraft(false); setCurrentId(id);
    } catch (err: any) { toast({ title: `Could not save the ${label}`, description: err?.message ?? String(err), variant: "destructive" }); }
    setBusy(false);
  }
  const [renaming, setRenaming] = useState(false), [nameDraft, setNameDraft] = useState("");
  async function rename() {
    if (current && nameDraft.trim()) {
      try { const row = await updatePlantTwin(current.id, { name: nameDraft.trim() }); qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => (old ?? []).map((t) => (t.id === row.id ? { ...t, name: row.name } : t))); }
      catch (err: any) { toast({ title: t("Could not rename"), description: err?.message ?? String(err), variant: "destructive" }); }
    }
    setRenaming(false);
  }
  const [confirmDel, setConfirmDel] = useState(false);
  async function remove() {
    if (!current) return;
    try { await deletePlantTwin(current.id); qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => (old ?? []).filter((t) => t.id !== current.id)); setCurrentId(null); }
    catch (err: any) { toast({ title: t("Could not delete"), description: err?.message ?? String(err), variant: "destructive" }); }
    setConfirmDel(false);
  }

  const isDraft = !currentId;
  // The asset most readings are linked to; the data-source card describes that one.
  const mainAsset = (() => { const n = new Map<string, number>(); keys.forEach((k) => { const a = bind[k]?.assetId; if (a) n.set(a, (n.get(a) ?? 0) + 1); }); return [...n.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null; })();
  const vals = keys.map((k) => ({ k, ...get(k) }));
  const bad = vals.filter((x) => x.status === "warn" || x.status === "crit").sort((a, b) => (a.status === "crit" ? -1 : 1) - (b.status === "crit" ? -1 : 1));
  const unlinked = keys.filter((k) => !(bind[k]?.assetId && bind[k]?.metric)).length;
  const saveText = { saved: t("Saved"), dirty: t("Unsaved changes…"), saving: t("Saving…"), error: t("Not saved: {err}", { err: saveErr }) }[saveState];

  const openSave = () => { setName(kind === "machine" ? `Pump ${twins.length + 1}` : `Process unit ${twins.length + 1}`); setSaveOpen(true); };
  const saveNow = () => {
    if (!current) return;
    pending.current = null;
    setSaveState("saving");
    updatePlantTwin(current.id, { scene: scene() as any }).then(() => { setSaveState("saved"); setSaveErr(""); }).catch((err) => { setSaveState("error"); setSaveErr(err?.message ?? String(err)); });
  };
  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap">
      {link
        ? (current || listQ.isLoading) && <span className="text-sm font-semibold truncate max-w-[14rem]">{listQ.isLoading ? t("Loading…") : current?.name}</span>
        : <Select value={currentId ?? ""} onValueChange={(v) => { setDraft(false); setCurrentId(v); }}>
        <SelectTrigger className="h-8 w-56 text-sm"><SelectValue placeholder={listQ.isLoading ? "Loading…" : "Draft (not saved)"} /></SelectTrigger>
        <SelectContent>{twins.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
      </Select>}
      {!isDraft && canCreate && <Button size="sm" variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-500/10 hover:text-orange-600 dark:text-orange-400" onClick={() => { setDraft(true); setCurrentId(null); }} title={t("Start a new twin")}><FilePlus className="w-4 h-4 mr-1" /> {t("New")}</Button>}
      {current?.canEdit && !renaming && (
        <>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setNameDraft(current.name); setRenaming(true); }} aria-label={t("Rename")} title={t("Rename")}><Pencil className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => setConfirmDel(true)} aria-label={t("Delete")} title={t("Delete")}><Trash2 className="w-4 h-4" /></Button>
        </>
      )}
      {renaming && (
        <div className="flex items-center gap-1">
          <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(false); }} className="h-8 w-48" autoFocus />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void rename()} aria-label={t("Save name")}><Check className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setRenaming(false)} aria-label={t("Cancel")}><X className="w-4 h-4" /></Button>
        </div>
      )}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1"><Switch checked={demo} disabled={readOnly} onCheckedChange={setDemo} className="scale-90" /> {t("Demo values")}</label>
      {current && (saveState === "error" || !current.canEdit) && <span className={cn("text-xs", saveState === "error" ? "text-red-500" : "text-muted-foreground")}>{current.canEdit ? saveText : t("View only: owned by someone else")}</span>}
      <span className={cn("ml-auto inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", wsStatus === "connected" ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300")}>{wsStatus === "connected" ? t("Live") : t("Reconnecting")}</span>
      {canCreate && (isDraft || current?.canEdit) && (
        <Button size="sm" onClick={() => { if (isDraft) openSave(); else saveNow(); }} disabled={saveState === "saving"} className={cn("h-8", saveTone(isDraft ? "new" : saveState))}
          title={isDraft ? t("Not saved yet: save this twin") : saveState === "saved" ? t("All changes saved") : saveState === "error" ? t("Not saved: {err}", { err: saveErr }) : saveState === "saving" ? t("Saving…") : t("Unsaved changes: press Save")}><Save className="w-4 h-4 mr-1" /> {t("Save")}</Button>
      )}
    </div>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {link?.toolbar ? createPortal(toolbar, link.toolbar) : <div className="p-3 border-b border-border shrink-0">{toolbar}</div>}
      {(isDraft || unlinked > 0) && (
        <div className={cn("px-3 py-1.5 text-xs border-b border-border shrink-0", demo && unlinked ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "text-muted-foreground")}>
          {isDraft && <>{canCreate ? t("Link readings to assets on the right, then Save.") : t("Link readings to assets on the right.")} </>}
          {unlinked > 0 && (demo ? t("{n} reading(s) show simulated demo values, marked \"demo\". They are not plant data.", { n: unlinked }) : t("{n} reading(s) not linked.", { n: unlinked }))}
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        <div className="relative flex-1 min-w-0 m-3">
          <Stage get={get} />
          {bad.length > 0 && (
            <div className={cn("absolute left-2 top-2 max-w-[calc(100%-16rem)] truncate font-mono text-xs px-2.5 py-1.5 rounded-md border text-white pointer-events-none", bad[0].status === "crit" ? "bg-red-950/80 border-red-500 pt-blink" : "bg-amber-950/70 border-amber-500")}>
              {bad[0].status === "crit" ? t("ALARM") : t("WARNING")}  {TAGS[bad[0].k].tag} {t(TAGS[bad[0].k].n)} {fmt(bad[0].k, bad[0].v)}{bad[0].src === "demo" ? ` (${t("demo")})` : ""}{bad.length > 1 ? `  (+${bad.length - 1})` : ""}
            </div>
          )}
        </div>
        <div className="w-80 shrink-0 border-l border-border overflow-y-auto p-3 space-y-5">
          {demo && (
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Demo scenario")}</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {SCENARIOS.map(([s, l]) => <Button key={s} size="sm" variant={scenario === s ? "default" : "outline"} className="h-8 text-xs justify-start" onClick={() => setScenario(s)}>{t(l)}</Button>)}
              </div>
              {demoValve && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-xs"><Label className="text-xs">{t("FCV-101 opening (demo)")}</Label><span className="font-mono">{valve} %</span></div>
                  <Slider min={10} max={100} step={1} value={[valve]} onValueChange={([v]) => setValve(v)} />
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t("Affects demo values only. Linked readings always show plant data.")}</p>
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Link all readings to one asset")}</h3>
            <Select value="" onValueChange={(v) => void linkAll(v)} disabled={readOnly}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Choose an asset…")} /></SelectTrigger>
              <SelectContent>{assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("Readings are matched to the asset's metrics by name. Change any match below.")}</p>
          </div>
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Data source")}</h3>
            <DataSourceCard assetId={mainAsset} readings={keys.map((k) => ({ k, n: TAGS[k].n, metric: bind[k]?.assetId === mainAsset ? bind[k]?.metric || null : null }))} />
          </div>
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Readings")}</h3>
            {keys.map((k) => (
              <ReadingRow key={k} k={k} assets={assets} b={bind[k]} value={get(k)} readOnly={readOnly}
                onAsset={(a) => void linkAsset(k, a)} onMetric={(m) => setBind((b) => ({ ...b, [k]: { assetId: b[k]?.assetId ?? "", metric: m } }))} />
            ))}
          </div>
        </div>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("Save twin")}</DialogTitle><DialogDescription>{t("Saves this twin with its asset links for everyone in the project.")}</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label>{t("Name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></div>
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
