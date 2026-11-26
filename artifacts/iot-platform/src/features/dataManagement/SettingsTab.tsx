import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { useT } from "@/i18n";
import { Save } from "lucide-react";
import { ErrorLine, getJson, send } from "./shared";

export interface DataSettings {
  alerts: { diskFreePctBelow: number; daysUntilFullBelow: number; backupMaxAgeHours: number; summariesBehindHours: number; rejectionsPerHourAbove: number; quietAssets: boolean; webhookUrl: string | null; webhookSet?: boolean };
  pruneWindow: { enabled: boolean; start: string; end: string };
  approval: { enabled: boolean; thresholdRows: number };
  archive: { enabled: boolean };
  tiers: { m15Days: number; hourDays: number | null };
  health: { quietMinutes: number };
}

function Num({ label, value, onChange, suffix, hint, min = 0, max }: { label: string; value: number; onChange: (n: number) => void; suffix?: string; hint?: string; min?: number; max?: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input type="number" className="h-8 text-sm w-32" min={min} max={max} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <Card><CardContent className="pt-4 pb-4 space-y-3">
      <div><h3 className="text-sm font-medium">{title}</h3><p className="text-xs text-muted-foreground">{hint}</p></div>
      {children}
    </CardContent></Card>
  );
}

export function SettingsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canAction, can } = useCurrentUser();
  const t = useT();
  // Settings guard deletions, so changing them needs approve_data_changes (administrators).
  const canManage = canAction("manage_assets", "data_management") && can("approve_data_changes");
  const q = useQuery({ queryKey: ["system/data-settings"], queryFn: () => getJson<DataSettings>("/api/system/data-settings"), retry: 1 });
  const [d, setD] = useState<DataSettings | null>(null);
  const [webhook, setWebhook] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (q.data) { setD(structuredClone(q.data)); setWebhook(q.data.alerts.webhookUrl ?? ""); } }, [q.data]);

  if (q.isError) return <ErrorLine error={q.error} onRetry={() => q.refetch()} />;
  if (!d) return <p className="text-xs text-muted-foreground">Loading…</p>;
  const set = <K extends keyof DataSettings>(k: K, v: Partial<DataSettings[K]>) => setD({ ...d, [k]: { ...d[k], ...v } });
  const numbersOk = [d.alerts.diskFreePctBelow, d.alerts.daysUntilFullBelow, d.alerts.backupMaxAgeHours, d.alerts.summariesBehindHours, d.alerts.rejectionsPerHourAbove, d.approval.thresholdRows, d.tiers.m15Days, d.health.quietMinutes].every(Number.isFinite)
    && (d.tiers.hourDays === null || Number.isFinite(d.tiers.hourDays));
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(d.pruneWindow.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.pruneWindow.end);

  async function save() {
    if (!d) return;
    setSaving(true);
    try {
      const { webhookSet: _w, webhookUrl: _u, ...alerts } = d.alerts;
      const body = { ...d, alerts: { ...alerts, ...(webhook !== (q.data?.alerts.webhookUrl ?? "") ? { webhookUrl: webhook.trim() || null } : {}) } };
      const r = await send<{ pendingApproval?: boolean }>("PUT", "/api/system/data-settings", body);
      if (r.status === 202 && r.data.pendingApproval) toast({ title: t("Partly waiting for approval"), description: t("Changes that weaken the deletion safeguards wait for a second administrator under Retention > Waiting for approval. The other changes are saved.") });
      else toast({ title: "Settings saved" });
      for (const k of ["system/data-settings", "system/storage", "system/archives", "system/alerts"]) qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      toast({ title: "Not saved", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <fieldset disabled={!canManage} className="space-y-4">
        <Block title="Alerts" hint="Checked every 10 minutes. An alert shows in the bell and on the Overview, is written to the activity log, and goes to the webhook if one is set. Set a value to 0 to switch that check off.">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Num label="Free disk space below" value={d.alerts.diskFreePctBelow} onChange={(n) => set("alerts", { diskFreePctBelow: n })} suffix="%" max={90} />
            <Num label="Disk full within" value={d.alerts.daysUntilFullBelow} onChange={(n) => set("alerts", { daysUntilFullBelow: n })} suffix="days" />
            <Num label="No good backup for" value={d.alerts.backupMaxAgeHours} onChange={(n) => set("alerts", { backupMaxAgeHours: n })} suffix="hours" />
            <Num label="Summaries behind by" value={d.alerts.summariesBehindHours} onChange={(n) => set("alerts", { summariesBehindHours: n })} suffix="hours" />
            <Num label="Refused ingest requests per hour above" value={d.alerts.rejectionsPerHourAbove} onChange={(n) => set("alerts", { rejectionsPerHourAbove: n })} />
            <div className="space-y-1"><Label className="text-xs">Assets that stop sending</Label>
              <label className="flex items-center gap-2 text-xs h-8"><Switch checked={d.alerts.quietAssets} onCheckedChange={(v) => set("alerts", { quietAssets: v })} /> Alert</label></div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Webhook URL (optional)</Label>
            <Input className="h-8 text-sm font-mono" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.example.com/…" />
            <p className="text-[11px] text-muted-foreground">Receives a JSON POST when an alert is raised or cleared (works with Teams, Slack or your own service through a relay). Email, SMS and WhatsApp delivery do not exist in the platform yet, so Notification Groups cannot receive these alerts.</p>
          </div>
        </Block>

        <Block title="Data health" hint="When an asset counts as quiet on the Data health tab and for the alert.">
          <Num label="Quiet after" value={d.health.quietMinutes} onChange={(n) => set("health", { quietMinutes: n })} suffix="minutes without a reading" min={5} />
        </Block>

        <Block title="Pruning window" hint="Limit the hourly deletion of readings to quiet hours (plant time). Other records are still pruned every hour. Run pruning now is not limited.">
          <label className="flex items-center gap-2 text-xs"><Switch checked={d.pruneWindow.enabled} onCheckedChange={(v) => set("pruneWindow", { enabled: v })} /> Only prune readings between</label>
          <div className="flex items-center gap-2">
            <Input type="time" className="h-8 text-sm w-32" value={d.pruneWindow.start} onChange={(e) => set("pruneWindow", { start: e.target.value })} />
            <span className="text-xs">and</span>
            <Input type="time" className="h-8 text-sm w-32" value={d.pruneWindow.end} onChange={(e) => set("pruneWindow", { end: e.target.value })} />
          </div>
        </Block>

        <Block title="Approval of large deletions" hint="When on, bad-data removals, manual pruning runs and policy changes that would delete more readings than the limit wait until a second administrator approves them.">
          <label className="flex items-center gap-2 text-xs"><Switch checked={d.approval.enabled} onCheckedChange={(v) => set("approval", { enabled: v })} /> Require a second administrator</label>
          <Num label="Above" value={d.approval.thresholdRows} onChange={(n) => set("approval", { thresholdRows: n })} suffix="readings (0 = every deletion)" />
          <p className="text-[11px] text-muted-foreground">Needs at least two administrators with the Approve data changes permission. While it is on, switching it off, raising the limit, switching archiving off or keeping summaries for less time also waits for a second administrator. The hourly run of already approved policies does not need approval.</p>
        </Block>

        <Block title="Archive before delete" hint="Write each day of raw readings to a compressed file before pruning may delete it. Pruning waits while archiving fails. The first run archives every day up to the oldest cutoff, which can take a while and needs disk space (roughly a fifth of the table size).">
          <label className="flex items-center gap-2 text-xs"><Switch checked={d.archive.enabled} onCheckedChange={(v) => set("archive", { enabled: v })} /> Archive before delete</label>
          <p className="text-[11px] text-muted-foreground">Files go to the folder set by ARCHIVE_DIR on the server (default var/archives). Mount a network share or object storage there to keep them off the server.</p>
        </Block>

        <Block title="Summary levels" hint="Summaries keep long-term charts after raw readings are deleted. Charts with 15-minute steps use 15-minute summaries; 1-hour steps and longer use hourly ones.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Num label="Keep 15-minute summaries" value={d.tiers.m15Days} onChange={(n) => set("tiers", { m15Days: n })} suffix="days (0 = do not build)" />
            <div className="space-y-1">
              <Label className="text-xs">Keep hourly summaries</Label>
              <div className="flex items-center gap-2">
                <Input type="number" className="h-8 text-sm w-32" min={0} value={d.tiers.hourDays ?? ""} placeholder="server default" onChange={(e) => set("tiers", { hourDays: e.target.value === "" ? null : Number(e.target.value) })} />
                <span className="text-xs text-muted-foreground">days (empty = RETENTION_ROLLUP_DAYS, 0 = for ever)</span>
              </div>
            </div>
          </div>
        </Block>
      </fieldset>
      {canManage ? (
        <div className="flex items-center gap-3">
          <Button size="sm" className="gap-1.5" disabled={saving || !numbersOk || !timeOk} onClick={save}><Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save settings"}</Button>
          {(!numbersOk || !timeOk) && <span className="text-xs text-red-500">Fill in every number, and times as HH:MM.</span>}
        </div>
      ) : <p className="text-xs text-muted-foreground">Changing settings needs the Manage assets permission.</p>}
    </div>
  );
}
