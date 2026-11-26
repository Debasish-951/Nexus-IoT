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
  // ── Integration Hub additions (defaults keep the old behaviour) ──
  /** direct = the original single send from ingest; queued = outbox with retries and a delivery log. */
  deliveryMode: text("delivery_mode").notNull().default("direct"),
  /** Add X-Nexus-Signature (HMAC-SHA256 with secretKey) to every send. */
  signatureEnabled: boolean("signature_enabled").notNull().default(false),
  /** Only events from this project (root asset). Null = every project. */
  projectId: uuid("project_id"),
  /** Queued mode: attempts before a delivery is parked as dead. */
  maxAttempts: integer("max_attempts").notNull().default(6),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  sendCount: integer("send_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Destination = typeof destinationsTable.$inferSelect;
