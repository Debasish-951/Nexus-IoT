import { Router, type IRouter } from "express";
import { respondInvalid } from "../lib/respond";
import { eq, sql } from "drizzle-orm";
import { db, attributesTable, assetsTable } from "@workspace/db";
import { logActivity } from "./activity_log";
import { diffFields } from "../lib/audit-core";
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
    respondInvalid(req, res, params.error);
    return;
  }

  // Order by sortOrder, not name — attributes applied from a template are
  // inserted in the template's own (sectioned) order, so this keeps that layout
  // instead of scrambling it alphabetically.
  const attrs = await db
    .select()
    .from(attributesTable)
    .where(eq(attributesTable.assetId, params.data.id))
    .orderBy(attributesTable.sortOrder, attributesTable.createdAt);

  res.json(attrs);
});

router.post("/assets/:id/attributes", async (req, res): Promise<void> => {
  const params = CreateAssetAttributeParams.safeParse(req.params);
  if (!params.success) {
    respondInvalid(req, res, params.error);
    return;
  }

  const parsed = CreateAssetAttributeBody.safeParse(req.body);
  if (!parsed.success) {
    respondInvalid(req, res, parsed.error);
    return;
  }

  const body = req.body as Record<string, unknown>;

  const [attr] = await db
    .insert(attributesTable)
    .values({
      assetId: params.data.id,
      name: parsed.data.name,
      type: parsed.data.type,
      dataType: parsed.data.dataType,
      value: parsed.data.value ?? null,
      tagName: parsed.data.tagName ?? null,
      sourceMetric: (body.sourceMetric as string | null) ?? null,
      uom: parsed.data.uom ?? null,
      decimalPlaces: typeof body.decimalPlaces === "number" ? body.decimalPlaces : null,
      thousandSeparator: typeof body.thousandSeparator === "boolean" ? body.thousandSeparator : false,
      expression: parsed.data.expression ?? null,
      // Append after whatever this asset already has.
      sortOrder: sql`(select coalesce(max(${attributesTable.sortOrder}), 0) + 1 from ${attributesTable} where ${attributesTable.assetId} = ${params.data.id})`,
    })
    .returning();

  await db
    .update(assetsTable)
    .set({ attributeCount: sql`${assetsTable.attributeCount} + 1` })
    .where(eq(assetsTable.id, params.data.id));

  await logActivity("attribute.created", "attributes", attr!.id, attr!.name, `${attr!.type} ${attr!.dataType}`, req,
    { assetId: params.data.id, changes: diffFields({}, attr as unknown as Record<string, unknown>, { ignore: ["id", "assetId", "sortOrder"] }) });
  res.status(201).json(attr);
});

router.put("/attributes/:id", async (req, res): Promise<void> => {
  const params = UpdateAttributeParams.safeParse(req.params);
  if (!params.success) {
    respondInvalid(req, res, params.error);
    return;
  }

  const parsed = UpdateAttributeBody.safeParse(req.body);
  if (!parsed.success) {
    respondInvalid(req, res, parsed.error);
    return;
  }

  const body = req.body as Record<string, unknown>;

  const [before] = await db.select().from(attributesTable).where(eq(attributesTable.id, params.data.id));
  const [attr] = await db
    .update(attributesTable)
    .set({
      ...(parsed.data.name              !== undefined ? { name:             parsed.data.name }             : {}),
      ...(parsed.data.value             !== undefined ? { value:            parsed.data.value }            : {}),
      ...(parsed.data.uom               !== undefined ? { uom:              parsed.data.uom }              : {}),
      ...(parsed.data.expression        !== undefined ? { expression:       parsed.data.expression }       : {}),
      ...(body.type                     !== undefined ? { type:             body.type             as string        } : {}),
      ...(body.dataType                 !== undefined ? { dataType:         body.dataType         as string        } : {}),
      ...(body.tagName                  !== undefined ? { tagName:          body.tagName          as string | null  } : {}),
      ...(body.sourceMetric             !== undefined ? { sourceMetric:     body.sourceMetric     as string | null  } : {}),
      ...(body.decimalPlaces            !== undefined ? { decimalPlaces:    body.decimalPlaces    as number | null  } : {}),
      ...(body.thousandSeparator        !== undefined ? { thousandSeparator: body.thousandSeparator as boolean      } : {}),
    })
    .where(eq(attributesTable.id, params.data.id))
    .returning();

  if (!attr) {
    res.status(404).json({ error: "Attribute not found" });
    return;
  }

  await logActivity("attribute.updated", "attributes", attr.id, attr.name, null, req,
    { assetId: attr.assetId, changes: diffFields(before as unknown as Record<string, unknown>, attr as unknown as Record<string, unknown>, { ignore: ["id", "assetId", "sortOrder"] }) });
  res.json(attr);
});

router.delete("/attributes/:id", async (req, res): Promise<void> => {
  const params = DeleteAttributeParams.safeParse(req.params);
  if (!params.success) {
    respondInvalid(req, res, params.error);
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

  await logActivity("attribute.deleted", "attributes", attr.id, attr.name, attr.value != null ? `value was ${String(attr.value).slice(0, 100)}` : null, req, { assetId: attr.assetId });
  res.sendStatus(204);
});

export default router;
