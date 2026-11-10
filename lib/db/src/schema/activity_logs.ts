import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const activityLogsTable = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  category: text("category").notNull(),
  actorName: text("actor_name").notNull().default("system"),
  actorRole: text("actor_role").notNull().default("system"),
  actorUsername: text("actor_username"),
  targetId: text("target_id"),
  targetName: text("target_name"),
  detail: text("detail"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // The log is read newest first and pruned by age.
  index("activity_logs_ts_idx").on(table.timestamp),
]);

export type ActivityLog = typeof activityLogsTable.$inferSelect;
