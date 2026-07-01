import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  useListAssetTemplates, useCreateAssetTemplate, useDeleteAssetTemplate, useListAssets,
  getListAssetTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, LayoutTemplate, ArrowLeft, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useCurrentUser } from "@/contexts/UserContext";
import type { Asset } from "./assetShared";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AssetTemplates() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useCurrentUser();

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const { data: templates } = useListAssetTemplates();
  const { data: assets } = useListAssets();
  const allTemplates = (templates as any[] | undefined) ?? [];
  const allAssets = (assets as Asset[] | undefined) ?? [];

  // Client-side filter so search is exact and reliable.
  const templateList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? allTemplates.filter((t) => (t.name ?? "").toLowerCase().includes(q)) : allTemplates;
  }, [allTemplates, search]);

  const usageCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of allAssets) if (a.templateId) m[a.templateId] = (m[a.templateId] ?? 0) + 1;
    return m;
  }, [allAssets]);

  const deleteTemplate = useDeleteAssetTemplate();
  function handleDeleteTemplate(e: React.MouseEvent, t: any) {
    e.stopPropagation();
    if (!confirm(`Delete template "${t.name}"?`)) return;
    deleteTemplate.mutate({ id: t.id }, {
      onSuccess: () => { toast({ title: "Template deleted" }); qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() }); },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  const form = useForm({ defaultValues: { name: "" } });
  async function onSubmit(data: { name: string }) {
    setCreating(true);
    try {
      const res = await fetch(`${BASE}/api/asset-templates`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.name }),
      });
      const created = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: "Create failed", description: created.error ?? "Try again", variant: "destructive" }); return; }
      toast({ title: "Template created" });
      qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
      setCreateOpen(false); form.reset();
      if (created.id) navigate(`/asset-templates/${created.id}`);
    } finally { setCreating(false); }
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/asset-management"))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><LayoutTemplate className="w-5 h-5 text-primary" /> Asset Templates</h1>
          <p className="text-sm text-muted-foreground">Create and manage reusable attribute templates</p>
        </div>
        {can("manage_templates") && (
          <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> Create Template</Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
      </div>

      {/* Table */}
      <Card className="shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-medium">Template Name</th>
                <th className="text-left px-4 py-2.5 font-medium">Asset Type</th>
                <th className="text-left px-4 py-2.5 font-medium">Assets Using</th>
                <th className="text-left px-4 py-2.5 font-medium">Attributes</th>
                <th className="text-left px-4 py-2.5 font-medium">Created By</th>
                <th className="text-left px-4 py-2.5 font-medium">Last Updated</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {!templates ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50"><td colSpan={7} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td></tr>
                ))
              ) : templateList.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                  <LayoutTemplate className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No templates {search ? "match your search" : "yet"}</p>
                  {!search && can("manage_templates") && (
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" /> Create your first template</Button>
                  )}
                </td></tr>
              ) : (
                templateList.map((t: any) => (
                  <tr key={t.id} onClick={() => navigate(`/asset-templates/${t.id}`)}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer group">
                    <td className="px-4 py-2.5 font-medium text-primary">{t.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.tags?.[0] ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{usageCount[t.id] ?? 0}</td>
                    <td className="px-4 py-2.5 tabular-nums">{t.attributeCount ?? (t.attributeDefinitions?.length ?? 0)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">—</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{t.updatedAt ? format(new Date(t.updatedAt), "MM/dd/yyyy") : "—"}</td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {can("manage_templates") && (
                        <button title="Delete template" onClick={(e) => handleDeleteTemplate(e, t)}
                          className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Template</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel>
                  <FormControl><Input placeholder="e.g. Rotating Equipment, Energy Meter, Flow Sensor" {...field} /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
