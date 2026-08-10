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

/**
 * Strip the MQTT password from anything returned to a client.
 *
 * `GET /brokers` returned the raw row, so every broker's MQTT password was
 * visible to any user who could list brokers. Note this route never SETS the
 * password — it is configured out of band — which is why the leak went unnoticed:
 * nothing in this file put it there, so nothing in this file looked responsible
 * for taking it out.
 *
 * The response keeps `hasMqttPassword` so the UI can still show whether
 * authentication is configured.
 */
function toClient(row: typeof brokersTable.$inferSelect) {
  const { mqttPassword: _p, ...safe } = row;
  return { ...safe, hasMqttPassword: !!row.mqttPassword };
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

  const [broker] = await db
    .insert(brokersTable)
    .values({
      name: parsed.data.name,
      type: parsed.data.type,
      endpoint: parsed.data.endpoint ?? null,
      tags: parsed.data.tags ?? [],
      status: "disconnected",
    })
    .returning();

  void logActivity("broker.created", "broker", broker.id, broker.name, `type=${broker.type}`, req);
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

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.endpoint !== undefined) updateData.endpoint = parsed.data.endpoint;
  if (parsed.data.tags !== undefined) updateData.tags = parsed.data.tags;

  const [broker] = await db
    .update(brokersTable)
    .set(updateData)
    .where(eq(brokersTable.id, params.data.id))
    .returning();

  if (!broker) {
    res.status(404).json({ error: "Broker not found" });
    return;
  }

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
  res.sendStatus(204);
});

export default router;
