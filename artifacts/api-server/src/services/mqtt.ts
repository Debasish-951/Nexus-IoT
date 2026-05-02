/**
 * MQTT Subscriber Service
 * Reads MQTT brokers from the database, subscribes to their configured topics,
 * and auto-ingests incoming payloads via the ingest pipeline.
 */
import mqtt from "mqtt";
import { db, brokersTable, brokerEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { normalise, processNormalised } from "../routes/ingest.js";
import { broadcast } from "../lib/ws-broadcast.js";

const activeClients: Map<string, ReturnType<typeof mqtt.connect>> = new Map();

export async function startMqttSubscribers(): Promise<void> {
  const brokers = await db.select().from(brokersTable)
    .where(eq(brokersTable.type, "mqtt"));

  for (const broker of brokers) {
    if (!broker.endpoint || !broker.mqttTopic) continue;
    if (activeClients.has(broker.id)) continue; // already running

    try {
      const options: mqtt.IClientOptions = { clientId: broker.mqttClientId ?? `iot-platform-${broker.id.slice(0, 8)}` };
      if (broker.mqttUsername) options.username = broker.mqttUsername;
      if (broker.mqttPassword) options.password = broker.mqttPassword;
      options.reconnectPeriod = 5000;
      options.connectTimeout = 10000;

      const client = mqtt.connect(broker.endpoint, options);
      activeClients.set(broker.id, client);

      client.on("connect", async () => {
        const ts = new Date();
        await db.update(brokersTable).set({ status: "connected" }).where(eq(brokersTable.id, broker.id));
        await db.insert(brokerEventsTable).values({ brokerId: broker.id, brokerName: broker.name, status: "connected", timestamp: ts });
        broadcast("broker_status", { brokerId: broker.id, brokerName: broker.name, status: "connected", timestamp: ts.toISOString() });
        client.subscribe(broker.mqttTopic!, (err) => {
          if (err) console.error(`[MQTT] Subscribe error on ${broker.name}:`, err.message);
        });
      });

      client.on("message", async (_topic, message) => {
        try {
          const body = JSON.parse(message.toString()) as Record<string, unknown>;
          // Apply mapping rules: rename fields before normalisation
          const mappingRules = (broker.mappingRules ?? []) as Array<{ from: string; to: string }>;
          if (mappingRules.length > 0 && typeof body.data === "object" && body.data) {
            const data = body.data as Record<string, unknown>;
            for (const rule of mappingRules) {
              if (rule.from in data) { data[rule.to] = data[rule.from]; delete data[rule.from]; }
            }
          }
          // Ensure deviceId is set
          if (!body.deviceId && broker.mqttClientId) body.deviceId = broker.mqttClientId;
          const n = normalise(body);
          if (!n) return;
          await processNormalised(n);
          await db.update(brokersTable)
            .set({ totalRequests: db.$count(brokersTable) as any }) // increment approximation
            .where(eq(brokersTable.id, broker.id));
        } catch (err: any) {
          console.error(`[MQTT] Parse error on ${broker.name}:`, err.message);
        }
      });

      client.on("error", async (err) => {
        console.error(`[MQTT] Connection error on ${broker.name}:`, err.message);
        const ts = new Date();
        await db.update(brokersTable).set({ status: "error" }).where(eq(brokersTable.id, broker.id));
        await db.insert(brokerEventsTable).values({ brokerId: broker.id, brokerName: broker.name, status: "error", message: err.message, timestamp: ts });
        broadcast("broker_status", { brokerId: broker.id, brokerName: broker.name, status: "error", timestamp: ts.toISOString() });
      });

      client.on("close", async () => {
        const ts = new Date();
        await db.update(brokersTable).set({ status: "disconnected" }).where(eq(brokersTable.id, broker.id));
        await db.insert(brokerEventsTable).values({ brokerId: broker.id, brokerName: broker.name, status: "disconnected", timestamp: ts });
        broadcast("broker_status", { brokerId: broker.id, brokerName: broker.name, status: "disconnected", timestamp: ts.toISOString() });
      });

    } catch (err: any) {
      console.error(`[MQTT] Failed to start subscriber for ${broker.name}:`, err.message);
    }
  }
}

export async function stopMqttSubscribers(): Promise<void> {
  for (const [id, client] of activeClients) {
    client.end(true);
    activeClients.delete(id);
  }
}

export async function refreshMqttSubscribers(): Promise<void> {
  await stopMqttSubscribers();
  await startMqttSubscribers();
}
