import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
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
}, (table) => [
  // Primary time-series query: filter by asset + metric, order by time descending
  index("idx_telemetry_asset_metric_ts").on(table.assetId, table.metric, table.timestamp),
  // Global time-range scans (retention pruning, export, dashboard)
  index("idx_telemetry_ts").on(table.timestamp),
  // Per-asset scans (export all metrics for one asset)
  index("idx_telemetry_asset_ts").on(table.assetId, table.timestamp),
]);

export const insertTelemetrySchema = createInsertSchema(telemetryTable).omit({ id: true });
export type InsertTelemetry = z.infer<typeof insertTelemetrySchema>;
export type Telemetry = typeof telemetryTable.$inferSelect;
