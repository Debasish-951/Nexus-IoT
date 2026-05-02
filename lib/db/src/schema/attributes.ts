import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attributesTable = pgTable("attributes", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("static"), // static | dynamic | metric | runtime
  dataType: text("data_type").notNull().default("text"), // text | number | boolean | timestamp | double
  value: jsonb("value"),
  tagName: text("tag_name"),
  uom: text("uom"),
  quality: text("quality"),
  expression: text("expression"),
  timestamp: timestamp("timestamp", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAttributeSchema = createInsertSchema(attributesTable).omit({ id: true, updatedAt: true });
export type InsertAttribute = z.infer<typeof insertAttributeSchema>;
export type Attribute = typeof attributesTable.$inferSelect;
