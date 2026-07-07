import { useEffect, useState } from "react";
import { subHours, subDays, format } from "date-fns";

export interface Point { t: string; v: number; ts: number }

// Fetch a telemetry series for one asset+tag over a time range, optionally polling.
export function useTelemetrySeries(assetId?: string, tag?: string, rangeHours = 24, refreshSec = 0): { data: Point[]; loading: boolean } {
  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assetId || !tag) { setData([]); return; }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const from = (rangeHours <= 24 ? subHours(new Date(), rangeHours) : subDays(new Date(), rangeHours / 24)).toISOString();
        const p = new URLSearchParams({ metric: tag, from, limit: "500" });
        const rows: any[] = await fetch(`/api/telemetry/${assetId}?${p}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
        if (cancelled) return;
        setData(rows.map((r) => {
          const ts = new Date(r.timestamp).getTime();
          return { ts, t: format(new Date(r.timestamp), rangeHours <= 24 ? "HH:mm" : "MM/dd HH:mm"), v: Number(r.value) };
        }).filter((r) => !isNaN(r.v)).sort((a, b) => a.ts - b.ts));
      } finally { if (!cancelled) setLoading(false); }
    };
    load();
    if (refreshSec > 0) { const iv = setInterval(load, refreshSec * 1000); return () => { cancelled = true; clearInterval(iv); }; }
    return () => { cancelled = true; };
  }, [assetId, tag, rangeHours, refreshSec]);

  return { data, loading };
}

// Fetch several tags and merge them into rows keyed by timestamp:
// [{ t, ts, tagA: v, tagB: v }] — for multi-series charts / scatter X-vs-Y.
export function useMultiSeries(assetId: string | undefined, tags: string[], rangeHours = 24, refreshSec = 0): Record<string, any>[] {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const key = tags.join("|");
  useEffect(() => {
    if (!assetId || tags.length === 0) { setRows([]); return; }
    let cancelled = false;
    const load = async () => {
      const from = (rangeHours <= 24 ? subHours(new Date(), rangeHours) : subDays(new Date(), rangeHours / 24)).toISOString();
      const byTs: Record<number, any> = {};
      await Promise.all(tags.map(async (tag) => {
        const p = new URLSearchParams({ metric: tag, from, limit: "500" });
        const r: any[] = await fetch(`/api/telemetry/${assetId}?${p}`).then((x) => (x.ok ? x.json() : [])).catch(() => []);
        for (const row of r) {
          const ts = new Date(row.timestamp).getTime(); const v = Number(row.value); if (isNaN(v)) continue;
          if (!byTs[ts]) byTs[ts] = { ts, t: format(new Date(row.timestamp), rangeHours <= 24 ? "HH:mm" : "MM/dd HH:mm") };
          byTs[ts][tag] = v;
        }
      }));
      if (!cancelled) setRows(Object.values(byTs).sort((a, b) => a.ts - b.ts));
    };
    load();
    if (refreshSec > 0) { const iv = setInterval(load, refreshSec * 1000); return () => { cancelled = true; clearInterval(iv); }; }
    return () => { cancelled = true; };
  }, [assetId, key, rangeHours, refreshSec]);
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
