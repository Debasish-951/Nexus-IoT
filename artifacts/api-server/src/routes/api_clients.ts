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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router();

// ── List ───────────────────────────────────────────────────────────────────────
router.get("/api-clients", async (_req, res): Promise<void> => {
  const clients = await db
    .select()
    .from(apiClientsTable)
    .orderBy(apiClientsTable.name);
  res.json(clients);
});

// ── Create ─────────────────────────────────────────────────────────────────────
router.post("/api-clients", async (req, res): Promise<void> => {
  const parsed = CreateApiClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Parse expiresAt and allowedIps from body manually (not in generated Zod yet)
  const body = req.body as Record<string, unknown>;
  const expiresAt   = body.expiresAt   ? new Date(body.expiresAt as string)   : null;
  const allowedIps  = Array.isArray(body.allowedIps) ? (body.allowedIps as string[]) : [];
  const description = typeof body.description === "string" ? body.description : null;

  const [client] = await db
    .insert(apiClientsTable)
    .values({
      name:        parsed.data.name,
      description,
      clientId:    randomUUID(),
      clientSecret: randomUUID(),
      tags:        parsed.data.tags  ?? [],
      scopes:      parsed.data.scopes ?? [],
      allowedIps,
      ...(expiresAt ? { expiresAt } : {}),
      status:      "active",
    })
    .returning();

  void logActivity("api_client.created", "api_client", client.id, client.name, null, req);
  res.status(201).json(client);
});

// ── Update ─────────────────────────────────────────────────────────────────────
router.put("/api-clients/:id", async (req, res): Promise<void> => {
  const params = UpdateApiClientParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateApiClientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const body = req.body as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};

  if (parsed.data.name    !== undefined) updateData.name    = parsed.data.name;
  if (parsed.data.tags    !== undefined) updateData.tags    = parsed.data.tags;
  if (parsed.data.scopes  !== undefined) updateData.scopes  = parsed.data.scopes;
  if (parsed.data.status  !== undefined) updateData.status  = parsed.data.status;

  // Extra fields not yet in generated Zod
  if (typeof body.description === "string") updateData.description = body.description;
  if (Array.isArray(body.allowedIps))       updateData.allowedIps  = body.allowedIps;
  if (body.expiresAt !== undefined) {
    updateData.expiresAt = body.expiresAt ? new Date(body.expiresAt as string) : null;
  }

  const [client] = await db
    .update(apiClientsTable)
    .set(updateData)
    .where(eq(apiClientsTable.id, params.data.id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  res.json(client);
});

// ── Rotate secret ──────────────────────────────────────────────────────────────
router.post("/api-clients/:id/rotate-secret", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const newSecret = randomUUID();

  const [client] = await db
    .update(apiClientsTable)
    .set({ clientSecret: newSecret, secretRotatedAt: new Date() })
    .where(eq(apiClientsTable.id, id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }

  void logActivity("api_client.secret_rotated", "api_client", client.id, client.name, null, req);
  // Return the new secret plaintext ONCE — caller must store it
  res.json({ ...client, clientSecret: newSecret });
});

// ── Revoke ─────────────────────────────────────────────────────────────────────
router.post("/api-clients/:id/revoke", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [client] = await db
    .update(apiClientsTable)
    .set({ status: "revoked" })
    .where(eq(apiClientsTable.id, id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  void logActivity("api_client.revoked", "api_client", client.id, client.name, null, req);
  res.json(client);
});

// ── Restore (un-revoke) ────────────────────────────────────────────────────────
router.post("/api-clients/:id/restore", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [client] = await db
    .update(apiClientsTable)
    .set({ status: "active" })
    .where(eq(apiClientsTable.id, id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  void logActivity("api_client.restored", "api_client", client.id, client.name, null, req);
  res.json(client);
});

// ── Delete ─────────────────────────────────────────────────────────────────────
router.delete("/api-clients/:id", async (req, res): Promise<void> => {
  const params = DeleteApiClientParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [client] = await db
    .delete(apiClientsTable)
    .where(eq(apiClientsTable.id, params.data.id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  void logActivity("api_client.deleted", "api_client", client.id, client.name, null, req);
  res.sendStatus(204);
});

export default router;
