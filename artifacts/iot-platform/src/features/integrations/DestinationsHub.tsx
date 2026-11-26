import { Fragment, useEffect, useState } from "react";
import { Send, ListChecks, RotateCw, KeyRound, FlaskConical, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { useAssetTree } from "@/components/AssetScopePicker";
import { FEATURES } from "@/lib/features";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import DestinationsClassic from "@/pages/Destinations";
import { HubTabs, PageHead, Stat, Pill, Notice, ErrorLine, OneTimeSecret, AlertsPanel, useJson, send, fmtTime, ago, type Catalog } from "./shared";

/**
 * Integration Hub → Destinations. The original page is the first tab,
 * unchanged. New tabs: Delivery (queued delivery with retries, event
 * subscriptions, project filter, signing) and Delivery log (with resend).
 * A destination stays in "direct" mode, exactly as before, until switched.
 */

interface DestRow {
  id: string; name: string; endpoint: string; enabled: boolean; eventTypes: string[]; authType: string;
  deliveryMode: "direct" | "queued"; signatureEnabled: boolean; hasSigningSecret: boolean; projectId: string | null;
  maxAttempts: number; lastSentAt: string | null; lastError: string | null; sendCount: number;
  stats24h: { delivered: number; pending: number; dead: number; avgMs: number };
}

interface DeliveryRow {
  id: string; destinationId: string; destinationName: string | null; eventId: number; eventType: string; status: "pending" | "delivered" | "dead";
  attempts: number; nextAttemptAt: string; lastStatusCode: number | null; lastError: string | null; durationMs: number | null;
  deliveredAt: string | null; createdAt: string; payload: Record<string, unknown> | null;
}

export default function DestinationsHub() {
  if (FEATURES.classicIntegrationHub) return <DestinationsClassic />;
  return (
    <HubTabs tabs={[{ id: "destinations", label: "Destinations" }, { id: "delivery", label: "Delivery" }, { id: "log", label: "Delivery log" }, { id: "alerts", label: "Alerts" }]}>
      {(tab) => tab === "destinations" ? <DestinationsClassic />
        : <div className="p-6 space-y-4">
            {tab === "delivery" && <DeliveryTab />}
            {tab === "log" && <LogTab />}
            {tab === "alerts" && <><PageHead icon={ShieldAlert} title="Integration alerts" subtitle="Destinations and connectors that are failing" /><AlertsPanel filter={["destination", "connector"]} /></>}
          </div>}
    </HubTabs>
  );
}

// ── Delivery settings ────────────────────────────────────────────────────────

function DeliveryTab() {
  const t = useT();
  const dests = useJson<DestRow[]>("/api/integration/destinations");
  const catalog = useJson<Catalog>("/api/integration/catalog");
  return (
    <>
      <PageHead icon={Send} title="Delivery" subtitle="How each destination receives events: retries, which events, which project, and signatures" />
      <Notice>
        <b>{t("Direct")}</b> {t("is how destinations have always worked: one attempt per alarm, straight from ingest.")}{" "}
        <b>{t("Queued")}</b> {t("adds retries, a delivery log, more event types and resend. Switch one destination at a time and use Send test event to check it.")}
      </Notice>
      <ErrorLine error={dests.error ?? catalog.error} onRetry={dests.reload} />
      {dests.data?.length === 0 && <Notice>{t("No destinations yet. Add one on the Destinations tab.")}</Notice>}
      <div className="space-y-3">
        {dests.data && catalog.data && dests.data.map((d) => <DeliveryCard key={d.id} dest={d} catalog={catalog.data!} onSaved={dests.reload} />)}
      </div>
    </>
  );
}

function DeliveryCard({ dest, catalog, onSaved }: { dest: DestRow; catalog: Catalog; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const { canAction } = useCurrentUser();
  const canEdit = canAction("manage_destinations", "brokers", "write");
  const tree = useAssetTree();
  const [mode, setMode] = useState(dest.deliveryMode);
  const [events, setEvents] = useState<string[]>(dest.eventTypes);
  const [projectId, setProjectId] = useState(dest.projectId ?? "all");
  const [attempts, setAttempts] = useState(String(dest.maxAttempts));
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = [...new Set(catalog.eventTypes.map((e) => e.group))];
  const has = (id: string) => events.includes(id) || events.includes(id.split(".")[0]!) || events.includes("*");
  const toggle = (id: string, on: boolean) => setEvents((cur) => {
    const group = id.split(".")[0]!;
    // Expand a group subscription ("alarm") into its members before removing one of them.
    let list = cur.includes(group) ? [...cur.filter((x) => x !== group), ...catalog.eventTypes.filter((e) => e.group === group).map((e) => e.id)] : [...cur];
    list = on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
    return list;
  });
  const dirty = mode !== dest.deliveryMode || JSON.stringify([...events].sort()) !== JSON.stringify([...dest.eventTypes].sort())
    || (projectId === "all" ? null : projectId) !== dest.projectId || attempts !== String(dest.maxAttempts);
  const queuedOnly = catalog.eventTypes.filter((e) => e.group !== "alarm" || e.id === "alarm.acknowledged").some((e) => events.includes(e.id) || events.includes(e.group));

  const save = async () => {
    setBusy(true);
    try {
      await send("PUT", `/api/integration/destinations/${dest.id}/delivery`, {
        deliveryMode: mode, eventTypes: events, projectId: projectId === "all" ? null : projectId, maxAttempts: Number(attempts),
      });
      toast({ title: t("Delivery settings saved") });
      onSaved();
    } catch (e) { toast({ title: t("Could not save"), description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const signing = async (on: boolean) => {
    try { await send("PUT", `/api/integration/destinations/${dest.id}/delivery`, { signatureEnabled: on }); onSaved(); }
    catch (e) { toast({ title: t("Could not change signing"), description: (e as Error).message, variant: "destructive" }); }
  };
  const newSecret = async () => {
    if (dest.hasSigningSecret && !window.confirm(t("Replace the signing secret? Receivers using the old one will reject signed events until updated."))) return;
    try { const r = await send<{ signingSecret: string }>("POST", `/api/integration/destinations/${dest.id}/signing-secret`); setSecret(r.signingSecret); onSaved(); }
    catch (e) { toast({ title: t("Could not create a secret"), description: (e as Error).message, variant: "destructive" }); }
  };
  const test = async () => {
    try { await send("POST", `/api/integration/destinations/${dest.id}/test-event`); toast({ title: t("Test event queued"), description: t("See the Delivery log tab in a few seconds.") }); }
    catch (e) { toast({ title: t("Could not queue a test"), description: (e as Error).message, variant: "destructive" }); }
  };

  const s = dest.stats24h;
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4 space-y-3", !dest.enabled && "opacity-70")}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold flex items-center gap-2">{dest.name}
            <Pill tone={dest.deliveryMode === "queued" ? "blue" : "grey"}>{t(dest.deliveryMode === "queued" ? "Queued" : "Direct")}</Pill>
            {!dest.enabled && <Pill tone="grey">{t("Disabled")}</Pill>}
            {dest.signatureEnabled && <Pill tone="green">{t("Signed")}</Pill>}
          </div>
          <div className="text-xs text-muted-foreground font-mono truncate">{dest.endpoint}</div>
          <div className="text-xs text-muted-foreground">{t("Last sent")} {ago(dest.lastSentAt)}{dest.lastError ? ` · ${t("last error")}: ${dest.lastError}` : ""}</div>
        </div>
        {dest.deliveryMode === "queued" && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Delivered 24 h" value={s.delivered} tone="ok" />
            <Stat label="Waiting" value={s.pending} tone={s.pending ? "warn" : undefined} />
            <Stat label="Undelivered" value={s.dead} tone={s.dead ? "bad" : undefined} />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <Label className="text-xs">{t("Delivery mode")}</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as DestRow["deliveryMode"])} disabled={!canEdit}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="direct">{t("Direct (original, one attempt)")}</SelectItem>
              <SelectItem value="queued">{t("Queued (retries + log)")}</SelectItem>
            </SelectContent>
          </Select>
          {mode === "queued" && (
            <>
              <Label className="text-xs">{t("Attempts before giving up")}</Label>
              <Input className="h-8" type="number" min={1} max={20} value={attempts} onChange={(e) => setAttempts(e.target.value)} disabled={!canEdit} />
              <p className="text-[11px] text-muted-foreground">{t("Retry waits")}: {catalog.retryScheduleSec.map((x) => x < 60 ? `${x}s` : x < 3600 ? `${x / 60}m` : `${x / 3600}h`).join(", ")}</p>
            </>
          )}
          <Label className="text-xs">{t("Project")}</Label>
          <Select value={projectId} onValueChange={setProjectId} disabled={!canEdit}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All projects")}</SelectItem>
              {tree.roots.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="lg:col-span-2 space-y-2">
          <Label className="text-xs">{t("Events")}</Label>
          <div className="grid sm:grid-cols-3 gap-3">
            {groups.map((g) => (
              <div key={g} className="space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(g)}</div>
                {catalog.eventTypes.filter((e) => e.group === g).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={has(e.id)} disabled={!canEdit} onCheckedChange={(v) => toggle(e.id, v === true)} />{t(e.label)}
                  </label>
                ))}
              </div>
            ))}
          </div>
          {events.includes("telemetry") && <p className="text-[11px] text-muted-foreground">{t("'telemetry' is kept from the original settings; it is not sent by either mode yet.")}</p>}
          {mode === "direct" && queuedOnly && <Notice tone="warn">{t("Direct mode sends alarm raised and cleared only. Switch to queued to receive the other ticked events.")}</Notice>}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm">{t("Sign events (HMAC-SHA256)")}</span>
          <Switch checked={dest.signatureEnabled} disabled={!canEdit || !dest.hasSigningSecret} onCheckedChange={signing} />
          {canEdit && <Button size="sm" variant="outline" className="h-7" onClick={newSecret}>{t(dest.hasSigningSecret ? "New signing secret" : "Create signing secret")}</Button>}
        </div>
        <div className="ml-auto flex gap-2">
          {canEdit && dest.deliveryMode === "queued" && <Button size="sm" variant="outline" onClick={test}><FlaskConical className="w-3.5 h-3.5 mr-1.5" />{t("Send test event")}</Button>}
          {canEdit && <Button size="sm" onClick={save} disabled={!dirty || busy}>{t(busy ? "Saving…" : "Save")}</Button>}
        </div>
      </div>
      {dest.hasSigningSecret && !dest.signatureEnabled && !secret && <p className="text-[11px] text-muted-foreground">{t("A secret exists from the original Destinations form. Turn signing on to use it, or create a new one.")}</p>}
      {secret && <OneTimeSecret label="Signing secret" value={secret} note="Give this to the receiver. It verifies X-Nexus-Signature with it. It will not be shown again." />}
    </div>
  );
}

// ── Delivery log ─────────────────────────────────────────────────────────────

function LogTab() {
  const t = useT();
  const { toast } = useToast();
  const { canAction } = useCurrentUser();
  const canEdit = canAction("manage_destinations", "brokers", "write");
  const dests = useJson<DestRow[]>("/api/integration/destinations");
  const [dest, setDest] = useState("all");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ limit: "200", ...(dest !== "all" ? { destinationId: dest } : {}), ...(status !== "all" ? { status } : {}) }).toString();
  const log = useJson<DeliveryRow[]>(`/api/integration/deliveries?${qs}`);
  useEffect(() => { const id = setInterval(log.reload, 10_000); return () => clearInterval(id); }, [log.reload]);

  const resend = async (id: string) => {
    try { await send("POST", `/api/integration/deliveries/${id}/resend`); toast({ title: t("Queued again") }); log.reload(); }
    catch (e) { toast({ title: t("Could not resend"), description: (e as Error).message, variant: "destructive" }); }
  };
  const resendAll = async () => {
    if (dest === "all") return;
    try { const r = await send<{ resent: number }>("POST", `/api/integration/destinations/${dest}/resend-dead`); toast({ title: t("{n} event(s) queued again", { n: r.resent }) }); log.reload(); }
    catch (e) { toast({ title: t("Could not resend"), description: (e as Error).message, variant: "destructive" }); }
  };

  return (
    <>
      <PageHead icon={ListChecks} title="Delivery log" subtitle="Every event sent to queued destinations, with retries and the receiver's answer"
        actions={<div className="flex gap-2 flex-wrap">
          <Select value={dest} onValueChange={setDest}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t("All destinations")}</SelectItem>
              {(dests.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Any status")}</SelectItem><SelectItem value="delivered">{t("Delivered")}</SelectItem>
              <SelectItem value="pending">{t("Waiting / retrying")}</SelectItem><SelectItem value="dead">{t("Undelivered")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={log.reload}><RefreshCw className={cn("w-3.5 h-3.5", log.loading && "animate-spin")} /></Button>
          {canEdit && dest !== "all" && <Button variant="outline" onClick={resendAll}><RotateCw className="w-3.5 h-3.5 mr-1.5" />{t("Resend undelivered")}</Button>}
        </div>} />
      <ErrorLine error={log.error} onRetry={log.reload} />
      {log.data && log.data.length === 0 && <Notice>{t("No deliveries yet. Only destinations in queued mode appear here.")}</Notice>}
      {log.data && log.data.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border">
              <th className="px-3 py-2 font-medium">{t("Time")}</th><th className="px-3 py-2 font-medium">{t("Destination")}</th><th className="px-3 py-2 font-medium">{t("Event")}</th>
              <th className="px-3 py-2 font-medium">{t("Status")}</th><th className="px-3 py-2 font-medium text-right">{t("Attempts")}</th><th className="px-3 py-2 font-medium">{t("Answer")}</th><th />
            </tr></thead>
            <tbody>
              {log.data.map((d) => (
                <Fragment key={d.id}>
                  <tr className="border-b border-border/60 hover:bg-muted/30 cursor-pointer" onClick={() => setOpen(open === d.id ? null : d.id)}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtTime(d.createdAt)}</td>
                    <td className="px-3 py-1.5">{d.destinationName ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono">{d.eventType}</td>
                    <td className="px-3 py-1.5">
                      {d.status === "delivered" ? <Pill tone="green">{t("Delivered")}</Pill>
                        : d.status === "dead" ? <Pill tone="red">{t("Undelivered")}</Pill>
                        : <Pill tone="amber">{d.attempts ? `${t("Retry")} ${fmtTime(d.nextAttemptAt)}` : t("Waiting")}</Pill>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.attempts}</td>
                    <td className="px-3 py-1.5 max-w-[22rem] truncate">{d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : ""}{d.lastError ? ` ${d.lastError}` : ""}{d.durationMs != null ? ` · ${d.durationMs} ms` : ""}</td>
                    <td className="px-3 py-1.5 text-right">{canEdit && d.status !== "pending" && (
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={(e) => { e.stopPropagation(); void resend(d.id); }}>{t("Resend")}</Button>)}</td>
                  </tr>
                  {open === d.id && (
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td colSpan={7} className="px-3 py-2"><pre className="text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(d.payload, null, 2)}</pre></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
