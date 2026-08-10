import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { RefreshCw, Maximize2, Bell } from "lucide-react";
import {
  useGetDashboardSummary, useGetDashboardAttention, useGetDashboardHealthIndex,
  useGetDashboardAlarmTrend, useGetDashboardIngestSeries, useGetDashboardLiveMetrics,
  getGetDashboardAttentionQueryKey, getGetDashboardHealthIndexQueryKey,
  getGetDashboardAlarmTrendQueryKey, getGetDashboardIngestSeriesQueryKey,
  getGetDashboardLiveMetricsQueryKey,
  useListAssets,
} from "@workspace/api-client-react";
import { useWsEvents } from "@/hooks/useWsEvents";
import { useCurrentUser } from "@/contexts/UserContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusRibbon } from "@/features/home/StatusRibbon";
import { BandOverview } from "@/features/home/BandOverview";
import { BandAttention, type ActivityEntry } from "@/features/home/BandAttention";
import { BandLiveSignals, type FeedRow } from "@/features/home/BandLiveSignals";
import { BandTrends } from "@/features/home/BandTrends";
import { SetupChecklist } from "@/features/home/SetupChecklist";
import { ViewSwitch } from "@/features/home/ViewSwitch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** How often each band re-fetches. Live things are pushed; the rest is polled. */
const REFRESH = {
  attention: 30_000,
  liveMetrics: 30_000,
  ingest: 60_000,
  health: 300_000,
  trend: 300_000,
};

/** Newest telemetry messages kept in the live feed. */
const FEED_LIMIT = 12;

interface TelemetryEvent {
  assetId?: string; assetName?: string; deviceId?: string;
  metric?: string; value?: unknown; timestamp?: string;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The banded Home page — A + B + C from the approved mockup.
 *
 * Reading order is deliberate: who you are → what needs you → what the sensors
 * say → where it is heading. An operator stops after band 2, a manager reads 1
 * and 4, an engineer lives in 3. One layout rather than three, because four
 * role-specific dashboards is four things to keep working.
 */
export default function HomeOverview() {
  const [, navigate] = useLocation();
  const { currentUser } = useCurrentUser();

  // `queryKey` is passed explicitly because the generated options type requires
  // it. The hook would default it, but the type does not know that, and casting
  // the whole options object away would silence real mistakes alongside this one.
  const summary = useGetDashboardSummary();
  const attention = useGetDashboardAttention(undefined, {
    query: { queryKey: getGetDashboardAttentionQueryKey(), refetchInterval: REFRESH.attention },
  });
  const health = useGetDashboardHealthIndex(undefined, {
    query: { queryKey: getGetDashboardHealthIndexQueryKey(), refetchInterval: REFRESH.health },
  });
  const trend = useGetDashboardAlarmTrend(undefined, {
    query: { queryKey: getGetDashboardAlarmTrendQueryKey(), refetchInterval: REFRESH.trend },
  });
  const ingest = useGetDashboardIngestSeries(undefined, {
    query: { queryKey: getGetDashboardIngestSeriesQueryKey(), refetchInterval: REFRESH.ingest },
  });
  const live = useGetDashboardLiveMetrics(undefined, {
    query: { queryKey: getGetDashboardLiveMetricsQueryKey(), refetchInterval: REFRESH.liveMetrics },
  });
  const assets = useListAssets();

  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const feedSeq = useRef(0);

  // The activity log is not in the generated client, so it is fetched directly.
  // A read with no side effects needs no CSRF token; `apiFetch` matters for
  // writes, which this page does not do.
  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/activity-log?limit=8`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setActivities(data.entries ?? []);
      }
    } catch { /* the panel renders its own empty state */ }
  }, []);

  useEffect(() => { void fetchActivities(); }, [fetchActivities]);

  const refetchAll = useCallback(() => {
    void attention.refetch();
    void live.refetch();
    void ingest.refetch();
    void summary.refetch();
    void fetchActivities();
  }, [attention, live, ingest, summary, fetchActivities]);

  const wsStatus = useWsEvents({
    // An alarm event changes the queue and the counters, so both are refreshed.
    // The trend and health index are 5-minute views — repolling them on every
    // alarm would be a lot of database work to move a 30-day chart by one pixel.
    alarm: () => { void attention.refetch(); void summary.refetch(); },
    activity_log: () => { void fetchActivities(); },
    telemetry: (data) => {
      const evt = data as TelemetryEvent;
      if (!evt?.metric) return;
      setFeed((prev) => [
        {
          key: `f${feedSeq.current++}`,
          assetName: evt.assetName ?? evt.deviceId ?? "Unknown asset",
          metric: evt.metric!,
          value: typeof evt.value === "number" || typeof evt.value === "string" ? evt.value : null,
          at: Date.now(),
        },
        ...prev,
      ].slice(0, FEED_LIMIT));
    },
  });

  const assetList = (assets.data as Array<{ id: string }> | undefined) ?? [];

  const setupCounts = useMemo(() => ({
    assets: assetList.length,
    users: summary.data?.totalUsers ?? 0,
    brokers: summary.data?.connectedBrokers ?? 0,
    rules: trend.data?.rules.total ?? 0,
    // Not in any summary endpoint; a dashboard count would need its own query.
    // Treated as "unknown, so not yet done" rather than fetched for one tick box.
    dashboards: 0,
  }), [assetList.length, summary.data, trend.data]);

  const hasTelemetry = (ingest.data?.totalPoints ?? 0) > 0
    || (live.data?.tiles.length ?? 0) > 0
    || Boolean(summary.data?.lastIngestionAt);

  // Bands 3 and 4 have nothing to draw before any data exists. Rendering four
  // empty charts is exactly the failure the old dashboard had, so the page
  // collapses to the checklist instead and grows into the full layout on its own.
  const isFreshInstall = !hasTelemetry && assetList.length <= 1
    && (trend.data?.totals ?? 0) === 0;

  const loading = attention.isLoading || health.isLoading || summary.isLoading;
  const openAlarms = attention.data?.counts.alarm ?? 0;

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  return (
    <div className="p-6 pb-10 max-w-[1600px] mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-tight">
            {greeting()}{currentUser?.fullName ? `, ${currentUser.fullName.split(" ")[0]}` : ""}
          </h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            {openAlarms > 0
              ? <>Plant overview · <span className="text-orange-500 font-medium">
                  {attention.data?.counts.total} item{attention.data?.counts.total === 1 ? "" : "s"} need attention
                </span></>
              : "Plant overview · nothing is waiting on you"}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <ViewSwitch />
          <Button variant="outline" size="icon" className="h-9 w-9" title="Refresh now"
                  onClick={refetchAll}>
            <RefreshCw className={cn("w-4 h-4", attention.isFetching && "animate-spin")} />
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9" title="Toggle fullscreen"
                  onClick={toggleFullscreen}>
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9 relative" title="Active alarms"
                  onClick={() => navigate("/alarms")}>
            <Bell className="w-4 h-4" />
            {openAlarms > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center
                               justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                {openAlarms}
              </span>
            )}
          </Button>
        </div>
      </div>

      <StatusRibbon summary={summary.data} attention={attention.data}
                    ingest={ingest.data} wsStatus={wsStatus} />

      {isFreshInstall ? (
        <div className="mt-5">
          <SetupChecklist counts={setupCounts} hasTelemetry={hasTelemetry} />
        </div>
      ) : (
        <>
          <BandOverview health={health.data} trend={trend.data} attention={attention.data}
                        ingest={ingest.data} loading={loading} />

          <BandAttention data={attention.data} activities={activities} loading={loading} />

          <BandLiveSignals live={live.data} ingest={ingest.data} feed={feed}
                           loading={live.isLoading} />

          <BandTrends trend={trend.data} ingest={ingest.data} loading={trend.isLoading} />
        </>
      )}
    </div>
  );
}
