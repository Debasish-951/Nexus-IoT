import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, apiClientsTable } from "@workspace/db";
import {
  CreateApiClientBody,
  UpdateApiClientBody,
  UpdateApiClientParams,
  DeleteApiClientParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { logActivity } from "./activity_log";

const router: IRouter = Router();

router.get("/api-clients", async (req, res): Promise<void> => {
  const clients = await db
    .select()
    .from(apiClientsTable)
    .orderBy(apiClientsTable.name);

  res.json(clients);
});

router.post("/api-clients", async (req, res): Promise<void> => {
  const parsed = CreateApiClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [client] = await db
    .insert(apiClientsTable)
    .values({
      name: parsed.data.name,
      clientId: randomUUID(),
      clientSecret: randomUUID(),
      tags: parsed.data.tags ?? [],
      scopes: parsed.data.scopes ?? [],
      status: "active",
    })
    .returning();

  void logActivity("api_client.created", "api_client", client.id, client.name, null, req);
  res.status(201).json(client);
});

router.put("/api-clients/:id", async (req, res): Promise<void> => {
  const params = UpdateApiClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateApiClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.tags !== undefined) updateData.tags = parsed.data.tags;
  if (parsed.data.scopes !== undefined) updateData.scopes = parsed.data.scopes;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

  const [client] = await db
    .update(apiClientsTable)
    .set(updateData)
    .where(eq(apiClientsTable.id, params.data.id))
    .returning();

  if (!client) {
    res.status(404).json({ error: "API client not found" });
    return;
  }

  res.json(client);
});

router.delete("/api-clients/:id", async (req, res): Promise<void> => {
  const params = DeleteApiClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [client] = await db
    .delete(apiClientsTable)
    .where(eq(apiClientsTable.id, params.data.id))
    .returning();

  if (!client) {
    res.status(404).json({ error: "API client not found" });
    return;
  }

  void logActivity("api_client.deleted", "api_client", client.id, client.name, null, req);
  res.sendStatus(204);
});

export default router;
