import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const brokerEventsTable = pgTable("broker_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  brokerId: uuid("broker_id").notNull(),
  brokerName: text("broker_name").notNull(),
  status: text("status").notNull(), // connected | disconnected | error
  message: text("message"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Per-broker history (newest first) and age-based retention.
  index("broker_events_broker_ts_idx").on(table.brokerId, table.timestamp),
  index("broker_events_ts_idx").on(table.timestamp),
]);

export type BrokerEvent = typeof brokerEventsTable.$inferSelect;
