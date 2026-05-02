import { pgTable, text, timestamp, uuid, boolean, integer } from "drizzle-orm/pg-core";

export const destinationsTable = pgTable("destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  endpoint: text("endpoint").notNull(),
  authType: text("auth_type").notNull().default("bearer"), // bearer|api_key|basic|none
  token: text("token"),
  secretKey: text("secret_key"),
  apiKeyHeader: text("api_key_header").default("X-API-Key"),
  basicUser: text("basic_user"),
  basicPass: text("basic_pass"),
  eventTypes: text("event_types").array().notNull().default(["alarm"]),
  enabled: boolean("enabled").notNull().default(true),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  sendCount: integer("send_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Destination = typeof destinationsTable.$inferSelect;
