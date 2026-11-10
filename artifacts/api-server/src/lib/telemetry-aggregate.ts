import { pool } from "@workspace/db";
import { PLANT_TIME_ZONE } from "./plant-time";

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

  if (opts.assetId) { params.push(opts.assetId); filters.push(`asset_id = $${params.length}`); }
  if (opts.metric)  { params.push(opts.metric);  filters.push(`metric = $${params.length}`); }
  if (opts.from)    { params.push(opts.from);    filters.push(`"timestamp" >= $${params.length}`); }
  if (opts.to)      { params.push(opts.to);      filters.push(`"timestamp" <= $${params.length}`); }

  const unit = CALENDAR_BUCKETS[opts.bucket];
  let bucketExpr: string;
  if (unit) {
    params.push(PLANT_TIME_ZONE);
    const tz = `$${params.length}::text`;
    bucketExpr = `(date_trunc('${unit}', "timestamp" AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  } else {
    bucketExpr = `to_timestamp(FLOOR(EXTRACT(EPOCH FROM "timestamp") / ${stepSec}) * ${stepSec})`;
  }

  // One extra row tells us whether anything was cut off.
  params.push(maxLimit + 1);
  const limitParam = params.length;

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
