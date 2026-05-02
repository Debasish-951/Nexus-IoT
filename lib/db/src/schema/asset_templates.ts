import { pgTable, text, timestamp, integer, uuid, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface AttributeDefinition {
  name: string;
  type: "static" | "dynamic" | "metric";
  dataType: "text" | "number" | "double" | "boolean" | "timestamp";
  tagName?: string;
  uom?: string;
  value?: string;
}

export const assetTemplatesTable = pgTable("asset_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
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
