import { useMemo } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { DashboardHealthIndex, DashboardAlarmTrend, DashboardAttention, DashboardIngestSeries, HealthNode }
  from "@workspace/api-client-react";
import {
  Panel, KpiTile, Track, BandHeader, EmptyHint, PanelSkeleton,
  scoreTone, formatDuration, formatCount, SEVERITY,
} from "./primitives";

/**
 * Band 1 — "How are we doing?"
 *
 * The Health Index, six KPI tiles, and the hierarchy rollup. Nothing here is
 * real-time; the whole band is happy on a five-minute refresh.
 */

function Gauge({ score }: { score: number }) {
  // Semicircle: r=80 → arc length ≈ 251. The dash offset walks the stroke back
  // from full, so offset 251 is empty and 0 is a complete half-circle.
  const arc = 251;
  const tone = scoreTone(score);
  const stroke = tone.bar === "bg-green-500" ? "#22c55e"
    : tone.bar === "bg-amber-500" ? "#f59e0b"
    : tone.bar === "bg-orange-500" ? "#f97316" : "#ef4444";
  return (
    <svg viewBox="0 0 200 116" className="w-full max-w-[220px] mx-auto" role="img"
         aria-label={`Health index ${score} out of 100`}>
      <path d="M20,104 A80,80 0 0,1 180,104" fill="none" stroke="currentColor"
            className="text-muted" strokeWidth="13" strokeLinecap="round" />
      <path d="M20,104 A80,80 0 0,1 180,104" fill="none" stroke={stroke}
            strokeWidth="13" strokeLinecap="round"
            strokeDasharray={arc}
            strokeDashoffset={arc - (arc * Math.max(0, Math.min(100, score))) / 100}
            style={{ transition: "stroke-dashoffset 600ms ease" }} />
      <text x="100" y="92" textAnchor="middle" className="fill-foreground"
            fontSize="38" fontWeight="600">{score}</text>
      <text x="100" y="110" textAnchor="middle" className="fill-muted-foreground" fontSize="10.5">
        out of 100
      </text>
    </svg>
  );
}

function Branch({ node, depth, onPick }: {
  node: HealthNode; depth: number; onPick: (id: string) => void;
}) {
  const tone = scoreTone(node.score);
  return (
    <>
      <button type="button" onClick={() => onPick(node.id)}
              className="w-full text-left group" style={{ paddingLeft: depth * 16 }}>
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className={cn("truncate group-hover:underline",
            depth === 0 ? "text-[13px] font-semibold" : "text-xs text-muted-foreground")}>
            {node.name}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {node.score} · {node.assetCount} asset{node.assetCount === 1 ? "" : "s"}
          </span>
        </div>
        <Track value={node.score} barClassName={tone.bar} className={depth === 0 ? "h-2" : undefined} />
      </button>
      {node.children.map((child) => (
        <Branch key={child.id} node={child} depth={depth + 1} onPick={onPick} />
      ))}
    </>
  );
}

export function BandOverview({ health, trend, attention, ingest, loading }: {
  health?: DashboardHealthIndex;
  trend?: DashboardAlarmTrend;
  attention?: DashboardAttention;
  ingest?: DashboardIngestSeries;
  loading: boolean;
}) {
  const [, navigate] = useLocation();

  const openAlarms = attention?.counts.alarm ?? 0;
  const bySeverity = attention?.counts.bySeverity;

  // Availability is derived here rather than server-side because it is a
  // presentation of the same downtime term the score already reports — a second
  // endpoint computing a second definition of "available" is how two numbers
  // that should agree stop agreeing.
  const availability = useMemo(() => {
    if (!health || !trend) return null;
    const windowSeconds = health.window.days * 86_400;
    const assets = Math.max(1, health.assetCount);
    const down = trend.worstPerformers.reduce((s, w) => s + w.openSeconds, 0);
    return Math.max(0, Math.min(100, 100 - (down / (windowSeconds * assets)) * 100));
  }, [health, trend]);

  const totalDowntime = trend?.worstPerformers.reduce((s, w) => s + w.openSeconds, 0) ?? 0;

  return (
    <>
      <BandHeader n={1} title="Overview" question="“How are we doing?”"
                  context={health ? `Rolling ${health.window.days} days` : undefined} />

      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_320px] gap-3.5">

        {/* ── Health Index ── */}
        <Panel title="Health Index" sub="Composite score">
          {loading && !health ? <PanelSkeleton rows={4} /> : !health ? (
            <EmptyHint title="No score yet" hint="Add an asset to start scoring." />
          ) : (
            <div className="p-4 pt-5">
              <Gauge score={health.overall} />
              {/* No week-on-week delta: nothing persists a daily snapshot, so a
                  trend arrow here would be invented. `previous` stays null until
                  something stores history. */}
              <p className="text-center text-[11px] text-muted-foreground mt-1">
                across {health.assetCount} asset{health.assetCount === 1 ? "" : "s"}
              </p>

              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mt-5 mb-2.5">
                What's costing points
              </p>
              {([
                ["Alarm burden", health.factors.alarmBurden, "bg-amber-500"],
                ["Unplanned downtime", health.factors.downtime, "bg-orange-500"],
                ["Data completeness", health.factors.staleness, "bg-green-500"],
              ] as const).map(([label, cost, bar]) => (
                <div key={label} className="mb-2.5 last:mb-0">
                  <div className="flex items-center justify-between text-[11.5px] mb-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="tabular-nums">{cost > 0 ? `−${cost}` : "0"}</span>
                  </div>
                  <Track value={100 - Math.min(100, cost)} barClassName={bar} />
                </div>
              ))}
              <p className="text-[10.5px] text-muted-foreground mt-3 pt-3 border-t border-border">
                Score is 100 minus these three, so the arithmetic on screen always adds up.
              </p>
            </div>
          )}
        </Panel>

        {/* ── KPI grid ── */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3.5 content-start">
          <KpiTile
            label="Needs action"
            value={openAlarms}
            unit={openAlarms === 1 ? "open alarm" : "open alarms"}
            className={openAlarms > 0 ? "border-red-500/30" : undefined}
            badge={openAlarms > 0
              ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-500">{openAlarms}</span>
              : undefined}
            footLeft={bySeverity
              ? `${bySeverity.critical} crit · ${bySeverity.high} high · ${bySeverity.medium} med`
              : "—"}
          >
            <div className="flex gap-[3px] mt-2 mb-1">
              {(["critical", "high", "medium", "low"] as const).map((s) => {
                const n = bySeverity?.[s] ?? 0;
                return <span key={s} className={cn("h-1 rounded-sm", n > 0 ? SEVERITY[s].bar : "bg-muted")}
                             style={{ flex: Math.max(1, n) }} />;
              })}
            </div>
          </KpiTile>

          <KpiTile
            label="Availability"
            value={availability == null ? "—" : availability.toFixed(1)}
            unit={availability == null ? undefined : "%"}
            footLeft={health ? `${health.window.days}-day` : undefined}
          >
            <Track value={availability ?? 0} className="mt-2.5 mb-1" barClassName="bg-green-500" />
          </KpiTile>

          <KpiTile
            label="MTTA / MTTR"
            value={<>
              {formatDuration(trend?.mttaSeconds ?? null)}
              <span className="text-muted-foreground font-medium"> / {formatDuration(trend?.mttrSeconds ?? null)}</span>
            </>}
            footLeft="Acknowledge / resolve"
            footRight={trend ? `${trend.clearedCount} cleared` : undefined}
          />

          <KpiTile
            label="Downtime"
            value={formatDuration(totalDowntime)}
            footLeft={health ? `${health.window.days}-day` : undefined}
            footRight={trend ? `${trend.worstPerformers.length} asset(s)` : undefined}
          >
            <Track value={Math.min(100, (totalDowntime / 3600) * 5)} className="mt-2.5 mb-1"
                   barClassName="bg-orange-500" />
          </KpiTile>

          <KpiTile
            label="Data points ingested"
            value={formatCount(ingest?.totalPoints ?? 0)}
            footLeft={ingest ? `last ${ingest.window.hours} h` : undefined}
            footRight={ingest ? `peak ${ingest.peakPerMinute}/min` : undefined}
          />

          <KpiTile
            label="Alarms this hour"
            value={trend?.alarmsLastHour ?? 0}
            footLeft={trend ? `${trend.rules.enabled} rule(s) enabled` : undefined}
            footRight={trend && trend.rules.neverFired > 0
              ? <span className="text-amber-500">{trend.rules.neverFired} never fired</span>
              : undefined}
          />
        </div>

        {/* ── Hierarchy ── */}
        <Panel title="Health by hierarchy" sub="Rolled up from asset scores">
          {loading && !health ? <PanelSkeleton rows={5} /> : !health || health.tree.length === 0 ? (
            <EmptyHint title="No assets yet"
                       hint="Create a plant and a few assets and this becomes a map of where the score is going." />
          ) : (
            <div className="p-4 space-y-2.5">
              {health.tree.map((node) => (
                <Branch key={node.id} node={node} depth={0} onPick={() => navigate("/assets")} />
              ))}
              <p className="text-[10.5px] text-muted-foreground pt-3 mt-1 border-t border-border">
                Worst branch first. Click a branch to open it in Assets.
              </p>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
