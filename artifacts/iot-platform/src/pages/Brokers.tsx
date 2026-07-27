import { useState, useCallback } from "react";
import {
  useListBrokers, useCreateBroker, useDeleteBroker, getListBrokersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, CheckCircle2, XCircle, AlertCircle, Wifi, Copy, Info, History, ChevronDown, KeyRound, FolderOpen } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";
import { useWsEvents } from "@/hooks/useWsEvents";
import BrokerHistoryTimeline from "@/components/BrokerHistoryTimeline";
import { Link } from "wouter";
import { apiGet } from "@/lib/auth-api";

const TYPE_LABELS: Record<string, string> = {
  mqtt:             "MQTT",
  rest_api:         "REST API (Push)",
  http_api:         "HTTP API (Poll)",
  azure_iot:        "Azure IoT Hub",
  azure_event_hub:  "Azure Event Hub",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "connected") return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
  if (status === "error")     return <AlertCircle   className="w-3.5 h-3.5 text-red-500" />;
  return                              <XCircle       className="w-3.5 h-3.5 text-muted-foreground" />;
}

const BASE_URL = window.location.origin;

/**
 * Per-client HTTP ingest endpoints.
 *
 * Was a single hard-coded, unauthenticated URL shared by everything, which made
 * it impossible to tell which integration was generating load. Every API Client
 * now has its own endpoint carrying its `clientId`, and ingest requires a key —
 * so the request counts below are real attribution, not a guess.
 *
 * The clientId in the path is an identifier, not a secret. The API key sent in
 * the header is what authenticates; posting to another client's URL with your
 * own key is rejected.
 */
function IngestEndpointPanel() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: clients, isLoading } = useQuery<any[]>({
    queryKey: ["api-clients-endpoints"],
    queryFn: async () => {
      const res = await apiGet("/api/api-clients");
      return res.ok ? res.json() : [];
    },
    staleTime: 15_000,
  });

  function copy(text: string, what = "Copied") {
    navigator.clipboard.writeText(text);
    toast({ title: what });
  }

  // Only clients that can actually post telemetry. An empty scope list means
  // "all scopes" in apiKeyAuth, so those qualify too.
  const ingestClients = (clients ?? []).filter(
    (c) => c.status === "active" &&
      (c.scopes.length === 0 || c.scopes.includes("*") || c.scopes.includes("ingest:write")),
  );

  /**
   * Group by owning project.
   *
   * A project-scoped client is the shared team credential: the project head
   * assigns people to the project, and everyone on it sees this one endpoint
   * rather than each person carrying their own key. Unassigned (platform-wide)
   * clients fall into a trailing bucket.
   */
  const groupedByProject = (() => {
    const byProject = new Map<string | null, any[]>();
    for (const c of ingestClients) {
      const key = c.projectName ?? null;
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(c);
    }
    return [...byProject.entries()]
      .map(([project, clients]) => ({ project, clients }))
      .sort((a, b) => {
        if (a.project === null) return 1;   // unassigned last
        if (b.project === null) return -1;
        return a.project.localeCompare(b.project);
      });
  })();

  // Headings only earn their space once projects are actually in use.
  const showProjectHeadings = groupedByProject.some((g) => g.project !== null);

  const exPayload = JSON.stringify({ deviceId: "sensor-01", data: { temperature: 72.4 } });

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2 text-blue-800 dark:text-blue-300">
            <Info className="w-4 h-4" /> HTTP API Ingest Endpoints
          </p>
          <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
            Each API Client has its own endpoint, so traffic and load are attributed per integration.
          </p>
        </div>
        <Link href="/api-clients">
          <Button size="sm" variant="outline" className="shrink-0">
            <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Manage clients
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-16 rounded" />)}
        </div>
      ) : ingestClients.length === 0 ? (
        <div className="rounded border border-dashed border-blue-300 dark:border-blue-800/50 bg-white/60 dark:bg-slate-900/50 px-4 py-6 text-center">
          <KeyRound className="w-6 h-6 mx-auto mb-2 text-muted-foreground opacity-40" />
          <p className="text-sm font-medium">No ingest-capable API clients yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Ingest now requires an API key. Create a client with the{" "}
            <code className="bg-muted px-1 rounded">ingest:write</code> scope to get a dedicated
            endpoint for a gateway, SCADA bridge, or project.
          </p>
          <Link href="/api-clients">
            <Button size="sm" className="mt-3">Create an API Client</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {groupedByProject.map(({ project, clients: group }) => (
            <div key={project ?? "__unassigned"} className="space-y-2">
              {/* Group header only when projects are actually in use — a single
                  unassigned bucket would just be noise. */}
              {showProjectHeadings && (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700/70 dark:text-blue-400/70">
                  <FolderOpen className="w-3 h-3" />
                  {project ?? "Not assigned to a project"}
                </p>
              )}
              {group.map((c) => {
            const single = `${BASE_URL}/api/ingest/k/${c.clientId}/payload`;
            const batch  = `${BASE_URL}/api/ingest/k/${c.clientId}/batch`;
            const open   = expanded === c.id;
            return (
              <div key={c.id} className="rounded border border-blue-200 dark:border-blue-800/30 bg-white dark:bg-slate-900 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="text-xs font-medium truncate max-w-[180px]">{c.name}</span>
                  <code className="text-[10px] font-mono text-muted-foreground">{c.clientId}</code>
                  <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
                    <span title="Total requests through this client">
                      <strong className="tabular-nums text-foreground">{(c.totalRequests ?? 0).toLocaleString()}</strong> req
                    </span>
                    <span title="Last request seen">
                      {c.lastUsedAt ? formatDistanceToNow(new Date(c.lastUsedAt), { addSuffix: true }) : "never used"}
                    </span>
                    <button onClick={() => setExpanded(open ? null : c.id)}
                      className="text-muted-foreground hover:text-foreground">
                      {open ? "Hide" : "Show"} endpoints
                    </button>
                  </span>
                </div>

                {open && (
                  <div className="border-t border-blue-200 dark:border-blue-800/30 px-3 py-2 space-y-1.5 bg-blue-50/40 dark:bg-blue-950/10">
                    {[{ label: "Single payload", url: single }, { label: "Batch payloads", url: batch }].map(({ label, url }) => (
                      <div key={url} className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground w-24 shrink-0">{label}</span>
                        <code className="text-[11px] font-mono text-primary flex-1 truncate">{url}</code>
                        <button onClick={() => copy(url)} className="text-muted-foreground hover:text-foreground shrink-0">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[11px] text-muted-foreground w-24 shrink-0">Auth header</span>
                      <code className="text-[11px] font-mono text-foreground/70 flex-1 truncate">
                        X-API-Key: &lt;this client&apos;s secret&gt;
                      </code>
                    </div>
                  </div>
                )}
              </div>
            );
              })}
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="text-xs text-blue-700 dark:text-blue-400 mb-1">Example payload:</p>
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 rounded border border-blue-200 dark:border-blue-800/30 px-2.5 py-1.5">
          <code className="text-xs font-mono text-foreground/80 flex-1">{exPayload}</code>
          <button onClick={() => copy(exPayload)} className="text-muted-foreground hover:text-foreground shrink-0">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-blue-700/80 dark:text-blue-400/80">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        Ingest requires a valid API key with the <code className="bg-white/60 dark:bg-slate-900 px-1 rounded">ingest:write</code> scope.
        Anonymous posting is no longer accepted.
      </p>
    </div>
  );
}

export default function Brokers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { can } = useCurrentUser();

  const { data: brokers } = useListBrokers();
  const createBroker = useCreateBroker();
  const deleteBroker = useDeleteBroker();

  const [statusOverrides, setStatusOverrides] = useState<Record<string, { status: string; timestamp: string }>>({});
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  const handleBrokerStatus = useCallback((raw: unknown) => {
    const ev = raw as { brokerId: string; status: string; timestamp: string };
    setStatusOverrides((prev) => ({ ...prev, [ev.brokerId]: { status: ev.status, timestamp: ev.timestamp } }));
  }, []);

  useWsEvents({ broker_status: handleBrokerStatus });

  const form = useForm({
    defaultValues: {
      name: "", type: "mqtt", endpoint: "",
      mqttTopic: "", mqttUsername: "", mqttPassword: "", mqttClientId: "",
      httpMethod: "POST", httpAuthHeader: "X-API-Key", httpApiKey: "",
    },
  });
  const watchType = form.watch("type");

  function onSubmit(data: any) {
    createBroker.mutate(
      { data: { name: data.name, type: data.type, endpoint: data.endpoint || null } },
      {
        onSuccess: () => {
          toast({ title: "Broker created" });
          qc.invalidateQueries({ queryKey: getListBrokersQueryKey() });
          setOpen(false);
          form.reset();
        },
      }
    );
  }

  const brokerList = (brokers as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Wifi className="w-5 h-5 text-primary" /> Broker Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage MQTT, REST API and HTTP data ingestion brokers
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline">Refresh</Button>
          {can("manage_brokers") && (
            <Button size="sm" onClick={() => setOpen(true)} data-testid="add-broker-btn">
              <Plus className="w-4 h-4 mr-1.5" /> Add
            </Button>
          )}
        </div>
      </div>
      <ReadOnlyBanner permission="manage_brokers" message="cannot add or remove brokers." />

      {/* HTTP Ingest Panel */}
      <IngestEndpointPanel />

      {/* Broker table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-8">
                <input type="checkbox" className="rounded" />
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Endpoint</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Connected Devices</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Total Requests</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Last Edited</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {!brokers ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : brokerList.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  <Wifi className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No brokers configured</p>
                </td>
              </tr>
            ) : (
              brokerList.flatMap((broker: any) => {
                const isExpanded = expandedHistory === broker.id;
                return [
                  <tr key={broker.id}
                    className={cn("border-b border-border/50 hover:bg-muted/30 transition-colors", isExpanded && "bg-muted/20")}
                    data-testid={`broker-row-${broker.id}`}>
                    <td className="px-4 py-3"><input type="checkbox" className="rounded" /></td>
                    <td className="px-4 py-3 font-medium text-primary">{broker.name}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                        {TYPE_LABELS[broker.type] ?? broker.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[160px]">
                      {broker.endpoint ?? "—"}
                    </td>
                    <td className="px-4 py-3">{broker.connectedDevices}</td>
                    <td className="px-4 py-3">{Number(broker.totalRequests).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const ov = statusOverrides[broker.id];
                        const liveStatus = ov?.status ?? broker.status;
                        const isLive = !!ov;
                        return (
                          <div className="flex items-center gap-1.5">
                            <StatusIcon status={liveStatus} />
                            <span className={cn("text-xs capitalize",
                              liveStatus === "connected" ? "text-green-600" : "text-muted-foreground")}>
                              {liveStatus === "connected" ? "Connected" : liveStatus}
                            </span>
                            {isLive && (
                              <span className="text-[9px] font-medium text-primary/60 bg-primary/10 px-1 rounded">live</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {statusOverrides[broker.id]
                        ? <span className="text-primary/70">{formatDistanceToNow(new Date(statusOverrides[broker.id].timestamp), { addSuffix: true })}</span>
                        : format(new Date(broker.updatedAt), "yyyy-MM-dd HH:mm:ss.SSS")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedHistory(isExpanded ? null : broker.id)}
                          className={cn(
                            "flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors",
                            isExpanded
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                          title="Connection history"
                        >
                          <History className="w-3.5 h-3.5" />
                          <ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} />
                        </button>
                        {can("manage_brokers") && (
                          <button className="text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => deleteBroker.mutate({ id: broker.id }, {
                              onSuccess: () => { toast({ title: "Broker deleted" }); qc.invalidateQueries({ queryKey: getListBrokersQueryKey() }); },
                            })}
                            data-testid={`delete-broker-${broker.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={`${broker.id}-history`} className="border-b border-border/50 bg-muted/10">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="flex items-center gap-2 mb-3">
                          <History className="w-4 h-4 text-primary" />
                          <h3 className="text-sm font-semibold">Connection History — {broker.name}</h3>
                          <span className="text-xs text-muted-foreground">(last 50 events)</span>
                        </div>
                        <BrokerHistoryTimeline brokerId={broker.id} brokerName={broker.name} />
                      </td>
                    </tr>
                  ),
                ].filter(Boolean);
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add Broker Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="add-broker-dialog">
          <DialogHeader><DialogTitle>Add Broker</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input {...field} data-testid="broker-name-input" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="broker-type-select"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="mqtt">MQTT</SelectItem>
                        <SelectItem value="rest_api">REST API (Push)</SelectItem>
                        <SelectItem value="http_api">HTTP API (Poll)</SelectItem>
                        <SelectItem value="azure_iot">Azure IoT Hub</SelectItem>
                        <SelectItem value="azure_event_hub">Azure Event Hub</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="endpoint" render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {watchType === "mqtt"     ? "Broker URL" :
                     watchType === "http_api" ? "Polling Endpoint URL" : "Endpoint"}
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={
                      watchType === "mqtt"             ? "mqtt://host:1883" :
                      watchType === "http_api"         ? "https://api.example.com/data" :
                      watchType === "azure_iot"        ? "yourhub.azure-devices.net" :
                      watchType === "azure_event_hub"  ? "Endpoint=sb://yourhub.servicebus.windows.net/..." :
                      "https://..."
                    } {...field} data-testid="broker-endpoint-input" />
                  </FormControl>
                </FormItem>
              )} />

              {/* MQTT-specific fields */}
              {watchType === "mqtt" && (
                <Tabs defaultValue="connection">
                  <TabsList className="h-7 text-xs">
                    <TabsTrigger value="connection" className="text-xs">Connection</TabsTrigger>
                    <TabsTrigger value="auth"       className="text-xs">Auth</TabsTrigger>
                  </TabsList>
                  <TabsContent value="connection" className="space-y-3 mt-3">
                    <FormField control={form.control} name="mqttTopic" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Topic Filter</FormLabel>
                        <FormControl><Input placeholder="sensors/#" {...field} /></FormControl>
                        <FormDescription className="text-xs">MQTT topic to subscribe to (supports wildcards)</FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="mqttClientId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client ID</FormLabel>
                        <FormControl><Input placeholder="iot-platform-client" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </TabsContent>
                  <TabsContent value="auth" className="space-y-3 mt-3">
                    <FormField control={form.control} name="mqttUsername" render={({ field }) => (
                      <FormItem><FormLabel>Username</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="mqttPassword" render={({ field }) => (
                      <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl></FormItem>
                    )} />
                  </TabsContent>
                </Tabs>
              )}

              {/* HTTP API specific fields */}
              {watchType === "http_api" && (
                <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground">HTTP API Configuration</p>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="httpMethod" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Method</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="GET">GET</SelectItem>
                            <SelectItem value="POST">POST</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="httpAuthHeader" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Auth Header</FormLabel>
                        <FormControl><Input placeholder="X-API-Key" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="httpApiKey" render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Key / Token</FormLabel>
                      <FormControl><Input type="password" placeholder="sk-..." {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <div className="rounded-sm bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-400 px-2.5 py-1.5">
                    The platform will poll this endpoint and forward the response to the ingest pipeline.
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createBroker.isPending} data-testid="save-broker-btn">Add</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
