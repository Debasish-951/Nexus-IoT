import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, attributesTable, assetsTable } from "@workspace/db";
import {
  CreateAssetAttributeBody,
  CreateAssetAttributeParams,
  UpdateAttributeBody,
  UpdateAttributeParams,
  DeleteAttributeParams,
  ListAssetAttributesParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/assets/:id/attributes", async (req, res): Promise<void> => {
  const params = ListAssetAttributesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const attrs = await db
    .select()
    .from(attributesTable)
    .where(eq(attributesTable.assetId, params.data.id))
    .orderBy(attributesTable.name);

  res.json(attrs);
});

router.post("/assets/:id/attributes", async (req, res): Promise<void> => {
  const params = CreateAssetAttributeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateAssetAttributeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [attr] = await db
    .insert(attributesTable)
    .values({
      assetId: params.data.id,
      name: parsed.data.name,
      type: parsed.data.type,
      dataType: parsed.data.dataType,
      value: parsed.data.value ?? null,
      tagName: parsed.data.tagName ?? null,
      uom: parsed.data.uom ?? null,
      expression: parsed.data.expression ?? null,
    })
    .returning();

  await db
    .update(assetsTable)
    .set({ attributeCount: sql`${assetsTable.attributeCount} + 1` })
    .where(eq(assetsTable.id, params.data.id));

  res.status(201).json(attr);
});

router.put("/attributes/:id", async (req, res): Promise<void> => {
  const params = UpdateAttributeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAttributeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [attr] = await db
    .update(attributesTable)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.value !== undefined ? { value: parsed.data.value } : {}),
      ...(parsed.data.uom !== undefined ? { uom: parsed.data.uom } : {}),
      ...(parsed.data.expression !== undefined ? { expression: parsed.data.expression } : {}),
    })
    .where(eq(attributesTable.id, params.data.id))
    .returning();

  if (!attr) {
    res.status(404).json({ error: "Attribute not found" });
    return;
  }

  res.json(attr);
});

router.delete("/attributes/:id", async (req, res): Promise<void> => {
  const params = DeleteAttributeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [attr] = await db
    .delete(attributesTable)
    .where(eq(attributesTable.id, params.data.id))
    .returning();

  if (!attr) {
    res.status(404).json({ error: "Attribute not found" });
    return;
  }

  await db
    .update(assetsTable)
    .set({ attributeCount: sql`GREATEST(${assetsTable.attributeCount} - 1, 0)` })
    .where(eq(assetsTable.id, attr.assetId));

  res.sendStatus(204);
});

export default router;
