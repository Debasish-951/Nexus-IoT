import { pgTable, text, timestamp, uuid, integer, boolean, jsonb, bigserial, bigint, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Integration Hub tables (outbound events, delivery log, OAuth access tokens,
 * idempotency, per-client request log, pull connectors).
 *
 * Everything here is NEW: no existing table changes meaning, and every column
 * added to api_clients / destinations is nullable or has a default that keeps
 * the old behaviour. So `db push` is additive and the previous code paths run
 * exactly as before until someone opts in.
 */

/**
 * Outbox of business events (alarm raised/cleared/acknowledged, asset changes,
 * connector errors). Written once per event; deliveries fan out from here, and
 * machine clients can also poll it through GET /api/v1/events.
 */
export const integrationEventsTable = pgTable("integration_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  type: text("type").notNull(),
  assetId: uuid("asset_id"),
  /** Root asset (project) of `assetId`, so project-bound clients see only their own events. */
  projectId: uuid("project_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("integration_events_created_idx").on(t.createdAt),
  index("integration_events_project_idx").on(t.projectId, t.id),
]);

/**
 * One row per (event, destination). The delivery worker sends pending rows,
 * retries with backoff, and parks a row as `dead` after the destination's
 * maxAttempts. Resend puts a row back to `pending`.
 */
export const destinationDeliveriesTable = pgTable("destination_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: bigint("event_id", { mode: "number" }).notNull(),
  destinationId: uuid("destination_id").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("pending"), // pending | delivered | dead
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastStatusCode: integer("last_status_code"),
  lastError: text("last_error"),
  durationMs: integer("duration_ms"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("destination_deliveries_due_idx").on(t.status, t.nextAttemptAt),
  index("destination_deliveries_dest_idx").on(t.destinationId, t.createdAt),
]);

/**
 * Short-lived bearer tokens from POST /api/oauth/token (client-credentials
 * grant). Only the SHA-256 is stored. Tokens carry the `nxat_` prefix, so a
 * normal client secret never touches this table.
 */
export const apiAccessTokensTable = pgTable("api_access_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  apiClientId: uuid("api_client_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("api_access_tokens_hash_idx").on(t.tokenHash),
  index("api_access_tokens_expires_idx").on(t.expiresAt),
]);

/** Stored answers for writes sent with an Idempotency-Key header (kept 24 hours). */
export const apiIdempotencyKeysTable = pgTable("api_idempotency_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  apiClientId: uuid("api_client_id").notNull(),
  key: text("key").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code").notNull(),
  body: jsonb("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("api_idempotency_client_key_idx").on(t.apiClientId, t.key),
  index("api_idempotency_created_idx").on(t.createdAt),
]);

/** Every request made with an API credential (method, path, status, time). Pruned by age. */
export const apiRequestLogTable = pgTable("api_request_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  apiClientId: uuid("api_client_id").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code").notNull(),
  durationMs: integer("duration_ms").notNull(),
  ip: text("ip"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("api_request_log_client_ts_idx").on(t.apiClientId, t.ts),
  index("api_request_log_ts_idx").on(t.ts),
]);

/**
 * Pull connectors: the platform fetches data on a schedule (REST, PostgreSQL,
 * Modbus TCP; OPC UA saved but not run yet) and feeds it through the normal
 * ingest pipeline. Created disabled.
 */
export const pullConnectorsTable = pgTable("pull_connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(), // rest | sql | modbus | opcua
  description: text("description"),
  projectId: uuid("project_id"),
  enabled: boolean("enabled").notNull().default(false),
  intervalSec: integer("interval_sec").notNull().default(60),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  /** Password / token / connection string, AES-GCM encrypted (lib/secret-box). */
  secretEnc: text("secret_enc"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastStatus: text("last_status"), // ok | error | skipped
  lastError: text("last_error"),
  runCount: integer("run_count").notNull().default(0),
  recordsRead: integer("records_read").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type IntegrationEvent = typeof integrationEventsTable.$inferSelect;
export type DestinationDelivery = typeof destinationDeliveriesTable.$inferSelect;
export type PullConnector = typeof pullConnectorsTable.$inferSelect;
