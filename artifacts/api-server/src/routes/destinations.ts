import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, destinationsTable } from "@workspace/db";
import { logActivity } from "./activity_log";

const router: IRouter = Router();

router.get("/destinations", async (req, res): Promise<void> => {
  const rows = await db.select().from(destinationsTable).orderBy(destinationsTable.name);
  res.json(rows);
});

router.post("/destinations", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  if (!body.name || !body.endpoint) {
    res.status(400).json({ error: "name and endpoint are required" }); return;
  }
  const [row] = await db.insert(destinationsTable).values({
    name: String(body.name),
    description: body.description ? String(body.description) : null,
    endpoint: String(body.endpoint),
    authType: (body.authType as string) ?? "bearer",
    token: body.token ? String(body.token) : null,
    secretKey: body.secretKey ? String(body.secretKey) : null,
    apiKeyHeader: body.apiKeyHeader ? String(body.apiKeyHeader) : "X-API-Key",
    basicUser: body.basicUser ? String(body.basicUser) : null,
    basicPass: body.basicPass ? String(body.basicPass) : null,
    eventTypes: Array.isArray(body.eventTypes) ? (body.eventTypes as string[]) : ["alarm"],
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
  }).returning();
  void logActivity("destination.created", "destination", row.id, row.name, null, req);
  res.status(201).json(row);
});

router.put("/destinations/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined)        updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description || null;
  if (body.endpoint !== undefined)    updateData.endpoint = body.endpoint;
  if (body.authType !== undefined)    updateData.authType = body.authType;
  if (body.token !== undefined)       updateData.token = body.token || null;
  if (body.secretKey !== undefined)   updateData.secretKey = body.secretKey || null;
  if (body.apiKeyHeader !== undefined) updateData.apiKeyHeader = body.apiKeyHeader;
  if (body.basicUser !== undefined)   updateData.basicUser = body.basicUser || null;
  if (body.basicPass !== undefined)   updateData.basicPass = body.basicPass || null;
  if (body.eventTypes !== undefined)  updateData.eventTypes = body.eventTypes;
  if (body.enabled !== undefined)     updateData.enabled = Boolean(body.enabled);
  const [row] = await db.update(destinationsTable).set(updateData).where(eq(destinationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/destinations/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [row] = await db.delete(destinationsTable).where(eq(destinationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  void logActivity("destination.deleted", "destination", row.id, row.name, null, req);
  res.sendStatus(204);
});

// Test-fire to a destination
router.post("/destinations/:id/test", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [dest] = await db.select().from(destinationsTable).where(eq(destinationsTable.id, id)).limit(1);
  if (!dest) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (dest.authType === "bearer" && dest.token)     headers["Authorization"] = `Bearer ${dest.token}`;
    if (dest.authType === "api_key" && dest.token)    headers[dest.apiKeyHeader ?? "X-API-Key"] = dest.token;
    if (dest.authType === "basic" && dest.basicUser)  headers["Authorization"] = `Basic ${Buffer.from(`${dest.basicUser}:${dest.basicPass ?? ""}`).toString("base64")}`;
    const resp = await fetch(dest.endpoint, {
      method: "POST", headers,
      body: JSON.stringify({ event: "test", source: "iot-platform", timestamp: new Date().toISOString(), destinationId: dest.id }),
      signal: AbortSignal.timeout(6000),
    });
    res.json({ success: resp.ok, statusCode: resp.status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Forward event to all matching destinations ─────────────────────────────
export async function forwardToDestinations(eventType: "alarm" | "telemetry", payload: Record<string, unknown>): Promise<void> {
  const destinations = await db.select().from(destinationsTable)
    .where(eq(destinationsTable.enabled, true));
  for (const dest of destinations) {
    if (!(dest.eventTypes ?? []).includes(eventType)) continue;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (dest.authType === "bearer" && dest.token)     headers["Authorization"] = `Bearer ${dest.token}`;
    if (dest.authType === "api_key" && dest.token)    headers[dest.apiKeyHeader ?? "X-API-Key"] = dest.token;
    if (dest.authType === "basic" && dest.basicUser)  headers["Authorization"] = `Basic ${Buffer.from(`${dest.basicUser}:${dest.basicPass ?? ""}`).toString("base64")}`;
    const destId = dest.id;
    fetch(dest.endpoint, {
      method: "POST", headers,
      body: JSON.stringify({ event: eventType, ...payload }),
      signal: AbortSignal.timeout(6000),
    }).then(async (r) => {
      await db.update(destinationsTable)
        .set({ lastSentAt: new Date(), lastError: r.ok ? null : `HTTP ${r.status}`, sendCount: sql`${destinationsTable.sendCount} + 1` })
        .where(eq(destinationsTable.id, destId));
    }).catch(async (err: any) => {
      await db.update(destinationsTable)
        .set({ lastError: err.message })
        .where(eq(destinationsTable.id, destId));
    });
  }
}

export default router;
