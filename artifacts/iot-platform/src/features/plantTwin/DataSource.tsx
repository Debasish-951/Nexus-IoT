import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, PlugZap } from "lucide-react";
import { useListAssets } from "@workspace/api-client-react";
import { fetchPlantValues } from "./api";

export interface DataSourceReading { k: string; n: string; metric: string | null }

/** Metric name a device should send so the reading links by itself: "Winding temperature" → "winding_temperature". */
export const suggestedMetric = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function ago(ts: string | null, t: (s: string, v?: Record<string, string | number>) => string): string {
  if (!ts) return t("no data yet");
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return t("{n} s ago", { n: Math.round(s) });
  if (s < 5400) return t("{n} min ago", { n: Math.round(s / 60) });
  if (s < 172800) return t("{n} h ago", { n: Math.round(s / 3600) });
  return new Date(ts).toLocaleString();
}

/**
 * Where a twin's data comes from. A twin never talks to devices itself: devices
 * send telemetry to an asset (Integration Hub: HTTP, MQTT, Azure IoT), matched by
 * the payload's deviceId = the asset's identifier, and the twin reads that
 * asset's metrics. This card shows the chain, when data last arrived, and the
 * payload a device must send so every reading links by name.
 */
export function DataSourceCard({ assetId, readings }: { assetId: string | null | undefined; readings: DataSourceReading[] }) {
  const [, navigate] = useLocation();
  const t = useT();
  const { toast } = useToast();
  const { data: assetsData } = useListAssets();
  const asset = useMemo(() => ((assetsData as any[] | undefined) ?? []).find((a: any) => a.id === assetId) as { id: string; name: string; identifier?: string } | undefined, [assetsData, assetId]);
  const pairs = useMemo(() => (assetId ? readings.filter((r) => r.metric).map((r) => ({ assetId, metric: r.metric! })) : []), [assetId, readings]);
  const pairsKey = pairs.map((p) => p.metric).join("|");
  const [last, setLast] = useState<{ ts: string | null; got: number } | null>(null);
  useEffect(() => {
    setLast(null);
    if (!pairs.length) return;
    let cancelled = false;
    const load = () => fetchPlantValues(pairs).then((rows) => {
      if (cancelled) return;
      const ts = rows.map((r) => r.ts).filter(Boolean).sort().pop() ?? null;
      setLast({ ts, got: rows.filter((r) => r.value != null).length });
    }).catch(() => { /* shown as unknown */ });
    void load(); const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, pairsKey]);

  const deviceId = asset?.identifier || "<asset identifier>";
  const sample = JSON.stringify({
    deviceId,
    timestamp: "2026-01-01T00:00:00Z",
    metrics: Object.fromEntries(readings.map((r) => [r.metric || suggestedMetric(r.n), 0])),
  }, null, 2);
  const linked = readings.filter((r) => r.metric).length;
  const copy = () => { void navigator.clipboard?.writeText(sample).then(() => toast({ title: t("Sample payload copied") }), () => toast({ title: t("Copy failed"), description: t("Select the text and copy it instead."), variant: "destructive" })); };

  return (
    <div className="space-y-2 text-xs">
      <div className="rounded-md border border-border p-2 space-y-1">
        <div className="flex items-center gap-1.5 font-medium"><PlugZap className="w-3.5 h-3.5 text-primary" /> {t("Device → asset → this twin")}</div>
        {assetId ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
            <dt>{t("Asset")}</dt><dd className="text-foreground truncate">{asset?.name ?? t("Asset outside this project")}</dd>
            <dt>deviceId</dt><dd className="font-mono text-foreground truncate">{asset?.identifier ?? t("unknown")}</dd>
            <dt>{t("Linked")}</dt><dd className="text-foreground">{t("{a} of {b} readings", { a: linked, b: readings.length })}</dd>
            <dt>{t("Last data")}</dt><dd className={last?.ts ? "text-foreground" : "text-amber-600 dark:text-amber-400"}>{pairs.length ? (last ? ago(last.ts, t) : t("checking…")) : t("no reading linked yet")}</dd>
          </dl>
        ) : (
          <p className="text-muted-foreground">{t("Not connected. Pick the asset this machine is, above. Devices send data to an asset through Integration Hub, using the asset's identifier as deviceId.")}</p>
        )}
      </div>
      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-2 py-1.5 font-medium">{t("Payload a device sends")}</summary>
        <div className="px-2 pb-2 space-y-1.5">
          <p className="text-muted-foreground">{t("POST to /api/ingest/payload with an API client key, or publish the same JSON over MQTT. Metric names that match the readings link by themselves.")}</p>
          <pre className="font-mono text-[10.5px] bg-muted rounded p-2 overflow-x-auto whitespace-pre">{sample}</pre>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copy}><Copy className="w-3 h-3 mr-1" />{t("Copy")}</Button>
        </div>
      </details>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate("/integrations")}><ExternalLink className="w-3 h-3 mr-1" />{t("Set up data sources in Integration Hub")}</Button>
    </div>
  );
}
