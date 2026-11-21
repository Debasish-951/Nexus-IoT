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
import { logActivity } from "./activity_log";
import { diffFields } from "../lib/audit-core";
import { AttributeDefinitionsSchema } from "../schemas/common";

const router: IRouter = Router();

/**
 * Read `attribute_definitions` whatever shape the row was saved in.
 *
 * The PUT route used to `JSON.stringify` the list before handing it to a jsonb
 * column, so older rows hold a JSON *string* scalar instead of an array. New
 * writes store the array itself. Old rows are decoded here so responses always
 * carry an array; they become real arrays the next time the template is saved.
 */
export function readAttributeDefinitions(raw: unknown): unknown[] {
  let value = raw;
  // Two rounds at most: one for the double encoding, one for a driver that
  // hands jsonb back as text.
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value : [];
}

function toClient<T extends { attributeDefinitions: unknown }>(template: T): T {
  return { ...template, attributeDefinitions: readAttributeDefinitions(template.attributeDefinitions) } as T;
}

router.get("/asset-templates", async (req, res): Promise<void> => {
  const templates = await db
    .select()
    .from(assetTemplatesTable)
    .orderBy(assetTemplatesTable.name);
  res.json(templates.map(toClient));
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

  // Templates were the one write path in Asset Management with no audit entry.
  void logActivity("template.created", "template", template.id, template.name, null, req);
  res.status(201).json(toClient(template));
});

router.get("/asset-templates/:id", async (req, res): Promise<void> => {
  const params = GetAssetTemplateParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const [template] = await db
    .select()
    .from(assetTemplatesTable)
    .where(eq(assetTemplatesTable.id, params.data.id));

  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(toClient(template));
});

router.put("/asset-templates/:id", async (req, res): Promise<void> => {
  const params = UpdateAssetTemplateParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const parsed = UpdateAssetTemplateBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }

  // attributeDefinitions is not in the generated body schema, so it is checked
  // against the hand-written one here. It was stored unchecked before, including
  // the runtime expressions that ingest later evaluates.
  const rawDefinitions = (req.body as any)?.attributeDefinitions;
  let attributeDefinitions: unknown[] | undefined;
  if (rawDefinitions !== undefined) {
    const defs = AttributeDefinitionsSchema.safeParse(rawDefinitions);
    if (!defs.success) { respondInvalid(req, res, defs.error); return; }
    attributeDefinitions = defs.data;
  }
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
    // The array itself, not JSON.stringify of it: a stringified value lands in
    // jsonb as one string scalar, which SQL and reports cannot look inside.
    updatePayload.attributeDefinitions = attributeDefinitions;
    updatePayload.attributeCount = attributeDefinitions.length;
  }

  if (Object.keys(updatePayload).length === 0) {
    const [tmpl] = await db.select().from(assetTemplatesTable).where(eq(assetTemplatesTable.id, params.data.id));
    if (!tmpl) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(toClient(tmpl));
    return;
  }

  const [beforeTemplate] = await db.select().from(assetTemplatesTable).where(eq(assetTemplatesTable.id, params.data.id));
  const [template] = await db
    .update(assetTemplatesTable)
    .set(updatePayload as any)
    .where(eq(assetTemplatesTable.id, params.data.id))
    .returning();

  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  void logActivity("template.updated", "template", template.id, template.name,
    `fields=${Object.keys(updatePayload).join(",")}`, req,
    { changes: diffFields(beforeTemplate as unknown as Record<string, unknown>, template as unknown as Record<string, unknown>, { only: Object.keys(updatePayload) }) });
  res.json(toClient(template));
});

router.delete("/asset-templates/:id", async (req, res): Promise<void> => {
  const params = DeleteAssetTemplateParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const [template] = await db
    .delete(assetTemplatesTable)
    .where(eq(assetTemplatesTable.id, params.data.id))
    .returning();

  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  void logActivity("template.deleted", "template", template.id, template.name, null, req);
  res.sendStatus(204);
});

export default router;
