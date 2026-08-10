import { useMemo } from "react";
import { useLocation } from "wouter";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardAlarmTrend, DashboardIngestSeries } from "@workspace/api-client-react";
import {
  Panel, BandHeader, EmptyHint, PanelSkeleton, StackedBars, Legend,
  SEVERITY, formatDuration, formatCount,
} from "./primitives";

/**
 * Band 4 — "Is this getting better or worse?"
 *
 * Alarm trend, worst performers, ingest throughput and per-device connectivity.
 * Everything here is a 30-day or 24-hour view; nothing needs to be live.
 */

function ConnectivityMatrix({ ingest }: { ingest: DashboardIngestSeries }) {
  // The busiest hour sets the scale. A device sending 4 messages an hour and one
  // sending 40,000 both read as "reporting" — the distinction the matrix is for
  // is reporting vs silent, not volume.
  return (
    <div className="space-y-2">
      {ingest.devices.map((d) => (
        <div key={d.deviceId} className="grid grid-cols-[84px_1fr] gap-2 items-center">
          <span className={cn("text-[10.5px] truncate", d.bound ? "text-muted-foreground" : "text-violet-400")}
                title={d.bound ? d.deviceId : `${d.deviceId} — no asset bound`}>
            {d.deviceId}
          </span>
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${d.buckets.length}, 1fr)` }}>
            {d.buckets.map((n, i) => (
              <span key={i} className="h-3 rounded-[2px]"
                    title={`${new Date(ingest.hours[i]).toLocaleString()} — ${n} message${n === 1 ? "" : "s"}`}
                    style={{ background: n === 0 ? "hsl(var(--muted))" : d.bound ? "#2dd4bf" : "#8b5cf6" }} />
            ))}
          </div>
        </div>
      ))}
      <Legend items={[
        { color: "#2dd4bf", label: "Reporting" },
        { color: "hsl(var(--muted))", label: "Silent" },
        { color: "#8b5cf6", label: "No asset bound" },
      ]} />
    </div>
  );
}

export function BandTrends({ trend, ingest, loading }: {
  trend?: DashboardAlarmTrend;
  ingest?: DashboardIngestSeries;
  loading: boolean;
}) {
  const [, navigate] = useLocation();

  const bars = useMemo(
    () => (trend?.series ?? []).map((d) => ({
      label: d.date,
      critical: d.critical, high: d.high, medium: d.medium, low: d.low, info: d.info,
    })),
    [trend],
  );

  const ingestData = useMemo(
    () => (ingest?.series ?? []).map((p) => ({ t: new Date(p.minute).getTime(), n: p.count })),
    [ingest],
  );

  const changeTone = trend?.changePct == null ? "text-muted-foreground"
    : trend.changePct > 0 ? "text-red-500" : trend.changePct < 0 ? "text-green-500" : "text-muted-foreground";

  return (
    <>
      <BandHeader n={4} title="Trends & reliability" question="“Is this getting better or worse?”"
                  context={trend ? `${trend.window.days} days` : undefined} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">

        <Panel className="lg:col-span-2" title="Alarm trend" sub="Daily count by severity">
          {loading && !trend ? <PanelSkeleton rows={3} /> : !trend || trend.totals === 0 ? (
            <EmptyHint
              icon={TrendingUp}
              title="No alarm history yet"
              hint="Once alarm rules start firing and clearing, this chart shows whether the plant is getting noisier or quieter, and the MTTA/MTTR below become meaningful."
            />
          ) : (
            <div className="p-4">
              <StackedBars data={bars} keys={["critical", "high", "medium", "low"]} height={90} />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
                <span>{bars[0]?.label}</span>
                <span>{bars[Math.floor(bars.length / 2)]?.label}</span>
                <span>today</span>
              </div>
              <Legend items={(["critical", "high", "medium", "low"] as const)
                .map((s) => ({ color: SEVERITY[s].hex, label: SEVERITY[s].label }))} />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border">
                <div>
                  <p className="text-[10.5px] text-muted-foreground">Total</p>
                  <p className="text-[15px] font-semibold tabular-nums">{trend.totals}</p>
                </div>
                <div>
                  <p className="text-[10.5px] text-muted-foreground">Second half vs first</p>
                  <p className={cn("text-[15px] font-semibold tabular-nums", changeTone)}>
                    {trend.changePct == null ? "—"
                      : `${trend.changePct > 0 ? "+" : ""}${trend.changePct}%`}
                  </p>
                </div>
                <div>
                  <p className="text-[10.5px] text-muted-foreground">MTTA</p>
                  <p className="text-[15px] font-semibold tabular-nums">{formatDuration(trend.mttaSeconds)}</p>
                </div>
                <div>
                  <p className="text-[10.5px] text-muted-foreground">MTTR</p>
                  <p className="text-[15px] font-semibold tabular-nums">{formatDuration(trend.mttrSeconds)}</p>
                </div>
              </div>
              {trend.peak && trend.peak.total > 0 && (
                <p className="text-[10.5px] text-muted-foreground mt-3">
                  Busiest day: {trend.peak.date} with {trend.peak.total} alarm{trend.peak.total === 1 ? "" : "s"}.
                </p>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Worst performers" sub={trend ? `${trend.window.days}-day alarms and open time` : undefined}>
          {!trend || trend.worstPerformers.length === 0 ? (
            <p className="px-4 py-8 text-xs text-muted-foreground text-center">
              No asset has raised an alarm in this window
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground border-b border-border">
                  <th className="text-left font-semibold px-4 py-2.5">Asset</th>
                  <th className="text-right font-semibold px-2 py-2.5">Alarms</th>
                  <th className="text-right font-semibold px-4 py-2.5">Open</th>
                </tr>
              </thead>
              <tbody>
                {trend.worstPerformers.map((w) => (
                  <tr key={w.assetId}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate("/assets")}>
                    <td className="px-4 py-2.5 font-medium truncate max-w-[150px]">{w.assetName}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{w.alarms}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatDuration(w.openSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">

        <Panel title="Ingest throughput"
               sub={ingest ? `Messages per minute · ${ingest.window.hours} hours` : undefined}>
          {loading && !ingest ? <PanelSkeleton rows={2} /> : !ingest || ingestData.length === 0 ? (
            <EmptyHint
              title="No messages in this window"
              hint="This is the panel that tells a quiet plant apart from a broken pipeline — a flat line here with a recent 'last message' means quiet; nothing at all means the pipeline stopped."
            />
          ) : (
            <div className="p-4">
              <ResponsiveContainer width="100%" height={92}>
                <AreaChart data={ingestData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                  <defs>
                    <linearGradient id="homeIngestFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" hide />
                  <YAxis tick={{ fontSize: 9 }} className="fill-muted-foreground" stroke="currentColor" width={40} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, background: "hsl(var(--card))",
                                    border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                    formatter={(v: number) => [v, "messages"]} />
                  <Area type="monotone" dataKey="n" stroke="#2dd4bf" strokeWidth={1.6}
                        fill="url(#homeIngestFill)" isAnimationActive={false} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex justify-between mt-3 pt-3 border-t border-border">
                <div>
                  <p className="text-[10.5px] text-muted-foreground">Latest minute</p>
                  <p className="text-[13px] font-semibold tabular-nums">{ingest.currentPerMinute}</p>
                </div>
                <div>
                  <p className="text-[10.5px] text-muted-foreground">Peak</p>
                  <p className="text-[13px] font-semibold tabular-nums">{ingest.peakPerMinute}</p>
                </div>
                <div>
                  <p className="text-[10.5px] text-muted-foreground">Total</p>
                  <p className="text-[13px] font-semibold tabular-nums">{formatCount(ingest.totalPoints)}</p>
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Connectivity" sub="Messages per device, per hour, last 24 h">
          {!ingest || ingest.devices.length === 0 ? (
            <EmptyHint
              title="No devices reporting"
              hint="Each row is a device id and each cell an hour, so a gap in reporting is visible without opening anything."
            />
          ) : (
            <div className="p-4"><ConnectivityMatrix ingest={ingest} /></div>
          )}
        </Panel>

        <Panel title="Rule engine" sub="Alarm rules and what they are doing">
          {!trend ? <PanelSkeleton rows={2} /> : (
            <div className="p-4 text-[12.5px]">
              {([
                ["Rules configured", trend.rules.total, null],
                ["Enabled", trend.rules.enabled, null],
                ["Alarms raised this hour", trend.alarmsLastHour, null],
                ["Acknowledged in window", trend.acknowledgedCount, null],
                ["Cleared in window", trend.clearedCount, null],
                ["Never fired in window", trend.rules.neverFired,
                  trend.rules.neverFired > 0 ? "text-amber-500" : null],
              ] as const).map(([label, value, tone]) => (
                <div key={label}
                     className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={cn("font-semibold tabular-nums", tone)}>{value}</span>
                </div>
              ))}
              {trend.rules.neverFired > 0 && (
                <p className="text-[10.5px] text-muted-foreground mt-3 pt-3 border-t border-border">
                  A rule that never fires is usually watching a metric no asset sends. Nothing errors — it
                  simply never does anything.
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
