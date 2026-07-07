import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Save, Copy, Eye, EyeOff, Maximize2, Minimize2, Download, Undo2, Redo2, LayoutDashboard,
  Upload, Share2, ShieldCheck, LayoutTemplate, Trash2,
} from "lucide-react";
import { useListAssets } from "@workspace/api-client-react";
import { useDashboards } from "@/features/dashboards/useDashboards";
import { DashboardCanvas } from "@/features/dashboards/DashboardCanvas";
import { WidgetPanel } from "@/features/dashboards/WidgetPanel";
import { AssetVizPanel } from "@/features/dashboards/AssetVizPanel";
import type { Widget } from "@/features/dashboards/types";
import { resolveTags } from "@/features/dashboards/assetBinding";
import { AssetTreeProvider } from "@/components/asset-tree/AssetTreeContext";
import { AssetTree } from "@/components/asset-tree/AssetTree";
import type { Asset } from "@/pages/assetShared";

export default function Visualization() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const api = useDashboards();

  // ── Mode: "By Asset" explorer vs Dashboard Builder ──
  const [mode, setMode] = useState<"explore" | "build">("explore");
  const { data: assetsData } = useListAssets();
  const allAssets = (assetsData as Asset[] | undefined) ?? [];
  const [assetSelId, setAssetSelId] = useState<string | null>(null);
  const [assetCollapsed, setAssetCollapsed] = useState<Set<string>>(new Set());
  const assetChildren = useMemo(() => {
    const m: Record<string, Asset[]> = {};
    for (const a of allAssets) { const k = a.parentId ?? "root"; (m[k] ||= []).push(a); }
    for (const k in m) m[k].sort((x, y) => x.name.localeCompare(y.name));
    return m;
  }, [allAssets]);
  const assetTreeCtx = {
    childrenByParent: assetChildren,
    selectedId: assetSelId,
    setSelectedId: setAssetSelId,
    isExpanded: (id: string) => !assetCollapsed.has(id),
    toggle: (id: string) => setAssetCollapsed((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    visibleIds: null,
    canManage: false,
    onAddChild: () => {}, onRename: () => {}, onDelete: () => {}, onAssignTemplate: () => {},
    onOpenBuilder: (a: Asset) => { setAssetSelId(a.id); openBuilderFor(a); },
  };
  const selectedAsset = assetSelId ? allAssets.find((a) => a.id === assetSelId) ?? null : null;

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [widgets, setWidgetsState] = useState<Widget[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [dirty, setDirty] = useState(false);

  const past = useRef<Widget[][]>([]);
  const future = useRef<Widget[][]>([]);
  const clipboard = useRef<Widget | null>(null);
  const skipAutosave = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const [accessOpen, setAccessOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const ALL_ROLES = ["admin", "engineer", "operator", "viewer"];

  // setWidgets wrapper: snapshot history only on add/remove (length change).
  const setWidgets = useCallback((updater: (prev: Widget[]) => Widget[]) => {
    setWidgetsState((prev) => {
      const next = updater(prev);
      if (next.length !== prev.length) { past.current.push(prev); future.current = []; }
      return next;
    });
    setDirty(true);
  }, []);

  const openDashboard = useCallback((id: string) => {
    const d = api.dashboards.find((x) => x.id === id);
    if (!d) return;
    skipAutosave.current = true;
    setCurrentId(id); setName(d.name); setWidgetsState(d.widgets ?? []);
    setSelectedId(null); past.current = []; future.current = []; setDirty(false);
    api.markRecent(id);
  }, [api]);

  // When the dashboards list first loads and nothing is open, open the first one.
  useEffect(() => {
    if (!currentId && api.dashboards.length) openDashboard(api.dashboards[0].id);
  }, [api.dashboards, currentId, openDashboard]);

  // New widgets auto-bind to the opened asset's device + first matching tag.
  const [builderBinding, setBuilderBinding] = useState<{ assetId: string; tag: string } | undefined>(undefined);

  // Right-click asset → open builder in place; create a dashboard for it if none open.
  function openBuilderFor(a: Asset) {
    setMode("build");
    resolveTags(a.id, allAssets).then(({ ownerId, tags }) => {
      if (ownerId) setBuilderBinding({ assetId: ownerId, tag: tags[0] ?? "" });
    });
    if (!currentId) api.createDashboard(`${a.name} Dashboard`, null, []).then((id) => { if (id) openDashboard(id); });
  }

  const save = useCallback(async () => {
    if (!currentId) return;
    await api.saveDashboard({ id: currentId, name: name.trim() || "Untitled", widgets });
    setDirty(false);
    toast({ title: "Dashboard saved" });
  }, [api, currentId, name, widgets, toast]);

  // Auto-save (debounced) while a dashboard is open and dirty.
  useEffect(() => {
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    if (!currentId || !dirty) return;
    const t = setTimeout(() => {
      api.saveDashboard({ id: currentId, name: name.trim() || "Untitled", widgets }).then(() => setDirty(false));
    }, 1500);
    return () => clearTimeout(t);
  }, [widgets, name, currentId, dirty]); // eslint-disable-line

  const updateConfig = useCallback((id: string, patch: Record<string, any>) => {
    setWidgetsState((prev) => prev.map((w) => (w.id === id ? { ...w, config: { ...w.config, ...patch } } : w)));
    setDirty(true);
  }, []);
  const deleteWidget = useCallback((id: string) => { setWidgets((prev) => prev.filter((w) => w.id !== id)); setSelectedId(null); }, [setWidgets]);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    future.current.push(widgets); setWidgetsState(past.current.pop()!); setDirty(true); setSelectedId(null);
  }, [widgets]);
  const redo = useCallback(() => {
    if (!future.current.length) return;
    past.current.push(widgets); setWidgetsState(future.current.pop()!); setDirty(true); setSelectedId(null);
  }, [widgets]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      else if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (ctrl && e.key.toLowerCase() === "c" && selectedId) { clipboard.current = widgets.find((w) => w.id === selectedId) ?? null; }
      else if (ctrl && e.key.toLowerCase() === "v" && clipboard.current) {
        e.preventDefault();
        const src = clipboard.current;
        setWidgets((prev) => [...prev, { ...src, id: `w${Date.now()}`, x: Math.min(10, src.x + 1), y: src.y + 1 }]);
      }
      else if (ctrl && e.key.toLowerCase() === "d" && selectedId) {
        e.preventDefault();
        const src = widgets.find((w) => w.id === selectedId); if (src) setWidgets((prev) => [...prev, { ...src, id: `w${Date.now()}`, x: Math.min(10, src.x + 1), y: src.y + 1 }]);
      }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { e.preventDefault(); deleteWidget(selectedId); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, widgets, undo, redo, setWidgets, deleteWidget]);

  const selectedWidget = useMemo(() => widgets.find((w) => w.id === selectedId) ?? null, [widgets, selectedId]);
  const current = currentId ? api.dashboards.find((d) => d.id === currentId) : null;

  // Builder tree ctx: selecting a machine rebinds every bound widget to it, so one
  // dashboard renders whichever machine you click (parameterized dashboard).
  const buildAssetCtx = {
    ...assetTreeCtx,
    setSelectedId: (id: string) => {
      setAssetSelId(id);
      setWidgets((prev) => prev.map((w) => (w.config?.assetId ? { ...w, config: { ...w.config, assetId: id } } : w)));
    },
    onOpenBuilder: undefined,
  };

  function exportJson() {
    const blob = new Blob([JSON.stringify({ name, widgets }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${(name || "dashboard").replace(/\s+/g, "_")}.json`; a.click(); URL.revokeObjectURL(url);
  }
  async function share() {
    try { await navigator.clipboard.writeText(JSON.stringify({ name, widgets })); toast({ title: "Dashboard copied", description: "JSON copied to clipboard — paste via Import to share." }); }
    catch { toast({ title: "Copy failed", variant: "destructive" }); }
  }
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const w = Array.isArray(obj.widgets) ? obj.widgets : [];
      const id = await api.createDashboard(obj.name || f.name.replace(/\.json$/, ""), null, w);
      if (id) { openDashboard(id); toast({ title: "Dashboard imported" }); }
    } catch { toast({ title: "Import failed", description: "Not a valid dashboard JSON.", variant: "destructive" }); }
  }
  function saveAsTemplate() {
    const n = prompt("Template name", name || "Template"); if (!n?.trim()) return;
    api.saveAsTemplate(n.trim(), widgets); toast({ title: "Template saved" });
  }
  function openAccess() { setRoles(current?.roleAccess ?? ALL_ROLES); setAccessOpen(true); }
  async function applyAccess() {
    if (!currentId) return;
    await api.saveDashboard({ id: currentId, name: name.trim() || "Untitled", widgets, roleAccess: roles.length ? roles : ALL_ROLES });
    setAccessOpen(false); toast({ title: "Access updated" });
  }

  return (
    <div className="p-4 h-full flex flex-col gap-3">
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/data-explorer"))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-1.5">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Visualization</h1>
        </div>
        {mode === "explore" && <span className="ml-2 text-xs text-muted-foreground">Right-click an asset → <strong>Dashboard Builder</strong></span>}
      </div>

      {mode === "explore" ? (
        <Card className="flex-1 min-h-0 overflow-hidden shadow-sm">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={26} minSize={18} maxSize={40}>
              <div className="h-full border-r border-border overflow-auto">
                <AssetTreeProvider value={assetTreeCtx}>
                  <AssetTree loading={!assetsData} />
                </AssetTreeProvider>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={74}>
              <AssetVizPanel assetId={assetSelId} assetName={selectedAsset?.name} assets={allAssets} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </Card>
      ) : (
      <Card className={cn("flex-1 min-h-0 overflow-hidden shadow-sm", fullscreen && "fixed inset-0 z-50 rounded-none")}>
        <div className="flex flex-col h-full">
          {/* Dashboard toolbar */}
          <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => setMode("explore")} title="Back to asset explorer"><ArrowLeft className="w-4 h-4 mr-1" /> Assets</Button>
            <div className="w-px h-5 bg-border" />
            <select
              value={currentId ?? ""}
              onChange={(e) => {
                if (e.target.value === "__new") { const n = prompt("Dashboard name", "New Dashboard"); if (n?.trim()) api.createDashboard(n.trim(), null, []).then((id) => id && openDashboard(id)); }
                else if (e.target.value) openDashboard(e.target.value);
              }}
              className="h-8 rounded-md border border-border text-sm px-2 max-w-[12rem]"
              title="Switch dashboard"
            >
              {!currentId && <option value="">— select dashboard —</option>}
              {api.dashboards.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              <option value="__new">+ New dashboard…</option>
            </select>
            <Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder="Dashboard name" className="h-8 w-44 text-sm font-medium" disabled={!currentId} />
            {dirty && <span className="text-[11px] text-amber-600">● unsaved</span>}
            <div className="flex-1" />
            <IconBtn title="Undo (Ctrl+Z)" onClick={undo}><Undo2 className="w-4 h-4" /></IconBtn>
            <IconBtn title="Redo (Ctrl+Y)" onClick={redo}><Redo2 className="w-4 h-4" /></IconBtn>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground px-1"><Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-90" /> Auto-refresh</label>
            <Button variant="outline" size="sm" onClick={() => setPreview((p) => !p)} disabled={!currentId}>{preview ? <><EyeOff className="w-4 h-4 mr-1.5" /> Edit</> : <><Eye className="w-4 h-4 mr-1.5" /> Preview</>}</Button>
            <Button variant="outline" size="sm" onClick={() => current && api.cloneDashboard(current)} disabled={!current}><Copy className="w-4 h-4 mr-1.5" /> Clone</Button>
            <IconBtn title="Templates" onClick={() => setTplOpen(true)}><LayoutTemplate className="w-4 h-4" /></IconBtn>
            <IconBtn title="Access control" onClick={openAccess} ><ShieldCheck className="w-4 h-4" /></IconBtn>
            <IconBtn title="Share (copy JSON)" onClick={share}><Share2 className="w-4 h-4" /></IconBtn>
            <IconBtn title="Import dashboard" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /></IconBtn>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />
            <Button variant="outline" size="sm" onClick={exportJson} disabled={!currentId}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
            <Button variant="outline" size="sm" onClick={() => setFullscreen((f) => !f)}>{fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</Button>
            <Button size="sm" onClick={save} disabled={!currentId}><Save className="w-4 h-4 mr-1.5" /> Save</Button>
          </div>

          <div className="flex-1 min-h-0">
            <ResizablePanelGroup direction="horizontal" className="h-full">
              {!fullscreen && (
                <>
                  <ResizablePanel defaultSize={22} minSize={15} maxSize={32}>
                    <div className="h-full border-r border-border overflow-auto">
                      <AssetTreeProvider value={buildAssetCtx}><AssetTree loading={!assetsData} /></AssetTreeProvider>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              )}
              <ResizablePanel defaultSize={fullscreen ? 100 : 58}>
                {currentId ? (
                  <DashboardCanvas widgets={widgets} setWidgets={setWidgets} selectedId={selectedId} onSelect={setSelectedId} preview={preview} defaultConfig={builderBinding} />
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Select or create a dashboard on the left.</div>
                )}
              </ResizablePanel>
              {!fullscreen && !preview && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={20} minSize={15} maxSize={32}>
                    <div className="h-full border-l border-border"><WidgetPanel selected={selectedWidget} updateConfig={updateConfig} onDelete={deleteWidget} /></div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </div>
      </Card>
      )}

      {/* Access Control */}
      <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Access Control</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Which roles can see this dashboard.</p>
          <div className="space-y-2">
            {ALL_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm capitalize cursor-pointer">
                <input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles((prev) => e.target.checked ? [...prev, r] : prev.filter((x) => x !== r))} />
                {r}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessOpen(false)}>Cancel</Button>
            <Button onClick={applyAccess}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Templates */}
      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><LayoutTemplate className="w-4 h-4" /> Dashboard Templates</DialogTitle></DialogHeader>
          <Button variant="outline" size="sm" className="w-full" onClick={saveAsTemplate} disabled={!currentId}>
            <Save className="w-4 h-4 mr-1.5" /> Save current dashboard as template
          </Button>
          <div className="mt-2 max-h-72 overflow-auto divide-y divide-border border border-border rounded-md">
            {api.templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No templates yet.</p>
            ) : api.templates.map((tpl) => (
              <div key={tpl.id} className="flex items-center gap-2 px-3 py-2">
                <LayoutTemplate className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm flex-1 truncate">{tpl.name} <span className="text-xs text-muted-foreground">({tpl.widgets.length} widgets)</span></span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
                  const n = prompt("New dashboard name", tpl.name); if (!n?.trim()) return;
                  const id = await api.createFromTemplate(tpl.id, n.trim(), null); if (id) { openDashboard(id); setTplOpen(false); }
                }}>Create</Button>
                <button title="Delete template" onClick={() => api.deleteTemplate(tpl.id)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <button title={title} onClick={onClick} className="p-1.5 rounded hover:bg-muted text-muted-foreground">{children}</button>;
}
