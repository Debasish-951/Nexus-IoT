import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, brokersTable } from "@workspace/db";
import {
  CreateBrokerBody,
  UpdateBrokerBody,
  UpdateBrokerParams,
  DeleteBrokerParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/brokers", async (req, res): Promise<void> => {
  const brokers = await db
    .select()
    .from(brokersTable)
    .orderBy(brokersTable.name);

  res.json(brokers);
});

router.post("/brokers", async (req, res): Promise<void> => {
  const parsed = CreateBrokerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

  res.status(201).json(broker);
});

router.put("/brokers/:id", async (req, res): Promise<void> => {
  const params = UpdateBrokerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateBrokerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

  res.json(broker);
});

router.delete("/brokers/:id", async (req, res): Promise<void> => {
  const params = DeleteBrokerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

  res.sendStatus(204);
});

export default router;
