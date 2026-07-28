import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, LayoutTemplate, Trash2, Search, Pencil, Check, X } from "lucide-react";
import { newId } from "@/features/dashboards/useDashboards";
import { useVizHierarchy } from "@/features/dashboards/vizHierarchy";

// Dashboard templates saved from Visualization (right-click a node → Create
// Template). They live in localStorage and can be applied onto any node of the
// Visualization hierarchy, which is how a layout gets reused across assets.
const TEMPLATES_KEY = "viz_templates";
const WKEY = (id: string) => `wsviz:widgets:${id}`;

interface DashTemplate { id: string; name: string; widgets: any[] }

function readTemplates(): DashTemplate[] {
  try { const r = localStorage.getItem(TEMPLATES_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}
function writeTemplates(list: DashTemplate[]) {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list)); } catch { /* quota */ }
}
function withFreshIds(widgets: any[]): any[] { return widgets.map((w) => ({ ...w, id: newId("w") })); }

export default function DashboardTemplates() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const viz = useVizHierarchy();

  const [templates, setTemplates] = useState<DashTemplate[]>(() => readTemplates());
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const persist = (next: DashTemplate[]) => { setTemplates(next); writeTemplates(next); };

  // Indented list of hierarchy nodes, so "Apply to" reads like the tree.
  const nodeOptions = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const n of viz.childrenByParent[parentId ?? "root"] ?? []) {
        out.push({ id: n.id, name: n.name, depth });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [viz.childrenByParent]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? templates.filter((t) => t.name.toLowerCase().includes(q)) : templates;
  }, [templates, search]);

  function applyTemplate(tpl: DashTemplate) {
    if (!target) return;
    try { localStorage.setItem(WKEY(target), JSON.stringify(withFreshIds(tpl.widgets))); } catch { /* quota */ }
    const name = nodeOptions.find((n) => n.id === target)?.name ?? "the selected dashboard";
    toast({ title: "Template applied", description: `"${tpl.name}" (${tpl.widgets.length} widget(s)) applied to "${name}". Open it in Visualization to see it.` });
  }
  function removeTemplate(id: string) {
    const tpl = templates.find((t) => t.id === id);
    if (tpl && !confirm(`Delete template "${tpl.name}"?`)) return;
    persist(templates.filter((t) => t.id !== id));
    toast({ title: "Template deleted" });
  }
  function startRename(tpl: DashTemplate) { setRenaming(tpl.id); setRenameValue(tpl.name); }
  function commitRename() {
    if (!renaming || !renameValue.trim()) { setRenaming(null); return; }
    persist(templates.map((t) => (t.id === renaming ? { ...t, name: renameValue.trim() } : t)));
    setRenaming(null);
  }

  return (
    <div className="p-6 space-y-3 h-full flex flex-col">
      <button onClick={() => navigate("/data-explorer")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground shrink-0">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="shrink-0">
        <h1 className="text-xl font-bold flex items-center gap-2"><LayoutTemplate className="w-5 h-5 text-primary" /> Asset Template</h1>
        <p className="text-sm text-muted-foreground">
          Reusable dashboard layouts. Save one from Visualization (right-click a dashboard → Create Template), then apply it to any other dashboard here.
        </p>
      </div>

      <Card className="flex-1 min-h-0 overflow-hidden shadow-sm flex flex-col">
        {/* Controls */}
        <div className="p-3 border-b border-border flex items-end gap-3 flex-wrap shrink-0">
          <div className="space-y-1 flex-1 min-w-[12rem]">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…" className="pl-7 h-9 text-sm" />
            </div>
          </div>
          <div className="space-y-1 min-w-[14rem]">
            <Label className="text-xs">Apply to dashboard</Label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— select a dashboard —</option>
              {nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>{`${" ".repeat(n.depth * 3)}${n.depth > 0 ? "└ " : ""}${n.name}`}</option>
              ))}
            </select>
          </div>
        </div>

        {nodeOptions.length === 0 && (
          <p className="px-3 py-2 text-xs text-amber-600 shrink-0">
            No dashboards exist yet — create one in <strong>Visualization</strong> first, then you can apply a template to it.
          </p>
        )}

        {/* Template list */}
        <div className="flex-1 overflow-auto divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
              <LayoutTemplate className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">
                {templates.length === 0
                  ? "No templates yet. In Visualization, right-click a dashboard that has widgets → “Create Template”."
                  : `No template matches “${search}”.`}
              </p>
            </div>
          ) : filtered.map((tpl) => (
            <div key={tpl.id} className="flex items-center gap-3 px-3 py-2.5">
              <LayoutTemplate className="w-4 h-4 text-primary shrink-0" />
              {renaming === tpl.id ? (
                <>
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    className="h-8 text-sm flex-1"
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }}
                  />
                  <button onClick={commitRename} title="Save name" className="p-1 text-primary hover:bg-primary/10 rounded"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setRenaming(null)} title="Cancel" className="p-1 text-muted-foreground hover:bg-muted rounded"><X className="w-4 h-4" /></button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tpl.name}</p>
                    <p className="text-xs text-muted-foreground">{tpl.widgets.length} widget{tpl.widgets.length !== 1 ? "s" : ""}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!target} onClick={() => applyTemplate(tpl)}
                    title={target ? "Apply this layout to the selected dashboard" : "Pick a target dashboard first"}>
                    Apply
                  </Button>
                  <button onClick={() => startRename(tpl)} title="Rename template" className="p-1 text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => removeTemplate(tpl.id)} title="Delete template" className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="px-3 py-1.5 border-t border-border text-[11px] text-muted-foreground shrink-0">
          {templates.length} template{templates.length !== 1 ? "s" : ""}
        </div>
      </Card>
    </div>
  );
}
