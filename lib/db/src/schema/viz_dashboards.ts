import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";

export const vizDashboardsTable = pgTable("viz_dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  assetFilter: uuid("asset_filter"),
  roleFilter: text("role_filter"),
  widgets: jsonb("widgets").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type VizDashboard = typeof vizDashboardsTable.$inferSelect;
