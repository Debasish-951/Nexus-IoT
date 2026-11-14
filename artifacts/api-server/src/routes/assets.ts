import { Router, type IRouter } from "express";
import { respondInvalid } from "../lib/respond";
import { eq, isNull, sql, and, or, inArray } from "drizzle-orm";
import {
  db, assetsTable, attributesTable, assetTemplatesTable, telemetryTable, telemetryRollupsTable, alarmsTable,
  alarmHistoryTable, alarmRulesTable,
} from "@workspace/db";
import { forgetRuleDelays, invalidateAlarmRuleCache, forgetAssetDelays } from "./ingest";
import { logActivity } from "./activity_log";
import { hasSeenDevice, removeSeenDevice } from "../lib/seen-devices";
import { deviceClaimedOutsideScope, DEVICE_IN_USE } from "../lib/project-access";
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

// Next sortOrder value for a batch of attribute inserts on one asset — callers
// increment their own local counter from this base across the loop so every
// row in the batch lands after whatever the asset already has, in list order.
async function nextSortOrderFor(assetId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${attributesTable.sortOrder}), 0)` })
    .from(attributesTable)
    .where(eq(attributesTable.assetId, assetId));
  return (row?.max ?? 0) + 1;
}

router.get("/assets", async (req, res): Promise<void> => {
  const query = ListAssetsQueryParams.safeParse(req.query);
  if (!query.success) { respondInvalid(req, res, query.error); return; }

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
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }

  // Device ID is optional per asset. Any asset MAY own a device id (machines,
  // gateways, etc.); grouping assets leave it blank. If provided it must map to a
  // known device (transmitting OR declared via a template payload).
  const devId = (parsed.data.identifier ?? "").trim();
  if (devId && !hasSeenDevice(devId)) {
    res.status(400).json({
      error: `"${devId}" is not a known device id. ` +
        `Register it first by pasting its device payload into a template, or by sending telemetry for it.`,
    });
    return;
  }
  if (devId && await deviceClaimedOutsideScope(req, devId)) { res.status(403).json(DEVICE_IN_USE); return; }

  let asset;
  try {
    [asset] = await db
      .insert(assetsTable)
      .values({
        name:        parsed.data.name,
        identifier:  devId || null,
        parentId:    parsed.data.parentId ?? null,
        templateId:  parsed.data.templateId ?? null,
        description: parsed.data.description ?? null,
        tags:        parsed.data.tags ?? [],
      })
      .returning();
  } catch (err) {
    // Several assets MAY share a device id (section templates off one payload), so a
    // duplicate is no longer an error here — anything that lands in this catch is a
    // genuine failure.
    //
    // Rethrown rather than answered here. This previously returned the driver's
    // own message, which for a constraint violation reads
    // `duplicate key value violates unique constraint "assets_identifier_unique"`
    // — the table, the column, and the existence of the index, handed to the
    // caller. The shared handler maps Postgres codes to domain wording and puts
    // the specifics in the log instead.
    throw err;
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
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, params.data.id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(asset);
});

router.put("/assets/:id", async (req, res): Promise<void> => {
  const params = UpdateAssetParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const parsed = UpdateAssetBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name        !== undefined) updateData.name        = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.tags        !== undefined) updateData.tags        = parsed.data.tags;

  // identifier (device id) — not in the generated body schema; read raw. Setting
  // it must reference a known device; empty string clears it (grouping asset).
  const rawIdentifier = (req.body as any)?.identifier;
  if (typeof rawIdentifier === "string") {
    const devId = rawIdentifier.trim();
    // The edit dialog always sends the identifier. When it has not changed it
    // is not re-checked: a device that has gone quiet (or been pruned from the
    // seen list) would otherwise block renaming or retagging its own asset.
    const [current] = devId
      ? await db.select({ identifier: assetsTable.identifier }).from(assetsTable).where(eq(assetsTable.id, params.data.id))
      : [];
    const unchanged = !!devId && current?.identifier === devId;
    if (!unchanged) {
      if (devId && !hasSeenDevice(devId)) {
        res.status(400).json({ error: `"${devId}" is not a known device id.` });
        return;
      }
      if (devId && await deviceClaimedOutsideScope(req, devId)) { res.status(403).json(DEVICE_IN_USE); return; }
      updateData.identifier = devId || null;
    }
  }

  let asset;
  // Nothing to write (e.g. only an unchanged identifier was sent): drizzle
  // refuses an empty SET, so answer with the row as it stands.
  if (Object.keys(updateData).length === 0) {
    [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, params.data.id));
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
    res.json(asset);
    return;
  }
  try {
    [asset] = await db.update(assetsTable).set(updateData).where(eq(assetsTable.id, params.data.id)).returning();
  } catch (err) {
    throw err;   // same reasoning as create: never hand the driver's text to a client
  }

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
  const note   = typeof body.note === "string" ? body.note.slice(0, 500) : null;

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
  // A running On/Off delay was measured before maintenance. Kept, it could raise
  // an alarm on the first reading after maintenance without waiting the delay.
  forgetAssetDelays(id);
  res.json(asset);
});

router.delete("/assets/:id", async (req, res): Promise<void> => {
  const params = DeleteAssetParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const rootId = params.data.id;

  // Fetch the root asset first (need name + parentId before we delete)
  const [rootAsset] = await db.select().from(assetsTable).where(eq(assetsTable.id, rootId));
  if (!rootAsset) { res.status(404).json({ error: "Asset not found" }); return; }

  // One transaction: a failure part-way used to leave the subtree half deleted,
  // with assets gone but their attributes, alarms or rules still in place.
  const { allIds, identifiers, ruleIds } = await db.transaction(async (tx) => {
    // Collect full subtree via recursive CTE (root + all descendants). UNION, not
    // UNION ALL, so a parent cycle in bad data cannot recurse for ever.
    const subtree = await tx.execute<{ id: string; identifier: string | null }>(sql`
      WITH RECURSIVE tree AS (
        SELECT id, identifier FROM assets WHERE id = ${rootId}
        UNION
        SELECT a.id, a.identifier FROM assets a INNER JOIN tree t ON a.parent_id = t.id
      )
      SELECT id, identifier FROM tree
    `);
    const allIds = subtree.rows.map((r) => r.id);
    const identifiers = subtree.rows.map((r) => r.identifier).filter((x): x is string => !!x);
    const now = new Date();

    // Remove dependent rows first — telemetry/attributes/alarms have no FK cascade,
    // so without this they'd be orphaned and keep showing up (e.g. in the Live Feed).
    await tx.delete(telemetryTable).where(inArray(telemetryTable.assetId, allIds));
    await tx.delete(telemetryRollupsTable).where(inArray(telemetryRollupsTable.assetId, allIds));
    await tx.delete(attributesTable).where(inArray(attributesTable.assetId, allIds));

    // History rows are records and are kept, but any still open are closed:
    // their alarm is deleted below, so nothing could ever clear or acknowledge them.
    await tx.update(alarmHistoryTable)
      .set({ status: "cleared", clearedAt: now })
      .where(and(
        inArray(alarmHistoryTable.assetId, allIds),
        inArray(alarmHistoryTable.status, ["active", "acknowledged"]),
      ));
    await tx.delete(alarmsTable).where(inArray(alarmsTable.assetId, allIds));

    // Rules bound to a deleted asset can never fire again; they are deleted
    // rather than left as ghost rules. Rules with no asset (all assets) stay.
    const rules = await tx.delete(alarmRulesTable)
      .where(inArray(alarmRulesTable.assetId, allIds))
      .returning({ id: alarmRulesTable.id });

    // Delete the whole subtree in one statement
    await tx.delete(assetsTable).where(inArray(assetsTable.id, allIds));

    // Decrement parent's childCount
    if (rootAsset.parentId) {
      await tx
        .update(assetsTable)
        .set({ childCount: sql`GREATEST(${assetsTable.childCount} - 1, 0)` })
        .where(eq(assetsTable.id, rootAsset.parentId));
    }
    return { allIds, identifiers, ruleIds: rules.map((r) => r.id) };
  });

  // In-memory rule state, only once the transaction has committed.
  for (const id of ruleIds) forgetRuleDelays(id);
  invalidateAlarmRuleCache();

  // Drop the devices from the seen-devices registry so they leave "Connected
  // Devices" until/unless they transmit again.
  await Promise.all(identifiers.map((id) => removeSeenDevice(id).catch(() => {})));

  // Note: viz_nodes.project_id references assets with ON DELETE SET NULL, so a
  // deleted project's top-level dashboards become unassigned (shown in every
  // project). That is the frontend's warning to give; it is unchanged here.
  void logActivity("asset.deleted", "asset", rootId, rootAsset.name,
    `Deleted ${allIds.length} asset(s) in subtree${ruleIds.length ? `, ${ruleIds.length} alarm rule(s)` : ""}`, req);
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

  const validTypes      = ["static", "dynamic", "metric", "timestamp"];
  const validDataTypes  = ["text", "number", "double", "boolean", "timestamp"];

  // New rows append after whatever this asset already has, in the order the
  // import listed them — not alphabetically once displayed.
  let nextSortOrder = await nextSortOrderFor(id);

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
        decimalPlaces: Number.isInteger(item.decimalPlaces) ? item.decimalPlaces : null,
        sortOrder: nextSortOrder++,
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

  // A `deviceid` definition is the binding, not an attribute — it never becomes a row
  // on the asset. Older templates carry the id in the column instead; both are honoured.
  const allDefs: any[] = (template as any).attributeDefinitions ?? [];
  const defs = allDefs.filter((d) => d?.type !== "deviceid");
  const declaredDeviceId: string | null =
    (template as any).deviceId
    ?? allDefs.find((d) => d?.type === "deviceid")?.value
    ?? allDefs.find((d) => d?.type === "deviceid")?.tagName
    ?? null;

  if (defs.length === 0 && !declaredDeviceId) {
    res.json({ created: 0, skipped: 0, skippedItems: [], message: "Template has no attribute definitions" });
    return;
  }

  /**
   * Applying a template binds the asset to the template's device stream, so the user
   * never has to type a Device ID on the asset itself.
   *
   * Sharing an id across assets is legitimate and expected: one gateway payload is
   * split into section templates (chiller, lighting, grid), every one of them carries
   * the same device id, and each section asset takes the metrics it declares. Ingest
   * partitions the payload by declared tag, so this is a supported topology, not a
   * collision. An asset that already has an id keeps it — a re-apply never silently
   * re-points an asset at a different device.
   */
  let deviceIdBound: string | null = null;
  const sharedWith: string[] = [];
  if (declaredDeviceId && asset.identifier !== declaredDeviceId && await deviceClaimedOutsideScope(req, declaredDeviceId)) {
    res.status(403).json(DEVICE_IN_USE);
    return;
  }
  if (declaredDeviceId && asset.identifier !== declaredDeviceId) {
    // Mirrors the template, including re-pointing an asset whose template's device id
    // was corrected — the template is the single source of truth for the binding. A
    // template with NO device id never clears an existing one, so adding a second,
    // device-less template to an asset cannot silently unbind it.
    const claimants = await db
      .select({ id: assetsTable.id, name: assetsTable.name })
      .from(assetsTable)
      .where(eq(assetsTable.identifier, declaredDeviceId));
    await db.update(assetsTable).set({ identifier: declaredDeviceId }).where(eq(assetsTable.id, id));
    asset.identifier = declaredDeviceId;
    deviceIdBound = declaredDeviceId;
    for (const c of claimants) if (c.id !== id) sharedWith.push(c.name);
  }

  // Fetch existing attributes for duplicate detection
  const existing = await db
    .select({ name: attributesTable.name, tagName: attributesTable.tagName })
    .from(attributesTable)
    .where(eq(attributesTable.assetId, id));

  const existingNames    = new Set(existing.map((e) => e.name.toLowerCase()));
  const existingTagNames = new Set(existing.filter((e) => e.tagName).map((e) => e.tagName!.toLowerCase()));

  // Tags are stored bare: ingest matches either the bare metric key or
  // "<deviceId>.<metric>", and a bare tag keeps a template portable between assets.
  const prefix = "";

  // Attributes land on the asset in the template's own (sectioned) order —
  // not alphabetically — so the asset view reads the same way the template does.
  let nextSortOrder = await nextSortOrderFor(id);

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
        decimalPlaces: Number.isInteger(def.decimalPlaces) ? def.decimalPlaces : null,
        sortOrder:  nextSortOrder++,
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

  res.json({
    created, skipped, skippedItems, templateName: template.name,
    // So the UI can say "bound to energy", and mention any section assets sharing it.
    deviceIdBound,
    sharedWith,
    deviceId: asset.identifier ?? null,
  });
});

export default router;
