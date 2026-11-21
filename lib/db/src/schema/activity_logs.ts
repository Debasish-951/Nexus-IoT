import { pgTable, pgSequence, text, timestamp, uuid, index, jsonb, bigint, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** One field changed by an edit; secrets are stored as "[redacted]". */
export interface AuditChange { field: string; from: unknown; to: unknown }

/**
 * The audit log. Append-only: a database trigger (ensured at API start, see
 * artifacts/api-server/src/lib/audit-store.ts) refuses UPDATE and DELETE except
 * for the hash backfill and the retention job. Each row carries the SHA-256 of
 * the previous row's hash plus its own fields, so an edit or a removal in the
 * middle breaks the chain that GET /activity-log/verify walks.
 */
/**
 * Sequence for activity_logs.seq. A separate sequence with a nullable column
 * (rather than bigserial) lets `db push` add the column to an existing table:
 * Postgres numbers the existing rows from the default, and drizzle-kit does not
 * offer to truncate the table as it does for a new NOT NULL column.
 */
export const activityLogsSeq = pgSequence("activity_logs_seq");

export const activityLogsTable = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Insertion order; the hash chain follows it. */
  seq: bigint("seq", { mode: "number" }).default(sql`nextval('activity_logs_seq')`),
  action: text("action").notNull(),
  category: text("category").notNull(),
  actorName: text("actor_name").notNull().default("system"),
  actorRole: text("actor_role").notNull().default("system"),
  actorUsername: text("actor_username"),
  /** From the signed-in session (never from request headers); null for system jobs. */
  actorUserId: text("actor_user_id"),
  targetId: text("target_id"),
  targetName: text("target_name"),
  detail: text("detail"),
  /** Field-level before/after of an edit. */
  changes: jsonb("changes").$type<AuditChange[]>(),
  /** success | failure | denied */
  outcome: text("outcome").notNull().default("success"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  correlationId: text("correlation_id"),
  /** The asset the entry is about, and the project (root asset) it belongs to. */
  assetId: text("asset_id"),
  projectId: text("project_id"),
  prevHash: text("prev_hash"),
  hash: text("hash"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // The log is read newest first and pruned by age.
  index("activity_logs_ts_idx").on(table.timestamp),
  uniqueIndex("activity_logs_seq_idx").on(table.seq),
  index("activity_logs_actor_idx").on(table.actorUserId),
  index("activity_logs_category_idx").on(table.category),
  index("activity_logs_action_idx").on(table.action),
  index("activity_logs_target_idx").on(table.targetId),
  index("activity_logs_project_idx").on(table.projectId),
]);

export type ActivityLog = typeof activityLogsTable.$inferSelect;

/**
 * Alerts raised when a sensitive action is recorded (an alarm rule deleted, a
 * user made administrator, data deleted, repeated failed sign-ins...). Shown in
 * the notification bell to users with Security Settings access.
 */
export const auditAlertsTable = pgTable("audit_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  rule: text("rule").notNull(),
  severity: text("severity").notNull(), // critical | high | medium
  title: text("title").notNull(),
  message: text("message").notNull(),
  /** The audit entry that raised it (null for sign-in bursts). */
  entryId: text("entry_id"),
  /** Collapses repeats (for example one failed-sign-in alert per user per hour). */
  dedupeKey: text("dedupe_key"),
  status: text("status").notNull().default("active"), // active | acknowledged
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
}, (t) => [
  index("audit_alerts_status_idx").on(t.status, t.raisedAt),
  index("audit_alerts_dedupe_idx").on(t.dedupeKey, t.raisedAt),
]);

export type AuditAlert = typeof auditAlertsTable.$inferSelect;
