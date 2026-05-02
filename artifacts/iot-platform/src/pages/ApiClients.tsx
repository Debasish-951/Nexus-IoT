import { useState } from "react";
import {
  useListApiClients,
  useCreateApiClient,
  useDeleteApiClient,
  getListApiClientsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Plus, Trash2, Copy } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function ApiClients() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: clients } = useListApiClients();
  const createClient = useCreateApiClient();
  const deleteClient = useDeleteApiClient();

  const form = useForm({ defaultValues: { name: "", scopes: "" } });

  function onSubmit(data: { name: string; scopes: string }) {
    createClient.mutate(
      { data: { name: data.name, scopes: data.scopes ? data.scopes.split(",").map((s) => s.trim()) : [] } },
      {
        onSuccess: () => {
          toast({ title: "API client created" });
          qc.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
          setOpen(false);
          form.reset();
        },
      }
    );
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  }

  const clientList = (clients as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" />API Clients</h1>
          <p className="text-sm text-muted-foreground">Third-party application credentials and access scopes</p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm" data-testid="add-client-btn"><Plus className="w-4 h-4 mr-1.5" /> Add Client</Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Client ID</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Scopes</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {!clients ? (
              Array.from({ length: 2 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 6 }).map((__, j) => (<td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>))}
                </tr>
              ))
            ) : clientList.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><KeyRound className="w-8 h-8 mx-auto mb-2 opacity-30" />No API clients yet</td></tr>
            ) : (
              clientList.map((client: any) => (
                <tr key={client.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`client-row-${client.id}`}>
                  <td className="px-4 py-3 font-medium">{client.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-muted-foreground">{client.clientId}</span>
                      <button className="text-muted-foreground hover:text-primary transition-colors" onClick={() => copyToClipboard(client.clientId)} data-testid={`copy-clientid-${client.id}`}><Copy className="w-3 h-3" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(client.scopes as string[]).map((scope: string) => (
                        <span key={scope} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{scope}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", client.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>{client.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{format(new Date(client.createdAt), "yyyy-MM-dd")}</td>
                  <td className="px-4 py-3">
                    <button className="text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => deleteClient.mutate({ id: client.id }, { onSuccess: () => { toast({ title: "Client deleted" }); qc.invalidateQueries({ queryKey: getListApiClientsQueryKey() }); } })}
                      data-testid={`delete-client-${client.id}`}
                    ><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="add-client-dialog">
          <DialogHeader><DialogTitle>Add API Client</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name *</FormLabel><FormControl><Input {...field} data-testid="client-name-input" /></FormControl></FormItem>)} />
              <FormField control={form.control} name="scopes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Scopes (comma-separated)</FormLabel>
                  <FormControl><Input placeholder="read:assets, write:ingest, read:alarms" {...field} data-testid="client-scopes-input" /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createClient.isPending} data-testid="save-client-btn">Create</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
