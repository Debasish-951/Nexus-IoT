import { useState } from "react";
import {
  useListBrokers,
  useCreateBroker,
  useDeleteBroker,
  getListBrokersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, CheckCircle2, XCircle, AlertCircle, Wifi } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  mqtt: "MQTT",
  rest_api: "Broker Rest Api",
  azure_iot: "Azure IoT Hub",
  azure_event_hub: "Azure Event Hub",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "connected") return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
  if (status === "error") return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
  return <XCircle className="w-3.5 h-3.5 text-muted-foreground" />;
}

export default function Brokers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: brokers } = useListBrokers();
  const createBroker = useCreateBroker();
  const deleteBroker = useDeleteBroker();

  const form = useForm({ defaultValues: { name: "", type: "mqtt", endpoint: "" } });

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
          <h1 className="text-xl font-semibold flex items-center gap-2"><Wifi className="w-5 h-5 text-primary" />Broker Management</h1>
          <p className="text-sm text-muted-foreground">Manage MQTT and REST API data ingestion brokers</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline">Refresh</Button>
          <Button size="sm" variant="outline">Filter</Button>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="add-broker-btn"><Plus className="w-4 h-4 mr-1.5" /> Add</Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-8"><input type="checkbox" className="rounded" /></th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
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
                  {Array.from({ length: 8 }).map((__, j) => (<td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>))}
                </tr>
              ))
            ) : brokerList.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground"><Wifi className="w-8 h-8 mx-auto mb-2 opacity-30" />No brokers configured</td></tr>
            ) : (
              brokerList.map((broker: any) => (
                <tr key={broker.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`broker-row-${broker.id}`}>
                  <td className="px-4 py-3"><input type="checkbox" className="rounded" /></td>
                  <td className="px-4 py-3 font-medium text-primary">{broker.name}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{TYPE_LABELS[broker.type] ?? broker.type}</td>
                  <td className="px-4 py-3">{broker.connectedDevices}</td>
                  <td className="px-4 py-3">{Number(broker.totalRequests).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusIcon status={broker.status} />
                      <span className={cn("text-xs capitalize", broker.status === "connected" ? "text-green-600" : "text-muted-foreground")}>
                        {broker.status === "connected" ? "Connected" : broker.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{format(new Date(broker.updatedAt), "yyyy-MM-dd HH:mm:ss.SSS")}</td>
                  <td className="px-4 py-3">
                    <button className="text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => deleteBroker.mutate({ id: broker.id }, { onSuccess: () => { toast({ title: "Broker deleted" }); qc.invalidateQueries({ queryKey: getListBrokersQueryKey() }); } })}
                      data-testid={`delete-broker-${broker.id}`}
                    ><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="add-broker-dialog">
          <DialogHeader><DialogTitle>Add Broker</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name *</FormLabel><FormControl><Input {...field} data-testid="broker-name-input" /></FormControl></FormItem>)} />
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem><FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger data-testid="broker-type-select"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="mqtt">MQTT</SelectItem><SelectItem value="rest_api">Broker Rest Api</SelectItem><SelectItem value="azure_iot">Azure IoT Hub</SelectItem><SelectItem value="azure_event_hub">Azure Event Hub</SelectItem></SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="endpoint" render={({ field }) => (<FormItem><FormLabel>Endpoint</FormLabel><FormControl><Input placeholder="mqtt://host:1883 or https://..." {...field} data-testid="broker-endpoint-input" /></FormControl></FormItem>)} />
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
