import { pgTable, text, timestamp, uuid, integer, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alarmRulesTable = pgTable("alarm_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  assetId: uuid("asset_id"),
  alarmType: text("alarm_type").notNull().default("threshold"), // threshold|deviation|rate_of_change|heartbeat
  severity: text("severity").notNull().default("medium"),
  metric: text("metric"),
  operator: text("operator"), // gt|lt|gte|lte|eq|ne
  threshold: doublePrecision("threshold"),
  deadband: doublePrecision("deadband"),
  onDelay: integer("on_delay"),
  offDelay: integer("off_delay"),
  scanRate: integer("scan_rate").default(2),
  rocWindow: integer("roc_window").default(60), // seconds window for rate-of-change
  enabled: boolean("enabled").notNull().default(true),
  requireAcknowledge: boolean("require_acknowledge").notNull().default(true),
  webhookUrl: text("webhook_url"),
  webhookEnabled: boolean("webhook_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAlarmRuleSchema = createInsertSchema(alarmRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAlarmRule = z.infer<typeof insertAlarmRuleSchema>;
export type AlarmRule = typeof alarmRulesTable.$inferSelect;
