import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const brokerEventsTable = pgTable("broker_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  brokerId: uuid("broker_id").notNull(),
  brokerName: text("broker_name").notNull(),
  status: text("status").notNull(), // connected | disconnected | error
  message: text("message"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export type BrokerEvent = typeof brokerEventsTable.$inferSelect;
