/**
 * Telemetry figures for AI Reports, read mostly from the hourly summaries.
 *
 * A report covers up to 92 days for a whole project, which is far too much raw
 * telemetry to scan inside the request's statement timeout. So:
 *
 * - whole hours before the hourly summaries' watermark come from
 *   `telemetry_rollups` (one row per asset, metric and hour);
 * - the partial first hour of the period and the recent tail after the
 *   watermark (a few hours) come from raw `telemetry`, using its
 *   (asset_id, metric, timestamp) index on short spans only;
 * - without summaries (TELEMETRY_ROLLUPS=false, or before the job's first run)
 *   everything comes from raw telemetry, one bounded query at a time.
 *
 * Queries run one after another, never all at once, so one report cannot take
 * over the connection pool. The split of a period and the merge of the parts
 * are pure functions, unit-tested.
 */
import { pool } from "@workspace/db";
import { activeTiers, getRollupState } from "../services/rollups";
import type { BucketRow, CoverageRow, MetricStatRow } from "./ai-report";

const HOUR = 3_600_000;
const NUMERIC = "'^-?[0-9]+(\\.[0-9]+)?$'";
/** Bucket rows per query part; a scope with very many metrics keeps the first ones. */
const MAX_ROWS = 80_000;

/** A time span; `open` spans exclude their end instant (it belongs to the next part). */
export interface Span { from: Date; to: Date; open?: boolean }
/** How a period is read: whole summarised hours, plus raw spans before and after them. */
export interface ReadPlan { rollup: Span | null; raw: Span[] }

const floorHour = (t: number) => Math.floor(t / HOUR) * HOUR;
const ceilHour = (t: number) => Math.ceil(t / HOUR) * HOUR;

/**
 * Split [from, to] into summarised whole hours [ceil(from), min(watermark, floor(to)))
 * and raw spans for the rest. Without a watermark the whole period is raw.
 */
export function planRead(range: Span, watermark: Date | null): ReadPlan {
  const from = range.from.getTime(), to = range.to.getTime();
  if (!watermark) return { rollup: null, raw: [range] };
  const rs = ceilHour(from);
  const re = Math.min(floorHour(watermark.getTime()), floorHour(to));
  if (re - rs < HOUR) return { rollup: null, raw: [range] };
  const raw: Span[] = [];
  if (rs > from) raw.push({ from: range.from, to: new Date(rs), open: true });
  if (to > re) raw.push({ from: new Date(re), to: range.to });
  return { rollup: { from: new Date(rs), to: new Date(re) }, raw };
}

/** Report bucket width: a whole number of hours, about 48 buckets per period, at least one hour. */
export function reportBucketMs(range: Span): number {
  const span = range.to.getTime() - range.from.getTime();
  return Math.max(HOUR, Math.ceil(span / 48 / HOUR) * HOUR);
}

/** Numeric count, sum, min and max of one metric of one asset in one report bucket. */
export interface BucketAgg { assetId: string; metric: string; t: number; n: number; sum: number | null; min: number | null; max: number | null }

/**
 * Merge bucket aggregates from several parts (summaries, raw head, raw tail)
 * into per-bucket averages and per-metric statistics. Parts cover disjoint time,
 * so counts and sums add up and min/max combine.
 */
export function mergeBuckets(parts: BucketAgg[][]): { buckets: BucketRow[]; stats: MetricStatRow[] } {
  const byBucket = new Map<string, BucketAgg>();
  for (const part of parts) for (const r of part) {
    if (!r.n) continue;
    const k = `${r.assetId}\u0000${r.metric}\u0000${r.t}`;
    const cur = byBucket.get(k);
    if (!cur) { byBucket.set(k, { ...r }); continue; }
    cur.n += r.n;
    cur.sum = (cur.sum ?? 0) + (r.sum ?? 0);
    cur.min = cur.min == null ? r.min : r.min == null ? cur.min : Math.min(cur.min, r.min);
    cur.max = cur.max == null ? r.max : r.max == null ? cur.max : Math.max(cur.max, r.max);
  }
  const byMetric = new Map<string, { assetId: string; metric: string; n: number; sum: number; min: number | null; max: number | null }>();
  const buckets: BucketRow[] = [];
  for (const b of byBucket.values()) {
    if (b.sum != null) buckets.push({ assetId: b.assetId, metric: b.metric, t: b.t, avg: b.sum / b.n });
    const k = `${b.assetId}\u0000${b.metric}`;
    const m = byMetric.get(k) ?? { assetId: b.assetId, metric: b.metric, n: 0, sum: 0, min: null, max: null };
    m.n += b.n; m.sum += b.sum ?? 0;
    m.min = m.min == null ? b.min : b.min == null ? m.min : Math.min(m.min, b.min);
    m.max = m.max == null ? b.max : b.max == null ? m.max : Math.max(m.max, b.max);
    byMetric.set(k, m);
  }
  const stats = [...byMetric.values()].map((m) => ({ assetId: m.assetId, metric: m.metric, n: m.n, min: m.min, avg: m.n ? m.sum / m.n : null, max: m.max }));
  return { buckets, stats };
}

/** Add up hours with data per asset from disjoint parts. */
export function mergeCoverage(parts: CoverageRow[][]): CoverageRow[] {
  const by = new Map<string, number>();
  for (const part of parts) for (const c of part) by.set(c.assetId, (by.get(c.assetId) ?? 0) + Number(c.hours));
  return [...by.entries()].map(([assetId, hours]) => ({ assetId, hours }));
}

type Raw = { asset_id: string; metric: string; t: string | number; n: string | number; sum: string | number | null; min: string | number | null; max: string | number | null };
const toAgg = (r: Raw): BucketAgg => ({
  assetId: r.asset_id, metric: r.metric, t: Number(r.t) * 1000, n: Number(r.n),
  sum: r.sum == null ? null : Number(r.sum), min: r.min == null ? null : Number(r.min), max: r.max == null ? null : Number(r.max),
});

async function rollupPart(ids: string[], span: Span, bucketSec: number, origin: number): Promise<{ buckets: BucketAgg[]; coverage: CoverageRow[] }> {
  const b = await pool.query<Raw>(`
    SELECT asset_id, metric,
           ($4::float8 + floor((extract(epoch from bucket) - $4::float8) / $5) * $5) AS t,
           SUM(n)::bigint AS n, SUM(sum) AS sum, MIN(min) AS min, MAX(max) AS max
    FROM telemetry_rollups
    WHERE asset_id = ANY($1::uuid[]) AND bucket >= $2 AND bucket < $3 AND n > 0
    GROUP BY asset_id, metric, 3
    LIMIT ${MAX_ROWS}`, [ids, span.from, span.to, origin, bucketSec]);
  const c = await pool.query<{ asset_id: string; hours: string }>(`
    SELECT asset_id, COUNT(DISTINCT bucket)::int AS hours
    FROM telemetry_rollups
    WHERE asset_id = ANY($1::uuid[]) AND bucket >= $2 AND bucket < $3 AND "rows" > 0
    GROUP BY asset_id`, [ids, span.from, span.to]);
  return { buckets: b.rows.map(toAgg), coverage: c.rows.map((r) => ({ assetId: r.asset_id, hours: Number(r.hours) })) };
}

async function rawPart(ids: string[], span: Span, bucketSec: number, origin: number): Promise<{ buckets: BucketAgg[]; coverage: CoverageRow[] }> {
  const end = span.open ? "<" : "<=";
  const b = await pool.query<Raw>(`
    SELECT asset_id, metric,
           ($4::float8 + floor((extract(epoch from "timestamp") - $4::float8) / $5) * $5) AS t,
           COUNT(*)::bigint AS n,
           SUM((value::text)::float8) AS sum, MIN((value::text)::float8) AS min, MAX((value::text)::float8) AS max
    FROM telemetry
    WHERE asset_id = ANY($1::uuid[]) AND "timestamp" >= $2 AND "timestamp" ${end} $3 AND value::text ~ ${NUMERIC}
    GROUP BY asset_id, metric, 3
    LIMIT ${MAX_ROWS}`, [ids, span.from, span.to, origin, bucketSec]);
  const c = await pool.query<{ asset_id: string; hours: string }>(`
    SELECT asset_id, COUNT(DISTINCT date_trunc('hour', "timestamp"))::int AS hours
    FROM telemetry
    WHERE asset_id = ANY($1::uuid[]) AND "timestamp" >= $2 AND "timestamp" ${end} $3
    GROUP BY asset_id`, [ids, span.from, span.to]);
  return { buckets: b.rows.map(toAgg), coverage: c.rows.map((r) => ({ assetId: r.asset_id, hours: Number(r.hours) })) };
}

/** The hourly summaries' watermark, or null when they are off or not built yet. */
export async function hourlyWatermark(): Promise<Date | null> {
  const tiers = await activeTiers();
  const hour = tiers.find((t) => t.key === "hour");
  if (!hour) return null;
  return (await getRollupState(hour)).watermark;
}

/**
 * Per-metric statistics, report buckets and hours with data for one period.
 * Bucket boundaries are counted from `range.from` floored to the hour, so the
 * hourly summaries fall into whole buckets.
 */
export async function loadPeriod(ids: string[], range: Span, bucketMs: number, watermark: Date | null): Promise<{ stats: MetricStatRow[]; buckets: BucketRow[]; coverage: CoverageRow[] }> {
  if (ids.length === 0) return { stats: [], buckets: [], coverage: [] };
  const plan = planRead(range, watermark);
  const bucketSec = Math.round(bucketMs / 1000);
  const origin = floorHour(range.from.getTime()) / 1000;
  const parts: { buckets: BucketAgg[]; coverage: CoverageRow[] }[] = [];
  // One query at a time: a report must not hold several pool connections.
  if (plan.rollup) parts.push(await rollupPart(ids, plan.rollup, bucketSec, origin));
  for (const span of plan.raw) parts.push(await rawPart(ids, span, bucketSec, origin));
  const merged = mergeBuckets(parts.map((p) => p.buckets));
  return { ...merged, coverage: mergeCoverage(parts.map((p) => p.coverage)) };
}
