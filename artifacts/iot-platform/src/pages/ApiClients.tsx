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
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useForm, Controller } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  KeyRound, Plus, Trash2, Copy, Eye, EyeOff, ChevronDown,
  CheckCircle2, XCircle, BookOpen, Shield, Zap, Bell, Clock,
  Terminal, AlertTriangle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";

// ── Scope definitions ─────────────────────────────────────────────────────────
const SCOPES = [
  {
    id: "read:assets",
    label: "Read Assets",
    description: "List assets and their current attribute values",
    icon: <Shield className="w-3.5 h-3.5" />,
    color: "text-blue-600 dark:text-blue-400",
    endpoint: "GET /api/export/assets",
  },
  {
    id: "read:telemetry",
    label: "Read Telemetry",
    description: "Query time-series sensor/metric data",
    icon: <Zap className="w-3.5 h-3.5" />,
    color: "text-purple-600 dark:text-purple-400",
    endpoint: "GET /api/export/telemetry",
  },
  {
    id: "read:alarms",
    label: "Read Alarms",
    description: "Read active alarm list",
    icon: <Bell className="w-3.5 h-3.5" />,
    color: "text-orange-600 dark:text-orange-400",
    endpoint: "GET /api/export/alarms",
  },
  {
    id: "read:alarm-history",
    label: "Read Alarm History",
    description: "Access full alarm event history",
    icon: <BookOpen className="w-3.5 h-3.5" />,
    color: "text-red-600 dark:text-red-400",
    endpoint: "GET /api/export/alarm-history",
  },
];

const ALL_SCOPES_ID = "*";

// ── Helpers ───────────────────────────────────────────────────────────────────
function SecretField({ secret }: { secret: string }) {
  const [visible, setVisible] = useState(false);
  const { toast } = useToast();
  function copy() {
    navigator.clipboard.writeText(secret);
    toast({ title: "Bearer token copied" });
  }
  return (
    <div className="flex items-center gap-1.5 group">
      <code className="font-mono text-[11px] text-foreground/80 bg-muted px-1.5 py-0.5 rounded max-w-[220px] truncate">
        {visible ? secret : "••••••••••••••••••••••••"}
      </code>
      <button
        onClick={() => setVisible((v) => !v)}
        className="text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100 transition-opacity"
        title={visible ? "Hide" : "Reveal token"}
      >
        {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </button>
      <button
        onClick={copy}
        className="text-muted-foreground hover:text-primary opacity-60 hover:opacity-100 transition-opacity"
        title="Copy bearer token"
      >
        <Copy className="w-3 h-3" />
      </button>
    </div>
  );
}

function IntegrationGuide({ client }: { client: any }) {
  const { toast } = useToast();
  const origin = window.location.origin;
  const secret = client.clientSecret ?? "<clientSecret>";

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  }

  const examples: Array<{ label: string; scope: string; cmd: string }> = [
    {
      label: "List assets",
      scope: "read:assets",
      cmd: `curl -H "Authorization: Bearer ${secret}" \\\n  ${origin}/api/export/assets`,
    },
    {
      label: "Telemetry (last 100 rows)",
      scope: "read:telemetry",
      cmd: `curl -H "X-API-Key: ${secret}" \\\n  "${origin}/api/export/telemetry?limit=100"`,
    },
    {
      label: "Active alarms",
      scope: "read:alarms",
      cmd: `curl -H "Authorization: Bearer ${secret}" \\\n  "${origin}/api/export/alarms?status=active"`,
    },
    {
      label: "Alarm history (date range)",
      scope: "read:alarm-history",
      cmd: `curl -H "Authorization: Bearer ${secret}" \\\n  "${origin}/api/export/alarm-history?from=2024-01-01T00:00:00Z&limit=500"`,
    },
  ];

  const scopes: string[] = client.scopes ?? [];
  const allScopes = scopes.includes("*") || scopes.length === 0;

  return (
    <div className="space-y-4">
      {/* Auth method */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Authentication</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Bearer Token", value: `Authorization: Bearer ${secret}` },
            { label: "API Key Header", value: `X-API-Key: ${secret}` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
              <div className="flex items-center gap-1.5">
                <code className="text-[10px] font-mono text-foreground/80 flex-1 truncate">{value}</code>
                <button onClick={() => copy(value)} className="text-muted-foreground hover:text-foreground shrink-0">
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* curl examples */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">curl Examples</p>
        <div className="space-y-2">
          {examples.map((ex) => {
            const allowed = allScopes || scopes.includes(ex.scope);
            return (
              <div key={ex.scope} className={cn("rounded-md border bg-slate-950 dark:bg-black/40", !allowed && "opacity-40")}>
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                  <div className="flex items-center gap-1.5">
                    <Terminal className="w-3 h-3 text-green-400" />
                    <span className="text-[10px] text-slate-300">{ex.label}</span>
                    <span className="text-[9px] font-mono text-slate-500">{ex.scope}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!allowed && <span className="text-[9px] text-orange-400 flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" />not in scopes</span>}
                    <button onClick={() => copy(ex.cmd.replace(/\\\n\s+/g, " "))} className="text-slate-500 hover:text-slate-300">
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <pre className="text-[10px] font-mono text-green-300 px-3 py-2 overflow-x-auto whitespace-pre">{ex.cmd}</pre>
              </div>
            );
          })}
        </div>
      </div>

      {/* API schema link */}
      <div className="rounded-md border border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/20 px-3 py-2 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-blue-800 dark:text-blue-300">Full API reference</p>
          <code className="text-[10px] font-mono text-blue-600 dark:text-blue-400">{origin}/api/export/schema</code>
        </div>
        <button onClick={() => copy(`${origin}/api/export/schema`)} className="text-blue-400 hover:text-blue-600">
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ApiClients() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { can } = useCurrentUser();

  const { data: clients } = useListApiClients();
  const createClient = useCreateApiClient();
  const deleteClient = useDeleteApiClient();

  const form = useForm<{ name: string; scopes: string[]; allScopes: boolean }>({
    defaultValues: { name: "", scopes: [], allScopes: false },
  });
  const watchAllScopes = form.watch("allScopes");
  const watchScopes    = form.watch("scopes");

  function onSubmit(data: { name: string; scopes: string[]; allScopes: boolean }) {
    const finalScopes = data.allScopes ? [ALL_SCOPES_ID] : data.scopes;
    createClient.mutate(
      { data: { name: data.name, scopes: finalScopes } },
      {
        onSuccess: (created: any) => {
          toast({ title: "API client created", description: `Token: ${created.clientSecret}` });
          qc.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
          setOpen(false);
          form.reset();
          setExpandedId(created.id);
        },
      }
    );
  }

  const clientList = (clients as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" /> API Clients
          </h1>
          <p className="text-sm text-muted-foreground">
            Issue bearer tokens so external systems can securely export data from this platform
          </p>
        </div>
        {can("manage_api_clients") && (
          <Button onClick={() => setOpen(true)} size="sm" data-testid="add-client-btn">
            <Plus className="w-4 h-4 mr-1.5" /> New Client
          </Button>
        )}
      </div>
      <ReadOnlyBanner permission="manage_api_clients" message="cannot create or delete API clients." />

      {/* How it works banner */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3">
        <KeyRound className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs space-y-0.5">
          <p className="font-semibold text-foreground">How API export works</p>
          <p className="text-muted-foreground">
            Each client has a <strong>Client Secret</strong> that acts as a bearer token.
            External tools (BI dashboards, Python scripts, Node-RED) send it as{" "}
            <code className="bg-muted px-1 rounded font-mono">Authorization: Bearer &lt;secret&gt;</code>{" "}
            or <code className="bg-muted px-1 rounded font-mono">X-API-Key: &lt;secret&gt;</code> when calling{" "}
            <code className="bg-muted px-1 rounded font-mono">/api/export/*</code> endpoints.
            Scopes control what data each client can access.
          </p>
        </div>
      </div>

      {/* Scope reference */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {SCOPES.map((s) => (
          <div key={s.id} className="rounded-lg border border-border bg-card p-3 space-y-1">
            <div className={cn("flex items-center gap-1.5 font-medium text-xs", s.color)}>
              {s.icon}{s.label}
            </div>
            <p className="text-[10px] text-muted-foreground">{s.description}</p>
            <code className="text-[9px] font-mono text-muted-foreground/80">{s.endpoint}</code>
          </div>
        ))}
      </div>

      {/* Clients table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Bearer Token (Secret)</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Scopes</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Requests</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Last Used</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {!clients ? (
              Array.from({ length: 2 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : clientList.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                  <KeyRound className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">No API clients yet</p>
                  <p className="text-xs mt-1 opacity-60">Create one to start exporting data securely</p>
                </td>
              </tr>
            ) : (
              clientList.flatMap((client: any) => {
                const isExpanded = expandedId === client.id;
                const scopes: string[] = client.scopes ?? [];
                const isAllScopes = scopes.includes("*") || scopes.length === 0;
                return [
                  <tr
                    key={client.id}
                    className={cn("border-b border-border/50 hover:bg-muted/20 transition-colors", isExpanded && "bg-muted/10")}
                    data-testid={`client-row-${client.id}`}
                  >
                    <td className="px-4 py-3 font-medium">{client.name}</td>

                    {/* Bearer token */}
                    <td className="px-4 py-3">
                      {client.clientSecret
                        ? <SecretField secret={client.clientSecret} />
                        : <span className="text-xs text-muted-foreground italic">hidden</span>}
                    </td>

                    {/* Scopes */}
                    <td className="px-4 py-3">
                      {isAllScopes ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 px-2 py-0.5 rounded border border-purple-200 dark:border-purple-800">
                          <Shield className="w-2.5 h-2.5" /> All scopes
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {scopes.map((s: string) => (
                            <span key={s} className="text-[9px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">{s}</span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Request count */}
                    <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                      {Number(client.totalRequests ?? 0).toLocaleString()}
                    </td>

                    {/* Last used */}
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {client.lastUsedAt
                        ? <span title={format(new Date(client.lastUsedAt), "yyyy-MM-dd HH:mm:ss")}>
                            {formatDistanceToNow(new Date(client.lastUsedAt), { addSuffix: true })}
                          </span>
                        : <span className="opacity-40">Never</span>}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                        client.status === "active"
                          ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"
                          : "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400"
                      )}>
                        {client.status === "active"
                          ? <><CheckCircle2 className="w-2.5 h-2.5" />Active</>
                          : <><XCircle className="w-2.5 h-2.5" />Inactive</>}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : client.id)}
                          className={cn(
                            "flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors",
                            isExpanded
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                          title="Integration guide"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} />
                        </button>
                        {can("manage_api_clients") && (
                          <button
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => deleteClient.mutate({ id: client.id }, {
                              onSuccess: () => {
                                toast({ title: "Client deleted" });
                                qc.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
                                if (expandedId === client.id) setExpandedId(null);
                              },
                            })}
                            data-testid={`delete-client-${client.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>,

                  isExpanded && (
                    <tr key={`${client.id}-guide`} className="border-b border-border/50 bg-muted/5">
                      <td colSpan={7} className="px-6 py-5">
                        <div className="flex items-center gap-2 mb-4">
                          <BookOpen className="w-4 h-4 text-primary" />
                          <h3 className="text-sm font-semibold">Integration Guide — {client.name}</h3>
                        </div>
                        <IntegrationGuide client={client} />
                      </td>
                    </tr>
                  ),
                ].filter(Boolean);
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="add-client-dialog">
          <DialogHeader>
            <DialogTitle>Create API Client</DialogTitle>
            <DialogDescription>
              A bearer token (client secret) will be generated automatically. Copy it immediately — it is shown only once.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Grafana Export, Python ETL, Node-RED" {...field} data-testid="client-name-input" />
                  </FormControl>
                </FormItem>
              )} />

              {/* Scope picker */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Scopes</p>
                <FormDescription className="text-xs">
                  Choose what data this client can access. Leave all unchecked to grant every scope.
                </FormDescription>

                {/* All scopes toggle */}
                <Controller control={form.control} name="allScopes" render={({ field }) => (
                  <label className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    field.value
                      ? "border-purple-400 bg-purple-50/50 dark:bg-purple-950/20"
                      : "border-border hover:border-muted-foreground/40"
                  )}>
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-purple-600"
                      checked={field.value}
                      onChange={(e) => {
                        field.onChange(e.target.checked);
                        if (e.target.checked) form.setValue("scopes", []);
                      }}
                    />
                    <div>
                      <p className="text-xs font-semibold flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-purple-600" /> All Scopes (*)
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Super-key — can access everything. Use only for trusted internal integrations.</p>
                    </div>
                  </label>
                )} />

                {/* Individual scopes */}
                {!watchAllScopes && (
                  <Controller control={form.control} name="scopes" render={({ field }) => (
                    <div className="space-y-1.5">
                      {SCOPES.map((s) => {
                        const checked = (field.value as string[]).includes(s.id);
                        return (
                          <label key={s.id} className={cn(
                            "flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors",
                            checked ? "border-primary/50 bg-primary/5" : "border-border hover:border-muted-foreground/30"
                          )}>
                            <input
                              type="checkbox"
                              className="mt-0.5 accent-blue-600"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...(field.value as string[]), s.id]
                                  : (field.value as string[]).filter((x) => x !== s.id);
                                field.onChange(next);
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className={cn("text-xs font-medium flex items-center gap-1.5", s.color)}>
                                {s.icon}{s.label}
                              </p>
                              <p className="text-[10px] text-muted-foreground">{s.description}</p>
                              <code className="text-[9px] font-mono text-muted-foreground/70">{s.endpoint}</code>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )} />
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  type="submit"
                  disabled={createClient.isPending || (!watchAllScopes && watchScopes.length === 0)}
                  data-testid="save-client-btn"
                >
                  {createClient.isPending ? "Creating…" : "Create Client"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
