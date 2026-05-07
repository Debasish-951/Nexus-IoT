import { useState, useEffect } from "react";
import { useListBrokers, useListApiClients } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  Wifi, Send, KeyRound, Zap, ArrowRight, CheckCircle2,
  XCircle, Clock, AlertTriangle, BookOpen,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function StatusDot({ status }: { status: "connected" | "disconnected" | "error" | string }) {
  if (status === "connected") return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />;
  if (status === "error")     return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" />;
}

function HubCard({
  href, icon: Icon, title, description, children, accent,
}: {
  href: string; icon: React.ElementType; title: string; description: string;
  children?: React.ReactNode; accent?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
      <div className={`px-4 py-3 flex items-center gap-3 border-b border-border ${accent ?? "bg-muted/40"}`}>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>
      </div>
      <div className="p-4 flex-1 space-y-3">
        {children}
      </div>
      <div className="px-4 pb-4">
        <Link href={href} className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium">
          Manage <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

export default function IntegrationHub() {
  const { data: brokersData }    = useListBrokers();
  const { data: apiClientsData } = useListApiClients();
  const [destinations, setDestinations] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/destinations", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(setDestinations)
      .catch(() => setDestinations([]));
  }, []);

  const brokers    = (brokersData    as any[] | undefined) ?? [];
  const apiClients = (apiClientsData as any[] | undefined) ?? [];

  const connectedBrokers = brokers.filter((b: any) => b.status === "connected");
  const enabledDests     = destinations.filter((d: any) => d.enabled);
  const activeClients    = apiClients.filter((c: any) => !c.expiresAt || new Date(c.expiresAt) > new Date());

  return (
    <div className="p-6 space-y-6 max-w-5xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" /> Integration Hub
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of all active data connections — inbound and outbound.
        </p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "MQTT / REST Brokers", value: brokers.length,      sub: `${connectedBrokers.length} connected`,    icon: Wifi,    color: "text-blue-500" },
          { label: "Webhook Destinations", value: destinations.length, sub: `${enabledDests.length} enabled`,         icon: Send,    color: "text-green-500" },
          { label: "API Clients",          value: apiClients.length,   sub: `${activeClients.length} active`,         icon: KeyRound, color: "text-amber-500" },
          { label: "Ingest Endpoint",      value: "Live",              sub: "HTTP + MQTT supported",                  icon: Zap,     color: "text-primary" },
        ].map(({ label, value, sub, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4 space-y-1">
            <div className="flex items-center gap-2">
              <Icon className={`w-4 h-4 shrink-0 ${color}`} />
              <span className="text-xs text-muted-foreground font-medium">{label}</span>
            </div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">

        {/* MQTT / REST Brokers */}
        <HubCard href={`${BASE}/brokers`} icon={Wifi} title="Brokers" description="MQTT, REST API, Azure IoT connections">
          {brokers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No brokers configured yet.</p>
          ) : (
            <div className="space-y-1.5">
              {brokers.slice(0, 5).map((b: any) => (
                <div key={b.id} className="flex items-center gap-2 text-xs">
                  <StatusDot status={b.status} />
                  <span className="flex-1 truncate font-medium">{b.name}</span>
                  <span className="text-muted-foreground uppercase text-[10px]">{b.type}</span>
                </div>
              ))}
              {brokers.length > 5 && (
                <p className="text-xs text-muted-foreground">+{brokers.length - 5} more</p>
              )}
            </div>
          )}
        </HubCard>

        {/* Webhook Destinations */}
        <HubCard href={`${BASE}/destinations`} icon={Send} title="Destinations" description="Outbound webhook / HTTP forwarding">
          {destinations.length === 0 ? (
            <p className="text-xs text-muted-foreground">No destinations configured yet.</p>
          ) : (
            <div className="space-y-1.5">
              {destinations.slice(0, 5).map((d: any) => (
                <div key={d.id} className="flex items-center gap-2 text-xs">
                  {d.enabled
                    ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                    : <XCircle className="w-3 h-3 text-muted-foreground/40 shrink-0" />}
                  <span className="flex-1 truncate font-medium">{d.name}</span>
                  <span className="text-muted-foreground text-[10px] truncate max-w-[80px]">{d.url?.replace(/^https?:\/\//, "").split("/")[0]}</span>
                </div>
              ))}
              {destinations.length > 5 && (
                <p className="text-xs text-muted-foreground">+{destinations.length - 5} more</p>
              )}
            </div>
          )}
        </HubCard>

        {/* API Clients */}
        <HubCard href={`${BASE}/api-clients`} icon={KeyRound} title="API Clients" description="OAuth client credentials for external apps">
          {apiClients.length === 0 ? (
            <p className="text-xs text-muted-foreground">No API clients created yet.</p>
          ) : (
            <div className="space-y-1.5">
              {apiClients.slice(0, 5).map((c: any) => {
                const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
                return (
                  <div key={c.id} className="flex items-center gap-2 text-xs">
                    {expired
                      ? <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                      : <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
                    <span className="flex-1 truncate font-medium">{c.name}</span>
                    {c.lastUsedAt && (
                      <span className="text-muted-foreground text-[10px] flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(c.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                );
              })}
              {apiClients.length > 5 && (
                <p className="text-xs text-muted-foreground">+{apiClients.length - 5} more</p>
              )}
            </div>
          )}
        </HubCard>

        {/* Ingest API */}
        <HubCard href={`${BASE}/integration-guide`} icon={Zap} title="Ingest API" description="Push telemetry from any device or gateway">
          <div className="space-y-2">
            <div className="rounded-md bg-muted/60 border border-border px-3 py-2 font-mono text-xs text-primary break-all">
              POST {window.location.origin}/api/ingest/payload
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {[
                "Auto-detects flat, nested-data, nested-metrics, nested-root formats",
                "Evaluates alarm rules on every ingest",
                "Broadcasts via WebSocket in real time",
                "Supports batch ingest up to 500 payloads",
              ].map((t) => (
                <div key={t} className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </HubCard>

        {/* Integration Guide */}
        <HubCard href={`${BASE}/integration-guide`} icon={BookOpen} title="Integration Guide" description="Code examples, payload formats & auth setup">
          <div className="space-y-2 text-xs text-muted-foreground">
            {[
              { label: "3-step quick setup", sub: "Register asset → send payload → verify" },
              { label: "4 payload formats", sub: "Flat, nested-root, nested-data, nested-metrics" },
              { label: "Python & cURL examples", sub: "Copy-paste ready code" },
              { label: "Dry-run validation", sub: "POST /api/ingest/validate (no DB write)" },
            ].map(({ label, sub }) => (
              <div key={label} className="flex items-start gap-1.5">
                <ArrowRight className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">{label}</p>
                  <p className="text-[11px]">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </HubCard>

      </div>

      {/* Ingest endpoint quick info */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-semibold text-foreground text-sm">How data flows</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {[
            { dir: "Inbound", desc: "Devices push payloads to the REST Ingest API or publish to MQTT brokers configured here." },
            { dir: "Processing", desc: "The platform normalises metrics, updates dynamic attributes, evaluates alarm rules, and fires runtime expressions." },
            { dir: "Outbound", desc: "Alarm events and telemetry updates are forwarded to registered Webhook Destinations and broadcast via WebSocket." },
          ].map(({ dir, desc }) => (
            <div key={dir} className="space-y-1">
              <p className="font-semibold text-foreground">{dir}</p>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
