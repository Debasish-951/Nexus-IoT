import { pgTable, text, timestamp, uuid, jsonb, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attributesTable = pgTable("attributes", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("static"), // static | dynamic | metric | runtime | timestamp
  dataType: text("data_type").notNull().default("text"), // text | number | boolean | timestamp | double
  value: jsonb("value"),
  tagName: text("tag_name"),
  sourceMetric: text("source_metric"),   // payload key that feeds this attribute (if ≠ tagName-derived key)
  uom: text("uom"),
  decimalPlaces: integer("decimal_places"),          // display decimal places (null = no rounding)
  thousandSeparator: boolean("thousand_separator").notNull().default(false),
  quality: text("quality"),
  expression: text("expression"),
  timestamp: timestamp("timestamp", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  // Drives display order (see routes/attributes.ts) so attributes applied from a
  // template keep the template's section layout instead of falling back to A–Z.
  // Assigned as (current max for the asset) + 1 on every insert path, so new
  // attributes always append after whatever's already there.
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertAttributeSchema = createInsertSchema(attributesTable).omit({ id: true, updatedAt: true });
export type InsertAttribute = z.infer<typeof insertAttributeSchema>;
export type Attribute = typeof attributesTable.$inferSelect;
