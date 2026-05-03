import { pgTable, text, timestamp, uuid, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dataRetentionTable = pgTable("data_retention_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  assetId: uuid("asset_id"),          // null = applies to all assets
  metric: text("metric"),             // null = applies to all metrics
  retentionDays: integer("retention_days").notNull().default(90),
  enabled: boolean("enabled").notNull().default(true),
  lastPrunedAt: timestamp("last_pruned_at", { withTimezone: true }),
  rowsPruned: integer("rows_pruned").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDataRetentionSchema = createInsertSchema(dataRetentionTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDataRetention = z.infer<typeof insertDataRetentionSchema>;
export type DataRetention = typeof dataRetentionTable.$inferSelect;
