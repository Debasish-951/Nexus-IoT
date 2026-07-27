import { useEffect, useState } from "react";
import { format } from "date-fns";
import { effectiveRangeMinutes, getFromTo, gapFill, GRANULARITY_STEP_MAP, type TimeCfg } from "./timeRange";

export interface Point { t: string; v: number; ts: number }

// Fetch one tag's raw or server-bucketed series for the given time config —
// shared by useTelemetrySeries/useMultiSeries. Mirrors AnalyticsKpi.tsx's
// fetchOneSeries so both dashboards aggregate identically.
async function fetchSeriesRaw(assetId: string, tag: string, timeCfg: TimeCfg): Promise<{ timestamp: string; value: number | null }[]> {
  const { from, to } = getFromTo(timeCfg);
  const rawMinutes = effectiveRangeMinutes(timeCfg);
  const rangeMin = (timeCfg.customFrom || rawMinutes < 0) ? Infinity : Math.max(rawMinutes, 60);
  const hasCustomGran = !!timeCfg.granularity && timeCfg.granularity !== "auto";
  const hasCustomAgg = !!timeCfg.aggType && timeCfg.aggType !== "avg";
  const useAgg = rangeMin > 120 || hasCustomGran || hasCustomAgg;
  const autoGran = rangeMin <= 60 ? "1m" : rangeMin <= 360 ? "5m" : rangeMin <= 1440 ? "15m" : rangeMin <= 4320 ? "1h" : rangeMin <= 10080 ? "6h" : "1d";
  const bucket = hasCustomGran ? (GRANULARITY_STEP_MAP[timeCfg.granularity!] ?? autoGran) : autoGran;
  const aggField = timeCfg.aggType === "sum" ? "sum_val"
    : timeCfg.aggType === "min" ? "min_val"
    : timeCfg.aggType === "max" ? "max_val"
    : timeCfg.aggType === "count" ? "count"
    : "avg_val";

  if (useAgg) {
    const p = new URLSearchParams({ assetId, metric: tag, from, to, bucket, limit: "2000" });
    const json = await fetch(`/api/system/aggregate?${p}`).then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] }));
    const mapped = (json.data ?? []).map((d: any) => {
      const raw = d[aggField] ?? d.avg_val ?? d.max_val ?? d.min_val ?? null;
      return { timestamp: d.bucket, value: raw !== null ? parseFloat(String(raw)) : null };
    });
    return gapFill(mapped, bucket);
  }
  const p = new URLSearchParams({ metric: tag, from, to, limit: "500" });
  const rows: any[] = await fetch(`/api/telemetry/${assetId}?${p}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return rows.map((r) => ({ timestamp: r.timestamp, value: r.value != null ? parseFloat(String(r.value)) : null }));
}

// Fetch a telemetry series for one asset+tag over a time range, optionally polling.
export function useTelemetrySeries(assetId?: string, tag?: string, timeCfg: TimeCfg = {}, refreshSec = 0, nonce: any = 0): { data: Point[]; loading: boolean } {
  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const cfgKey = JSON.stringify(timeCfg);

  useEffect(() => {
    if (!assetId || !tag) { setData([]); return; }
    let cancelled = false;
    const minutes = effectiveRangeMinutes(timeCfg);
    const load = async () => {
      setLoading(true);
      try {
        const rows = await fetchSeriesRaw(assetId, tag, timeCfg);
        if (cancelled) return;
        setData(rows.map((r) => {
          const ts = new Date(r.timestamp).getTime();
          return { ts, t: format(new Date(r.timestamp), minutes > 0 && minutes <= 1440 ? "HH:mm" : "MM/dd HH:mm"), v: Number(r.value) };
        }).filter((r) => !isNaN(r.v)).sort((a, b) => a.ts - b.ts));
      } finally { if (!cancelled) setLoading(false); }
    };
    load();
    if (refreshSec > 0) { const iv = setInterval(load, refreshSec * 1000); return () => { cancelled = true; clearInterval(iv); }; }
    return () => { cancelled = true; };
  }, [assetId, tag, cfgKey, refreshSec, nonce]);

  return { data, loading };
}

// Fetch several tags and merge them into rows keyed by timestamp:
// [{ t, ts, tagA: v, tagB: v }] — for multi-series charts / scatter X-vs-Y.
export function useMultiSeries(assetId: string | undefined, tags: string[], timeCfg: TimeCfg = {}, refreshSec = 0, nonce: any = 0): Record<string, any>[] {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const tagKey = tags.join("|");
  const cfgKey = JSON.stringify(timeCfg);
  useEffect(() => {
    if (!assetId || tags.length === 0) { setRows([]); return; }
    let cancelled = false;
    const minutes = effectiveRangeMinutes(timeCfg);
    const load = async () => {
      const byTs: Record<number, any> = {};
      await Promise.all(tags.map(async (tag) => {
        const series = await fetchSeriesRaw(assetId, tag, timeCfg);
        for (const row of series) {
          const ts = new Date(row.timestamp).getTime(); const v = row.value;
          if (v == null || isNaN(v)) continue;
          if (!byTs[ts]) byTs[ts] = { ts, t: format(new Date(row.timestamp), minutes > 0 && minutes <= 1440 ? "HH:mm" : "MM/dd HH:mm") };
          byTs[ts][tag] = v;
        }
      }));
      if (!cancelled) setRows(Object.values(byTs).sort((a, b) => a.ts - b.ts));
    };
    load();
    if (refreshSec > 0) { const iv = setInterval(load, refreshSec * 1000); return () => { cancelled = true; clearInterval(iv); }; }
    return () => { cancelled = true; };
  }, [assetId, tagKey, cfgKey, refreshSec, nonce]);
  return rows;
}

// Fetch an arbitrary set of series — each an { assetId, tag } pair with its own
// output key — and merge them into rows keyed by timestamp:
// [{ t, ts, s0: v, s1: v, … }]. Unlike useMultiSeries, each series can come from
// a DIFFERENT asset, so a chart widget can overlay metrics across assets.
export interface SeriesSpec { key: string; assetId?: string; tag?: string }
export function useSeriesSet(series: SeriesSpec[], timeCfg: TimeCfg = {}, refreshSec = 0, nonce: any = 0): Record<string, any>[] {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const specKey = series.map((s) => `${s.key}=${s.assetId ?? ""}:${s.tag ?? ""}`).join("|");
  const cfgKey = JSON.stringify(timeCfg);
  useEffect(() => {
    const valid = series.filter((s) => s.assetId && s.tag);
    if (valid.length === 0) { setRows([]); return; }
    let cancelled = false;
    const minutes = effectiveRangeMinutes(timeCfg);
    const load = async () => {
      const byTs: Record<number, any> = {};
      await Promise.all(valid.map(async (s) => {
        const rawSeries = await fetchSeriesRaw(s.assetId!, s.tag!, timeCfg);
        for (const row of rawSeries) {
          const ts = new Date(row.timestamp).getTime(); const v = row.value;
          if (v == null || isNaN(v)) continue;
          if (!byTs[ts]) byTs[ts] = { ts, t: format(new Date(row.timestamp), minutes > 0 && minutes <= 1440 ? "HH:mm" : "MM/dd HH:mm") };
          byTs[ts][s.key] = v;
        }
      }));
      if (!cancelled) setRows(Object.values(byTs).sort((a, b) => a.ts - b.ts));
    };
    load();
    if (refreshSec > 0) { const iv = setInterval(load, refreshSec * 1000); return () => { cancelled = true; clearInterval(iv); }; }
    return () => { cancelled = true; };
  }, [specKey, cfgKey, refreshSec, nonce]);
  return rows;
}

export function aggregate(pts: Point[], mode: string): number | null {
  if (!pts.length) return null;
  const vals = pts.map((p) => p.v);
  switch (mode) {
    case "avg": return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "max": return Math.max(...vals);
    case "min": return Math.min(...vals);
    case "sum": return vals.reduce((a, b) => a + b, 0);
    default: return vals[vals.length - 1]; // last
  }
}

// Metric (tag) names available for an asset.
export function useMetricOptions(assetId?: string): string[] {
  const [metrics, setMetrics] = useState<string[]>([]);
  useEffect(() => {
    if (!assetId) { setMetrics([]); return; }
    let cancelled = false;
    fetch(`/api/telemetry/${assetId}/metrics`).then((r) => (r.ok ? r.json() : [])).then((m) => { if (!cancelled) setMetrics(Array.isArray(m) ? m : []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [assetId]);
  return metrics;
}
