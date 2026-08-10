import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Radio, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardLiveMetrics, DashboardIngestSeries, LiveMetricTile } from "@workspace/api-client-react";
import {
  Panel, KpiTile, BandHeader, EmptyHint, Sparkline,
  SEVERITY, severityOf, formatValue,
} from "./primitives";

/**
 * Band 3 — "What are the sensors actually saying?"
 *
 * Live tiles, one expanded chart, the data-quality mix and a streaming feed.
 * This is the band that goes quiet on a system with no telemetry, so every
 * widget in it has an empty state that says what would fill it.
 */

export interface FeedRow {
  key: string;
  assetName: string;
  metric: string;
  value: number | string | null;
  at: number;
}

function Tile({ tile, onOpen }: { tile: LiveMetricTile; onOpen: () => void }) {
  const sev = tile.inAlarm ? severityOf(tile.severity) : null;
  const colour = sev ? SEVERITY[sev].hex : "#2dd4bf";
  const points = tile.series.map((p) => p.v);

  return (
    <button type="button" onClick={onOpen} className="text-left">
      <KpiTile
        className={cn("h-full transition-colors hover:border-foreground/20",
          tile.inAlarm && "border-red-500/30")}
        label={tile.metric}
        badge={tile.inAlarm
          ? <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", SEVERITY[severityOf(tile.severity)].chip)}>
              alarm
            </span>
          : undefined}
        value={<span className={cn(tile.inAlarm && SEVERITY[severityOf(tile.severity)].text)}>
          {formatValue(tile.current)}
        </span>}
        footLeft={tile.assetName}
        footRight={tile.threshold != null
          ? `${tile.operator ?? ""} ${formatValue(tile.threshold)}`.trim()
          : `min ${formatValue(tile.min)}`}
      >
        <Sparkline points={points} color={colour} threshold={tile.threshold ?? null} className="my-1" />
      </KpiTile>
    </button>
  );
}

export function BandLiveSignals({ live, ingest, feed, loading }: {
  live?: DashboardLiveMetrics;
  ingest?: DashboardIngestSeries;
  feed: FeedRow[];
  loading: boolean;
}) {
  const [, navigate] = useLocation();
  const tiles = live?.tiles ?? [];

  // The expanded chart follows the first tile — which is whatever is in alarm,
  // then whatever has a rule watching it. It promotes itself; nobody configures
  // which metric gets the big panel.
  const focus = tiles[0];
  const chartData = useMemo(
    () => (focus?.series ?? []).map((p) => ({
      t: new Date(p.t).getTime(),
      v: p.v,
    })),
    [focus],
  );

  const quality = ingest?.quality ?? {};
  const qualityTotal = Object.values(quality).reduce((s, n) => s + n, 0);
  const QUALITY_COLOUR: Record<string, string> = {
    good: "#22c55e", uncertain: "#f59e0b", bad: "#ef4444", unknown: "#6b7686",
  };

  return (
    <>
      <BandHeader n={3} title="Live signals" question="“What are the sensors actually saying?”"
                  context="Streaming" />

      {loading && !live ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[112px] rounded-lg border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <Panel title="Live metrics" sub="Current values with their thresholds">
          <EmptyHint
            icon={Gauge}
            title="No numeric telemetry yet"
            hint="Tiles appear on their own once data arrives — whatever is in alarm first, then metrics with a rule watching them, then whatever is most active. Nothing to configure."
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
            {tiles.map((t) => (
              <Tile key={`${t.assetId}-${t.metric}`} tile={t}
                    onOpen={() => navigate(`/data-explorer?assetId=${t.assetId}&metric=${encodeURIComponent(t.metric)}`)} />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Ordered automatically: metrics in alarm first, then those with a rule watching them, then the most active.
          </p>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        <Panel
          className="lg:col-span-2"
          title={focus ? `${focus.metric} — ${focus.assetName}` : "Metric detail"}
          sub={focus?.ruleName ? `Watched by rule “${focus.ruleName}”` : "Most recent readings"}
        >
          {!focus || chartData.length < 2 ? (
            <EmptyHint title="Nothing to chart yet"
                       hint="This panel follows the first tile above." />
          ) : (
            <div className="p-4 pt-5">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="homeMetricFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={focus.inAlarm ? "#ef4444" : "#2dd4bf"} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={focus.inAlarm ? "#ef4444" : "#2dd4bf"} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
                         tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                         tick={{ fontSize: 10 }} className="fill-muted-foreground" stroke="currentColor" />
                  <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" stroke="currentColor"
                         width={52} tickFormatter={(v) => formatValue(v)} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, background: "hsl(var(--card))",
                                    border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                    formatter={(v: number) => [formatValue(v), focus.metric]} />
                  <Area type="monotone" dataKey="v" stroke={focus.inAlarm ? "#ef4444" : "#2dd4bf"}
                        strokeWidth={1.8} fill="url(#homeMetricFill)" isAnimationActive={false} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-border text-[11.5px]">
                <span className="text-muted-foreground">Current <b className="text-foreground">{formatValue(focus.current)}</b></span>
                <span className="text-muted-foreground">Min <b className="text-foreground">{formatValue(focus.min)}</b></span>
                <span className="text-muted-foreground">Max <b className="text-foreground">{formatValue(focus.max)}</b></span>
                {focus.threshold != null && (
                  <span className="text-muted-foreground">
                    Threshold <b className="text-foreground">{focus.operator} {formatValue(focus.threshold)}</b>
                  </span>
                )}
              </div>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-3.5">
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
            className="flex-1"
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
      </div>
    </>
  );
}
