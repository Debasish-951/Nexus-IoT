import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardIngestSeries } from "@workspace/api-client-react";
import { Panel, BandHeader, EmptyHint, formatValue } from "./primitives";

/**
 * Band 3 — "What are the sensors actually saying?"
 *
 * The data-quality mix and a streaming feed. This is the band that goes quiet on
 * a system with no telemetry, so every widget in it has an empty state that says
 * what would fill it.
 */

export interface FeedRow {
  key: string;
  assetName: string;
  metric: string;
  value: number | string | null;
  at: number;
}

export function BandLiveSignals({ ingest, feed }: {
  ingest?: DashboardIngestSeries;
  feed: FeedRow[];
}) {
  const quality = ingest?.quality ?? {};
  const qualityTotal = Object.values(quality).reduce((s, n) => s + n, 0);
  const QUALITY_COLOUR: Record<string, string> = {
    good: "#22c55e", uncertain: "#f59e0b", bad: "#ef4444", unknown: "#6b7686",
  };

  return (
    <>
      <BandHeader n={3} title="Live signals" question="“What are the sensors actually saying?”"
                  context="Streaming" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Panel title="Data quality" sub="Newest 1,000 readings">
            {qualityTotal === 0 ? (
              <p className="px-4 py-5 text-xs text-muted-foreground text-center">No readings yet</p>
            ) : (
              <div className="p-4 space-y-2.5">
                <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                  {Object.entries(quality).map(([k, n]) => (
                    <span key={k} style={{ width: `${(n / qualityTotal) * 100}%`,
                                           background: QUALITY_COLOUR[k] ?? QUALITY_COLOUR.unknown }} />
                  ))}
                </div>
                {Object.entries(quality)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <div key={k} className="flex items-center justify-between text-[11.5px]">
                      <span className="inline-flex items-center gap-2 capitalize">
                        <i className="w-2 h-2 rounded-[2px]"
                           style={{ background: QUALITY_COLOUR[k] ?? QUALITY_COLOUR.unknown }} />
                        {k}
                      </span>
                      <span className="tabular-nums font-medium">
                        {((n / qualityTotal) * 100).toFixed(n / qualityTotal > 0.99 ? 0 : 1)}%
                      </span>
                    </div>
                  ))}
                <p className="text-[10.5px] text-muted-foreground pt-2.5 border-t border-border">
                  Readings marked bad are excluded from rule evaluation.
                </p>
              </div>
            )}
          </Panel>

          <Panel
            title="Live feed"
            sub="Straight off the WebSocket"
            badge={<span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("w-1.5 h-1.5 rounded-full", feed.length ? "bg-green-500 animate-pulse" : "bg-muted-foreground")} />
              {feed.length ? "live" : "idle"}
            </span>}
          >
            {feed.length === 0 ? (
              <EmptyHint
                icon={Radio}
                title="Waiting for data"
                hint="Messages appear here the instant they are ingested. Nothing has arrived since this page opened."
              />
            ) : (
              <div className="max-h-[220px] overflow-y-auto">
                {feed.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 px-4 py-2
                                                border-b border-border/40 last:border-0">
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-mono truncate">{row.metric}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{row.assetName}</p>
                    </div>
                    <span className="text-xs font-semibold tabular-nums shrink-0">
                      {typeof row.value === "number" ? formatValue(row.value) : String(row.value ?? "—")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
      </div>
    </>
  );
}
