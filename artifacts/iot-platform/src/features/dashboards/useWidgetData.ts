import { useEffect, useRef, useState } from "react";
import { effectiveRangeMinutes, getFromTo, gapFill, tickLabel, GRANULARITY_STEP_MAP, type TimeCfg } from "./timeRange";

export interface Point { t: string; v: number; ts: number }

/**
 * Skips a state update when the freshly-fetched series is byte-for-byte the same
 * as what is already on screen.
 *
 * A rolling "last N minutes" window is refetched on every poll even when no new
 * telemetry has landed, and each fetch builds a brand-new array/object regardless
 * — so without this, a chart refreshing every 1–20s replaces its data reference
 * constantly, and Recharts treats every replacement as new data: full axis-domain
 * recalculation and repaint. That is what made the chart (and its tooltip,
 * mid-hover) stutter under a fast refresh interval even when the line hadn't
 * actually moved. Comparing serialized content is cheap next to a repaint.
 */
function sameSeries(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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

  // A non-2xx here silently became "no data" with no trace of why — which is exactly how
  // the query-param date-coercion bug (fixed in lib/api-spec/orval.config.ts; short
  // ranges 400'd while long ranges used a different, unaffected endpoint) went unnoticed.
  // Logging the response keeps the next such break visible in the console instead of
  // looking identical to a genuinely empty range.
  if (useAgg) {
    const p = new URLSearchParams({ assetId, metric: tag, from, to, bucket, limit: "2000" });
    const res = await fetch(`/api/system/aggregate?${p}`).catch((e) => { console.warn("[widget] aggregate fetch failed", e); return null; });
    if (res && !res.ok) console.warn(`[widget] /api/system/aggregate?${p} → ${res.status}`, await res.text().catch(() => ""));
    const json = res?.ok ? await res.json() : { data: [] };
    const mapped = (json.data ?? []).map((d: any) => {
      const raw = d[aggField] ?? d.avg_val ?? d.max_val ?? d.min_val ?? null;
      return { timestamp: d.bucket, value: raw !== null ? parseFloat(String(raw)) : null };
    });
    return gapFill(mapped, bucket);
  }
  const p = new URLSearchParams({ metric: tag, from, to, limit: "500" });
  const res = await fetch(`/api/telemetry/${assetId}?${p}`).catch((e) => { console.warn("[widget] telemetry fetch failed", e); return null; });
  if (res && !res.ok) console.warn(`[widget] /api/telemetry/${assetId}?${p} → ${res.status}`, await res.text().catch(() => ""));
  const rows: any[] = res?.ok ? await res.json() : [];
  return rows.map((r) => ({ timestamp: r.timestamp, value: r.value != null ? parseFloat(String(r.value)) : null }));
}

// Fetch a telemetry series for one asset+tag over a time range, optionally polling.
export function useTelemetrySeries(assetId?: string, tag?: string, timeCfg: TimeCfg = {}, refreshSec = 0, nonce: any = 0): { data: Point[]; loading: boolean } {
  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const cfgKey = JSON.stringify(timeCfg);

  const lastRef = useRef<Point[]>([]);
  useEffect(() => {
    if (!assetId || !tag) { setData([]); lastRef.current = []; return; }
    let cancelled = false;
    const minutes = effectiveRangeMinutes(timeCfg);
    const load = async () => {
      setLoading(true);
      try {
        const rows = await fetchSeriesRaw(assetId, tag, timeCfg);
        if (cancelled) return;
        const next = rows.map((r) => {
          const ts = new Date(r.timestamp).getTime();
          return { ts, t: tickLabel(r.timestamp, minutes), v: Number(r.value) };
        }).filter((r) => !isNaN(r.v)).sort((a, b) => a.ts - b.ts);
        if (!sameSeries(next, lastRef.current)) { lastRef.current = next; setData(next); }
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
  const lastRef2 = useRef<Record<string, any>[]>([]);
  useEffect(() => {
    if (!assetId || tags.length === 0) { setRows([]); lastRef2.current = []; return; }
    let cancelled = false;
    const minutes = effectiveRangeMinutes(timeCfg);
    const load = async () => {
      const byTs: Record<number, any> = {};
      await Promise.all(tags.map(async (tag) => {
        const series = await fetchSeriesRaw(assetId, tag, timeCfg);
        for (const row of series) {
          const ts = new Date(row.timestamp).getTime(); const v = row.value;
          if (v == null || isNaN(v)) continue;
          if (!byTs[ts]) byTs[ts] = { ts, t: tickLabel(row.timestamp, minutes) };
          byTs[ts][tag] = v;
        }
      }));
      if (cancelled) return;
      const next = Object.values(byTs).sort((a, b) => a.ts - b.ts);
      if (!sameSeries(next, lastRef2.current)) { lastRef2.current = next; setRows(next); }
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
  const lastRef3 = useRef<Record<string, any>[]>([]);
  useEffect(() => {
    const valid = series.filter((s) => s.assetId && s.tag);
    if (valid.length === 0) { setRows([]); lastRef3.current = []; return; }
    let cancelled = false;
    const minutes = effectiveRangeMinutes(timeCfg);
    const load = async () => {
      const byTs: Record<number, any> = {};
      await Promise.all(valid.map(async (s) => {
        const rawSeries = await fetchSeriesRaw(s.assetId!, s.tag!, timeCfg);
        for (const row of rawSeries) {
          const ts = new Date(row.timestamp).getTime(); const v = row.value;
          if (v == null || isNaN(v)) continue;
          if (!byTs[ts]) byTs[ts] = { ts, t: tickLabel(row.timestamp, minutes) };
          byTs[ts][s.key] = v;
        }
      }));
      if (cancelled) return;
      const next = Object.values(byTs).sort((a, b) => a.ts - b.ts);
      if (!sameSeries(next, lastRef3.current)) { lastRef3.current = next; setRows(next); }
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

export interface MetricChoice { key: string; label: string }

// ── Per-asset metric/attribute metadata, shared across widgets ────────────────
// Both endpoints below are pure metadata: the same answer for every widget bound
// to the same asset. Fetching them per widget meant a dashboard with a dozen
// widgets on one asset fired two dozen identical round-trips before it could
// draw anything. Cached here with a short TTL, so a freshly-added attribute still
// turns up without a page reload.
interface AssetMetricMeta { metrics: string[]; attrs: any[] }
const META_TTL_MS = 30_000;
const metaCache = new Map<string, { at: number; p: Promise<AssetMetricMeta> }>();

function fetchAssetMeta(assetId: string): Promise<AssetMetricMeta> {
  const hit = metaCache.get(assetId);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.p;
  const p = Promise.all([
    fetch(`/api/telemetry/${assetId}/metrics`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch(`/api/assets/${assetId}/attributes`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]).then(([metricsRaw, attrsRaw]) => ({
    metrics: Array.isArray(metricsRaw) ? (metricsRaw as string[]) : [],
    attrs: Array.isArray(attrsRaw) ? (attrsRaw as any[]) : [],
  }));
  metaCache.set(assetId, { at: Date.now(), p });
  return p;
}

/** Every tag form an attribute can be queried under → the attribute row itself.
 *  A tagName stored as "<deviceId>.<metric>" is matched by ingest against the
 *  bare metric too, and telemetry stores the bare form, so both are indexed. */
function indexAttrsByTag(attrs: any[]): Map<string, any> {
  const byTag = new Map<string, any>();
  for (const a of attrs) {
    const declared: string | null = a.tagName ?? a.sourceMetric ?? null;
    if (!declared) continue;
    byTag.set(declared, a);
    const bare = declared.includes(".") ? declared.split(".").slice(1).join(".") : null;
    if (bare && !byTag.has(bare)) byTag.set(bare, a);
  }
  return byTag;
}

export interface AttrDisplayMeta { name?: string; uom?: string }

/**
 * tag → { Attribute Name, UoM }, for a set of assets at once. Keyed
 * `${assetId}::${tag}` because a chart's overlay series can bind to a DIFFERENT
 * asset than the primary, and the same tag can mean different things on two assets.
 *
 * Lets a chart name its series the way the user named the attribute, and label
 * its axis with the unit already declared in the template's UoM column, rather
 * than making both be retyped per widget — without every widget re-fetching the
 * same metadata.
 */
export function useAttributeMeta(assetIds: (string | undefined)[]): Map<string, AttrDisplayMeta> {
  // Serialised so an inline array literal from the caller doesn't refire the effect.
  const key = [...new Set(assetIds.filter((x): x is string => !!x))].sort().join("|");
  const [meta, setMeta] = useState<Map<string, AttrDisplayMeta>>(() => new Map());
  useEffect(() => {
    const ids = key ? key.split("|") : [];
    if (!ids.length) { setMeta(new Map()); return; }
    let cancelled = false;
    Promise.all(ids.map((id) => fetchAssetMeta(id).then((m) => [id, m] as const))).then((entries) => {
      if (cancelled) return;
      const next = new Map<string, AttrDisplayMeta>();
      for (const [id, assetMeta] of entries) {
        for (const [tag, attr] of indexAttrsByTag(assetMeta.attrs)) {
          const name = typeof attr?.name === "string" ? attr.name.trim() : "";
          const uom = typeof attr?.uom === "string" ? attr.uom.trim() : "";
          if (name || uom) next.set(`${id}::${tag}`, { name: name || undefined, uom: uom || undefined });
        }
      }
      setMeta(next);
    });
    return () => { cancelled = true; };
  }, [key]);
  return meta;
}

// Metric choices for an asset, for widget data-binding: the live telemetry tags
// UNION the asset's configured attributes. `key` is always the raw tag — the
// string a chart query actually asks for, never shown to the user directly.
// `label` is the attribute's human Attribute Name where one is on record
// ("Chiller Energy" reads a lot better than "chiller.energy_kWh" in a dropdown,
// and is exactly what the user typed into the CSV/XLSX after export). An
// attribute that was never renamed has Attribute Name == the raw tag anyway
// (that's the CSV contract — see templateCsv.ts), so this is a strict upgrade,
// never a regression to "just show the tag". Attribute tagNames are stored
// prefixed with the device identifier (e.g. "pump-01.temperature") while
// telemetry keys arrive unprefixed, so both forms are indexed. Attributes that
// have not produced telemetry yet are still offered, so a dashboard can be laid
// out before data starts flowing.
export function useMetricChoices(assetId?: string): MetricChoice[] {
  const [choices, setChoices] = useState<MetricChoice[]>([]);
  useEffect(() => {
    if (!assetId) { setChoices([]); return; }
    let cancelled = false;
    fetchAssetMeta(assetId).then(({ metrics, attrs }) => {
      if (cancelled) return;
      // Index attributes by every tag form they could be queried under, so a live
      // telemetry key (always bare) still resolves back to its Attribute Name.
      const byTag = indexAttrsByTag(attrs);

      // Two different tags renamed to the same Attribute Name would otherwise be
      // indistinguishable in the dropdown despite mapping to different telemetry —
      // disambiguate with the raw tag the moment a label repeats.
      const usedLabels = new Set<string>();
      function labelFor(tag: string, attr: any | undefined): string {
        const name = typeof attr?.name === "string" ? attr.name.trim() : "";
        let label = name || tag;
        if (usedLabels.has(label) && label !== tag) label = `${label} (${tag})`;
        usedLabels.add(label);
        return label;
      }

      // Live telemetry keys first — these are exactly what a chart query can ask for.
      const out: MetricChoice[] = metrics.map((k) => ({ key: k, label: labelFor(k, byTag.get(k)) }));
      const seen = new Set(metrics);

      for (const a of attrs) {
        if (a.type === "static") continue;          // not a time series
        const declared: string | null = a.tagName ?? a.sourceMetric ?? null;
        if (!declared) continue;
        // A tag stored as "<deviceId>.<metric>" is matched by ingest against the bare
        // metric too, and telemetry stores the bare form — so if that is what is on
        // record, it is already in the list above.
        const bare = declared.includes(".") ? declared.split(".").slice(1).join(".") : null;
        if (seen.has(declared) || (bare && seen.has(bare))) continue;
        // Nothing on record yet: offer the tag AS DECLARED (key unchanged — chopping
        // the first segment off a legitimately dotted tag invented unqueryable
        // choices before), labelled with its Attribute Name.
        seen.add(declared);
        out.push({ key: declared, label: labelFor(declared, a) });
      }
      setChoices(out);
    });
    return () => { cancelled = true; };
  }, [assetId]);
  return choices;
}
