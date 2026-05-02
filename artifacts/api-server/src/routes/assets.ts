import { Router, type IRouter } from "express";
import { eq, isNull, sql, like } from "drizzle-orm";
import { db, assetsTable, attributesTable, assetTemplatesTable } from "@workspace/db";
import {
  CreateAssetBody,
  UpdateAssetBody,
  GetAssetParams,
  UpdateAssetParams,
  DeleteAssetParams,
  ListAssetsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/assets", async (req, res): Promise<void> => {
  const query = ListAssetsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let conditions: ReturnType<typeof eq>[] = [];
  if (query.data.parentId !== undefined) {
    conditions.push(eq(assetsTable.parentId, query.data.parentId as string));
  }

  const assets = await db
    .select()
    .from(assetsTable)
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(assetsTable.name);

  res.json(assets);
});

router.post("/assets", async (req, res): Promise<void> => {
  const parsed = CreateAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [asset] = await db
    .insert(assetsTable)
    .values({
      name: parsed.data.name,
      identifier: parsed.data.identifier,
      parentId: parsed.data.parentId ?? null,
      templateId: parsed.data.templateId ?? null,
      description: parsed.data.description ?? null,
      tags: parsed.data.tags ?? [],
    })
    .returning();

  if (asset.parentId) {
    await db
      .update(assetsTable)
      .set({ childCount: sql`${assetsTable.childCount} + 1` })
      .where(eq(assetsTable.id, asset.parentId));
  }

  res.status(201).json(asset);
});

router.get("/assets/:id", async (req, res): Promise<void> => {
  const params = GetAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, params.data.id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(asset);
});

router.put("/assets/:id", async (req, res): Promise<void> => {
  const params = UpdateAssetParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateAssetBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [asset] = await db
    .update(assetsTable)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {}),
    })
    .where(eq(assetsTable.id, params.data.id))
    .returning();

  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(asset);
});

router.delete("/assets/:id", async (req, res): Promise<void> => {
  const params = DeleteAssetParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [asset] = await db.delete(assetsTable).where(eq(assetsTable.id, params.data.id)).returning();
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

  if (asset.parentId) {
    await db
      .update(assetsTable)
      .set({ childCount: sql`GREATEST(${assetsTable.childCount} - 1, 0)` })
      .where(eq(assetsTable.id, asset.parentId));
  }

  res.sendStatus(204);
});

// ── Bulk attribute import ─────────────────────────────────────────────────────
router.post("/assets/:id/attributes/bulk", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

  const items: any[] = req.body?.attributes ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "attributes must be a non-empty array" });
    return;
  }

  const validTypes    = ["static", "dynamic", "metric"];
  const validDataTypes = ["text", "number", "double", "boolean", "timestamp"];

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    if (!item.name || typeof item.name !== "string") { skipped++; errors.push(`Skipped: missing name`); continue; }
    const type     = validTypes.includes(item.type)     ? item.type     : "static";
    const dataType = validDataTypes.includes(item.dataType) ? item.dataType : "text";

    try {
      await db.insert(attributesTable).values({
        assetId:  id,
        name:     item.name.trim(),
        type,
        dataType,
        value:    item.value != null ? item.value : null,
        tagName:  item.tagName  ? item.tagName.trim()  : null,
        uom:      item.uom      ? item.uom.trim()      : null,
      });
      created++;
    } catch (err: any) {
      skipped++;
      errors.push(`Skipped "${item.name}": ${err?.message ?? "db error"}`);
    }
  }

  // update attributeCount
  await db
    .update(assetsTable)
    .set({ attributeCount: sql`${assetsTable.attributeCount} + ${created}` })
    .where(eq(assetsTable.id, id));

  res.json({ created, skipped, errors });
});

// ── Apply template → bulk-create attributes from template definitions ─────────
router.post("/assets/:id/apply-template", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

  const templateId: string | null = (req.body?.templateId as string | null) ?? asset.templateId ?? null;
  if (!templateId) {
    res.status(400).json({ error: "Asset has no template assigned and no templateId provided" });
    return;
  }

  const [template] = await db
    .select()
    .from(assetTemplatesTable)
    .where(eq(assetTemplatesTable.id, templateId));

  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const defs: any[] = (template as any).attributeDefinitions ?? [];
  if (defs.length === 0) {
    res.json({ created: 0, skipped: 0, message: "Template has no attribute definitions" });
    return;
  }

  // Build attributes — prepend asset identifier to tagName so "temperature" → "sensorgrow.temperature"
  const prefix = asset.identifier ? `${asset.identifier}.` : "";

  let created = 0;
  let skipped = 0;

  for (const def of defs) {
    if (!def.name) { skipped++; continue; }
    try {
      const resolvedTagName = def.tagName
        ? `${prefix}${def.tagName}`
        : null;

      await db.insert(attributesTable).values({
        assetId:  id,
        name:     def.name,
        type:     def.type     ?? "static",
        dataType: def.dataType ?? "text",
        value:    def.value    ?? null,
        tagName:  resolvedTagName,
        uom:      def.uom      ?? null,
      });
      created++;
    } catch {
      skipped++;
    }
  }

  // update attributeCount + templateName on asset
  await db
    .update(assetsTable)
    .set({
      attributeCount: sql`${assetsTable.attributeCount} + ${created}`,
      templateId,
      templateName: template.name,
    })
    .where(eq(assetsTable.id, id));

  res.json({ created, skipped, templateName: template.name });
});

export default router;
