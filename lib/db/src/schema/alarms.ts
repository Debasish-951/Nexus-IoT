import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alarmsTable = pgTable("alarms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  assetId: uuid("asset_id").notNull(),
  assetName: text("asset_name").notNull(),
  ruleId: uuid("rule_id"),
  severity: text("severity").notNull().default("medium"), // critical|high|medium|low|info
  status: text("status").notNull().default("active"), // active|acknowledged|cleared
  alarmClass: text("alarm_class"),
  message: text("message"),
  triggerValue: jsonb("trigger_value"),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
}, (table) => [
  // One open alarm per rule and asset. Payloads are processed concurrently, so
  // the check-then-insert in evaluateAlarmRules cannot prevent duplicates by
  // itself: several payloads can all see "no open alarm" and all insert one.
  // Keyed on the asset too, because a rule with no asset applies to every asset
  // and each asset needs its own alarm. Renamed from alarms_one_open_per_rule so
  // push drops and recreates it rather than diffing columns in place.
  uniqueIndex("alarms_one_open_per_rule_asset")
    .on(table.ruleId, table.assetId)
    .where(sql`${table.ruleId} IS NOT NULL AND ${table.status} IN ('active', 'acknowledged')`),
  // Lists and counts filter on status (bell, dashboard KPIs) and on asset + status
  // (asset health, ingest's open-alarm lookup); lists sort by time.
  index("alarms_status_idx").on(table.status),
  index("alarms_asset_status_idx").on(table.assetId, table.status),
  index("alarms_triggered_at_idx").on(table.triggeredAt),
]);

export const insertAlarmSchema = createInsertSchema(alarmsTable).omit({ id: true });
export type InsertAlarm = z.infer<typeof insertAlarmSchema>;
export type Alarm = typeof alarmsTable.$inferSelect;

export const alarmHistoryTable = pgTable("alarm_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  alarmId: uuid("alarm_id").notNull(),
  assetId: uuid("asset_id").notNull(),
  assetName: text("asset_name").notNull(),
  name: text("name").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
  /** Set when the alarm is acknowledged. Nullable, so adding it needs no backfill. */
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
}, (table) => [
  // Every clear and acknowledge updates history by alarm_id; trend charts and
  // retention filter by triggered_at.
  index("alarm_history_alarm_id_idx").on(table.alarmId),
  index("alarm_history_triggered_at_idx").on(table.triggeredAt),
  // Per-asset history (asset pages, AI tools, reports) filters by asset and time.
  index("alarm_history_asset_triggered_idx").on(table.assetId, table.triggeredAt),
]);

export const insertAlarmHistorySchema = createInsertSchema(alarmHistoryTable).omit({ id: true });
export type InsertAlarmHistory = z.infer<typeof insertAlarmHistorySchema>;
export type AlarmHistory = typeof alarmHistoryTable.$inferSelect;
