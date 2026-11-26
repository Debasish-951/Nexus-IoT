import { pgTable, text, timestamp, integer, uuid, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetsTable = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /**
   * Device ID — the payload's `deviceId`, which is what binds telemetry to this asset.
   *
   * Deliberately NOT unique. One gateway payload usually describes several sections of
   * a plant (chiller, lighting, grid), and the natural modelling is one asset per
   * section, each from its own section template, all carrying that same device id.
   * Ingest partitions the payload by the tags each asset declares, so several assets
   * sharing an id is a supported topology rather than a conflict.
   *
   * Null for grouping assets (Site / Unit / Process) — they hold no device link.
   */
  identifier: text("identifier"),
  parentId: uuid("parent_id"),
  templateId: uuid("template_id"),
  templateName: text("template_name"),
  description: text("description"),
  tags: text("tags").array().notNull().default([]),
  childCount: integer("child_count").notNull().default(0),
  attributeCount: integer("attribute_count").notNull().default(0),
  // Maintenance mode — suppresses alarm evaluation while set
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  maintenanceSince: timestamp("maintenance_since", { withTimezone: true }),
  maintenanceNote: text("maintenance_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Ingest attributes every payload by identifier = deviceId; tree walks, deletes
  // and child lists look up by parent. Both were sequential scans.
  index("assets_identifier_idx").on(table.identifier),
  index("assets_parent_id_idx").on(table.parentId),
]);

export const insertAssetSchema = createInsertSchema(assetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
