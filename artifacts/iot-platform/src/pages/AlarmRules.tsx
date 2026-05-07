import { useState, useEffect } from "react";
import {
  useListAlarmRules, useCreateAlarmRule, useDeleteAlarmRule,
  useUpdateAlarmRule, getListAlarmRulesQueryKey,
  useListAssets, useListAssetAttributes,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useForm, Controller } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Settings2, Plus, Trash2, Webhook, AlertTriangle, TrendingUp,
  CheckCircle2, Loader2, ExternalLink, Mail, MessageCircle, MessageSquareText, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400",
  high:     "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400",
  medium:   "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400",
  low:      "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400",
  info:     "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400",
};

const TYPE_LABELS: Record<string, string> = {
  threshold:      "Threshold",
  deviation:      "Deviation",
  rate_of_change: "Rate of Change",
  heartbeat:      "Heartbeat",
};

export default function AlarmRules() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any | null>(null);
  const [testingWebhook, setTestingWebhook] = useState<string | null>(null);
  const { can } = useCurrentUser();

  const { data: rules } = useListAlarmRules();
  const { data: assets } = useListAssets();
  const createRule = useCreateAlarmRule();
  const deleteRule = useDeleteAlarmRule();
  const updateRule = useUpdateAlarmRule();

  const form = useForm({
    defaultValues: {
      name: "", description: "", alarmType: "threshold", severity: "medium",
      metric: "", operator: "gt", threshold: "", deadband: "",
      onDelay: "0", offDelay: "0", scanRate: "2",
      rocWindow: "60",
      enabled: true, requireAcknowledge: true,
      webhookUrl: "", webhookEnabled: false,
      emailEnabled: false, whatsappEnabled: false, smsEnabled: false,
      assetId: "",
    },
  });

  function openEdit(rule: any) {
    setEditingRule(rule);
    form.reset({
      name:              rule.name ?? "",
      description:       rule.description ?? "",
      alarmType:         rule.alarmType ?? "threshold",
      severity:          rule.severity ?? "medium",
      assetId:           rule.assetId ?? "",
      metric:            rule.metric ?? "",
      operator:          rule.operator ?? "gt",
      threshold:         rule.threshold != null ? String(rule.threshold) : "",
      deadband:          rule.deadband  != null ? String(rule.deadband)  : "",
      onDelay:           rule.onDelay   != null ? String(rule.onDelay)   : "0",
      offDelay:          rule.offDelay  != null ? String(rule.offDelay)  : "0",
      scanRate:          rule.scanRate  != null ? String(rule.scanRate)  : "2",
      rocWindow:         rule.rocWindow != null ? String(rule.rocWindow) : "60",
      enabled:           rule.enabled ?? true,
      requireAcknowledge:rule.requireAcknowledge ?? true,
      webhookUrl:        rule.webhookUrl ?? "",
      webhookEnabled:    rule.webhookEnabled ?? false,
      emailEnabled:      rule.emailEnabled ?? false,
      whatsappEnabled:   rule.whatsappEnabled ?? false,
      smsEnabled:        rule.smsEnabled ?? false,
    });
    setOpen(true);
  }

  function openCreate() {
    setEditingRule(null);
    form.reset({
      name: "", description: "", alarmType: "threshold", severity: "medium",
      metric: "", operator: "gt", threshold: "", deadband: "",
      onDelay: "0", offDelay: "0", scanRate: "2", rocWindow: "60",
      enabled: true, requireAcknowledge: true,
      webhookUrl: "", webhookEnabled: false,
      emailEnabled: false, whatsappEnabled: false, smsEnabled: false,
      assetId: "",
    });
    setOpen(true);
  }

  const watchAlarmType = form.watch("alarmType");
  const watchWebhookEnabled = form.watch("webhookEnabled");
  const watchAssetId = form.watch("assetId" as any) as string;
  const { data: assetAttributes } = useListAssetAttributes(watchAssetId ?? "", {
    query: { enabled: !!watchAssetId, queryKey: ["alarm-rule-asset-attributes", watchAssetId] },
  });
  const [telemetryMetricKeys, setTelemetryMetricKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!watchAssetId) { setTelemetryMetricKeys([]); return; }
    fetch(`/api/telemetry/${watchAssetId}/metrics`, { credentials: "include" })
      .then(r => r.ok ? r.json() : []).then(setTelemetryMetricKeys).catch(() => setTelemetryMetricKeys([]));
  }, [watchAssetId]);
  const attrList = (assetAttributes as any[] | undefined) ?? [];
  function attrLabelForKey(key: string) {
    const m = attrList.find((a: any) => {
      const tag = a.tagName ?? a.sourceMetric ?? ""; if (!tag) return false;
      return tag === key || tag.split(".").slice(1).join(".") === key;
    });
    return m ? `${m.name} (${key})` : key;
  }
  const attributeOptions: Array<{ key: string; label: string }> = telemetryMetricKeys.length > 0
    ? telemetryMetricKeys.map(k => ({ key: k, label: attrLabelForKey(k) }))
    : attrList.filter((a: any) => a.tagName ?? a.sourceMetric).map((a: any) => ({
        key: a.tagName ?? a.sourceMetric ?? a.name,
        label: a.name,
      }));

  function buildPayload(data: any) {
    return {
      name: data.name, description: data.description || null,
      alarmType: data.alarmType, severity: data.severity,
      assetId: data.assetId || null,
      metric: data.metric || null, operator: data.operator || null,
      threshold: data.threshold ? Number(data.threshold) : null,
      deadband: data.deadband ? Number(data.deadband) : null,
      onDelay: data.onDelay ? Number(data.onDelay) : null,
      offDelay: data.offDelay ? Number(data.offDelay) : null,
      scanRate: data.scanRate ? Number(data.scanRate) : 2,
      enabled: data.enabled, requireAcknowledge: data.requireAcknowledge,
      ...(data.rocWindow ? { rocWindow: Number(data.rocWindow) } : {}),
      ...(data.webhookUrl ? { webhookUrl: data.webhookUrl } : {}),
      webhookEnabled: data.webhookEnabled,
      emailEnabled: data.emailEnabled,
      whatsappEnabled: data.whatsappEnabled,
      smsEnabled: data.smsEnabled,
    } as any;
  }

  function onSubmit(data: any) {
    if (editingRule) {
      updateRule.mutate({ id: editingRule.id, data: buildPayload(data) }, {
        onSuccess: () => {
          toast({ title: "Alarm rule updated" });
          qc.invalidateQueries({ queryKey: getListAlarmRulesQueryKey() });
          setOpen(false); setEditingRule(null); form.reset();
        },
      });
    } else {
      createRule.mutate({ data: buildPayload(data) }, {
        onSuccess: () => {
          toast({ title: "Alarm rule created" });
          qc.invalidateQueries({ queryKey: getListAlarmRulesQueryKey() });
          setOpen(false); form.reset();
        },
      });
    }
  }

  async function testWebhook(ruleId: string) {
    setTestingWebhook(ruleId);
    try {
      const res = await fetch(`/api/alarm-rules/${ruleId}/test-webhook`, { method: "POST" });
      const data = await res.json();
      if (data.success) toast({ title: "Webhook test succeeded", description: `HTTP ${data.statusCode}` });
      else toast({ title: "Webhook test failed", description: data.error ?? `HTTP ${data.statusCode}`, variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Webhook test failed", description: e.message, variant: "destructive" });
    } finally { setTestingWebhook(null); }
  }

  const ruleList = (rules as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" /> Alarm Rules
          </h1>
          <p className="text-sm text-muted-foreground">Configure threshold, rate-of-change, and event-based alarm conditions</p>
        </div>
        {can("manage_alarms") && <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1.5" /> Add Rule</Button>}
      </div>
      <ReadOnlyBanner permission="manage_alarms" message="cannot create, edit, or delete alarm rules." />

      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Severity</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Metric</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Condition</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Webhook</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Enabled</th>
              <th className="px-4 py-2.5 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {!rules ? Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="border-b border-border/50">
                {Array.from({ length: 8 }).map((__, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>)}
              </tr>
            )) : ruleList.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                <Settings2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No alarm rules configured</p>
              </td></tr>
            ) : ruleList.map((rule: any) => (
              <tr key={rule.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                <td className="px-4 py-3 font-medium">
                  <div>{rule.name}</div>
                  {rule.description && <div className="text-xs text-muted-foreground">{rule.description}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {rule.alarmType === "rate_of_change" && <TrendingUp className="w-3 h-3" />}
                    {TYPE_LABELS[rule.alarmType] ?? rule.alarmType}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", SEVERITY_STYLES[rule.severity] ?? "bg-muted")}>
                    {rule.severity}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{rule.metric ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {rule.threshold != null ? (
                    <span>
                      {rule.operator} {rule.threshold}
                      {rule.alarmType === "rate_of_change" && rule.rocWindow && (
                        <span className="text-muted-foreground ml-1">/ {rule.rocWindow}s</span>
                      )}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3">
                  {rule.webhookEnabled && rule.webhookUrl ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <Webhook className="w-3 h-3" /> Active
                    </span>
                  ) : rule.webhookUrl ? (
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Webhook className="w-3 h-3" /> Disabled</span>
                  ) : (
                    <span className="text-xs text-muted-foreground/40">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Switch checked={rule.enabled} disabled={!can("manage_alarms")}
                    onCheckedChange={(checked) => updateRule.mutate({ id: rule.id, data: { enabled: checked } as any },
                      { onSuccess: () => qc.invalidateQueries({ queryKey: getListAlarmRulesQueryKey() }) })}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {rule.webhookUrl && (
                      <button
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Test webhook"
                        disabled={testingWebhook === rule.id}
                        onClick={() => testWebhook(rule.id)}
                      >
                        {testingWebhook === rule.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Webhook className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {can("manage_alarms") && (<>
                      <button className="text-muted-foreground hover:text-primary transition-colors"
                        title="Edit rule"
                        onClick={() => openEdit(rule)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete rule"
                        onClick={() => deleteRule.mutate({ id: rule.id }, {
                          onSuccess: () => { toast({ title: "Rule deleted" }); qc.invalidateQueries({ queryKey: getListAlarmRulesQueryKey() }); }
                        })}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setEditingRule(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit Alarm Rule" : "Add Alarm Rule"}</DialogTitle>
            <DialogDescription>Configure when an alarm should trigger and choose how notifications are delivered.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <Tabs defaultValue="alarm">
                <TabsList><TabsTrigger value="alarm">Alarm</TabsTrigger><TabsTrigger value="message">Notifications</TabsTrigger></TabsList>

                <TabsContent value="alarm" className="space-y-4 mt-4">
                  <FormField control={form.control as any} name={"assetId" as any} render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asset</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {(((assets as any[] | undefined) ?? [])).map((asset: any) => (
                            <SelectItem key={asset.id} value={asset.id}>{asset.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem><FormLabel>Name *</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="severity" render={({ field }) => (
                      <FormItem><FormLabel>Severity *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem>
                            <SelectItem value="info">Info</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="alarmType" render={({ field }) => (
                      <FormItem><FormLabel>Alarm Type *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="threshold">Threshold</SelectItem>
                            <SelectItem value="deviation">Deviation</SelectItem>
                            <SelectItem value="rate_of_change">Rate of Change</SelectItem>
                            <SelectItem value="heartbeat">Heartbeat</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="metric" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Signal / Metric</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select attribute" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {attributeOptions.length === 0
                              ? <SelectItem value="__none__" disabled>{watchAssetId ? "No telemetry found — ingest data first" : "Select an asset first"}</SelectItem>
                              : attributeOptions.map(({ key, label }) => <SelectItem key={key} value={key}>{label}</SelectItem>)
                            }
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>

                  {watchAlarmType === "rate_of_change" && (
                    <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-3 text-xs">
                      <p className="font-medium text-blue-800 dark:text-blue-300 mb-1 flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5" /> Rate of Change
                      </p>
                      <p className="text-blue-700 dark:text-blue-400">
                        Triggers when the absolute change per second exceeds the threshold over the window period.
                        E.g. threshold=5 with window=60s fires if value changes by more than 5 units/second.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4">
                    <FormField control={form.control} name="operator" render={({ field }) => (
                      <FormItem><FormLabel>Operator</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="gt">&gt; greater than</SelectItem>
                            <SelectItem value="lt">&lt; less than</SelectItem>
                            <SelectItem value="gte">&gt;= gte</SelectItem>
                            <SelectItem value="lte">&lt;= lte</SelectItem>
                            <SelectItem value="eq">= equal</SelectItem>
                            <SelectItem value="ne">!= not equal</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="threshold" render={({ field }) => (
                      <FormItem><FormLabel>Threshold</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                    )} />
                    {watchAlarmType === "rate_of_change" ? (
                      <FormField control={form.control} name="rocWindow" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Window (seconds)</FormLabel>
                          <FormControl><Input type="number" min="1" {...field} /></FormControl>
                          <FormDescription className="text-xs">Time window for ROC calculation</FormDescription>
                        </FormItem>
                      )} />
                    ) : (
                      <FormField control={form.control} name="deadband" render={({ field }) => (
                        <FormItem><FormLabel>Deadband</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                      )} />
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <FormField control={form.control} name="onDelay" render={({ field }) => (
                      <FormItem><FormLabel>On Delay (s)</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="offDelay" render={({ field }) => (
                      <FormItem><FormLabel>Off Delay (s)</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="scanRate" render={({ field }) => (
                      <FormItem><FormLabel>Scan Rate (s)</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="2">2 seconds</SelectItem><SelectItem value="5">5 seconds</SelectItem>
                            <SelectItem value="10">10 seconds</SelectItem><SelectItem value="30">30 seconds</SelectItem>
                            <SelectItem value="60">60 seconds</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Controller control={form.control} name="requireAcknowledge" render={({ field }) => (
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    )} />
                    <Label className="text-sm">Require Acknowledge</Label>
                  </div>
                </TabsContent>

                <TabsContent value="message" className="mt-4 space-y-4">
                  <div className="rounded-md bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
                    Choose one or more delivery channels for alarm events.
                  </div>

                  {[
                    { name: "webhookEnabled", label: "Webhook", icon: Webhook, desc: "Deliver HTTP POST on trigger and clear" },
                    { name: "emailEnabled", label: "Email", icon: Mail, desc: "Send an email notification" },
                    { name: "whatsappEnabled", label: "WhatsApp", icon: MessageCircle, desc: "Send a WhatsApp alert" },
                    { name: "smsEnabled", label: "Text Message", icon: MessageSquareText, desc: "Send an SMS alert" },
                  ].map(({ name, label, icon: Icon, desc }) => (
                    <div key={name} className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-medium flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 text-primary" /> Enable {label}
                        </Label>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                      <Controller control={form.control} name={name as any} render={({ field }) => (
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      )} />
                    </div>
                  ))}

                  <FormField control={form.control} name="webhookUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Webhook URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://hooks.example.com/alarm" type="url" {...field}
                          disabled={!watchWebhookEnabled} />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Receives a JSON POST with: event, ruleName, metric, value, severity, assetId, timestamp
                      </FormDescription>
                    </FormItem>
                  )} />

                  {watchWebhookEnabled && (
                    <div className="rounded-md bg-muted/30 border border-border p-3">
                      <p className="text-xs font-medium mb-2">Payload preview</p>
                      <pre className="text-xs text-muted-foreground overflow-auto">{JSON.stringify({
                        event: "triggered",
                        ruleName: form.watch("name") || "My Rule",
                        metric: form.watch("metric") || "temperature",
                        value: 87.3,
                        threshold: Number(form.watch("threshold")) || 80,
                        severity: form.watch("severity"),
                        assetId: "...", assetName: "Fan",
                        timestamp: new Date().toISOString(),
                      }, null, 2)}</pre>
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setOpen(false); setEditingRule(null); form.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createRule.isPending || updateRule.isPending}>
                  {editingRule ? "Update Rule" : "Add Rule"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
