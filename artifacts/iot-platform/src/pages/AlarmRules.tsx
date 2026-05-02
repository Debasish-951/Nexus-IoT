import { useState } from "react";
import {
  useListAlarmRules,
  useCreateAlarmRule,
  useDeleteAlarmRule,
  useUpdateAlarmRule,
  getListAlarmRulesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useForm, Controller } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Settings2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
  info: "bg-blue-100 text-blue-700 border-blue-200",
};

export default function AlarmRules() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: rules } = useListAlarmRules();
  const createRule = useCreateAlarmRule();
  const deleteRule = useDeleteAlarmRule();
  const updateRule = useUpdateAlarmRule();

  const form = useForm({
    defaultValues: { name: "", description: "", alarmType: "threshold", severity: "medium", metric: "", operator: "gt", threshold: "", deadband: "", onDelay: "0", offDelay: "0", scanRate: "2", enabled: true, requireAcknowledge: true },
  });

  function onSubmit(data: any) {
    createRule.mutate(
      { data: { name: data.name, description: data.description || null, alarmType: data.alarmType, severity: data.severity, metric: data.metric || null, operator: data.operator || null, threshold: data.threshold ? Number(data.threshold) : null, deadband: data.deadband ? Number(data.deadband) : null, onDelay: data.onDelay ? Number(data.onDelay) : null, offDelay: data.offDelay ? Number(data.offDelay) : null, scanRate: data.scanRate ? Number(data.scanRate) : 2, enabled: data.enabled, requireAcknowledge: data.requireAcknowledge } },
      {
        onSuccess: () => {
          toast({ title: "Alarm rule created" });
          qc.invalidateQueries({ queryKey: getListAlarmRulesQueryKey() });
          setOpen(false);
          form.reset();
        },
      }
    );
  }

  const ruleList = (rules as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Settings2 className="w-5 h-5 text-primary" />Alarm Rules</h1>
          <p className="text-sm text-muted-foreground">Configure threshold and event-based alarm conditions</p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm" data-testid="add-rule-btn"><Plus className="w-4 h-4 mr-1.5" /> Add Rule</Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Severity</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Metric</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Threshold</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Scan Rate</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Enabled</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {!rules ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 8 }).map((__, j) => (<td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>))}
                </tr>
              ))
            ) : ruleList.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground"><Settings2 className="w-8 h-8 mx-auto mb-2 opacity-30" />No alarm rules configured</td></tr>
            ) : (
              ruleList.map((rule: any) => (
                <tr key={rule.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`rule-row-${rule.id}`}>
                  <td className="px-4 py-3 font-medium">{rule.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{rule.alarmType.replace("_", " ")}</td>
                  <td className="px-4 py-3"><span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", SEVERITY_STYLES[rule.severity] ?? "bg-muted")}>{rule.severity}</span></td>
                  <td className="px-4 py-3 font-mono text-xs">{rule.metric ?? "-"}</td>
                  <td className="px-4 py-3 text-xs">{rule.threshold != null ? `${rule.operator ?? ""} ${rule.threshold}` : "-"}</td>
                  <td className="px-4 py-3 text-xs">{rule.scanRate != null ? `${rule.scanRate}s` : "-"}</td>
                  <td className="px-4 py-3">
                    <Switch checked={rule.enabled}
                      onCheckedChange={(checked) => updateRule.mutate({ id: rule.id, data: { enabled: checked } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListAlarmRulesQueryKey() }) })}
                      data-testid={`rule-enabled-${rule.id}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => deleteRule.mutate({ id: rule.id }, { onSuccess: () => { toast({ title: "Rule deleted" }); qc.invalidateQueries({ queryKey: getListAlarmRulesQueryKey() }); } })}
                      data-testid={`delete-rule-${rule.id}`}
                    ><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" data-testid="add-rule-dialog">
          <DialogHeader><DialogTitle>Add Alarm Rule</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <Tabs defaultValue="alarm">
                <TabsList><TabsTrigger value="alarm">Alarm</TabsTrigger><TabsTrigger value="message">Message</TabsTrigger></TabsList>
                <TabsContent value="alarm" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name *</FormLabel><FormControl><Input {...field} data-testid="rule-name-input" /></FormControl></FormItem>)} />
                    <FormField control={form.control} name="severity" render={({ field }) => (
                      <FormItem><FormLabel>Severity *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger data-testid="rule-severity-select"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem><SelectItem value="info">Info</SelectItem></SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} data-testid="rule-description-input" /></FormControl></FormItem>)} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="alarmType" render={({ field }) => (
                      <FormItem><FormLabel>Alarm Type *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger data-testid="rule-type-select"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent><SelectItem value="threshold">Threshold</SelectItem><SelectItem value="deviation">Deviation</SelectItem><SelectItem value="rate_of_change">Rate of Change</SelectItem><SelectItem value="heartbeat">Heartbeat</SelectItem></SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="metric" render={({ field }) => (<FormItem><FormLabel>Signal/Metric</FormLabel><FormControl><Input placeholder="e.g. energy_meter_kwh" {...field} data-testid="rule-metric-input" /></FormControl></FormItem>)} />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <FormField control={form.control} name="operator" render={({ field }) => (
                      <FormItem><FormLabel>Operator</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent><SelectItem value="gt">&gt; (greater than)</SelectItem><SelectItem value="lt">&lt; (less than)</SelectItem><SelectItem value="gte">&gt;= (gte)</SelectItem><SelectItem value="lte">&lt;= (lte)</SelectItem><SelectItem value="eq">= (equal)</SelectItem><SelectItem value="ne">!= (not equal)</SelectItem></SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="threshold" render={({ field }) => (<FormItem><FormLabel>Threshold</FormLabel><FormControl><Input type="number" {...field} data-testid="rule-threshold-input" /></FormControl></FormItem>)} />
                    <FormField control={form.control} name="deadband" render={({ field }) => (<FormItem><FormLabel>Deadband</FormLabel><FormControl><Input type="number" {...field} data-testid="rule-deadband-input" /></FormControl></FormItem>)} />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <FormField control={form.control} name="onDelay" render={({ field }) => (<FormItem><FormLabel>On Delay (s)</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>)} />
                    <FormField control={form.control} name="offDelay" render={({ field }) => (<FormItem><FormLabel>Off Delay (s)</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>)} />
                    <FormField control={form.control} name="scanRate" render={({ field }) => (
                      <FormItem><FormLabel>Scan Rate (s)</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent><SelectItem value="2">2 seconds</SelectItem><SelectItem value="5">5 seconds</SelectItem><SelectItem value="10">10 seconds</SelectItem><SelectItem value="30">30 seconds</SelectItem><SelectItem value="60">60 seconds</SelectItem></SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Controller control={form.control} name="requireAcknowledge" render={({ field }) => (<Switch checked={field.value} onCheckedChange={field.onChange} data-testid="rule-require-ack" />)} />
                    <Label className="text-sm">Required Acknowledge</Label>
                  </div>
                </TabsContent>
                <TabsContent value="message" className="mt-4"><p className="text-sm text-muted-foreground">Message configuration coming soon.</p></TabsContent>
              </Tabs>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createRule.isPending} data-testid="save-rule-btn">Add</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
