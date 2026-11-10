import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useForm, Controller } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Send, Plus, Trash2, CheckCircle2, AlertCircle, Loader2,
  Webhook, KeyRound, Lock, Globe, Zap,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";
import { apiFetch } from "@/lib/auth-api";

const DEST_QUERY_KEY = ["destinations"];

async function fetchDestinations() {
  const res = await apiFetch("/api/destinations");
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

const AUTH_LABELS: Record<string, string> = {
  none:    "No Auth",
  bearer:  "Bearer Token",
  api_key: "API Key Header",
  basic:   "Basic Auth",
};
const AUTH_ICONS: Record<string, React.ElementType> = {
  none: Globe, bearer: KeyRound, api_key: KeyRound, basic: Lock,
};

export default function Destinations() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const { canAction } = useCurrentUser();

  const { data: destinations, isLoading } = useQuery({ queryKey: DEST_QUERY_KEY, queryFn: fetchDestinations });

  const createDest = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiFetch("/api/destinations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Destination created" }); qc.invalidateQueries({ queryKey: DEST_QUERY_KEY }); setOpen(false); form.reset(DEFAULT_VALUES); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteDest = useMutation({
    mutationFn: async (id: string) => { const res = await apiFetch(`/api/destinations/${id}`, { method: "DELETE" }); if (!res.ok) throw new Error(); },
    onSuccess: () => { toast({ title: "Destination deleted" }); qc.invalidateQueries({ queryKey: DEST_QUERY_KEY }); },
  });

  const toggleDest = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiFetch(`/api/destinations/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      if (!res.ok) throw new Error();
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DEST_QUERY_KEY }),
  });

  const DEFAULT_VALUES = {
    name: "", description: "", endpoint: "",
    authType: "bearer", token: "", secretKey: "",
    apiKeyHeader: "X-API-Key", basicUser: "", basicPass: "",
    eventTypes: ["alarm"], enabled: true,
  };
  const form = useForm({ defaultValues: DEFAULT_VALUES });
  const watchAuthType = form.watch("authType");

  async function testDestination(id: string) {
    setTesting(id);
    try {
      const res = await apiFetch(`/api/destinations/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.success) toast({ title: "Test succeeded", description: `HTTP ${data.statusCode}` });
      else toast({ title: "Test failed", description: data.error ?? `HTTP ${data.statusCode}`, variant: "destructive" });
    } catch (e: any) { toast({ title: "Test failed", description: e.message, variant: "destructive" }); }
    finally { setTesting(null); }
  }

  function onSubmit(data: any) {
    const payload = { ...data, eventTypes: data.eventTypes };
    createDest.mutate(payload);
  }

  const destList = (destinations as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Send className="w-5 h-5 text-primary" /> Data Destinations
          </h1>
          <p className="text-sm text-muted-foreground">Forward alarm and telemetry events to external systems via HTTP POST</p>
        </div>
        {canAction("manage_destinations", "brokers") && <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> Add Destination</Button>}
      </div>
      <ReadOnlyBanner permission="manage_destinations" message="cannot add, edit, or delete data destinations." />

      {/* Info Banner */}
      <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-3 text-xs text-blue-800 dark:text-blue-300">
        <p className="font-semibold mb-1 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> How it works</p>
        <p>When an alarm triggers/clears or telemetry is ingested, the platform sends a JSON POST to every enabled destination subscribed to that event type. Each destination can use Bearer Token, API Key, or Basic Auth. The request includes an <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">X-Source: iot-platform</code> signature header.</p>
      </div>

      {/* Destinations list */}
      <div className="space-y-2">
        {isLoading ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />) :
         destList.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
            <Send className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No destinations configured</p>
            <p className="text-xs mt-1 opacity-60">Add one to start forwarding data to external systems</p>
          </div>
        ) : destList.map((d: any) => {
          const AuthIcon = AUTH_ICONS[d.authType] ?? Globe;
          return (
            <div key={d.id} className={cn("rounded-lg border border-border bg-card p-4 flex items-start gap-4 shadow-sm transition-opacity", !d.enabled && "opacity-60")}>
              <div className={cn("mt-0.5 p-2 rounded-lg", d.enabled ? "bg-green-100 dark:bg-green-950/40" : "bg-muted")}>
                <Send className={cn("w-4 h-4", d.enabled ? "text-green-600" : "text-muted-foreground")} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-sm">{d.name}</span>
                  {d.eventTypes?.map((t: string) => (
                    <Badge key={t} variant="secondary" className="text-xs capitalize">{t}</Badge>
                  ))}
                  <span className="text-xs text-muted-foreground flex items-center gap-1 ml-1">
                    <AuthIcon className="w-3 h-3" /> {AUTH_LABELS[d.authType] ?? d.authType}
                  </span>
                </div>
                {d.description && <p className="text-xs text-muted-foreground mb-1">{d.description}</p>}
                <p className="text-xs font-mono text-muted-foreground truncate">{d.endpoint}</p>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  {d.lastSentAt && <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" />Last sent {formatDistanceToNow(new Date(d.lastSentAt), { addSuffix: true })}</span>}
                  {d.lastError && <span className="flex items-center gap-1 text-red-500"><AlertCircle className="w-3 h-3" />{d.lastError}</span>}
                  {d.sendCount > 0 && <span>{d.sendCount.toLocaleString()} sent</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => testDestination(d.id)} disabled={testing === d.id || !d.enabled}
                  className="text-xs text-muted-foreground hover:text-primary disabled:opacity-40 transition-colors flex items-center gap-1 border border-border rounded px-2 py-1">
                  {testing === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Webhook className="w-3 h-3" />}
                  Test
                </button>
                <Switch checked={d.enabled} disabled={!canAction("manage_destinations", "brokers")}
                  onCheckedChange={(enabled) => toggleDest.mutate({ id: d.id, enabled })} />
                {canAction("manage_destinations", "brokers") && (
                  <button className="text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => deleteDest.mutate(d.id)}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Payload preview */}
      {destList.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-xs font-semibold mb-2">Example alarm event payload sent to destinations</p>
          <pre className="text-xs text-muted-foreground overflow-auto">{JSON.stringify({
            event: "alarm",
            type: "triggered",
            ruleName: "Temperature Critical",
            metric: "temperature",
            value: 87.3,
            threshold: 55,
            severity: "critical",
            assetId: "...",
            assetName: "Fan",
            timestamp: new Date().toISOString(),
            source: "iot-platform",
          }, null, 2)}</pre>
        </div>
      )}

      {/* Add Destination Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Destination</DialogTitle>
            <DialogDescription>Configure an external HTTP endpoint to receive forwarded events.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="e.g. SCADA Webhook" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="authType" render={({ field }) => (
                  <FormItem><FormLabel>Auth Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">No Auth</SelectItem>
                        <SelectItem value="bearer">Bearer Token</SelectItem>
                        <SelectItem value="api_key">API Key Header</SelectItem>
                        <SelectItem value="basic">Basic Auth</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Input placeholder="Optional description" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="endpoint" render={({ field }) => (
                <FormItem>
                  <FormLabel>Endpoint URL *</FormLabel>
                  <FormControl><Input placeholder="https://api.example.com/events" type="url" {...field} /></FormControl>
                  <FormDescription className="text-xs">Receives HTTP POST with JSON event payload</FormDescription>
                </FormItem>
              )} />

              {/* Auth fields */}
              {(watchAuthType === "bearer" || watchAuthType === "api_key") && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="token" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{watchAuthType === "bearer" ? "Bearer Token" : "API Key Value"}</FormLabel>
                      <FormControl><Input type="password" placeholder="sk-..." {...field} /></FormControl>
                    </FormItem>
                  )} />
                  {watchAuthType === "api_key" && (
                    <FormField control={form.control} name="apiKeyHeader" render={({ field }) => (
                      <FormItem><FormLabel>Header Name</FormLabel><FormControl><Input placeholder="X-API-Key" {...field} /></FormControl></FormItem>
                    )} />
                  )}
                </div>
              )}
              {watchAuthType === "basic" && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="basicUser" render={({ field }) => (
                    <FormItem><FormLabel>Username</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="basicPass" render={({ field }) => (
                    <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl></FormItem>
                  )} />
                </div>
              )}

              {/* Event types */}
              <div>
                <label className="text-sm font-medium leading-none">Forward Events</label>
                <div className="flex gap-3 mt-2">
                  {["alarm", "telemetry"].map((type) => {
                    const current = form.watch("eventTypes") as string[];
                    const checked = current.includes(type);
                    return (
                      <label key={type} className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked ? [...current, type] : current.filter((t) => t !== type);
                            form.setValue("eventTypes", next);
                          }}
                          className="rounded" />
                        <span className="capitalize">{type} events</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setOpen(false); form.reset(DEFAULT_VALUES); }}>Cancel</Button>
                <Button type="submit" disabled={createDest.isPending}>Add Destination</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
