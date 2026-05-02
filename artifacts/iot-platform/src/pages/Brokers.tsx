import { useState } from "react";
import {
  useListBrokers, useCreateBroker, useDeleteBroker, getListBrokersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, CheckCircle2, XCircle, AlertCircle, Wifi, Copy, Info } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

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

function IngestEndpointPanel() {
  const { toast } = useToast();
  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  }
  const singleUrl  = `${BASE_URL}/api/ingest/payload`;
  const batchUrl   = `${BASE_URL}/api/ingest/batch`;
  const exPayload  = JSON.stringify({ deviceId: "sensor-01", data: { temperature: 72.4 } });

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2 text-blue-800 dark:text-blue-300">
        <Info className="w-4 h-4" /> HTTP API Ingest Endpoints
      </p>
      <p className="text-xs text-blue-700 dark:text-blue-400">
        External systems (Node-RED, custom scripts, SCADA) can push data directly to these endpoints using HTTP POST.
      </p>
      <div className="space-y-2">
        {[
          { label: "Single payload", url: singleUrl },
          { label: "Batch payloads", url: batchUrl  },
        ].map(({ label, url }) => (
          <div key={url} className="flex items-center gap-2 bg-white dark:bg-slate-900 rounded border border-blue-200 dark:border-blue-800/30 px-2.5 py-1.5">
            <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
            <code className="text-xs font-mono text-primary flex-1 truncate">{url}</code>
            <button onClick={() => copy(url)} className="text-muted-foreground hover:text-foreground shrink-0">
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div>
        <p className="text-xs text-blue-700 dark:text-blue-400 mb-1">Example payload:</p>
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 rounded border border-blue-200 dark:border-blue-800/30 px-2.5 py-1.5">
          <code className="text-xs font-mono text-foreground/80 flex-1">{exPayload}</code>
          <button onClick={() => copy(exPayload)} className="text-muted-foreground hover:text-foreground shrink-0">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Brokers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: brokers } = useListBrokers();
  const createBroker = useCreateBroker();
  const deleteBroker = useDeleteBroker();

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
          <Button size="sm" onClick={() => setOpen(true)} data-testid="add-broker-btn">
            <Plus className="w-4 h-4 mr-1.5" /> Add
          </Button>
        </div>
      </div>

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
              brokerList.map((broker: any) => (
                <tr key={broker.id}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors"
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
                    <div className="flex items-center gap-1.5">
                      <StatusIcon status={broker.status} />
                      <span className={cn("text-xs capitalize",
                        broker.status === "connected" ? "text-green-600" : "text-muted-foreground")}>
                        {broker.status === "connected" ? "Connected" : broker.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {format(new Date(broker.updatedAt), "yyyy-MM-dd HH:mm:ss.SSS")}
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => deleteBroker.mutate({ id: broker.id }, {
                        onSuccess: () => { toast({ title: "Broker deleted" }); qc.invalidateQueries({ queryKey: getListBrokersQueryKey() }); },
                      })}
                      data-testid={`delete-broker-${broker.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
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
