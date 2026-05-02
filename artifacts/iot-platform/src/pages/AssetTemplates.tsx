import { useState } from "react";
import {
  useListAssetTemplates,
  useCreateAssetTemplate,
  useDeleteAssetTemplate,
  getListAssetTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Search, FileText } from "lucide-react";
import { format } from "date-fns";

export default function AssetTemplates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const { data: templates } = useListAssetTemplates({ search: search || undefined });
  const createTemplate = useCreateAssetTemplate();
  const deleteTemplate = useDeleteAssetTemplate();

  const form = useForm({ defaultValues: { name: "" } });

  function onSubmit(data: { name: string }) {
    createTemplate.mutate(
      { data: { name: data.name } },
      {
        onSuccess: () => {
          toast({ title: "Template created" });
          qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
          setOpen(false);
          form.reset();
        },
      }
    );
  }

  const templateList = (templates as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Asset Templates</h1>
          <p className="text-sm text-muted-foreground">Define reusable attribute structures for assets</p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm" data-testid="add-template-btn">
          <Plus className="w-4 h-4 mr-1.5" /> Add Template
        </Button>
      </div>

      <div className="relative w-64">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input placeholder="Search templates..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" data-testid="template-search" />
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-8"><input type="checkbox" className="rounded" /></th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Attributes</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Last Edited</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {!templates ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-4 py-3"><Skeleton className="h-3 w-3" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-3 w-32" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-3 w-8" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-3 w-28" /></td>
                  <td className="px-4 py-3"></td>
                </tr>
              ))
            ) : templateList.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No templates yet. Create your first template.</p>
                </td>
              </tr>
            ) : (
              templateList.map((t: any) => (
                <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`template-row-${t.id}`}>
                  <td className="px-4 py-3"><input type="checkbox" className="rounded" /></td>
                  <td className="px-4 py-3 font-medium text-primary">{t.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.attributeCount}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{format(new Date(t.updatedAt), "yyyy-MM-dd HH:mm:ss.SSS")}</td>
                  <td className="px-4 py-3">
                    <button className="text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => deleteTemplate.mutate({ id: t.id }, { onSuccess: () => { toast({ title: "Template deleted" }); qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() }); } })}
                      data-testid={`delete-template-${t.id}`}
                    ><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="add-template-dialog">
          <DialogHeader><DialogTitle>Add Template</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="Template name" {...field} data-testid="template-name-input" /></FormControl></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createTemplate.isPending} data-testid="save-template-btn">Add</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
