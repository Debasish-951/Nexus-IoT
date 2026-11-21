import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Download, Eye, FilePlus, ImageDown, LayoutTemplate, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Redo2, Save, Trash2, Undo2, Upload, X } from "lucide-react";
import { useListAssets } from "@workspace/api-client-react";
import { useProjectScope } from "@/hooks/useProjectScope";
import { useProject } from "@/contexts/ProjectContext";
import { useCurrentUser } from "@/contexts/UserContext";
import { listPlantTwins, getPlantTwin, createPlantTwin, updatePlantTwin, deletePlantTwin, fetchAssetMetrics, type PlantTwinSummary } from "@/features/plantTwin/api";
import { useTwinLink, type TwinLink } from "@/features/plantTwin/twinLink";
import { saveTone } from "@/features/plantTwin/saveTone";
import { useAlarmLimits } from "@/features/plantTwin/shared/alarmLimits";
import { usePlayback, PlaybackButton } from "@/features/plantTwin/shared/playback";
import { TwinAlarms } from "@/features/plantTwin/shared/TwinAlarms";
import { snapshotSvg } from "@/features/plantTwin/shared/snapshot";
import { ProcessCanvas, type CanvasApi, type KeyAction } from "./canvas";
import { Palette, SelectionPanel, ReadingsPanel, autoMatch, type AlignMode, type Asset, type PanelActions } from "./panels";
import "@/features/plantTwin/plantTwin.css";
import { useProcessRuntime, tagKind, driveKind, fmtVal, type Scenario } from "./live";
import { isMineType, mineSym, mineType, registerMine, symDef, type MineSym } from "./symbols";
import { itemBox, noteBox, snap, symBox, type Box, type Pt } from "./geom";
import { blankScene, idsForAsset, isPortEnd, isSym, isTag, parseScene, sceneBindings, serializeScene, uid, type Binding, type Item, type NoteItem, type PipeItem, type ProcessScene, type Role, type SymItem, type TagItem } from "./scene";
import { TEMPLATES } from "./templates";
import { loadLibrary, saveLibrary, mineFromFile, MineFileError, MAX_SCENE_SYMBOLS } from "./mine";

/**
 * Process twin: a P&ID the user builds from a symbol library, connected by pipes,
 * with every tag bubble, symbol behaviour and pipe flow linkable to an asset
 * metric. Stored on the server as a plant twin with scene.kind "process"
 * (version 2). See scene.ts for the document and the conversion of older twins.
 */

// ── undo / redo ──────────────────────────────────────────────────────────────
function useHistory() {
  const [scene, setScene] = useState<ProcessScene>(() => blankScene());
  const cur = useRef(scene);
  const h = useRef({ past: [] as ProcessScene[], future: [] as ProcessScene[], base: null as ProcessScene | null, key: "", at: 0 });
  const [, bump] = useState(0);
  const [version, setVersion] = useState(0);
  const set = (s: ProcessScene) => { cur.current = s; setScene(s); };
  const change = useCallback((fn: (s: ProcessScene) => ProcessScene, live = false, key = "") => {
    const H = h.current; const prev = cur.current; const next = fn(prev);
    if (next === prev) return;
    if (live) { if (!H.base) H.base = prev; }
    else {
      const now = Date.now();
      const coalesce = !!key && key === H.key && now - H.at < 1200 && !H.base;
      if (!coalesce) { H.past.push(H.base ?? prev); if (H.past.length > 100) H.past.shift(); }
      H.future = []; H.base = null; H.key = key; H.at = now;
    }
    set(next); setVersion((v) => v + 1);
  }, []);
  const commit = useCallback(() => {
    const H = h.current; if (!H.base) return;
    H.past.push(H.base); if (H.past.length > 100) H.past.shift();
    H.base = null; H.future = []; H.key = ""; bump((n) => n + 1);
  }, []);
  const undo = useCallback(() => { const H = h.current; const p = H.past.pop(); if (!p) return; H.future.push(cur.current); H.key = ""; set(p); setVersion((v) => v + 1); }, []);
  const redo = useCallback(() => { const H = h.current; const f = H.future.pop(); if (!f) return; H.past.push(cur.current); H.key = ""; set(f); setVersion((v) => v + 1); }, []);
  const reset = useCallback((s: ProcessScene) => { h.current = { past: [], future: [], base: null, key: "", at: 0 }; set(s); }, []);
  return { scene, cur, change, commit, undo, redo, reset, version, canUndo: h.current.past.length > 0, canRedo: h.current.future.length > 0 };
}

const ROLE_TAG: Record<Role, [string, string]> = { level: ["LT", "level"], speed: ["SI", "speed"], opening: ["ZT", "opening"], temperature: ["TT", "temp"], value: ["", ""] };

function useAssets(): Asset[] {
  const { inScope } = useProjectScope();
  const { data } = useListAssets();
  return useMemo(() => ((data as any[] | undefined) ?? []).filter((a: any) => inScope(a.id, { strict: true })).map((a: any) => ({ id: a.id as string, name: a.name as string })), [data, inScope]);
}

export default function ProcessTwinView({ link }: { link: TwinLink }) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currentProjectId } = useProject();
  const { canModule } = useCurrentUser();
  const canCreate = canModule("live_twin", "write");
  const canDelete = canModule("live_twin", "delete");
  const assets = useAssets();
  const limitsOf = useAlarmLimits();

  // ── which twin ────────────────────────────────────────────────────────────
  const listQ = useQuery({ queryKey: ["plant-twins"], queryFn: listPlantTwins });
  const twins = useMemo(() => (listQ.data ?? []).filter((x) => x.kind === "process" && (!x.projectId || !currentProjectId || x.projectId === currentProjectId)), [listQ.data, currentProjectId]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const current: PlantTwinSummary | null = twins.find((x) => x.id === currentId) ?? null;
  const isDraft = !currentId;
  const readOnly = isDraft ? !canCreate : !current?.canEdit;
  const hist = useHistory();
  const { scene, change } = hist;
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [palette, setPalette] = useState(true);
  const apiRef = useRef<CanvasApi | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);

  useTwinLink(link, currentId, (id) => { setDraft(!id); setCurrentId(id); });
  useEffect(() => {
    if (!listQ.isSuccess || draft) return;
    if (currentId && twins.some((x) => x.id === currentId)) return;
    if (twins[0]) setCurrentId(twins[0].id); else setDraft(true);
  }, [listQ.isSuccess, twins, currentId, draft]);

  // ── load ──────────────────────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [saveErr, setSaveErr] = useState("");
  const loadedVersion = useRef(0);
  const versionRef = useRef(0); versionRef.current = hist.version;
  const pending = useRef<{ id: string; body: ProcessScene } | null>(null);
  useEffect(() => {
    setSel(new Set());
    if (!currentId) {
      hist.reset(blankScene()); loadedVersion.current = versionRef.current; setSaveState("saved"); setEdit(canCreate); setCanvasKey((k) => k + 1);
      return;
    }
    let cancelled = false;
    getPlantTwin(currentId).then((row) => {
      if (cancelled) return;
      const { scene: s, converted } = parseScene(row.scene);
      hist.reset(s); setCanvasKey((k) => k + 1);
      setEdit(row.canEdit && canCreate);
      loadedVersion.current = versionRef.current;
      if (converted && row.canEdit) { setSaveState("dirty"); pending.current = { id: row.id, body: s }; }
      else setSaveState("saved");
    }).catch((err) => toast({ title: t("Could not open this twin"), description: err?.message ?? String(err), variant: "destructive" }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // Mark unsaved after any edit of an opened twin (the first version after a load is the load itself).
  useEffect(() => {
    if (hist.version === loadedVersion.current) return;
    if (current?.canEdit) { setSaveState("dirty"); pending.current = { id: current.id, body: hist.cur.current }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hist.version]);
  useEffect(() => () => {
    const p = pending.current; if (!p) return; pending.current = null;
    updatePlantTwin(p.id, { scene: serializeScene(p.body) as any }).catch(() => { /* best effort on leave */ });
  }, [currentId]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // Drop selected ids that no longer exist (after undo, delete or import).
  useEffect(() => {
    setSel((prev) => {
      if (!prev.size) return prev;
      const ids = new Set([...scene.items.map((i) => i.id), ...scene.pipes.map((p) => p.id), ...(scene.notes ?? []).map((n) => n.id)]);
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [scene]);

  // ── live ──────────────────────────────────────────────────────────────────
  const pairs = useMemo(() => sceneBindings(scene), [scene]);
  const playback = usePlayback(pairs);
  const rt = useProcessRuntime(scene, { demo: scene.demo, scenario, playback });

  // ── editing actions ───────────────────────────────────────────────────────
  const clip = useRef<{ items: Item[]; pipes: PipeItem[]; notes: NoteItem[] } | null>(null);
  // ── My symbols (uploads) ──────────────────────────────────────────────────
  const [lib, setLib] = useState<MineSym[]>(() => loadLibrary());
  const mineList = useMemo(() => [...lib.map((m) => ({ ...m, saved: true })), ...(scene.custom ?? []).filter((m) => !lib.some((x) => x.id === m.id))], [lib, scene.custom]);
  /** Uploaded symbols the given types need, added to the scene's own copy; null when the diagram would get too large. */
  const mineFor = (s: ProcessScene, types: string[]): MineSym[] | null => {
    const have = s.custom ?? [];
    const need = [...new Set(types.filter(isMineType))]
      .filter((ty) => !have.some((m) => mineType(m.id) === ty))
      .map((ty) => { if (!mineSym(ty)) { const m = lib.find((x) => mineType(x.id) === ty); if (m) registerMine([m]); } return mineSym(ty); })
      .filter((m): m is MineSym => !!m);
    if (!need.length) return have;
    const all = [...have, ...need];
    if (all.reduce((n, m) => n + m.src.length, 0) > MAX_SCENE_SYMBOLS) {
      toast({ title: t("This diagram has too many uploaded symbols"), description: t("Uploaded symbols in one diagram are limited to about 600 KB. Use smaller files or fewer symbols."), variant: "destructive" });
      return null;
    }
    return all;
  };
  const upRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ src: string; w: number; h: number; name: string } | null>(null);
  const pickUpload = async (f: File) => {
    try { const r = await mineFromFile(f); setUpload({ ...r, name: f.name.replace(/\.[^.]+$/, "").slice(0, 60) || t("My symbol") }); }
    catch (e) {
      const code = e instanceof MineFileError ? e.code : "bad";
      const msg = { type: t("Use an SVG, PNG, JPEG, WebP or GIF file."), svgSize: t("SVG files up to 200 KB are accepted."), imageSize: t("Images up to 3 MB are accepted."), bad: t("The file could not be read as a drawing or image.") }[code];
      toast({ title: t("Could not use this file"), description: msg, variant: "destructive" });
    }
  };
  const forgetMine = (id: string) => setLib((l) => { const n = l.filter((x) => x.id !== id); saveLibrary(n); return n; });
  const nextTag = (s: ProcessScene, prefix: string) => {
    const used = new Set(s.items.map((i) => i.tag));
    for (let n = 101; n < 10_000; n++) { const tag = `${prefix}-${n}`; if (!used.has(tag)) return tag; }
    return `${prefix}-${Date.now() % 10_000}`;
  };
  const addNote = (kind: string, c: Pt) => {
    const id = uid("n"); const x = snap(c[0]), y = snap(c[1]);
    const n: NoteItem = kind === "zone" ? { id, kind: "zone", x: x - 150, y: y - 100, w: 300, h: 200, text: t("Area") }
      : kind === "line" || kind === "arrow" ? { id, kind: "line", x: x - 80, y, x2: x + 80, y2: y, ...(kind === "arrow" ? { arrow: true } : {}) }
      : { id, kind: "text", x: x - 40, y: y - 10, text: t("Text") };
    change((s) => ({ ...s, notes: [...(s.notes ?? []), n] }));
    setSel(new Set([id]));
  };
  const addSymbol = (type: string, at?: Pt) => {
    if (readOnly) return;
    const c = at ?? apiRef.current?.center() ?? [400, 300];
    if (type.startsWith("note:")) { addNote(type.slice(5), c); return; }
    const custom = mineFor(hist.cur.current, [type]); if (!custom) return;
    if (isMineType(type) && !mineSym(type)) return;
    const def = symDef(type);
    const id = uid("s");
    change((s) => ({ ...s, ...(custom.length ? { custom } : {}), items: [...s.items, { kind: "sym", id, type, x: snap(c[0] - def.w / 2), y: snap(c[1] - def.h / 2), rot: 0, scale: 1, tag: nextTag(s, def.prefix), label: "", drives: {} } as SymItem] }));
    setSel(new Set([id]));
  };
  const confirmUpload = () => {
    if (!upload) return;
    const m: MineSym = { id: Math.random().toString(36).slice(2, 10), name: upload.name.trim() || t("My symbol"), w: upload.w, h: upload.h, src: upload.src };
    registerMine([m]);
    const next = [...lib, m]; setLib(next);
    const kept = saveLibrary(next);
    setUpload(null);
    addSymbol(mineType(m.id));
    if (!kept) toast({ title: t("Added to this diagram only"), description: t("This browser has no room left to keep it in My symbols.") });
  };
  const addTag = (sym: SymItem, role?: Role) => {
    const b = symBox(sym); const id = uid("b");
    const no = sym.tag.match(/\d+[A-Z]?$/)?.[0] ?? "101";
    const [letters, kind] = role && role !== "value" ? ROLE_TAG[role] : ["", ""];
    const drive = role ? sym.drives?.[role] : undefined;
    const tg: TagItem = {
      kind: "tag", id, x: snap(b.x + b.w + 20), y: snap(b.y), tag: letters ? `${letters}-${no}` : sym.tag, label: role === "value" || !role ? sym.label : t(kind), attach: sym.id,
      bind: drive?.bind ? { ...drive.bind } : undefined, limits: drive?.limits ? { ...drive.limits } : undefined,
      demoKind: role ? driveKind(sym, role) : undefined, unit: drive?.unit, decimals: drive?.decimals,
    };
    change((s) => ({ ...s, items: [...s.items, tg] }));
    setSel(new Set([id]));
  };
  const removeSel = useCallback(() => {
    if (!sel.size) return;
    change((s) => {
      // Locked items are kept.
      const locked = new Set([...s.items.filter((i) => i.locked).map((i) => i.id), ...(s.notes ?? []).filter((n) => n.locked).map((n) => n.id)]);
      const gone = new Set([...sel].filter((id) => !locked.has(id)));
      for (const it of s.items) if (isTag(it) && !it.locked && it.attach && gone.has(it.attach) && s.items.some((x) => x.id === it.attach && isSym(x))) gone.add(it.id);
      return {
        ...s,
        items: s.items.filter((i) => !gone.has(i.id)).map((i) => (isTag(i) && i.attach && gone.has(i.attach) ? { ...i, attach: null } : i)),
        pipes: s.pipes.filter((p) => !gone.has(p.id) && !(isPortEnd(p.a) && gone.has(p.a.sym)) && !(isPortEnd(p.b) && gone.has(p.b.sym))),
        ...(s.notes ? { notes: s.notes.filter((n) => !gone.has(n.id)) } : {}),
      };
    });
    setSel(new Set());
  }, [sel, change]);
  const rotate = (dir: 1 | -1) => change((s) => ({ ...s, items: s.items.map((i) => (sel.has(i.id) && isSym(i) && !i.locked ? { ...i, rot: (((i.rot + dir * 90) % 360) + 360) % 360 } : i)) }));
  const flip = (axis: "x" | "y") => change((s) => ({ ...s, items: s.items.map((i) => (sel.has(i.id) && isSym(i) && !i.locked ? (axis === "x" ? { ...i, flipX: !i.flipX || undefined } : { ...i, flipY: !i.flipY || undefined }) : i)) }));
  const lock = (v: boolean) => change((s) => ({
    ...s,
    items: s.items.map((i) => (sel.has(i.id) ? { ...i, locked: v || undefined } : i)),
    ...(s.notes ? { notes: s.notes.map((n) => (sel.has(n.id) ? { ...n, locked: v || undefined } : n)) } : {}),
  }));
  const align = (mode: AlignMode) => change((s) => {
    const list: { id: string; b: Box }[] = [
      ...s.items.filter((i) => sel.has(i.id) && !i.locked).map((i) => ({ id: i.id, b: itemBox(i) })),
      ...(s.notes ?? []).filter((n) => sel.has(n.id) && !n.locked).map((n) => ({ id: n.id, b: noteBox(n) })),
    ];
    if (list.length < 2) return s;
    const x0 = Math.min(...list.map((o) => o.b.x)), x1 = Math.max(...list.map((o) => o.b.x + o.b.w));
    const y0 = Math.min(...list.map((o) => o.b.y)), y1 = Math.max(...list.map((o) => o.b.y + o.b.h));
    const d = new Map<string, Pt>();
    if (mode === "hdist" || mode === "vdist") {
      const h = mode === "hdist";
      const sorted = [...list].sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y));
      const total = sorted.reduce((n, o) => n + (h ? o.b.w : o.b.h), 0);
      const gap = ((h ? x1 - x0 : y1 - y0) - total) / (sorted.length - 1);
      let at = h ? x0 : y0;
      for (const o of sorted) { d.set(o.id, h ? [at - o.b.x, 0] : [0, at - o.b.y]); at += (h ? o.b.w : o.b.h) + gap; }
    } else {
      for (const o of list) {
        const dx = mode === "left" ? x0 - o.b.x : mode === "right" ? x1 - (o.b.x + o.b.w) : mode === "hcenter" ? (x0 + x1) / 2 - (o.b.x + o.b.w / 2) : 0;
        const dy = mode === "top" ? y0 - o.b.y : mode === "bottom" ? y1 - (o.b.y + o.b.h) : mode === "vcenter" ? (y0 + y1) / 2 - (o.b.y + o.b.h / 2) : 0;
        d.set(o.id, [dx, dy]);
      }
    }
    // Tag bubbles follow their symbol.
    for (const it of s.items) if (isTag(it) && it.attach && d.has(it.attach) && !d.has(it.id) && !sel.has(it.id) && !it.locked) d.set(it.id, d.get(it.attach)!);
    const mv = (id: string): Pt => d.get(id) ?? [0, 0];
    return {
      ...s,
      items: s.items.map((i) => { const [dx, dy] = mv(i.id); return dx || dy ? { ...i, x: Math.round(i.x + dx), y: Math.round(i.y + dy) } : i; }),
      ...(s.notes ? { notes: s.notes.map((n) => { const [dx, dy] = mv(n.id); return dx || dy ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy), ...(n.x2 != null ? { x2: Math.round(n.x2 + dx) } : {}), ...(n.y2 != null ? { y2: Math.round(n.y2 + dy) } : {}) } : n; }) } : {}),
    };
  });
  const copy = () => {
    const items = scene.items.filter((i) => sel.has(i.id));
    const ids = new Set(items.map((i) => i.id));
    const pipes = scene.pipes.filter((p) => (sel.has(p.id) || (isPortEnd(p.a) && ids.has(p.a.sym)) || (isPortEnd(p.b) && ids.has(p.b.sym))) && (!isPortEnd(p.a) || ids.has(p.a.sym)) && (!isPortEnd(p.b) || ids.has(p.b.sym)));
    const notes = (scene.notes ?? []).filter((n) => sel.has(n.id));
    clip.current = items.length || pipes.length || notes.length ? JSON.parse(JSON.stringify({ items, pipes, notes })) : null;
  };
  const paste = () => {
    const c = clip.current; if (!c || readOnly) return;
    const map = new Map<string, string>();
    c.items.forEach((i) => map.set(i.id, uid(isSym(i) ? "s" : "b")));
    c.pipes.forEach((p) => map.set(p.id, uid("pipe")));
    c.notes.forEach((n) => map.set(n.id, uid("n")));
    const off = 40;
    const custom = mineFor(hist.cur.current, c.items.filter(isSym).map((i) => i.type)); if (!custom) return;
    change((s) => {
      const used = new Set(s.items.map((i) => i.tag));
      const items: Item[] = c.items.map((i) => {
        let tag = i.tag;
        if (isSym(i) && used.has(tag)) { tag = nextTag({ ...s, items: [...s.items, ...[...used].map((u) => ({ tag: u }) as any)] }, symDef(i.type).prefix); }
        used.add(tag);
        return { ...i, id: map.get(i.id)!, x: i.x + off, y: i.y + off, tag, ...(isTag(i) && i.attach ? { attach: map.get(i.attach) ?? i.attach } : {}) } as Item;
      });
      const pipes = c.pipes.map((p) => ({
        ...p, id: map.get(p.id)!,
        a: isPortEnd(p.a) ? { ...p.a, sym: map.get(p.a.sym)! } : { x: p.a.x + off, y: p.a.y + off },
        b: isPortEnd(p.b) ? { ...p.b, sym: map.get(p.b.sym)! } : { x: p.b.x + off, y: p.b.y + off },
        mid: p.mid.map(([x, y]) => [x + off, y + off] as Pt),
      }));
      const notes = c.notes.map((n) => ({ ...n, id: map.get(n.id)!, x: n.x + off, y: n.y + off, ...(n.x2 != null ? { x2: n.x2 + off } : {}), ...(n.y2 != null ? { y2: n.y2 + off } : {}) }));
      return { ...s, items: [...s.items, ...items], pipes: [...s.pipes, ...pipes], ...(notes.length || s.notes ? { notes: [...(s.notes ?? []), ...notes] } : {}), ...(custom.length ? { custom } : {}) };
    });
    setSel(new Set([...map.values()]));
    clip.current = { notes: c.notes.map((n) => ({ ...n, x: n.x + off, y: n.y + off, ...(n.x2 != null ? { x2: n.x2 + off } : {}), ...(n.y2 != null ? { y2: n.y2 + off } : {}) })), items: c.items.map((i) => ({ ...i, x: i.x + off, y: i.y + off })), pipes: c.pipes.map((p) => ({ ...p, a: isPortEnd(p.a) ? p.a : { x: p.a.x + off, y: p.a.y + off }, b: isPortEnd(p.b) ? p.b : { x: p.b.x + off, y: p.b.y + off }, mid: p.mid.map(([x, y]) => [x + off, y + off] as Pt) })) };
  };
  const onKey = (a: KeyAction) => {
    if (a === "escape") { setSel(new Set()); return; }
    if (readOnly || !edit) return;
    if (a === "delete") removeSel();
    if (a === "rotate") rotate(1);
    if (a === "undo") hist.undo();
    if (a === "redo") hist.redo();
    if (a === "copy") copy();
    if (a === "paste") paste();
    if (a === "duplicate") { copy(); paste(); }
    if (a === "selectAll") setSel(new Set([...scene.items.map((i) => i.id), ...scene.pipes.map((p) => p.id), ...(scene.notes ?? []).map((n) => n.id)]));
  };
  const act: PanelActions = {
    update: (id, fn, key) => change((s) => ({
      ...s,
      items: s.items.map((i) => (i.id === id ? fn(i) : i)),
      pipes: s.pipes.map((p) => (p.id === id ? fn(p) : p)),
      ...(s.notes ? { notes: s.notes.map((n) => (n.id === id ? fn(n) : n)) } : {}),
    }), false, key ? `${id}:${key}` : ""),
    remove: removeSel, rotate, duplicate: () => { copy(); paste(); }, addTag, flip, align, lock,
  };

  async function linkAll(assetId: string) {
    const ms = await fetchAssetMetrics(assetId); const used = new Set<string>();
    const pick = (hints: string[], kind: string, shared = false) => { const m = autoMatch(hints, kind, ms, shared ? new Set() : used); if (m && !shared) used.add(m); return { assetId, metric: m }; };
    change((s) => ({
      ...s,
      items: s.items.map((i) => {
        if (isTag(i)) return { ...i, bind: pick([i.tag, i.label], tagKind(i)) };
        const def = symDef(i.type); const drives = { ...(i.drives ?? {}) };
        for (const role of def.roles) if (drives[role] || role === def.roles[0]) drives[role] = { ...(drives[role] ?? {}), bind: pick([i.tag, i.label, role], driveKind(i, role), true) };
        return { ...i, drives };
      }),
      pipes: s.pipes.map((p) => (p.flow && p.line !== "signal" && p.line !== "electrical" ? { ...p, flow: { ...p.flow, bind: pick([p.label ?? "", "flow"], "flow", true) } } : p)),
    }));
    toast({ title: t("Linked to the asset"), description: t("Check the matches in the Readings list and on each symbol.") });
  }

  const focusAsset = (assetId: string) => {
    const ids = idsForAsset(scene, assetId);
    setSel(new Set(ids)); setFlash(new Set(ids));
    window.setTimeout(() => setFlash(new Set()), 3200);
  };

  // ── save / rename / delete / export ───────────────────────────────────────
  const sceneOut = (): ProcessScene => {
    const s = hist.cur.current; const used = new Set(s.items.filter(isSym).map((i) => i.type));
    // Only uploaded symbols still in use are saved with the diagram.
    return serializeScene({ ...s, ...(s.custom ? { custom: s.custom.filter((m) => used.has(mineType(m.id))) } : {}), view: apiRef.current?.getView() });
  };
  const [saveOpen, setSaveOpen] = useState(false), [name, setName] = useState(""), [busy, setBusy] = useState(false);
  async function saveAs() {
    setBusy(true);
    try {
      const id = `pt-${crypto.randomUUID()}`;
      const row = await createPlantTwin({ id, name: name.trim(), projectId: currentProjectId ?? null, scene: { ...(sceneOut() as any), ...(link?.folderId ? { parent: link.folderId } : {}) } });
      qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => [row, ...(old ?? [])]);
      pending.current = null; setSaveOpen(false); setDraft(false); setCurrentId(id);
    } catch (err: any) { toast({ title: t("Could not save the process twin"), description: err?.message ?? String(err), variant: "destructive" }); }
    setBusy(false);
  }
  const saveNow = () => {
    if (!current) return;
    pending.current = null; setSaveState("saving");
    const body = sceneOut();
    updatePlantTwin(current.id, { scene: body as any }).then((row) => {
      setSaveState("saved"); setSaveErr("");
      qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => (old ?? []).map((x) => (x.id === row.id ? { ...x, machines: row.machines, updatedAt: row.updatedAt } : x)));
    }).catch((err) => { setSaveState("error"); setSaveErr(err?.message ?? String(err)); pending.current = { id: current.id, body }; });
  };
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
    try { pending.current = null; await deletePlantTwin(current.id); qc.setQueryData<PlantTwinSummary[]>(["plant-twins"], (old) => (old ?? []).filter((x) => x.id !== current.id)); setCurrentId(null); }
    catch (err: any) { toast({ title: t("Could not delete"), description: err?.message ?? String(err), variant: "destructive" }); }
    setConfirmDel(false);
  }
  const fileRef = useRef<HTMLInputElement>(null);
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(sceneOut(), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${(current?.name ?? "process-twin").replace(/[^\w.-]+/g, "_")}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async (f: File) => {
    try {
      if (f.size > 2_000_000) throw new Error(t("The file is larger than 2 MB."));
      const raw = JSON.parse(await f.text());
      if (!raw || raw.kind !== "process") throw new Error(t("This is not a process twin file."));
      const { scene: s } = parseScene(raw);
      change(() => ({ ...s, view: undefined }));
      setSel(new Set()); setTimeout(() => apiRef.current?.fit(), 50);
      toast({ title: t("Diagram imported"), description: t("Save to keep it.") });
    } catch (err: any) { toast({ title: t("Could not import the file"), description: err?.message ?? String(err), variant: "destructive" }); }
  };
  const snapshot = () => { if (svgRef.current) void snapshotSvg(svgRef.current, current?.name ?? "process-twin", { bg: "#0b1220" }); };
  const loadTemplate = (key: string) => { const tp = TEMPLATES.find((x) => x.key === key) ?? TEMPLATES[0]; change(() => tp.build()); setSel(new Set()); setTimeout(() => apiRef.current?.fit(), 50); };

  // ── toolbar ───────────────────────────────────────────────────────────────
  const openSave = () => { setName(current ? t("{name} (copy)", { name: current.name }) : t("Process unit {n}", { n: twins.length + 1 })); setSaveOpen(true); };
  const saveText = { saved: t("Saved"), dirty: t("Unsaved changes…"), saving: t("Saving…"), error: t("Not saved: {err}", { err: saveErr }) }[saveState];
  const editing = edit && !readOnly;
  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap">
      {(current || listQ.isLoading) && <span className="text-sm font-semibold truncate max-w-[14rem]">{listQ.isLoading ? t("Loading…") : current?.name}</span>}
      {isDraft && <span className="text-sm text-muted-foreground">{t("New diagram (not saved)")}</span>}
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
      {!readOnly && (
        <div className="inline-flex rounded-md border border-border overflow-hidden" role="group" aria-label={t("Mode")}>
          <button className={cn("px-2.5 h-8 text-xs inline-flex items-center gap-1", editing ? "bg-primary text-primary-foreground" : "hover:bg-muted")} onClick={() => setEdit(true)}><Pencil className="w-3.5 h-3.5" />{t("Edit")}</button>
          <button className={cn("px-2.5 h-8 text-xs inline-flex items-center gap-1", !editing ? "bg-primary text-primary-foreground" : "hover:bg-muted")} onClick={() => { setEdit(false); }}><Eye className="w-3.5 h-3.5" />{t("View")}</button>
        </div>
      )}
      {editing && (
        <>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={hist.undo} disabled={!hist.canUndo} aria-label={t("Undo")} title={t("Undo (Ctrl+Z)")}><Undo2 className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={hist.redo} disabled={!hist.canRedo} aria-label={t("Redo")} title={t("Redo (Ctrl+Y)")}><Redo2 className="w-4 h-4" /></Button>
        </>
      )}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1"><Switch checked={scene.demo} disabled={readOnly} onCheckedChange={(v) => change((s) => ({ ...s, demo: v }))} className="scale-90" /> {t("Demo values")}</label>
      <PlaybackButton playback={playback} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon" variant="outline" className="h-8 w-8" aria-label={t("More")}><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={snapshot}><ImageDown className="w-4 h-4 mr-2" />{t("Download PNG snapshot")}</DropdownMenuItem>
          <DropdownMenuItem onClick={exportJson}><Download className="w-4 h-4 mr-2" />{t("Export diagram (JSON)")}</DropdownMenuItem>
          {!readOnly && <DropdownMenuItem onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 mr-2" />{t("Import diagram (JSON)")}</DropdownMenuItem>}
          {!readOnly && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><LayoutTemplate className="w-4 h-4 mr-2" />{t("Replace with a template")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>{TEMPLATES.map((tp) => <DropdownMenuItem key={tp.key} onClick={() => loadTemplate(tp.key)} title={t(tp.about)}>{t(tp.name)}</DropdownMenuItem>)}</DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {canCreate && !isDraft && <><DropdownMenuSeparator /><DropdownMenuItem onClick={openSave}><Copy className="w-4 h-4 mr-2" />{t("Save as a new twin…")}</DropdownMenuItem></>}
        </DropdownMenuContent>
      </DropdownMenu>
      {current && (saveState === "error" || !current.canEdit) && <span className={cn("text-xs", saveState === "error" ? "text-red-500" : "text-muted-foreground")}>{current.canEdit ? saveText : t("View only: owned by someone else")}</span>}
      <span className={cn("ml-auto inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", rt.ws === "connected" ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300")}>{rt.ws === "connected" ? t("Live") : t("Reconnecting")}</span>
      {canCreate && (isDraft || current?.canEdit) && (
        <Button size="sm" onClick={() => { if (isDraft) openSave(); else saveNow(); }} disabled={saveState === "saving"} className={cn("h-8", saveTone(isDraft ? "new" : saveState))}
          title={isDraft ? t("Not saved yet: save this twin") : saveState === "saved" ? t("All changes saved") : saveState === "error" ? t("Not saved: {err}", { err: saveErr }) : saveState === "saving" ? t("Saving…") : t("Unsaved changes: press Save")}><Save className="w-4 h-4 mr-1" /> {t("Save")}</Button>
      )}
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importJson(f); }} />
      <input ref={upRef} type="file" accept="image/svg+xml,.svg,image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pickUpload(f); }} />
      <Dialog open={!!upload} onOpenChange={(o) => { if (!o) setUpload(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Add to My symbols")}</DialogTitle>
            <DialogDescription>{t("The symbol is saved with each diagram that uses it and kept in this browser for other diagrams. It gets four connection points; link a reading to show its value.")}</DialogDescription>
          </DialogHeader>
          {upload && <div className="flex justify-center rounded-md bg-[#0b1220] p-3"><img src={upload.src} alt="" className="max-h-32 max-w-full object-contain" /></div>}
          <div className="space-y-1"><Label>{t("Name")}</Label><Input value={upload?.name ?? ""} onChange={(e) => setUpload((u) => (u ? { ...u, name: e.target.value.slice(0, 60) } : u))} onKeyDown={(e) => { if (e.key === "Enter") confirmUpload(); }} autoFocus /></div>
          <DialogFooter><Button variant="outline" onClick={() => setUpload(null)}>{t("Cancel")}</Button><Button onClick={confirmUpload}>{t("Add")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // ── banners ───────────────────────────────────────────────────────────────
  const tags = scene.items.filter(isTag);
  const unlinked = tags.filter((x) => !(x.bind?.assetId && x.bind.metric)).length;
  const bad = tags.map((x) => ({ x, r: rt.tagReading(x) })).filter(({ r }) => r.status === "warn" || r.status === "crit").sort((a, b) => (a.r.status === "crit" ? -1 : 1) - (b.r.status === "crit" ? -1 : 1));
  const assetIds = useMemo(() => Array.from(new Set(pairs.map((p) => p.assetId))), [pairs]);
  const assetName = (id: string) => assets.find((a) => a.id === id)?.name;
  const empty = scene.items.length === 0 && scene.pipes.length === 0 && !scene.notes?.length;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {link?.toolbar ? createPortal(toolbar, link.toolbar) : <div className="p-3 border-b border-border shrink-0">{toolbar}</div>}
      {(isDraft || unlinked > 0) && !empty && (
        <div className={cn("px-3 py-1.5 text-xs border-b border-border shrink-0", scene.demo && unlinked ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "text-muted-foreground")}>
          {isDraft && <>{canCreate ? t("Link readings to assets on the right, then Save.") : t("Link readings to assets on the right.")} </>}
          {unlinked > 0 && (scene.demo ? t("{n} reading(s) show simulated demo values, marked \"demo\". They are not plant data.", { n: unlinked }) : t("{n} reading(s) not linked.", { n: unlinked }))}
        </div>
      )}
      {playback.bar && <div className="px-3 pt-2 shrink-0">{playback.bar}</div>}
      <div className="flex-1 min-h-0 flex">
        {editing && palette && (
          <div className="w-56 shrink-0 border-r border-border overflow-y-auto p-2.5">
            <Palette onAdd={(type) => addSymbol(type)} mine={mineList} onUpload={() => upRef.current?.click()} onForget={forgetMine} />
          </div>
        )}
        <div className="relative flex-1 min-w-0 m-3">
          <ProcessCanvas key={canvasKey} scene={scene} edit={editing} rt={rt} sel={sel} setSel={setSel} flash={flash}
            onChange={(fn, live) => change(fn, live)} onCommit={hist.commit} onDropSymbol={(type, at) => addSymbol(type, at)} onKeyAction={onKey} apiRef={apiRef} svgRef={svgRef} />
          {editing && (
            <button className="absolute left-2 top-2 w-7 h-7 rounded border border-slate-600 bg-slate-900/80 text-slate-100 hover:bg-slate-800 flex items-center justify-center" onClick={() => setPalette((p) => !p)} aria-label={palette ? t("Hide symbols") : t("Show symbols")} title={palette ? t("Hide symbols") : t("Show symbols")}>
              {palette ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
            </button>
          )}
          {bad.length > 0 && (
            <div className={cn("absolute top-2 max-w-[calc(100%-6rem)] truncate font-mono text-xs px-2.5 py-1.5 rounded-md border text-white pointer-events-none", editing ? "left-11" : "left-2", bad[0].r.status === "crit" ? "bg-red-950/80 border-red-500 pt-blink" : "bg-amber-950/70 border-amber-500")}>
              {bad[0].r.status === "crit" ? t("ALARM") : t("WARNING")}  {bad[0].x.tag} {bad[0].x.label} {fmtVal(bad[0].r.v, bad[0].x.unit || undefined, bad[0].x.decimals, tagKind(bad[0].x))}{bad[0].r.src === "demo" ? ` (${t("demo")})` : ""}{bad.length > 1 ? `  (+${bad.length - 1})` : ""}
            </div>
          )}
          {empty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="pointer-events-auto rounded-lg border border-slate-700 bg-slate-900/90 p-5 max-w-lg max-h-full overflow-y-auto text-center space-y-3 text-slate-100">
                <LayoutTemplate className="w-8 h-8 mx-auto text-sky-400" />
                <p className="text-sm">{editing ? t("Drag symbols from the palette onto the canvas and connect their ports with pipes, or start from an industry template.") : readOnly ? t("This diagram is empty.") : t("This diagram is empty. Switch to Edit to build it.")}</p>
                {editing && (
                  <div className="grid grid-cols-2 gap-1.5 text-left">
                    {TEMPLATES.map((tp) => (
                      <button key={tp.key} className="rounded-md border border-slate-700 hover:border-sky-500 hover:bg-slate-800 px-2.5 py-1.5" onClick={() => loadTemplate(tp.key)}>
                        <span className="block text-xs font-semibold">{t(tp.name)}</span>
                        <span className="block text-[11px] text-slate-400 leading-snug">{t(tp.about)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="w-80 shrink-0 border-l border-border overflow-y-auto p-3 space-y-5">
          {sel.size > 0
            ? <SelectionPanel scene={scene} sel={sel} assets={assets} rt={rt} limitsOf={limitsOf} readOnly={readOnly} act={act} />
            : <ReadingsPanel scene={scene} assets={assets} rt={rt} readOnly={readOnly} demo={scene.demo} scenario={scenario} setScenario={setScenario}
                onLinkAll={(a) => void linkAll(a)} onSelect={(id) => setSel(new Set([id]))}
                onBindTag={(id, b: Binding | undefined) => act.update(id, (x) => ({ ...x, bind: b }), "bind")} />}
          <TwinAlarms assetIds={assetIds} onFocus={focusAsset} label={assetName} />
        </div>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("Save twin")}</DialogTitle><DialogDescription>{t("Saves this twin with its asset links for everyone in the project.")}</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label>{t("Name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void saveAs(); }} /></div>
          {link?.folderName && <p className="text-xs text-muted-foreground">{t("Saved in folder \"{f}\".", { f: link.folderName })}</p>}
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
 * View-only process twin for a dashboard widget: the saved diagram, fitted to
 * the widget, with live values (or demo values when the twin uses them).
 */
export function ProcessTwinEmbed({ twinId }: { twinId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["plant-twin", twinId], queryFn: () => getPlantTwin(twinId), enabled: !!twinId, staleTime: 60_000 });
  const scene = useMemo(() => (q.data ? parseScene(q.data.scene).scene : blankScene()), [q.data]);
  const rt = useProcessRuntime(scene, { demo: scene.demo, scenario: "normal" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  if (q.isError) return <div className="h-full flex items-center justify-center text-xs text-muted-foreground p-3 text-center">{t("This process twin could not be opened. It may have been deleted, or you may not have access.")}</div>;
  if (!q.data) return <div className="h-full flex items-center justify-center text-xs text-muted-foreground">{t("Loading…")}</div>;
  const demoCount = scene.items.filter(isTag).filter((x) => !(x.bind?.assetId && x.bind.metric)).length;
  return (
    <div className="relative w-full h-full min-h-[120px]">
      <ProcessCanvas scene={scene} edit={false} rt={rt} sel={sel} setSel={setSel} compact />
      {scene.demo && demoCount > 0 && <span className="absolute right-1.5 top-1.5 text-[10px] rounded px-1.5 py-0.5 bg-amber-500/20 text-amber-300 pointer-events-none">{t("{n} demo value(s)", { n: demoCount })}</span>}
    </div>
  );
}
