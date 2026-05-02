import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
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
});

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
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
});

export const insertAlarmHistorySchema = createInsertSchema(alarmHistoryTable).omit({ id: true });
export type InsertAlarmHistory = z.infer<typeof insertAlarmHistorySchema>;
export type AlarmHistory = typeof alarmHistoryTable.$inferSelect;
