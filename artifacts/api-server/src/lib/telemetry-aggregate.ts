import { pool } from "@workspace/db";
import { PLANT_TIME_ZONE } from "./plant-time";
import { activeTiers } from "../services/rollups";

export const BUCKET_SECONDS: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "6h": 21600, "12h": 43200,
  "1d": 86400, "1w": 604800,
};

/** Buckets that follow the plant's calendar rather than fixed epoch multiples. */
const CALENDAR_BUCKETS: Record<string, "day" | "week"> = { "1d": "day", "1w": "week" };

export interface AggregateRow {
  bucket: Date; asset_id: string; metric: string;
  avg_val: string; min_val: string; max_val: string; sum_val: string; count: number;
}

export interface AggregateResult {
  rows: AggregateRow[];
  /** True when more buckets matched than `limit`; the OLDEST were dropped. */
  truncated: boolean;
}

/**
 * Time-bucketed telemetry statistics. Shared by /system/aggregate and published Home widgets.
 *
 * When more buckets match than the limit, the NEWEST are kept: the query orders
 * descending, limits, and the rows are put back in ascending order. Ordering
 * ascending before the LIMIT used to keep the oldest buckets, so a chart over a
 * long window silently lost its most recent data.
 *
 * Day and week buckets start at midnight (Monday for weeks) in PLANT_TIME_ZONE;
 * shorter buckets are fixed multiples of the epoch.
 *
 * For buckets of 15 minutes or longer, periods without raw readings are filled
 * from the summaries, per asset and metric: 15-minute summaries for quarter
 * hours with no raw reading, hourly summaries (buckets of 1 hour or longer) for
 * hours with neither. Long-term trends therefore survive a short raw retention,
 * and gaps in the middle (legal holds, removed bad data) are filled too.
 * Shorter buckets show raw data only.
 */
export async function aggregateTelemetryWithMeta(opts: {
  assetId?: string; metric?: string; from?: string | Date; to?: string | Date; limit?: number; bucket: string;
}): Promise<AggregateResult> {
  const stepSec = BUCKET_SECONDS[opts.bucket] ?? 3600;
  const maxLimit = opts.limit ?? 1000;

  // Build WHERE clause as a raw SQL string to avoid Drizzle prepared-statement
  // type-inference issues with EXTRACT/FLOOR arithmetic.
  // stepSec and the calendar unit are from fixed whitelists; every other value is bound.
  const filters: string[] = ["value::text ~ '^-?[0-9]+(\\.[0-9]+)?$'"];
  const params: (string | number | Date)[] = [];

  // Rollup filters (charts at 1 h or longer) reuse the same bound parameters.
  const rollupFilters: string[] = ["r.n > 0"];
  if (opts.assetId) { params.push(opts.assetId); filters.push(`asset_id = $${params.length}`); rollupFilters.push(`r.asset_id = $${params.length}`); }
  if (opts.metric)  { params.push(opts.metric);  filters.push(`metric = $${params.length}`); rollupFilters.push(`r.metric = $${params.length}`); }
  if (opts.from)    { params.push(opts.from);    filters.push(`"timestamp" >= $${params.length}`); rollupFilters.push(`r.bucket > ($${params.length})::timestamptz - interval '1 hour'`); }
  if (opts.to)      { params.push(opts.to);      filters.push(`"timestamp" <= $${params.length}`); rollupFilters.push(`r.bucket <= $${params.length}`); }

  const unit = CALENDAR_BUCKETS[opts.bucket];
  let bucketOf: (col: string) => string;
  if (unit) {
    params.push(PLANT_TIME_ZONE);
    const tz = `$${params.length}::text`;
    bucketOf = (col) => `(date_trunc('${unit}', ${col} AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  } else {
    bucketOf = (col) => `to_timestamp(FLOOR(EXTRACT(EPOCH FROM ${col}) / ${stepSec}) * ${stepSec})`;
  }
  const bucketExpr = bucketOf(`"timestamp"`);

  // One extra row tells us whether anything was cut off.
  params.push(maxLimit + 1);
  const limitParam = params.length;

  // Summary levels this bucket size can use: 15-minute from 15 m steps, hourly from 1 h.
  const tiers = stepSec >= 900 ? (await activeTiers()).filter((t) => t.stepSec <= stepSec) : [];
  if (tiers.length > 0) {
    const use15 = tiers.some((t) => t.key === "m15");
    const useHour = tiers.some((t) => t.key === "hour");
    const f = (alias: string) => rollupFilters.map((x) => x.replace(/\br\./g, `${alias}.`)).join(" AND ");
    const EMPTY = `SELECT NULL::timestamptz AS bucket, NULL::uuid AS asset_id, NULL::text AS metric, NULL::numeric AS s, NULL::numeric AS mn, NULL::numeric AS mx, NULL::bigint AS n WHERE false`;
    // Raw readings are first grouped per 15 minutes; that also tells which quarter
    // hours still have raw data. A summary is used only for a quarter hour (15-minute
    // level) or hour (hourly level) that no finer source covers, so gaps anywhere
    // (pruned history, legal holds in between, removed bad data) are filled while
    // periods with raw data always show raw data.
    const result = await pool.query<AggregateRow>(`
      WITH raw15 AS (
        SELECT to_timestamp(FLOOR(EXTRACT(EPOCH FROM "timestamp") / 900) * 900) AS b15, asset_id, metric,
               SUM((value::text)::numeric) AS s, MIN((value::text)::numeric) AS mn,
               MAX((value::text)::numeric) AS mx, COUNT(*)::bigint AS n
        FROM telemetry
        WHERE ${filters.join(" AND ")}
        GROUP BY 1, asset_id, metric
      ),
      raw AS (
        SELECT ${bucketOf("r15.b15")} AS bucket, r15.asset_id, r15.metric, SUM(r15.s) AS s, MIN(r15.mn) AS mn, MAX(r15.mx) AS mx, SUM(r15.n)::bigint AS n
        FROM raw15 r15 GROUP BY 1, r15.asset_id, r15.metric
      ),
      q15 AS (
        ${use15 ? `SELECT q.bucket, q.asset_id, q.metric, q.sum, q.min, q.max, q.n
        FROM telemetry_rollups_15m q
        WHERE ${f("q")}
          AND NOT EXISTS (SELECT 1 FROM raw15 r WHERE r.asset_id = q.asset_id AND r.metric = q.metric AND r.b15 = q.bucket)`
        : `SELECT NULL::timestamptz AS bucket, NULL::uuid AS asset_id, NULL::text AS metric, NULL::float8 AS sum, NULL::float8 AS min, NULL::float8 AS max, NULL::int AS n WHERE false`}
      ),
      old15 AS (
        ${use15 ? `SELECT ${bucketOf("q15.bucket")} AS bucket, q15.asset_id, q15.metric,
               SUM(q15.sum)::numeric AS s, MIN(q15.min)::numeric AS mn, MAX(q15.max)::numeric AS mx, SUM(q15.n)::bigint AS n
        FROM q15 GROUP BY 1, q15.asset_id, q15.metric` : EMPTY}
      ),
      covered_h AS (
        SELECT DISTINCT c.asset_id, c.metric, to_timestamp(FLOOR(EXTRACT(EPOCH FROM c.b) / 3600) * 3600) AS h
        FROM (SELECT asset_id, metric, b15 AS b FROM raw15 UNION ALL SELECT asset_id, metric, bucket AS b FROM q15) c
      ),
      oldh AS (
        ${useHour ? `SELECT ${bucketOf("h.bucket")} AS bucket, h.asset_id, h.metric,
               SUM(h.sum)::numeric AS s, MIN(h.min)::numeric AS mn, MAX(h.max)::numeric AS mx, SUM(h.n)::bigint AS n
        FROM telemetry_rollups h
        WHERE ${f("h")}
          AND NOT EXISTS (SELECT 1 FROM covered_h c WHERE c.asset_id = h.asset_id AND c.metric = h.metric AND c.h = h.bucket)
        GROUP BY 1, h.asset_id, h.metric` : EMPTY}
      )
      SELECT bucket, asset_id, metric,
             SUM(s) / NULLIF(SUM(n), 0) AS avg_val,
             MIN(mn) AS min_val, MAX(mx) AS max_val, SUM(s) AS sum_val, SUM(n)::int AS count
      FROM (SELECT * FROM raw UNION ALL SELECT * FROM old15 UNION ALL SELECT * FROM oldh) u
      GROUP BY bucket, asset_id, metric
      ORDER BY bucket DESC, asset_id DESC, metric DESC
      LIMIT $${limitParam}
    `, params);
    return keepNewest(result.rows, maxLimit);
  }

  const result = await pool.query<AggregateRow>(`
    SELECT
      ${bucketExpr} AS bucket,
      asset_id,
      metric,
      AVG((value::text)::numeric)  AS avg_val,
      MIN((value::text)::numeric)  AS min_val,
      MAX((value::text)::numeric)  AS max_val,
      SUM((value::text)::numeric)  AS sum_val,
      COUNT(*)::int                AS count
    FROM telemetry
    WHERE ${filters.join(" AND ")}
    GROUP BY 1, asset_id, metric
    ORDER BY bucket DESC, asset_id DESC, metric DESC
    LIMIT $${limitParam}
  `, params);

  return keepNewest(result.rows, maxLimit);
}

/** Rows arrive newest first with one extra; keep `limit` and return them oldest first. */
export function keepNewest<T>(rowsNewestFirst: T[], limit: number): { rows: T[]; truncated: boolean } {
  const truncated = rowsNewestFirst.length > limit;
  return { rows: rowsNewestFirst.slice(0, limit).reverse(), truncated };
}

/** Rows only, oldest first. Kept for callers that do not report truncation. */
export async function aggregateTelemetry(opts: {
  assetId?: string; metric?: string; from?: string | Date; to?: string | Date; limit?: number; bucket: string;
}): Promise<AggregateRow[]> {
  return (await aggregateTelemetryWithMeta(opts)).rows;
}
