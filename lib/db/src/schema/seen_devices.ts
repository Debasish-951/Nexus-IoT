import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

// Registry of every deviceId that has ever sent telemetry, even when no asset
// matches. Persisted so the device list (used by the Create Asset wizard and the
// asset-creation match rule) survives server restarts.
export const seenDevicesTable = pgTable("seen_devices", {
  deviceId: text("device_id").primaryKey(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
  matched: boolean("matched").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeenDeviceRow = typeof seenDevicesTable.$inferSelect;
