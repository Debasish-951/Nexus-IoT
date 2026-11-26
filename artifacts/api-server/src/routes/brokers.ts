import { Router, type IRouter } from "express";
import { respondInvalid } from "../lib/respond";
import { eq } from "drizzle-orm";
import { db, brokersTable } from "@workspace/db";
import {
  CreateBrokerBody,
  UpdateBrokerBody,
  UpdateBrokerParams,
  DeleteBrokerParams,
} from "@workspace/api-zod";
import { logActivity } from "./activity_log";
import { diffFields } from "../lib/audit-core";
import { encryptSecret } from "../lib/secret-box";
import { refreshMqttSubscribers } from "../services/mqtt";
import { checkBrokerEndpoint } from "../lib/broker-target";
import { logger } from "../lib/logger";

/** AAD context for the MQTT password; services/mqtt.ts decrypts with the same one. */
const MQTT_CREDENTIAL_AAD = "brokers.mqttPassword";

/**
 * Azure IoT Hub and Event Hub brokers are stored but nothing connects to them:
 * there is no Azure consumer in the server. Said in every response so the UI and
 * API callers are not left waiting for a connection that will never happen.
 */
function connectionNote(type: string): string | null {
  if (type === "azure_iot" || type === "azure_event_hub") {
    return "The server does not connect to Azure brokers yet. Forward this hub's messages to the HTTP ingest endpoint instead.";
  }
  return null;
}

/**
 * Strip the MQTT password from anything returned to a client.
 *
 * `GET /brokers` used to return the raw row, so every broker's MQTT password was
 * visible to any user who could list brokers. The password is write-only: the
 * response keeps `hasMqttPassword` so the UI can still show whether
 * authentication is configured.
 */
function toClient(row: typeof brokersTable.$inferSelect) {
  const { mqttPassword: _p, ...safe } = row;
  return { ...safe, hasMqttPassword: !!row.mqttPassword, connectionNote: connectionNote(row.type) };
}

/** Trimmed text, or null when blank. */
function textOrNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/** Mapping rules with empty names removed. */
function cleanRules(rules: { from: string; to: string }[]): { from: string; to: string }[] {
  return rules
    .map((r) => ({ from: r.from.trim(), to: r.to.trim() }))
    .filter((r) => r.from && r.to);
}

/**
 * Reconnect the MQTT subscriber for one broker after a change. Fire-and-forget:
 * the save has succeeded whatever the broker does, and a connection failure is
 * reported through the broker's status and history instead.
 */
function refreshSubscriber(brokerId: string): void {
  refreshMqttSubscribers(brokerId).catch((err) => {
    logger.warn({ brokerId, err }, "MQTT subscriber refresh failed");
  });
}

const router: IRouter = Router();

router.get("/brokers", async (req, res): Promise<void> => {
  const brokers = await db
    .select()
    .from(brokersTable)
    .orderBy(brokersTable.name);

  res.json(brokers.map(toClient));
});

router.post("/brokers", async (req, res): Promise<void> => {
  const parsed = CreateBrokerBody.safeParse(req.body);
  if (!parsed.success) {
    respondInvalid(req, res, parsed.error);
    return;
  }
  const body = parsed.data;

  // The server connects to this address, so it is checked here (lib/broker-target.ts).
  const target = checkBrokerEndpoint(body.endpoint, body.type);
  if (!target.ok) { res.status(400).json({ error: target.error, code: "unsafe_broker_target" }); return; }

  // Topic, client id, credentials and mapping rules used to be dropped here, and
  // the subscriber skips a broker without a topic, so an MQTT broker created in
  // the UI could never connect.
  const [broker] = await db
    .insert(brokersTable)
    .values({
      name: body.name,
      type: body.type,
      endpoint: body.endpoint ?? null,
      tags: body.tags ?? [],
      status: "disconnected",
      mqttTopic: textOrNull(body.mqttTopic),
      mqttClientId: textOrNull(body.mqttClientId),
      mqttUsername: textOrNull(body.mqttUsername),
      // Encrypted at rest, like destination credentials (lib/secret-box.ts).
      mqttPassword: body.mqttPassword ? encryptSecret(body.mqttPassword, MQTT_CREDENTIAL_AAD) : null,
      mappingRules: cleanRules(body.mappingRules ?? []),
    })
    .returning();

  void logActivity("broker.created", "broker", broker.id, broker.name, `type=${broker.type}`, req);
  if (broker.type === "mqtt") refreshSubscriber(broker.id);
  res.status(201).json(toClient(broker));
});

router.put("/brokers/:id", async (req, res): Promise<void> => {
  const params = UpdateBrokerParams.safeParse(req.params);
  if (!params.success) {
    respondInvalid(req, res, params.error);
    return;
  }

  const parsed = UpdateBrokerBody.safeParse(req.body);
  if (!parsed.success) {
    respondInvalid(req, res, parsed.error);
    return;
  }
  const body = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.endpoint !== undefined) updateData.endpoint = body.endpoint;
  if (body.tags !== undefined) updateData.tags = body.tags;
  if (body.mqttTopic !== undefined) updateData.mqttTopic = textOrNull(body.mqttTopic);
  if (body.mqttClientId !== undefined) updateData.mqttClientId = textOrNull(body.mqttClientId);
  if (body.mqttUsername !== undefined) updateData.mqttUsername = textOrNull(body.mqttUsername);
  // Omitted leaves the stored password alone (the form cannot read it back);
  // an empty string or null clears it.
  if (body.mqttPassword !== undefined) {
    updateData.mqttPassword = body.mqttPassword ? encryptSecret(body.mqttPassword, MQTT_CREDENTIAL_AAD) : null;
  }
  if (body.mappingRules !== undefined) updateData.mappingRules = cleanRules(body.mappingRules);

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No changes were sent.", code: "no_changes" });
    return;
  }

  const [beforeBroker] = await db.select().from(brokersTable).where(eq(brokersTable.id, params.data.id));
  if (beforeBroker && body.endpoint !== undefined) {
    const target = checkBrokerEndpoint(body.endpoint, beforeBroker.type);
    if (!target.ok) { res.status(400).json({ error: target.error, code: "unsafe_broker_target" }); return; }
  }
  const [broker] = await db
    .update(brokersTable)
    .set(updateData)
    .where(eq(brokersTable.id, params.data.id))
    .returning();

  if (!broker) {
    res.status(404).json({ error: "Broker not found" });
    return;
  }

  void logActivity("broker.updated", "broker", broker.id, broker.name, null, req,
    { changes: diffFields(beforeBroker as unknown as Record<string, unknown>, broker as unknown as Record<string, unknown>, { only: Object.keys(updateData) }) });
  refreshSubscriber(broker.id);
  res.json(toClient(broker));
});

router.delete("/brokers/:id", async (req, res): Promise<void> => {
  const params = DeleteBrokerParams.safeParse(req.params);
  if (!params.success) {
    respondInvalid(req, res, params.error);
    return;
  }

  const [broker] = await db
    .delete(brokersTable)
    .where(eq(brokersTable.id, params.data.id))
    .returning();

  if (!broker) {
    res.status(404).json({ error: "Broker not found" });
    return;
  }

  void logActivity("broker.deleted", "broker", broker.id, broker.name, null, req);
  // The row is gone, so the refresh stops the client and starts nothing.
  refreshSubscriber(broker.id);
  res.sendStatus(204);
});

export default router;
