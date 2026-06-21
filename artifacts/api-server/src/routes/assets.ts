import { Router, type IRouter } from "express";
import { eq, isNull, sql, and, or, inArray } from "drizzle-orm";
import { db, assetsTable, attributesTable, assetTemplatesTable } from "@workspace/db";
import { logActivity } from "./activity_log";
import {
  CreateAssetBody,
  UpdateAssetBody,
  GetAssetParams,
  UpdateAssetParams,
  DeleteAssetParams,
  ListAssetsQueryParams,
} from "@workspace/api-zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router();

router.get("/assets", async (req, res): Promise<void> => {
  const query = ListAssetsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

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
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  let asset;
  try {
    [asset] = await db
      .insert(assetsTable)
      .values({
        name:        parsed.data.name,
        identifier:  parsed.data.identifier,
        parentId:    parsed.data.parentId ?? null,
        templateId:  parsed.data.templateId ?? null,
        description: parsed.data.description ?? null,
        tags:        parsed.data.tags ?? [],
      })
      .returning();
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to create asset" });
    return;
  }

  if (asset.parentId) {
    await db
      .update(assetsTable)
      .set({ childCount: sql`${assetsTable.childCount} + 1` })
      .where(eq(assetsTable.id, asset.parentId));
  }

  void logActivity("asset.created", "asset", asset.id, asset.name, asset.parentId ? `parentId=${asset.parentId}` : null, req);
  res.status(201).json(asset);
});

router.get("/assets/:id", async (req, res): Promise<void> => {
  const params = GetAssetParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

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
      ...(parsed.data.name        !== undefined ? { name:        parsed.data.name }        : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.tags        !== undefined ? { tags:        parsed.data.tags }        : {}),
    })
    .where(eq(assetsTable.id, params.data.id))
    .returning();

  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(asset);
});

// ── Maintenance mode toggle ───────────────────────────────────────────────────
router.post("/assets/:id/maintenance", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [current] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!current) { res.status(404).json({ error: "Asset not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const enable = typeof body.enable === "boolean" ? body.enable : !current.maintenanceMode;
  const note   = typeof body.note === "string" ? body.note : null;

  const [asset] = await db
    .update(assetsTable)
    .set({
      maintenanceMode: enable,
      maintenanceSince: enable ? new Date() : null,
      maintenanceNote:  enable ? note : null,
    })
    .where(eq(assetsTable.id, id))
    .returning();

  void logActivity(
    enable ? "asset.maintenance_enabled" : "asset.maintenance_disabled",
    "asset", id, current.name, null, req
  );
  res.json(asset);
});

router.delete("/assets/:id", async (req, res): Promise<void> => {
  const params = DeleteAssetParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const rootId = params.data.id;

  // Fetch the root asset first (need name + parentId before we delete)
  const [rootAsset] = await db.select().from(assetsTable).where(eq(assetsTable.id, rootId));
  if (!rootAsset) { res.status(404).json({ error: "Asset not found" }); return; }

  // Collect full subtree via recursive CTE (root + all descendants)
  const subtree = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM assets WHERE id = ${rootId}
      UNION ALL
      SELECT a.id FROM assets a INNER JOIN tree t ON a.parent_id = t.id
    )
    SELECT id FROM tree
  `);
  const allIds = subtree.rows.map((r) => r.id);

  // Delete the whole subtree in one statement (no FK issues since entire subtree goes)
  await db.delete(assetsTable).where(inArray(assetsTable.id, allIds));

  // Decrement parent's childCount
  if (rootAsset.parentId) {
    await db
      .update(assetsTable)
      .set({ childCount: sql`GREATEST(${assetsTable.childCount} - 1, 0)` })
      .where(eq(assetsTable.id, rootAsset.parentId));
  }

  void logActivity("asset.deleted", "asset", rootId, rootAsset.name, `Deleted ${allIds.length} asset(s) in subtree`, req);
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

  // Fetch existing attribute names and tagNames for duplicate detection
  const existing = await db
    .select({ name: attributesTable.name, tagName: attributesTable.tagName })
    .from(attributesTable)
    .where(eq(attributesTable.assetId, id));

  const existingNames   = new Set(existing.map((e) => e.name.toLowerCase()));
  const existingTagNames = new Set(existing.filter((e) => e.tagName).map((e) => e.tagName!.toLowerCase()));

  const validTypes      = ["static", "dynamic", "metric"];
  const validDataTypes  = ["text", "number", "double", "boolean", "timestamp"];

  let created = 0;
  let skipped = 0;
  const skippedItems: string[] = [];

  for (const item of items) {
    if (!item.name || typeof item.name !== "string") { skipped++; skippedItems.push("(unnamed)"); continue; }

    const nameKey   = item.name.trim().toLowerCase();
    const tagKey    = item.tagName ? item.tagName.trim().toLowerCase() : null;

    // Duplicate check — skip if name already exists on this asset
    if (existingNames.has(nameKey)) {
      skipped++;
      skippedItems.push(item.name.trim());
      continue;
    }
    if (tagKey && existingTagNames.has(tagKey)) {
      skipped++;
      skippedItems.push(item.name.trim());
      continue;
    }

    const type     = validTypes.includes(item.type)        ? item.type     : "static";
    const dataType = validDataTypes.includes(item.dataType) ? item.dataType : "text";

    try {
      await db.insert(attributesTable).values({
        assetId:  id,
        name:     item.name.trim(),
        type,
        dataType,
        value:    item.value  != null ? item.value  : null,
        tagName:  item.tagName ? item.tagName.trim() : null,
        uom:      item.uom     ? item.uom.trim()     : null,
      });
      // Update local sets to catch duplicates within the same batch
      existingNames.add(nameKey);
      if (tagKey) existingTagNames.add(tagKey);
      created++;
    } catch (err: any) {
      skipped++;
      skippedItems.push(item.name.trim());
    }
  }

  await db
    .update(assetsTable)
    .set({ attributeCount: sql`${assetsTable.attributeCount} + ${created}` })
    .where(eq(assetsTable.id, id));

  res.json({ created, skipped, skippedItems });
});

// ── Apply template → bulk-create attributes from template definitions ─────────
router.post("/assets/:id/apply-template", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

  const templateId: string | null = (req.body?.templateId as string | null) ?? asset.templateId ?? null;
  if (!templateId) {
    res.status(400).json({ error: "No template selected and no template assigned to asset" });
    return;
  }

  const [template] = await db
    .select()
    .from(assetTemplatesTable)
    .where(eq(assetTemplatesTable.id, templateId));

  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const defs: any[] = (template as any).attributeDefinitions ?? [];
  if (defs.length === 0) {
    res.json({ created: 0, skipped: 0, skippedItems: [], message: "Template has no attribute definitions" });
    return;
  }

  // Fetch existing attributes for duplicate detection
  const existing = await db
    .select({ name: attributesTable.name, tagName: attributesTable.tagName })
    .from(attributesTable)
    .where(eq(attributesTable.assetId, id));

  const existingNames    = new Set(existing.map((e) => e.name.toLowerCase()));
  const existingTagNames = new Set(existing.filter((e) => e.tagName).map((e) => e.tagName!.toLowerCase()));

  const prefix = asset.identifier ? `${asset.identifier}.` : "";

  let created = 0;
  let skipped = 0;
  const skippedItems: string[] = [];

  for (const def of defs) {
    if (!def.name) { skipped++; continue; }

    const resolvedTagName = def.tagName ? `${prefix}${def.tagName}` : null;
    const nameKey  = def.name.toLowerCase();
    const tagKey   = resolvedTagName ? resolvedTagName.toLowerCase() : null;

    // Duplicate check
    if (existingNames.has(nameKey)) {
      skipped++;
      skippedItems.push(def.name);
      continue;
    }
    if (tagKey && existingTagNames.has(tagKey)) {
      skipped++;
      skippedItems.push(def.name);
      continue;
    }

    try {
      await db.insert(attributesTable).values({
        assetId:    id,
        name:       def.name,
        type:       def.type       ?? "static",
        dataType:   def.dataType   ?? "text",
        value:      def.value      ?? null,
        tagName:    resolvedTagName,
        uom:        def.uom        ?? null,
        expression: def.expression ?? null,
      });
      existingNames.add(nameKey);
      if (tagKey) existingTagNames.add(tagKey);
      created++;
    } catch {
      skipped++;
      skippedItems.push(def.name);
    }
  }

  await db
    .update(assetsTable)
    .set({
      attributeCount: sql`${assetsTable.attributeCount} + ${created}`,
      templateId,
      templateName: template.name,
    })
    .where(eq(assetsTable.id, id));

  res.json({ created, skipped, skippedItems, templateName: template.name });
});

export default router;
