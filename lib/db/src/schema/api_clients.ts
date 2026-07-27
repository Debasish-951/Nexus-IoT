import { pgTable, text, timestamp, uuid, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiClientsTable = pgTable("api_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  /**
   * Optional owning project — a root-level asset (one with no parent).
   *
   * This is what lets a team share one credential: the project head creates a
   * project, assigns people to it (users.access_overrides.allowedProjects), and
   * gives the project a dedicated API client. Everyone on the project sees and
   * uses that one endpoint, instead of each person needing their own key.
   *
   * NULL means a platform-wide client, visible only to administrators — the
   * pre-existing behaviour, so old rows keep working untouched.
   *
   * Deliberately NOT a foreign key: assets are user-managed and deleting a
   * project should orphan its client (surfaced in the UI as "unassigned")
   * rather than cascade-delete a live credential out from under a running
   * gateway.
   */
  projectId: uuid("project_id"),
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
