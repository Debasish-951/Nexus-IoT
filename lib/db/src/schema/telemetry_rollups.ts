import { pgTable, text, timestamp, uuid, integer, doublePrecision, jsonb, primaryKey, index } from "drizzle-orm/pg-core";

/**
 * Hourly summaries of raw telemetry, one row per asset, metric and hour.
 *
 * Built in the background by `services/rollups.ts` from `telemetry`, starting
 * with the oldest reading and then once per completed hour. They serve three
 * purposes:
 *
 * - Data Management reads row counts per asset and per day from here, instead
 *   of counting tens of millions of raw rows on every page load.
 * - The retention preview estimates how many readings a policy would delete.
 * - Charts at 1-hour buckets or longer (`/system/aggregate`) fall back to these
 *   summaries for hours whose raw readings were pruned, so long-term trends
 *   survive a short raw retention.
 *
 * `rows` counts every raw reading of the hour; `n`, `sum`, `min` and `max`
 * cover only the numeric ones (`n` = 0 and the rest null when none were numeric).
 */
export const telemetryRollupsTable = pgTable("telemetry_rollups", {
  assetId: uuid("asset_id").notNull(),
  metric: text("metric").notNull(),
  /** Start of the hour (UTC). */
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  rows: integer("rows").notNull(),
  n: integer("n").notNull(),
  sum: doublePrecision("sum"),
  min: doublePrecision("min"),
  max: doublePrecision("max"),
}, (table) => [
  primaryKey({ columns: [table.assetId, table.metric, table.bucket] }),
  index("idx_telemetry_rollups_bucket").on(table.bucket),
]);

/**
 * 15-minute summaries: the middle tier between raw readings and hourly
 * summaries. Same columns and rules as `telemetry_rollups`; `bucket` is the
 * start of the quarter hour. Kept for the "15-minute summaries" period in Data
 * Management settings (default 365 days). Charts with 15-minute to 1-hour
 * steps use them for periods whose raw readings were pruned.
 */
export const telemetryRollups15mTable = pgTable("telemetry_rollups_15m", {
  assetId: uuid("asset_id").notNull(),
  metric: text("metric").notNull(),
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  rows: integer("rows").notNull(),
  n: integer("n").notNull(),
  sum: doublePrecision("sum"),
  min: doublePrecision("min"),
  max: doublePrecision("max"),
}, (table) => [
  primaryKey({ columns: [table.assetId, table.metric, table.bucket] }),
  index("idx_telemetry_rollups_15m_bucket").on(table.bucket),
]);

/**
 * Small key/value store for background jobs. The rollup job keeps its
 * watermark here under the key `telemetry_rollups`: every hour before
 * `value.watermark` has been summarised.
 */
export const jobStateTable = pgTable("job_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * One row per retention run: the hourly job (`trigger` = "hourly") or the
 * "Run pruning now" button ("manual"). Shown as the pruning history on Data
 * Management. Kept for RETENTION_RUNS_DAYS (default 90).
 */
export const retentionRunsTable = pgTable("retention_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  trigger: text("trigger").notNull(),
  /** Who pressed the button; null for the hourly job. */
  userId: uuid("user_id"),
  username: text("username"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** Raw readings deleted by telemetry retention policies. */
  telemetryDeleted: integer("telemetry_deleted").notNull().default(0),
  /** Per-policy results: [{ policyId, name, rowsDeleted, cutoff }]. */
  details: jsonb("details").notNull().default([]),
  /** Rows deleted from other tables (alarms, logs, ...), by table. */
  operational: jsonb("operational").notNull().default({}),
  /** Set when the run failed. */
  error: text("error"),
}, (table) => [
  index("idx_retention_runs_started").on(table.startedAt),
]);
