import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, alarmRulesTable } from "@workspace/db";
import {
  CreateAlarmRuleBody,
  UpdateAlarmRuleBody,
  UpdateAlarmRuleParams,
  DeleteAlarmRuleParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/alarm-rules", async (req, res): Promise<void> => {
  const rules = await db
    .select()
    .from(alarmRulesTable)
    .orderBy(alarmRulesTable.name);

  res.json(rules);
});

router.post("/alarm-rules", async (req, res): Promise<void> => {
  const parsed = CreateAlarmRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [rule] = await db
    .insert(alarmRulesTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      assetId: parsed.data.assetId ?? null,
      alarmType: parsed.data.alarmType,
      severity: parsed.data.severity,
      metric: parsed.data.metric ?? null,
      operator: parsed.data.operator ?? null,
      threshold: parsed.data.threshold ?? null,
      deadband: parsed.data.deadband ?? null,
      onDelay: parsed.data.onDelay ?? null,
      offDelay: parsed.data.offDelay ?? null,
      scanRate: parsed.data.scanRate ?? 2,
      enabled: parsed.data.enabled,
      requireAcknowledge: parsed.data.requireAcknowledge,
    })
    .returning();

  res.status(201).json(rule);
});

router.put("/alarm-rules/:id", async (req, res): Promise<void> => {
  const params = UpdateAlarmRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAlarmRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.severity !== undefined) updateData.severity = parsed.data.severity;
  if (parsed.data.threshold !== undefined) updateData.threshold = parsed.data.threshold;
  if (parsed.data.deadband !== undefined) updateData.deadband = parsed.data.deadband;
  if (parsed.data.onDelay !== undefined) updateData.onDelay = parsed.data.onDelay;
  if (parsed.data.offDelay !== undefined) updateData.offDelay = parsed.data.offDelay;
  if (parsed.data.enabled !== undefined) updateData.enabled = parsed.data.enabled;
  if (parsed.data.requireAcknowledge !== undefined) updateData.requireAcknowledge = parsed.data.requireAcknowledge;

  const [rule] = await db
    .update(alarmRulesTable)
    .set(updateData)
    .where(eq(alarmRulesTable.id, params.data.id))
    .returning();

  if (!rule) {
    res.status(404).json({ error: "Alarm rule not found" });
    return;
  }

  res.json(rule);
});

router.delete("/alarm-rules/:id", async (req, res): Promise<void> => {
  const params = DeleteAlarmRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [rule] = await db
    .delete(alarmRulesTable)
    .where(eq(alarmRulesTable.id, params.data.id))
    .returning();

  if (!rule) {
    res.status(404).json({ error: "Alarm rule not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
