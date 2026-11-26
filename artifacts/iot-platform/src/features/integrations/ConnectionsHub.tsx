import { useState } from "react";
import { Plug, Plus, Play, FlaskConical, Trash2, Pencil, ShieldAlert, Database, Globe, Cpu, Network, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { useAssetTree } from "@/components/AssetScopePicker";
import { FEATURES } from "@/lib/features";
import { useT } from "@/i18n";
import IntegrationHubClassic from "@/pages/IntegrationHub";
import { HubTabs, PageHead, Pill, Notice, ErrorLine, AlertsPanel, useJson, send, fmtTime, ago } from "./shared";

/**
 * Integration Hub → Connections. The original overview is the first tab,
 * unchanged. New: Pull connectors (the platform fetches data on a schedule)
 * and Alerts. Connectors are created disabled.
 */

type CType = "rest" | "sql" | "modbus" | "opcua";
interface Connector {
  id: string; name: string; type: CType; description: string | null; projectId: string | null; enabled: boolean; intervalSec: number;
  config: Record<string, any>; hasSecret: boolean; lastRunAt: string | null; lastSuccessAt: string | null; lastStatus: string | null;
  lastError: string | null; runCount: number; recordsRead: number;
}
interface RunResult { ok: boolean; status: string; records: number; stored: number; error?: string; preview?: { deviceId: string; timestamp?: string; metrics: Record<string, unknown> }[] }

const TYPE_INFO: Record<CType, { label: string; icon: React.ElementType; blurb: string }> = {
  rest:   { label: "REST / HTTP JSON", icon: Globe,    blurb: "Calls a JSON API on a schedule (historian, cloud service, another platform)." },
  sql:    { label: "PostgreSQL query", icon: Database, blurb: "Runs a read-only SELECT on an external PostgreSQL database." },
  modbus: { label: "Modbus TCP",       icon: Cpu,      blurb: "Reads holding or input registers from a PLC, meter or drive." },
  opcua:  { label: "OPC UA",           icon: Network,  blurb: "Saved for later: OPC UA connectors do not run yet." },
};

export default function ConnectionsHub() {
  if (FEATURES.classicIntegrationHub) return <IntegrationHubClassic />;
  return (
    <HubTabs tabs={[{ id: "overview", label: "Overview" }, { id: "connectors", label: "Pull connectors" }, { id: "alerts", label: "Alerts" }]}>
      {(tab) => tab === "overview" ? <IntegrationHubClassic />
        : <div className="p-6 space-y-4">
            {tab === "connectors" && <ConnectorsTab />}
            {tab === "alerts" && <><PageHead icon={ShieldAlert} title="Integration alerts" subtitle="Everything in Integration Hub that needs attention" /><AlertsPanel /></>}
          </div>}
    </HubTabs>
  );
}

function ConnectorsTab() {
  const t = useT();
  const { toast } = useToast();
  const { canAction } = useCurrentUser();
  const canEdit = canAction("manage_brokers", "brokers", "write");
  const list = useJson<Connector[]>("/api/integration/connectors");
  const [editing, setEditing] = useState<Connector | "new" | null>(null);
  const [result, setResult] = useState<{ id: string; r: RunResult } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (c: Connector, what: "test" | "run") => {
    setBusy(c.id + what);
    try { const r = await send<RunResult>("POST", `/api/integration/connectors/${c.id}/${what}`); setResult({ id: c.id, r }); if (what === "run") list.reload(); }
    catch (e) { toast({ title: t("Failed"), description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const toggle = async (c: Connector, on: boolean) => {
    try { await send("PUT", `/api/integration/connectors/${c.id}`, { enabled: on }); list.reload(); }
    catch (e) { toast({ title: t("Could not change"), description: (e as Error).message, variant: "destructive" }); }
  };
  const remove = async (c: Connector) => {
    if (!window.confirm(t("Delete connector \"{name}\"? Data it already stored is kept.", { name: c.name }))) return;
    try { await send("DELETE", `/api/integration/connectors/${c.id}`); list.reload(); }
    catch (e) { toast({ title: t("Could not delete"), description: (e as Error).message, variant: "destructive" }); }
  };

  return (
    <>
      <PageHead icon={Plug} title="Pull connectors" subtitle="The platform fetches data on a schedule and stores it like any ingest payload: attributes, calculated values and alarm rules all apply"
        actions={canEdit && <Button size="sm" onClick={() => setEditing("new")}><Plus className="w-4 h-4 mr-1.5" />{t("Add connector")}</Button>} />
      <Notice>{t("Readings are matched to assets by device id, the same as pushed data. New connectors start switched off: use Test to check the mapping, then switch on.")}</Notice>
      <ErrorLine error={list.error} onRetry={list.reload} />
      {list.data && list.data.length === 0 && <Notice>{t("No connectors yet.")}</Notice>}
      <div className="space-y-2">
        {(list.data ?? []).map((c) => {
          const info = TYPE_INFO[c.type];
          return (
            <div key={c.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="p-2 rounded-lg bg-primary/10"><info.icon className="w-4 h-4 text-primary" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium flex items-center gap-2 flex-wrap">{c.name}
                    <Pill tone="grey">{t(info.label)}</Pill>
                    {c.type === "opcua" ? <Pill tone="amber">{t("Does not run yet")}</Pill>
                      : c.lastStatus === "error" ? <Pill tone="red">{t("Failing")}</Pill>
                      : c.lastStatus === "ok" ? <Pill tone="green">{t("OK")}</Pill> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("Every {s} s", { s: c.intervalSec })} · {t("last run")} {ago(c.lastRunAt)} · {c.runCount} {t("runs")} · {c.recordsRead.toLocaleString()} {t("records")}
                  </div>
                  {c.lastError && <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">{c.lastError}</div>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7" disabled={!!busy || c.type === "opcua"} onClick={() => act(c, "test")}><FlaskConical className="w-3.5 h-3.5 mr-1" />{t("Test")}</Button>
                  {canEdit && <Button size="sm" variant="outline" className="h-7" disabled={!!busy || c.type === "opcua"} onClick={() => act(c, "run")}><Play className="w-3.5 h-3.5 mr-1" />{t("Run now")}</Button>}
                  {canEdit && <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(c)}><Pencil className="w-3.5 h-3.5" /></Button>}
                  {canEdit && <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => remove(c)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                  <Switch checked={c.enabled} disabled={!canEdit} onCheckedChange={(v) => toggle(c, v)} aria-label={t("Enabled")} />
                </div>
              </div>
              {result?.id === c.id && (
                <div className="rounded border border-border bg-muted/20 p-2 text-xs space-y-1">
                  <div className="flex justify-between"><span>
                    {result.r.ok ? t("{n} record(s) read", { n: result.r.records }) : `${t("Failed")}: ${result.r.error}`}
                    {result.r.ok && result.r.stored ? ` · ${t("{n} value(s) stored", { n: result.r.stored })}` : ""}
                  </span><button onClick={() => setResult(null)}><X className="w-3 h-3" /></button></div>
                  {result.r.preview && <pre className="whitespace-pre-wrap break-all">{JSON.stringify(result.r.preview, null, 2)}</pre>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {editing && <ConnectorDialog connector={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function ConnectorDialog({ connector, onClose, onSaved }: { connector: Connector | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const tree = useAssetTree();
  const [type, setType] = useState<CType>(connector?.type ?? "rest");
  const [name, setName] = useState(connector?.name ?? "");
  const [interval, setIntervalSec] = useState(String(connector?.intervalSec ?? 60));
  const [projectId, setProjectId] = useState(connector?.projectId ?? "all");
  const [cfg, setCfg] = useState<Record<string, any>>(connector?.config ?? { method: "GET", authType: "none", port: 502, unitId: 1, registers: [] });
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setCfg((c) => ({ ...c, [k]: v }));
  const regs: any[] = Array.isArray(cfg.registers) ? cfg.registers : [];

  const save = async () => {
    setBusy(true);
    const config = { ...cfg };
    if (typeof config.fieldsText === "string") { config.fields = config.fieldsText.split(",").map((s: string) => s.trim()).filter(Boolean); delete config.fieldsText; }
    const body: Record<string, unknown> = { name, type, intervalSec: Number(interval), projectId: projectId === "all" ? null : projectId, config };
    if (secret) body.secret = secret;
    try {
      if (connector) await send("PUT", `/api/integration/connectors/${connector.id}`, body);
      else await send("POST", "/api/integration/connectors", body);
      onSaved();
    } catch (e) { toast({ title: t("Could not save"), description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const field = (label: string, key: string, placeholder?: string, type2 = "text") => (
    <div><Label className="text-xs">{t(label)}</Label><Input className="h-8" type={type2} placeholder={placeholder} value={cfg[key] ?? ""} onChange={(e) => set(key, type2 === "number" ? Number(e.target.value) : e.target.value)} /></div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(connector ? "Edit connector" : "Add connector")}</DialogTitle>
          <DialogDescription>{t(TYPE_INFO[type].blurb)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">{t("Name")}</Label><Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label className="text-xs">{t("Type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as CType)} disabled={!!connector}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(TYPE_INFO) as CType[]).map((k) => <SelectItem key={k} value={k}>{t(TYPE_INFO[k].label)}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label className="text-xs">{t("Run every (seconds)")}</Label><Input className="h-8" type="number" min={5} value={interval} onChange={(e) => setIntervalSec(e.target.value)} /></div>
            <div><Label className="text-xs">{t("Only write to project")}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{t("Any project")}</SelectItem>{tree.roots.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select></div>
          </div>

          {type === "rest" && (
            <div className="space-y-3">
              <div className="grid grid-cols-[6rem_1fr] gap-3">
                <div><Label className="text-xs">{t("Method")}</Label>
                  <Select value={cfg.method ?? "GET"} onValueChange={(v) => set("method", v)}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="GET">GET</SelectItem><SelectItem value="POST">POST</SelectItem></SelectContent></Select></div>
                {field("URL", "url", "https://historian.example.com/api/latest")}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label className="text-xs">{t("Authentication")}</Label>
                  <Select value={cfg.authType ?? "none"} onValueChange={(v) => set("authType", v)}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">{t("None")}</SelectItem><SelectItem value="bearer">Bearer</SelectItem><SelectItem value="api_key">API key</SelectItem><SelectItem value="basic">Basic</SelectItem></SelectContent></Select></div>
                {cfg.authType === "api_key" && field("Header name", "apiKeyHeader", "X-API-Key")}
                {cfg.authType === "basic" && field("User name", "basicUser")}
                {cfg.authType && cfg.authType !== "none" && <div><Label className="text-xs">{t(connector?.hasSecret ? "Token / password (blank = keep)" : "Token / password")}</Label><Input className="h-8" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} /></div>}
              </div>
              {cfg.method === "POST" && <div><Label className="text-xs">{t("Request body (JSON)")}</Label><Textarea rows={3} value={cfg.body ?? ""} onChange={(e) => set("body", e.target.value)} /></div>}
              <div className="grid grid-cols-3 gap-3">
                {field("Records at path", "recordsPath", "data.items")}
                {field("Device id field", "deviceIdField", "deviceId")}
                {field("…or fixed device id", "deviceId", "pump-101")}
                {field("Timestamp field", "timestampField", "ts")}
                <div className="col-span-2"><Label className="text-xs">{t("Fields to keep (comma separated, blank = all values)")}</Label>
                  <Input className="h-8" value={cfg.fieldsText ?? (cfg.fields ?? []).join(", ")} onChange={(e) => set("fieldsText", e.target.value)} /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("Private network addresses are refused unless ALLOW_PRIVATE_WEBHOOK_TARGETS=true is set on the server.")}</p>
            </div>
          )}

          {type === "sql" && (
            <div className="space-y-3">
              <div><Label className="text-xs">{t(connector?.hasSecret ? "Connection string (blank = keep)" : "Connection string")}</Label>
                <Input className="h-8 font-mono" type="password" placeholder="postgres://reader:…@10.0.0.20:5432/historian" value={secret} onChange={(e) => setSecret(e.target.value)} /></div>
              <div><Label className="text-xs">{t("Query (SELECT only; $1 = last watermark)")}</Label>
                <Textarea rows={4} className="font-mono text-xs" placeholder="SELECT tag AS device, ts, value FROM readings WHERE ts > COALESCE($1::timestamptz, now() - interval '5 minutes') ORDER BY ts LIMIT 1000"
                  value={cfg.query ?? ""} onChange={(e) => set("query", e.target.value)} /></div>
              <div className="grid grid-cols-3 gap-3">
                {field("Device id column", "deviceIdColumn", "device")}
                {field("…or fixed device id", "deviceId")}
                {field("Timestamp column", "timestampColumn", "ts")}
                {field("Watermark column", "watermarkColumn", "ts")}
              </div>
              <p className="text-[11px] text-muted-foreground">{t("Runs in a read-only transaction with a 15-second limit, so it can never change the source database. Use a read-only database user.")}</p>
            </div>
          )}

          {type === "modbus" && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-2">{field("Host", "host", "192.168.1.50")}</div>
                {field("Port", "port", "502", "number")}
                {field("Unit id", "unitId", "1", "number")}
              </div>
              {field("Device id (asset identifier)", "deviceId", "meter-01")}
              <div className="space-y-1">
                <div className="flex items-center justify-between"><Label className="text-xs">{t("Registers")}</Label>
                  <Button size="sm" variant="outline" className="h-6" onClick={() => set("registers", [...regs, { name: "", address: 0, function: "holding", type: "uint16" }])}><Plus className="w-3 h-3 mr-1" />{t("Add")}</Button></div>
                {regs.map((r, i) => {
                  const upd = (k: string, v: unknown) => set("registers", regs.map((x, j) => j === i ? { ...x, [k]: v } : x));
                  return (
                    <div key={i} className="grid grid-cols-[1fr_5rem_6.5rem_6rem_5rem_5.5rem_auto] gap-1.5 items-center">
                      <Input className="h-7 text-xs" placeholder={t("metric name")} value={r.name} onChange={(e) => upd("name", e.target.value)} />
                      <Input className="h-7 text-xs" type="number" placeholder="addr" value={r.address} onChange={(e) => upd("address", Number(e.target.value))} />
                      <Select value={r.function ?? "holding"} onValueChange={(v) => upd("function", v)}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="holding">Holding (3)</SelectItem><SelectItem value="input">Input (4)</SelectItem></SelectContent></Select>
                      <Select value={r.type ?? "uint16"} onValueChange={(v) => upd("type", v)}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{["uint16", "int16", "uint32", "int32", "float32"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
                      <Input className="h-7 text-xs" type="number" step="any" placeholder={t("scale")} value={r.scale ?? ""} onChange={(e) => upd("scale", e.target.value ? Number(e.target.value) : undefined)} />
                      <Select value={r.wordOrder ?? "big"} onValueChange={(v) => upd("wordOrder", v)}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="big">{t("Hi-Lo")}</SelectItem><SelectItem value="little">{t("Lo-Hi")}</SelectItem></SelectContent></Select>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => set("registers", regs.filter((_, j) => j !== i))}><X className="w-3 h-3" /></Button>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">{t("Plant-network addresses are allowed for Modbus. Loopback and link-local addresses are refused.")}</p>
            </div>
          )}

          {type === "opcua" && (
            <div className="space-y-3">
              <Notice tone="warn">{t("OPC UA connectors can be saved now but do not run yet: the server still needs an OPC UA client library. Use a gateway (Node-RED, Kepware) posting to ingest in the meantime.")}</Notice>
              {field("Endpoint URL", "endpointUrl", "opc.tcp://10.0.0.30:4840")}
              {field("Device id (asset identifier)", "deviceId")}
              <div><Label className="text-xs">{t("Node ids (one per line: nodeId = metric name)")}</Label>
                <Textarea rows={4} className="font-mono text-xs" value={cfg.nodesText ?? ""} onChange={(e) => set("nodesText", e.target.value)} placeholder={"ns=2;s=Pump1.Temp = temperature"} /></div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>{t(busy ? "Saving…" : "Save")}</Button>
        </DialogFooter>
        {connector && <p className="text-[11px] text-muted-foreground">{t("Last success")}: {fmtTime(connector.lastSuccessAt)}</p>}
      </DialogContent>
    </Dialog>
  );
}
