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
 *
 * Limits are reported, never silent: bucket rows are capped per query part in a
 * fixed order (asset, metric, time) and a metric cut by the cap is dropped
 * whole, so what is kept is complete and the same on every run; raw reads share
 * a time budget (`RawBudget`) and a part that runs out of it is skipped. Both
 * set a flag the report shows (`ReadLimits`).
 */
import { pool } from "@workspace/db";
import { activeTiers, getRollupState } from "../services/rollups";
import type { BucketRow, CoverageRow, MetricStatRow } from "./ai-report";

const HOUR = 3_600_000;
const NUMERIC = "'^-?[0-9]+(\\.[0-9]+)?$'";
/** Bucket rows per query part; a scope with very many metrics keeps the first ones (by asset and metric) and says so. */
export const MAX_ROWS = 80_000;
/** Total time the raw-telemetry reads of one report may take; past it the rest is skipped and flagged. */
export const RAW_BUDGET_MS = (() => {
  const v = Number(process.env.AI_REPORT_RAW_BUDGET_MS);
  return Number.isFinite(v) && v >= 1000 ? Math.floor(v) : 25_000;
})();

/** Shared time budget of the raw reads of one report (or one tool call). Set when a read was skipped or cancelled. */
export interface RawBudget { deadline: number; timedOut: boolean }
export const rawBudget = (ms: number = RAW_BUDGET_MS): RawBudget => ({ deadline: Date.now() + ms, timedOut: false });
/** What a read left out: bucket rows past MAX_ROWS, or raw spans skipped for time. */
export interface ReadLimits { rowsCapped: boolean; rawTimedOut: boolean }

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
export function mergeBucketAggs(parts: BucketAgg[][]): BucketAgg[] {
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
  return [...byBucket.values()];
}

export function mergeBuckets(parts: BucketAgg[][]): { buckets: BucketRow[]; stats: MetricStatRow[] } {
  const byBucket = mergeBucketAggs(parts);
  const byMetric = new Map<string, { assetId: string; metric: string; n: number; sum: number; min: number | null; max: number | null }>();
  const buckets: BucketRow[] = [];
  for (const b of byBucket) {
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

/**
 * Keep at most `max` rows of a result ordered by (asset, metric, time) and
 * fetched with one row more than `max`. When the cap was hit, the rows of the
 * metric the cap cut through are dropped too, so every metric kept is complete.
 */
export function capRows<T extends { asset_id: string; metric: string }>(rows: T[], max: number): { rows: T[]; capped: boolean } {
  if (rows.length <= max) return { rows, capped: false };
  const cut = rows[max]!;
  let end = max;
  while (end > 0 && rows[end - 1]!.asset_id === cut.asset_id && rows[end - 1]!.metric === cut.metric) end--;
  return { rows: rows.slice(0, end), capped: true };
}

type Raw = { asset_id: string; metric: string; t: string | number; n: string | number; sum: string | number | null; min: string | number | null; max: string | number | null };
const toAgg = (r: Raw): BucketAgg => ({
  assetId: r.asset_id, metric: r.metric, t: Number(r.t) * 1000, n: Number(r.n),
  sum: r.sum == null ? null : Number(r.sum), min: r.min == null ? null : Number(r.min), max: r.max == null ? null : Number(r.max),
});

type Part = { buckets: BucketAgg[]; coverage: CoverageRow[]; capped: boolean };

async function rollupPart(ids: string[], span: Span, bucketSec: number, origin: number, metrics: string[] | null = null): Promise<Part> {
  // Ordered, so the rows a cap keeps are the same on every run.
  const b = await pool.query<Raw>(`
    SELECT asset_id, metric,
           ($4::float8 + floor((extract(epoch from bucket) - $4::float8) / $5) * $5) AS t,
           SUM(n)::bigint AS n, SUM(sum) AS sum, MIN(min) AS min, MAX(max) AS max
    FROM telemetry_rollups
    WHERE asset_id = ANY($1::uuid[]) AND bucket >= $2 AND bucket < $3 AND n > 0
      AND ($6::text[] IS NULL OR metric = ANY($6::text[]))
    GROUP BY asset_id, metric, 3
    ORDER BY asset_id, metric, 3
    LIMIT ${MAX_ROWS + 1}`, [ids, span.from, span.to, origin, bucketSec, metrics]);
  const kept = capRows(b.rows, MAX_ROWS);
  const c = await pool.query<{ asset_id: string; hours: string }>(`
    SELECT asset_id, COUNT(DISTINCT bucket)::int AS hours
    FROM telemetry_rollups
    WHERE asset_id = ANY($1::uuid[]) AND bucket >= $2 AND bucket < $3 AND "rows" > 0
    GROUP BY asset_id`, [ids, span.from, span.to]);
  return { buckets: kept.rows.map(toAgg), coverage: c.rows.map((r) => ({ assetId: r.asset_id, hours: Number(r.hours) })), capped: kept.capped };
}

/** Postgres "canceling statement due to statement timeout". */
const QUERY_CANCELED = "57014";
const EMPTY_PART: Part = { buckets: [], coverage: [], capped: false };
type Query = (text: string, values: unknown[]) => Promise<{ rows: any[] }>;

/**
 * Run raw reads on one connection with a statement timeout taken from the
 * budget, so a long period without hourly summaries ends in time instead of
 * running into the pool's 30 s limit (and failing the whole report). Returns
 * null, and marks the budget, when the budget is spent or a statement ran out
 * of it.
 */
async function withinBudget<T>(budget: RawBudget | undefined, fn: (q: Query) => Promise<T>): Promise<T | null> {
  if (!budget) return fn((text, values) => pool.query(text, values));
  const left = () => budget.deadline - Date.now();
  if (left() < 500) { budget.timedOut = true; return null; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const r = await fn(async (text, values) => {
      const ms = Math.floor(left());
      if (ms < 500) throw Object.assign(new Error("raw read budget spent"), { code: QUERY_CANCELED });
      await client.query(`SET LOCAL statement_timeout = ${ms}`);
      return client.query(text, values);
    });
    await client.query("COMMIT");
    return r;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if ((err as { code?: string })?.code === QUERY_CANCELED) { budget.timedOut = true; return null; }
    throw err;
  } finally {
    client.release();
  }
}

async function rawPart(ids: string[], span: Span, bucketSec: number, origin: number, metrics: string[] | null = null, budget?: RawBudget): Promise<Part> {
  return (await withinBudget(budget, (q) => rawQueries(q, ids, span, bucketSec, origin, metrics))) ?? EMPTY_PART;
}

async function rawQueries(q: Query, ids: string[], span: Span, bucketSec: number, origin: number, metrics: string[] | null): Promise<Part> {
  const end = span.open ? "<" : "<=";
  const b: { rows: Raw[] } = await q(`
    SELECT asset_id, metric,
           ($4::float8 + floor((extract(epoch from "timestamp") - $4::float8) / $5) * $5) AS t,
           COUNT(*)::bigint AS n,
           SUM((value::text)::float8) AS sum, MIN((value::text)::float8) AS min, MAX((value::text)::float8) AS max
    FROM telemetry
    WHERE asset_id = ANY($1::uuid[]) AND "timestamp" >= $2 AND "timestamp" ${end} $3 AND value::text ~ ${NUMERIC}
      AND ($6::text[] IS NULL OR metric = ANY($6::text[]))
    GROUP BY asset_id, metric, 3
    ORDER BY asset_id, metric, 3
    LIMIT ${MAX_ROWS + 1}`, [ids, span.from, span.to, origin, bucketSec, metrics]);
  const kept = capRows(b.rows, MAX_ROWS);
  const c: { rows: { asset_id: string; hours: string }[] } = await q(`
    SELECT asset_id, COUNT(DISTINCT date_trunc('hour', "timestamp"))::int AS hours
    FROM telemetry
    WHERE asset_id = ANY($1::uuid[]) AND "timestamp" >= $2 AND "timestamp" ${end} $3
    GROUP BY asset_id`, [ids, span.from, span.to]);
  return { buckets: kept.rows.map(toAgg), coverage: c.rows.map((r) => ({ assetId: r.asset_id, hours: Number(r.hours) })), capped: kept.capped };
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
export async function loadPeriod(
  ids: string[], range: Span, bucketMs: number, watermark: Date | null, budget: RawBudget = rawBudget(),
): Promise<{ stats: MetricStatRow[]; buckets: BucketRow[]; coverage: CoverageRow[]; limits: ReadLimits }> {
  if (ids.length === 0) return { stats: [], buckets: [], coverage: [], limits: { rowsCapped: false, rawTimedOut: false } };
  const plan = planRead(range, watermark);
  const bucketSec = Math.round(bucketMs / 1000);
  const origin = floorHour(range.from.getTime()) / 1000;
  const parts: Part[] = [];
  // One query at a time: a report must not hold several pool connections.
  if (plan.rollup) parts.push(await rollupPart(ids, plan.rollup, bucketSec, origin));
  for (const span of plan.raw) parts.push(await rawPart(ids, span, bucketSec, origin, null, budget));
  const merged = mergeBuckets(parts.map((p) => p.buckets));
  return {
    ...merged,
    coverage: mergeCoverage(parts.map((p) => p.coverage)),
    limits: { rowsCapped: parts.some((p) => p.capped), rawTimedOut: budget.timedOut },
  };
}

/**
 * Bucket aggregates (count, sum, min, max per bucket) of the given metrics of the
 * given assets over a range, from the hourly summaries plus the raw head and
 * tail. Serves the AI tools on ranges too long to scan raw (see routes/ai.ts).
 * Buckets are whole hours, counted from the range start floored to the hour.
 */
export async function loadBucketAggs(ids: string[], metrics: string[], range: Span, bucketMs: number, budget?: RawBudget): Promise<BucketAgg[]> {
  if (ids.length === 0 || metrics.length === 0) return [];
  const watermark = await hourlyWatermark();
  const plan = planRead(range, watermark);
  const bucketSec = Math.round(Math.max(HOUR, Math.ceil(bucketMs / HOUR) * HOUR) / 1000);
  const origin = floorHour(range.from.getTime()) / 1000;
  const parts: BucketAgg[][] = [];
  if (plan.rollup) parts.push((await rollupPart(ids, plan.rollup, bucketSec, origin, metrics)).buckets);
  for (const span of plan.raw) parts.push((await rawPart(ids, span, bucketSec, origin, metrics, budget)).buckets);
  return mergeBucketAggs(parts).sort((a, b) => a.t - b.t);
}
