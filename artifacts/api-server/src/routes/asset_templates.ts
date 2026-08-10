import { Router, type IRouter } from "express";
import { respondInvalid } from "../lib/respond";
import { eq, sql } from "drizzle-orm";
import { db, assetTemplatesTable } from "@workspace/db";
import {
  CreateAssetTemplateBody,
  UpdateAssetTemplateBody,
  GetAssetTemplateParams,
  UpdateAssetTemplateParams,
  DeleteAssetTemplateParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/asset-templates", async (req, res): Promise<void> => {
  const templates = await db
    .select()
    .from(assetTemplatesTable)
    .orderBy(assetTemplatesTable.name);
  res.json(templates);
});

router.post("/asset-templates", async (req, res): Promise<void> => {
  const parsed = CreateAssetTemplateBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }

  // deviceId is not in the generated body schema — read it raw (same pattern as attributeDefinitions in PUT).
  const rawDeviceId = (req.body as any)?.deviceId;
  const deviceId = typeof rawDeviceId === "string" && rawDeviceId.trim() ? rawDeviceId.trim() : null;

  const [template] = await db
    .insert(assetTemplatesTable)
    .values({ name: parsed.data.name, deviceId, tags: parsed.data.tags ?? [] })
    .returning();

  res.status(201).json(template);
});

router.get("/asset-templates/:id", async (req, res): Promise<void> => {
  const params = GetAssetTemplateParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const [template] = await db
    .select()
    .from(assetTemplatesTable)
    .where(eq(assetTemplatesTable.id, params.data.id));

  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(template);
});

router.put("/asset-templates/:id", async (req, res): Promise<void> => {
  const params = UpdateAssetTemplateParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const parsed = UpdateAssetTemplateBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }

  // attributeDefinitions comes through as raw JSON (not in Zod schema — accept directly from body)
  const attributeDefinitions = (req.body as any)?.attributeDefinitions;
  const rawDeviceId = (req.body as any)?.deviceId;

  const updatePayload: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updatePayload.name = parsed.data.name;
  if (parsed.data.tags !== undefined) updatePayload.tags = parsed.data.tags;
  // The template owns the device id: applying it binds the asset to that payload
  // stream, so it has to be editable here (same raw-read pattern as the definitions).
  if (rawDeviceId !== undefined) {
    updatePayload.deviceId = typeof rawDeviceId === "string" && rawDeviceId.trim() ? rawDeviceId.trim() : null;
  }
  if (attributeDefinitions !== undefined) {
    updatePayload.attributeDefinitions = JSON.stringify(attributeDefinitions);
    updatePayload.attributeCount = Array.isArray(attributeDefinitions) ? attributeDefinitions.length : 0;
  }

  if (Object.keys(updatePayload).length === 0) {
    const [tmpl] = await db.select().from(assetTemplatesTable).where(eq(assetTemplatesTable.id, params.data.id));
    res.json(tmpl);
    return;
  }

  const [template] = await db
    .update(assetTemplatesTable)
    .set(updatePayload as any)
    .where(eq(assetTemplatesTable.id, params.data.id))
    .returning();

  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(template);
});

router.delete("/asset-templates/:id", async (req, res): Promise<void> => {
  const params = DeleteAssetTemplateParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const [template] = await db
    .delete(assetTemplatesTable)
    .where(eq(assetTemplatesTable.id, params.data.id))
    .returning();

  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.sendStatus(204);
});

export default router;
