import { pgTable, text, timestamp, uuid, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface MappingRule {
  from: string; // incoming field name
  to: string;   // target attribute name / tag suffix
}

export const brokersTable = pgTable("brokers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull().default("mqtt"), // mqtt|rest_api|azure_iot|azure_event_hub
  endpoint: text("endpoint"),
  status: text("status").notNull().default("disconnected"), // connected|disconnected|error
  connectedDevices: integer("connected_devices").notNull().default(0),
  totalRequests: integer("total_requests").notNull().default(0),
  tags: text("tags").array().notNull().default([]),
  // MQTT specific
  mqttUsername: text("mqtt_username"),
  mqttPassword: text("mqtt_password"),
  mqttTopic: text("mqtt_topic"),
  mqttClientId: text("mqtt_client_id"),
  // Payload mapping rules
  mappingRules: jsonb("mapping_rules").$type<MappingRule[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBrokerSchema = createInsertSchema(brokersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBroker = z.infer<typeof insertBrokerSchema>;
export type Broker = typeof brokersTable.$inferSelect;
