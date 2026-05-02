import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
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
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [template] = await db
    .insert(assetTemplatesTable)
    .values({
      name: parsed.data.name,
      tags: parsed.data.tags ?? [],
    })
    .returning();

  res.status(201).json(template);
});

router.get("/asset-templates/:id", async (req, res): Promise<void> => {
  const params = GetAssetTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [template] = await db
    .select()
    .from(assetTemplatesTable)
    .where(eq(assetTemplatesTable.id, params.data.id));

  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.json(template);
});

router.put("/asset-templates/:id", async (req, res): Promise<void> => {
  const params = UpdateAssetTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAssetTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [template] = await db
    .update(assetTemplatesTable)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {}),
    })
    .where(eq(assetTemplatesTable.id, params.data.id))
    .returning();

  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.json(template);
});

router.delete("/asset-templates/:id", async (req, res): Promise<void> => {
  const params = DeleteAssetTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [template] = await db
    .delete(assetTemplatesTable)
    .where(eq(assetTemplatesTable.id, params.data.id))
    .returning();

  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
