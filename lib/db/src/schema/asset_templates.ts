import { pgTable, text, timestamp, integer, uuid, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface AttributeDefinition {
  name: string;
  // "timestamp" attributes hold the payload's own clock rather than a metric value —
  // ingest binds them by type, not by tagName (the timestamp never travels as a metric).
  type: "static" | "dynamic" | "metric" | "runtime" | "timestamp";
  dataType: "text" | "number" | "double" | "boolean" | "timestamp";
  tagName?: string;
  uom?: string;
  value?: string;
  // Optional metadata (stored in the jsonb column — no DB migration needed).
  required?: boolean;
  description?: string;
  /** Display rounding, 0–10. Copied onto the attribute when the template is applied. */
  decimalPlaces?: number;
}

export const assetTemplatesTable = pgTable("asset_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  deviceId: text("device_id"),
  tags: text("tags").array().notNull().default([]),
  attributeCount: integer("attribute_count").notNull().default(0),
  attributeDefinitions: jsonb("attribute_definitions")
    .$type<AttributeDefinition[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAssetTemplateSchema = createInsertSchema(assetTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssetTemplate = z.infer<typeof insertAssetTemplateSchema>;
export type AssetTemplate = typeof assetTemplatesTable.$inferSelect;
