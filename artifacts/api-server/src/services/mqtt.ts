import { decryptSecret } from "../lib/secret-box";
/**
 * MQTT Subscriber Service
 * Reads MQTT brokers from the database, subscribes to their configured topics,
 * and auto-ingests incoming payloads via the ingest pipeline.
 *
 * Azure IoT Hub / Event Hub brokers are stored by the broker routes but nothing
 * here connects to them; only `type = 'mqtt'` brokers are subscribed.
 */
import mqtt from "mqtt";
import { db, brokersTable, brokerEventsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { normalise, processNormalised } from "../routes/ingest.js";
import { recordIngestRejection } from "./ingest-rejections.js";
import { broadcast } from "../lib/ws-broadcast.js";

const activeClients: Map<string, ReturnType<typeof mqtt.connect>> = new Map();

/** Messages processed at once per broker. MQTT_MAX_INFLIGHT overrides; 1 keeps strict order. */
const MAX_INFLIGHT = (() => {
  const n = Number(process.env.MQTT_MAX_INFLIGHT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
})();

/**
 * Bounds how many messages one broker processes at once.
 *
 * Each message used to start its own ingest straight away, so a burst opened
 * hundreds of concurrent ingests and queued them all on the database pool. The
 * gate is wired to MQTT.js's `handleMessage`, whose callback tells the client it
 * may deliver the next packet (and, for QoS 1, send the PUBACK). Holding that
 * callback while `max` messages are in flight pushes back on the broker, which
 * keeps unacknowledged messages for us, instead of dropping or buffering without limit.
 */
export class InflightGate {
  private inflight = 0;
  private waiting: (() => void) | null = null;

  constructor(readonly max: number) {}

  get active(): number { return this.inflight; }

  /** Start `task`; call `next` as soon as another message may be accepted. */
  run(task: () => Promise<void>, next: () => void): void {
    this.inflight++;
    if (this.inflight < this.max) next();
    else this.waiting = next;
    void task().catch(() => { /* the task logs its own errors */ }).finally(() => {
      this.inflight--;
      const resume = this.waiting;
      this.waiting = null;
      resume?.();
    });
  }
}

/** Stable client id, so a persistent session (clean: false) is resumed after a reconnect. */
export function mqttClientIdFor(broker: { id: string; mqttClientId: string | null }): string {
  return broker.mqttClientId?.trim() || `iot-platform-${broker.id.slice(0, 8)}`;
}

/** Start subscribers for MQTT brokers not already running. `onlyId` limits it to one broker. */
export async function startMqttSubscribers(onlyId?: string): Promise<void> {
  const brokers = await db.select().from(brokersTable)
    .where(onlyId
      ? and(eq(brokersTable.type, "mqtt"), eq(brokersTable.id, onlyId))
      : eq(brokersTable.type, "mqtt"));

  for (const broker of brokers) {
    if (!broker.endpoint || !broker.mqttTopic) continue;
    if (activeClients.has(broker.id)) continue; // already running

    try {
      const options: mqtt.IClientOptions = {
        clientId: mqttClientIdFor(broker),
        // A persistent session: the broker keeps QoS 1 messages for this client
        // while it is disconnected (a restart, a network drop) and delivers them
        // on reconnect. A clean session discarded them.
        clean: false,
      };
      if (broker.mqttUsername) options.username = broker.mqttUsername;
      // Decrypted at the moment of connection and not held anywhere else.
      if (broker.mqttPassword) {
        const password = decryptSecret(broker.mqttPassword, "brokers.mqttPassword");
        if (password) options.password = password;
        else console.error(`[MQTT] Password for ${broker.name} could not be decrypted - connecting without it`);
      }
      options.reconnectPeriod = 5000;
      options.connectTimeout = 10000;

      const client = mqtt.connect(broker.endpoint, options);
      activeClients.set(broker.id, client);

      // Writes the broker's status. These handlers are called by the MQTT library,
      // outside any request, so a database error here must be caught: an
      // unhandled rejection would stop the whole API process.
      const recordStatus = async (status: "connected" | "error" | "disconnected", message?: string): Promise<void> => {
        const ts = new Date();
        try {
          await db.update(brokersTable).set({ status }).where(eq(brokersTable.id, broker.id));
          await db.insert(brokerEventsTable).values({ brokerId: broker.id, brokerName: broker.name, status, message, timestamp: ts });
        } catch (err: any) {
          console.error(`[MQTT] Could not record "${status}" for ${broker.name}:`, err?.message ?? err);
        }
        broadcast("broker_status", { brokerId: broker.id, brokerName: broker.name, status, timestamp: ts.toISOString() });
      };

      client.on("connect", () => {
        // Subscribe first, so a database problem cannot leave the connection unsubscribed.
        // QoS 1: at-least-once delivery. QoS 0 lost any message sent while busy or reconnecting.
        client.subscribe(broker.mqttTopic!, { qos: 1 }, (err) => {
          if (err) console.error(`[MQTT] Subscribe error on ${broker.name}:`, err.message);
        });
        void recordStatus("connected");
      });

      const processMessage = async (payload: Buffer | string): Promise<void> => {
        try {
          const body = JSON.parse(payload.toString()) as Record<string, unknown>;
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
          if (!n) {
            recordIngestRejection({ source: "mqtt", route: `mqtt:${broker.name}`, status: 422, code: "no_readings", message: "The message held no readings that could be stored.", client: broker.name });
            return;
          }
          await processNormalised(n);
          // One message, one request. This used to write the number of BROKERS.
          await db.update(brokersTable)
            .set({ totalRequests: sql`${brokersTable.totalRequests} + 1` })
            .where(eq(brokersTable.id, broker.id));
        } catch (err: any) {
          console.error(`[MQTT] Message error on ${broker.name}:`, err?.message ?? err);
          recordIngestRejection({
            source: "mqtt", route: `mqtt:${broker.name}`, status: err instanceof SyntaxError ? 400 : 500,
            code: err instanceof SyntaxError ? "invalid_json" : "processing_failed", message: err?.message ?? String(err), client: broker.name,
          });
        }
      };

      // Processing happens here rather than in a "message" listener so that the
      // gate can hold back the next delivery; see InflightGate.
      const gate = new InflightGate(MAX_INFLIGHT);
      client.handleMessage = (packet, done) => {
        gate.run(() => processMessage(packet.payload), () => done());
      };

      client.on("error", (err) => {
        console.error(`[MQTT] Connection error on ${broker.name}:`, err.message);
        void recordStatus("error", err.message);
      });

      client.on("close", () => {
        // A client stopped on purpose (broker edited or deleted, shutdown) is no
        // longer in the map and must not write a status for a row that may be gone.
        if (activeClients.get(broker.id) !== client) return;
        void recordStatus("disconnected");
      });

    } catch (err: any) {
      console.error(`[MQTT] Failed to start subscriber for ${broker.name}:`, err.message);
    }
  }
}

/** Stop every subscriber, or only the one for `onlyId`. */
export async function stopMqttSubscribers(onlyId?: string): Promise<void> {
  for (const [id, client] of activeClients) {
    if (onlyId && id !== onlyId) continue;
    activeClients.delete(id);
    client.end(true);
  }
}

/**
 * Reconnect after a broker is created, edited or deleted, so a change takes
 * effect without restarting the API. With an id only that broker's client is
 * restarted; the others keep their connections.
 */
export async function refreshMqttSubscribers(onlyId?: string): Promise<void> {
  await stopMqttSubscribers(onlyId);
  await startMqttSubscribers(onlyId);
}
