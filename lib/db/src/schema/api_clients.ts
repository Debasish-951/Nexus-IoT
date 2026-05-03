import { pgTable, text, timestamp, uuid, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiClientsTable = pgTable("api_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  tags: text("tags").array().notNull().default([]),
  scopes: text("scopes").array().notNull().default([]),
  status: text("status").notNull().default("active"), // active|inactive|revoked
  allowedIps: text("allowed_ips").array().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),
  totalRequests: integer("total_requests").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApiClientSchema = createInsertSchema(apiClientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApiClient = z.infer<typeof insertApiClientSchema>;
export type ApiClient = typeof apiClientsTable.$inferSelect;
