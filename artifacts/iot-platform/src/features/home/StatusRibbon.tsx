import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import type { DashboardSummary, DashboardAttention, DashboardIngestSeries } from "@workspace/api-client-react";
import type { WsStatus } from "@/hooks/useWsEvents";
import { Pill, formatCount } from "./primitives";

/**
 * The strip above band 1 — "is the platform actually working?"
 *
 * It answers the question people ask before any other, and it is the one part
 * of the page that stays informative when every count is zero: "ingest live,
 * last message 4s ago, 0 in queue" reads as a healthy quiet system, which five
 * zeroes never did.
 */

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="shrink-0">
      <p className="text-[10.5px] text-muted-foreground leading-none mb-1">{label}</p>
      <p className="text-[13px] font-semibold leading-none">{value}</p>
    </div>
  );
}

export function StatusRibbon({ summary, attention, ingest, wsStatus }: {
  summary?: DashboardSummary;
  attention?: DashboardAttention;
  ingest?: DashboardIngestSeries;
  wsStatus: WsStatus;
}) {
  const lastIngest = ingest?.lastIngestionAt ?? summary?.lastIngestionAt ?? null;
  const lastIngestAge = lastIngest ? Date.now() - new Date(lastIngest).getTime() : null;

  // "Healthy" is a claim, so it is made from evidence rather than from the
  // absence of an error: something arrived recently, and the socket is up.
  const ingesting = lastIngestAge != null && lastIngestAge < 15 * 60_000;
  const tone = ingesting ? "ok" : lastIngest ? "warn" : "muted";

  const unbound = attention?.counts.unboundDevice ?? 0;
  const stale = attention?.counts.stale ?? 0;

  return (
    <Card className="shadow-sm !border-primary/40">
      <CardContent className="px-4 py-3 flex items-center gap-5 flex-wrap">
        <div className="flex items-center gap-2.5 shrink-0">
          <span className={"w-2 h-2 rounded-full shrink-0 " + (
            tone === "ok" ? "bg-green-500" : tone === "warn" ? "bg-amber-500" : "bg-muted-foreground"
          )} />
          <div>
            <p className="text-[13px] font-semibold leading-none">
              {tone === "ok" ? "Platform healthy" : tone === "warn" ? "Ingest has gone quiet" : "Waiting for data"}
            </p>
            <p className="text-[10.5px] text-muted-foreground leading-none mt-1">
              {tone === "ok" ? "Receiving telemetry"
                : tone === "warn" ? "Nothing received in the last 15 minutes"
                : "No telemetry has been received yet"}
            </p>
          </div>
        </div>

        <div className="w-px h-7 bg-border shrink-0 hidden sm:block" />

        <Stat label="Ingest" value={<>{(summary?.telemetryRate ?? 0).toFixed(1)}<span className="text-muted-foreground font-medium text-[11px] ml-1">msg/s</span></>} />
        <Stat label="Last message"
              value={lastIngest ? formatDistanceToNow(new Date(lastIngest), { addSuffix: true }) : "—"} />
        <Stat label="Brokers" value={`${summary?.connectedBrokers ?? 0} connected`} />
        <Stat label="Assets" value={formatCount(summary?.totalAssets ?? 0)} />
        <Stat label="Points (24 h window)" value={formatCount(ingest?.totalPoints ?? 0)} />

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Pill tone={wsStatus === "connected" ? "ok" : "warn"}>
            {wsStatus === "connected" ? "Live updates on" : "Reconnecting…"}
          </Pill>
          {stale > 0 && <Pill tone="warn">{stale} asset{stale === 1 ? "" : "s"} stale</Pill>}
          {unbound > 0 && <Pill tone="warn">{unbound} device{unbound === 1 ? "" : "s"} unbound</Pill>}
        </div>
      </CardContent>
    </Card>
  );
}
