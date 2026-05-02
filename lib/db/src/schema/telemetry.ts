import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const telemetryTable = pgTable("telemetry", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull(),
  deviceId: text("device_id"),
  metric: text("metric").notNull(),
  value: jsonb("value"),
  quality: text("quality"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTelemetrySchema = createInsertSchema(telemetryTable).omit({ id: true });
export type InsertTelemetry = z.infer<typeof insertTelemetrySchema>;
export type Telemetry = typeof telemetryTable.$inferSelect;
