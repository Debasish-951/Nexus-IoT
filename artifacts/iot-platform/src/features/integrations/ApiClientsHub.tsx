import { useEffect, useMemo, useState } from "react";
import { KeyRound, ShieldAlert, Save, RotateCw, Search, FlaskConical, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
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
import ApiClientsClassic from "@/pages/ApiClients";
import {
  HubTabs, PageHead, Stat, Pill, Notice, ErrorLine, OneTimeSecret, AlertsPanel, useJson, send, fmtTime, ago,
  type Catalog,
} from "./shared";

/**
 * Integration Hub → API Client. The original page is the first tab, unchanged.
 * New tabs: Access (permission builder, limits, sandbox, rotation with a grace
 * period, OAuth), Usage (per-client traffic) and Alerts.
 * VITE_CLASSIC_INTEGRATION_HUB=true shows only the original page.
 */

export interface ClientRow {
  id: string; name: string; clientId: string; description: string | null; projectId: string | null; projectName: string | null;
  status: string; scopes: string[]; allowedIps: string[]; expiresAt: string | null; lastUsedAt: string | null; totalRequests: number;
  secretRotatedAt: string | null; createdAt: string; allowedAssetIds: string[]; maxRows: number | null; maxRangeDays: number | null;
  sandbox: boolean; template: string | null; graceUntil: string | null; legacySuperKey: boolean;
  usage24h: { total: number; errors: number; avgMs: number };
}

/** Resource rows of the permission builder: which scope means read and which means write. */
const MATRIX: { resource: string; read?: string; write?: string; writeLabel?: string }[] = [
  { resource: "Telemetry", read: "read:telemetry", write: "ingest:write", writeLabel: "send readings" },
  { resource: "Assets", read: "read:assets" },
  { resource: "Attribute values", write: "write:attributes", writeLabel: "set values" },
  { resource: "Maintenance mode", write: "write:maintenance", writeLabel: "turn on / off" },
  { resource: "Alarms", read: "read:alarms", write: "write:alarms", writeLabel: "acknowledge" },
  { resource: "Alarm history", read: "read:alarm-history" },
  { resource: "Alarm rules", read: "read:alarm-rules" },
  { resource: "Event feed", read: "read:events" },
];

export default function ApiClientsHub() {
  if (FEATURES.classicIntegrationHub) return <ApiClientsClassic />;
  return (
    <HubTabs tabs={[{ id: "clients", label: "Clients" }, { id: "access", label: "Access" }, { id: "usage", label: "Usage" }, { id: "alerts", label: "Alerts" }]}>
      {(tab) => tab === "clients" ? <ApiClientsClassic />
        : <div className="p-6 space-y-4">
            {tab === "access" && <AccessTab />}
            {tab === "usage" && <UsageTab />}
            {tab === "alerts" && <><PageHead icon={ShieldAlert} title="Integration alerts" subtitle="Keys, destinations and connectors that need attention" /><AlertsPanel /></>}
          </div>}
    </HubTabs>
  );
}

function ClientPicker({ clients, value, onChange }: { clients: ClientRow[]; value: string; onChange: (id: string) => void }) {
  const t = useT();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-72"><SelectValue placeholder={t("Choose an API client")} /></SelectTrigger>
      <SelectContent>
        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.projectName ? ` · ${c.projectName}` : ""}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ── Access ───────────────────────────────────────────────────────────────────

function AccessTab() {
  const t = useT();
  const clients = useJson<ClientRow[]>("/api/integration/clients");
  const catalog = useJson<Catalog>("/api/integration/catalog");
  const [selected, setSelected] = useState("");
  useEffect(() => { if (!selected && clients.data?.length) setSelected(clients.data[0]!.id); }, [clients.data, selected]);
  const client = clients.data?.find((c) => c.id === selected) ?? null;

  return (
    <>
      <PageHead icon={KeyRound} title="Access" subtitle="What each API client may read and change, how far it reaches, and how its secret is rotated" />
      <ErrorLine error={clients.error ?? catalog.error} onRetry={clients.reload} />
      {clients.data && clients.data.length === 0 && <Notice>{t("No API clients yet. Create one on the Clients tab.")}</Notice>}
      {clients.data && clients.data.length > 0 && catalog.data && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-1">
            {clients.data.map((c) => (
              <button key={c.id} onClick={() => setSelected(c.id)}
                className={cn("w-full text-left rounded-lg border px-3 py-2 transition-colors", c.id === selected ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40")}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{c.name}</span>
                  {c.sandbox && <Pill tone="blue">{t("Sandbox")}</Pill>}
                  {c.legacySuperKey && <Pill tone="amber">{t("Full access")}</Pill>}
                  {c.status !== "active" && <Pill tone="grey">{t(c.status)}</Pill>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{c.projectName ?? t("All projects")} · {t("used")} {ago(c.lastUsedAt)}</div>
              </button>
            ))}
          </div>
          {client && <AccessEditor key={client.id} client={client} catalog={catalog.data} onSaved={clients.reload} />}
        </div>
      )}
    </>
  );
}

function AccessEditor({ client, catalog, onSaved }: { client: ClientRow; catalog: Catalog; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const { canAction } = useCurrentUser();
  const canEdit = canAction("manage_api_clients", "api_clients", "write");
  const tree = useAssetTree();
  const [scopes, setScopes] = useState<string[]>(client.scopes);
  const [assetIds, setAssetIds] = useState<string[]>(client.allowedAssetIds);
  const [maxRows, setMaxRows] = useState(client.maxRows?.toString() ?? "");
  const [maxRangeDays, setMaxRangeDays] = useState(client.maxRangeDays?.toString() ?? "");
  const [sandbox, setSandbox] = useState(client.sandbox);
  const [template, setTemplate] = useState(client.template ?? "");
  const [assetQuery, setAssetQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [grace, setGrace] = useState("24");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const grantable = new Set(catalog.grantableScopes);
  const mayGrant = (s: string) => grantable.has("*") || grantable.has(s) || client.scopes.includes(s);

  const toggle = (s: string, on: boolean) => setScopes((cur) => on ? [...new Set([...cur, s])] : cur.filter((x) => x !== s));
  const applyTemplate = (id: string) => {
    setTemplate(id);
    const tpl = catalog.templates.find((x) => x.id === id);
    if (tpl) setScopes(tpl.scopes.filter(mayGrant));
  };

  // Assets the limit can be chosen from: the client's project, or every project.
  const choices = useMemo(() => {
    const roots = client.projectId ? tree.roots.filter((r) => r.id === client.projectId) : tree.roots;
    const out: { id: string; name: string; depth: number }[] = [];
    for (const r of roots) {
      out.push({ id: r.id, name: r.name, depth: 0 });
      for (const d of tree.descendants(r.id)) out.push({ id: d.a.id, name: d.a.name, depth: d.depth });
    }
    const q = assetQuery.trim().toLowerCase();
    return q ? out.filter((a) => a.name.toLowerCase().includes(q)) : out;
  }, [tree, client.projectId, assetQuery]);

  const save = async () => {
    setSaving(true);
    try {
      await send("PUT", `/api/integration/clients/${client.id}/access`, {
        scopes, allowedAssetIds: assetIds, maxRows: maxRows || null, maxRangeDays: maxRangeDays || null, sandbox, template: template || null,
      });
      toast({ title: t("Access saved") });
      onSaved();
    } catch (e) {
      toast({ title: t("Could not save"), description: (e as Error).message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const rotate = async () => {
    if (!window.confirm(t(grace === "0"
      ? "Rotate now? The current secret stops working immediately."
      : "Rotate? A new secret is issued and the current one keeps working for the grace period."))) return;
    try {
      const r = await send<{ clientSecret: string }>("POST", `/api/integration/clients/${client.id}/rotate`, { graceHours: Number(grace) });
      setNewSecret(r.clientSecret);
      onSaved();
    } catch (e) { toast({ title: t("Could not rotate"), description: (e as Error).message, variant: "destructive" }); }
  };

  const endGrace = async () => {
    try { await send("POST", `/api/integration/clients/${client.id}/end-grace`); toast({ title: t("Old secret stopped") }); onSaved(); }
    catch (e) { toast({ title: t("Could not stop it"), description: (e as Error).message, variant: "destructive" }); }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const dirty = JSON.stringify([scopes.slice().sort(), assetIds.slice().sort(), maxRows, maxRangeDays, sandbox, template])
    !== JSON.stringify([client.scopes.slice().sort(), client.allowedAssetIds.slice().sort(), client.maxRows?.toString() ?? "", client.maxRangeDays?.toString() ?? "", client.sandbox, client.template ?? ""]);

  return (
    <div className="space-y-4 min-w-0">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold">{client.name}</div>
            <div className="text-xs text-muted-foreground font-mono">{client.clientId}</div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">{t("Template")}</Label>
            <Select value={template || "none"} onValueChange={(v) => v === "none" ? setTemplate("") : applyTemplate(v)} disabled={!canEdit}>
              <SelectTrigger className="w-64 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("Custom")}</SelectItem>
                {catalog.templates.map((tpl) => <SelectItem key={tpl.id} value={tpl.id}>{t(tpl.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {template && <p className="text-xs text-muted-foreground">{t(catalog.templates.find((x) => x.id === template)?.description ?? "")}</p>}
        {(scopes.includes("*") || scopes.length === 0) && (
          <Notice tone="warn">{t("This is a full-access key: it can read and change everything, including future features. Tick only what it needs and save to remove full access.")}
            {scopes.includes("*") && canEdit && <Button variant="link" size="sm" className="h-auto p-0 ml-2" onClick={() => toggle("*", false)}>{t("Remove full access")}</Button>}
          </Notice>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2 font-medium">{t("Resource")}</th><th className="py-2 font-medium w-28">{t("Read")}</th><th className="py-2 font-medium w-48">{t("Write")}</th>
            </tr></thead>
            <tbody>
              {MATRIX.map((row) => (
                <tr key={row.resource} className="border-b border-border/60">
                  <td className="py-2">{t(row.resource)}</td>
                  <td className="py-2">{row.read && (
                    <Checkbox checked={scopes.includes(row.read)} disabled={!canEdit || !mayGrant(row.read)} onCheckedChange={(v) => toggle(row.read!, v === true)} aria-label={`${row.resource} read`} />
                  )}</td>
                  <td className="py-2">{row.write && (
                    <label className="flex items-center gap-2">
                      <Checkbox checked={scopes.includes(row.write)} disabled={!canEdit || !mayGrant(row.write)} onCheckedChange={(v) => toggle(row.write!, v === true)} />
                      <span className="text-xs text-muted-foreground">{t(row.writeLabel ?? "write")}</span>
                    </label>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{t("Greyed boxes are scopes your own account may not grant.")}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="font-medium text-sm">{t("Asset limit")}</div>
          <p className="text-xs text-muted-foreground">
            {t(client.projectId ? "Already limited to its project. Tick assets to narrow it further (children are included)." : "Tick assets to limit this client to them and their children. None ticked = no extra limit.")}
          </p>
          <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="h-8 pl-7" placeholder={t("Search assets")} value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} /></div>
          <div className="max-h-56 overflow-auto rounded border border-border p-1">
            {choices.slice(0, 400).map((a) => (
              <label key={a.id} className="flex items-center gap-2 py-0.5 text-sm hover:bg-muted/40 rounded px-1" style={{ paddingLeft: 4 + a.depth * 14 }}>
                <Checkbox checked={assetIds.includes(a.id)} disabled={!canEdit}
                  onCheckedChange={(v) => setAssetIds((cur) => v === true ? [...new Set([...cur, a.id])] : cur.filter((x) => x !== a.id))} />
                <span className="truncate">{a.name}</span>
              </label>
            ))}
            {choices.length === 0 && <div className="text-xs text-muted-foreground p-2">{t("No assets")}</div>}
          </div>
          {assetIds.length > 0 && <div className="text-xs">{t("{n} asset(s) ticked", { n: assetIds.length })} · <button className="text-primary" onClick={() => setAssetIds([])} disabled={!canEdit}>{t("clear")}</button></div>}
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="font-medium text-sm">{t("Read limits")}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">{t("Most rows per request")}</Label>
              <Input type="number" min={1} max={100000} placeholder={t("endpoint default")} value={maxRows} onChange={(e) => setMaxRows(e.target.value)} disabled={!canEdit} /></div>
            <div><Label className="text-xs">{t("Widest time range (days)")}</Label>
              <Input type="number" min={1} max={3650} placeholder={t("no limit")} value={maxRangeDays} onChange={(e) => setMaxRangeDays(e.target.value)} disabled={!canEdit} /></div>
          </div>
          <div className="flex items-start gap-3 rounded border border-border p-3">
            <FlaskConical className="w-4 h-4 mt-0.5 text-blue-600" />
            <div className="flex-1">
              <div className="text-sm font-medium">{t("Sandbox")}</div>
              <p className="text-xs text-muted-foreground">{t("Writes are checked and answered, but nothing is stored or changed. Use it while a third party builds their integration.")}</p>
            </div>
            <Switch checked={sandbox} onCheckedChange={setSandbox} disabled={!canEdit} />
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || !dirty}><Save className="w-4 h-4 mr-1.5" />{t(saving ? "Saving…" : "Save access")}</Button>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="font-medium text-sm">{t("Secret rotation")}</div>
        <p className="text-xs text-muted-foreground">{t("Last rotated")}: {fmtTime(client.secretRotatedAt)}. {t("With a grace period the old secret keeps working while the gateway is updated, so nothing is lost.")}</p>
        {client.graceUntil && (
          <Notice tone="warn">{t("The previous secret is still accepted until")} {fmtTime(client.graceUntil)}.
            {canEdit && <Button variant="link" size="sm" className="h-auto p-0 ml-2" onClick={endGrace}>{t("Stop it now")}</Button>}</Notice>
        )}
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={grace} onValueChange={setGrace}>
              <SelectTrigger className="w-56 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t("No grace (stop old secret now)")}</SelectItem>
                <SelectItem value="1">{t("Old secret valid 1 hour")}</SelectItem>
                <SelectItem value="24">{t("Old secret valid 24 hours")}</SelectItem>
                <SelectItem value="72">{t("Old secret valid 3 days")}</SelectItem>
                <SelectItem value="168">{t("Old secret valid 7 days")}</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={rotate}><RotateCw className="w-3.5 h-3.5 mr-1.5" />{t("Rotate secret")}</Button>
          </div>
        )}
        {newSecret && <OneTimeSecret label="New client secret" value={newSecret} />}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="font-medium text-sm">{t("OAuth 2.0 (optional)")}</div>
        <p className="text-xs text-muted-foreground">
          {t("Enterprise systems can exchange the client id and secret for a short-lived token (valid {m} minutes) and send that instead of the secret.", { m: Math.round(catalog.accessTokenTtlSec / 60) })}
        </p>
        <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{`curl -X POST ${origin}/api/oauth/token \\
  -d grant_type=client_credentials \\
  -d client_id=${client.clientId} \\
  -d client_secret=<secret>

curl -H "Authorization: Bearer <access_token>" ${origin}/api/v1/assets`}</pre>
      </div>
    </div>
  );
}

// ── Usage ────────────────────────────────────────────────────────────────────

interface UsageReply {
  total: number; errors: number; hours: number; bucket: string;
  series: { at: string; total: number; errors: number; avgMs: number }[];
  paths: { method: string; path: string; total: number; errors: number; avgMs: number }[];
  recent: { id: number; method: string; path: string; statusCode: number; durationMs: number; ip: string | null; ts: string }[];
  denials: { at: string; type: string; reason: string | null; ip: string | null }[];
}

function UsageTab() {
  const t = useT();
  const clients = useJson<ClientRow[]>("/api/integration/clients");
  const [selected, setSelected] = useState("");
  const [hours, setHours] = useState("24");
  useEffect(() => { if (!selected && clients.data?.length) setSelected([...clients.data].sort((a, b) => b.usage24h.total - a.usage24h.total)[0]!.id); }, [clients.data, selected]);
  const usage = useJson<UsageReply>(selected ? `/api/integration/clients/${selected}/usage?hours=${hours}` : null);
  const u = usage.data;
  const errPct = u && u.total ? Math.round((u.errors / u.total) * 1000) / 10 : 0;

  return (
    <>
      <PageHead icon={Activity} title="Usage" subtitle="Requests made with each API client: volume, errors, slow endpoints and refusals"
        actions={<div className="flex gap-2">
          {clients.data && <ClientPicker clients={clients.data} value={selected} onChange={setSelected} />}
          <Select value={hours} onValueChange={setHours}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t("Last hour")}</SelectItem><SelectItem value="24">{t("Last 24 hours")}</SelectItem>
              <SelectItem value="168">{t("Last 7 days")}</SelectItem><SelectItem value="720">{t("Last 30 days")}</SelectItem>
            </SelectContent>
          </Select>
        </div>} />
      <ErrorLine error={clients.error ?? usage.error} onRetry={usage.reload} />
      {clients.data && (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="px-3 py-2 font-medium">{t("Client")}</th><th className="px-3 py-2 font-medium text-right">{t("Requests 24 h")}</th>
              <th className="px-3 py-2 font-medium text-right">{t("Errors")}</th><th className="px-3 py-2 font-medium text-right">{t("Avg ms")}</th><th className="px-3 py-2 font-medium">{t("Last used")}</th>
            </tr></thead>
            <tbody>{clients.data.map((c) => (
              <tr key={c.id} onClick={() => setSelected(c.id)} className={cn("border-b border-border/60 cursor-pointer hover:bg-muted/40", c.id === selected && "bg-primary/5")}>
                <td className="px-3 py-1.5">{c.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.usage24h.total.toLocaleString()}</td>
                <td className={cn("px-3 py-1.5 text-right tabular-nums", c.usage24h.errors > 0 && "text-red-600")}>{c.usage24h.errors.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.usage24h.avgMs}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{ago(c.lastUsedAt)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {u && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Requests" value={u.total.toLocaleString()} />
            <Stat label="Errors" value={u.errors.toLocaleString()} tone={u.errors ? "bad" : "ok"} />
            <Stat label="Error rate" value={`${errPct}%`} tone={errPct > 5 ? "bad" : errPct > 0 ? "warn" : "ok"} />
            <Stat label="Refused (security)" value={u.denials.length} tone={u.denials.length ? "warn" : "ok"} />
          </div>
          <div className="rounded-lg border border-border bg-card p-3 h-56">
            {u.series.length === 0 ? <div className="h-full grid place-items-center text-sm text-muted-foreground">{t("No requests in this period")}</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={u.series.map((s) => ({ ...s, ok: s.total - s.errors, label: new Date(s.at).toLocaleString(undefined, u.bucket === "day" ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" }) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} width={40} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Bar dataKey="ok" stackId="a" name={t("Succeeded")} fill="hsl(var(--primary))" />
                  <Bar dataKey="errors" stackId="a" name={t("Failed")} fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-lg border border-border bg-card overflow-x-auto">
              <div className="px-3 py-2 text-sm font-medium border-b border-border">{t("Endpoints")}</div>
              <table className="w-full text-xs"><tbody>
                {u.paths.map((p, i) => (
                  <tr key={i} className="border-b border-border/60">
                    <td className="px-3 py-1.5 font-mono">{p.method} {p.path}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.total.toLocaleString()}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums", p.errors > 0 && "text-red-600")}>{p.errors} {t("err")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.avgMs} ms</td>
                  </tr>))}
                {u.paths.length === 0 && <tr><td className="px-3 py-3 text-muted-foreground">{t("None")}</td></tr>}
              </tbody></table>
            </div>
            <div className="rounded-lg border border-border bg-card overflow-x-auto">
              <div className="px-3 py-2 text-sm font-medium border-b border-border">{t("Refused requests")}</div>
              <table className="w-full text-xs"><tbody>
                {u.denials.map((d, i) => (
                  <tr key={i} className="border-b border-border/60">
                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtTime(d.at)}</td><td className="px-3 py-1.5">{d.reason ?? d.type}</td><td className="px-3 py-1.5 font-mono">{d.ip ?? ""}</td>
                  </tr>))}
                {u.denials.length === 0 && <tr><td className="px-3 py-3 text-muted-foreground">{t("None")}</td></tr>}
              </tbody></table>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <div className="px-3 py-2 text-sm font-medium border-b border-border">{t("Last 100 requests")}</div>
            <table className="w-full text-xs"><tbody>
              {u.recent.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="px-3 py-1 whitespace-nowrap">{fmtTime(r.ts)}</td>
                  <td className="px-3 py-1 font-mono">{r.method} {r.path}</td>
                  <td className="px-3 py-1"><Pill tone={r.statusCode < 300 ? "green" : r.statusCode < 500 ? "amber" : "red"}>{r.statusCode}</Pill></td>
                  <td className="px-3 py-1 text-right tabular-nums">{r.durationMs} ms</td>
                  <td className="px-3 py-1 font-mono text-muted-foreground">{r.ip ?? ""}</td>
                </tr>))}
              {u.recent.length === 0 && <tr><td className="px-3 py-3 text-muted-foreground">{t("No requests in this period")}</td></tr>}
            </tbody></table>
          </div>
        </>
      )}
    </>
  );
}
