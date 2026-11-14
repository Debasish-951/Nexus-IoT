import { pgTable, text, timestamp, uuid, integer, bigint, boolean, jsonb, index, primaryKey } from "drizzle-orm/pg-core";

/**
 * Data Management operations: backups, alerts, legal holds, archives, change
 * requests with approval, and ingest rejections. See docs/features/data-management.md.
 */

/**
 * One row per backup run, written by the backup script on the VM
 * (scripts/ops/nexus-backup.sh) with `psql`. The app only reads it.
 */
export const backupRunsTable = pgTable("backup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** "ok" or "failed". */
  status: text("status").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  /** Where the files were written, e.g. /var/backups/nexus. */
  location: text("location"),
  includesUploads: boolean("includes_uploads").notNull().default(false),
  /** The script read the database file back successfully. */
  verified: boolean("verified").notNull().default(false),
  /** Copied off the VM by the script (OFFSITE_CMD succeeded). */
  offsite: boolean("offsite").notNull().default(false),
  host: text("host"),
  message: text("message"),
}, (t) => [index("idx_backup_runs_started").on(t.startedAt)]);

/**
 * Storage and data-pipeline alerts raised by services/system-alerts.ts. One
 * open row per condition `key`; it is cleared when the condition goes away.
 */
export const systemAlertsTable = pgTable("system_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  severity: text("severity").notNull(), // critical | high | medium
  title: text("title").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("active"), // active | acknowledged | cleared
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  /** Last webhook delivery attempt and its result. */
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  notifyResult: text("notify_result"),
}, (t) => [index("idx_system_alerts_key_status").on(t.key, t.status)]);

/**
 * Legal holds: readings that pruning, archiving-then-deleting and bad-data
 * removal must not delete. Null asset / metric / from / to mean "any".
 */
export const dataHoldsTable = pgTable("data_holds", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  reason: text("reason"),
  assetId: uuid("asset_id"),
  metric: text("metric"),
  fromTs: timestamp("from_ts", { withTimezone: true }),
  toTs: timestamp("to_ts", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** The hold ends by itself at this time, if set. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  releasedBy: text("released_by"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});

/**
 * Raw telemetry written to compressed files before pruning deletes it: one file
 * per UTC day (JSON lines, gzip). See services/archive.ts.
 */
export const dataArchivesTable = pgTable("data_archives", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** UTC day the file covers, as YYYY-MM-DD. */
  day: text("day").notNull().unique(),
  path: text("path").notNull(),
  rows: integer("rows").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
  restoredBy: text("restored_by"),
  restoredRows: integer("restored_rows"),
});

/**
 * Deletions that may need a second administrator: bad-data removal, manual
 * pruning runs and policy changes above the approval threshold.
 */
export const dataChangeRequestsTable = pgTable("data_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** range_delete | manual_prune | policy_change */
  kind: text("kind").notNull(),
  /** What to do, by kind (range, policy body, ...). */
  payload: jsonb("payload").notNull().default({}),
  summary: text("summary").notNull(),
  estimatedRows: integer("estimated_rows").notNull().default(0),
  /** pending | approved | rejected | done | failed */
  status: text("status").notNull().default("pending"),
  requestedById: uuid("requested_by_id"),
  requestedBy: text("requested_by"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedById: uuid("decided_by_id"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  rowsDeleted: integer("rows_deleted"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
}, (t) => [index("idx_data_change_requests_status").on(t.status, t.requestedAt)]);

/**
 * Ingest requests and MQTT messages that were refused or failed, counted per
 * hour, source, route, status and code. Written in batches by
 * services/ingest-rejections.ts; kept for 30 days.
 */
export const ingestRejectionsTable = pgTable("ingest_rejections", {
  hour: timestamp("hour", { withTimezone: true }).notNull(),
  source: text("source").notNull(), // http | mqtt
  route: text("route").notNull(),
  status: integer("status").notNull(),
  code: text("code").notNull(),
  count: integer("count").notNull().default(0),
  lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  /** A short example of the error text (never the payload). */
  lastMessage: text("last_message"),
  /** API client or broker of the last occurrence, if known. */
  lastClient: text("last_client"),
}, (t) => [
  primaryKey({ columns: [t.hour, t.source, t.route, t.status, t.code] }),
]);
