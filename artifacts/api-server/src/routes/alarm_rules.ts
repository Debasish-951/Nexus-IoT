import { Router, type IRouter } from "express";
import { respondInvalid } from "../lib/respond";
import { eq } from "drizzle-orm";
import { db, alarmRulesTable } from "@workspace/db";
import {
  CreateAlarmRuleBody, UpdateAlarmRuleBody,
  UpdateAlarmRuleParams, DeleteAlarmRuleParams,
} from "@workspace/api-zod";
import { checkOutboundUrl, assertSafeOutboundUrl, UnsafeUrlError } from "../lib/outbound-url";
import { logger } from "../lib/logger";
import { correlationIdOf } from "../lib/errors";

const router: IRouter = Router();

router.get("/alarm-rules", async (req, res): Promise<void> => {
  const rules = await db.select().from(alarmRulesTable).orderBy(alarmRulesTable.name);
  res.json(rules);
});

router.post("/alarm-rules", async (req, res): Promise<void> => {
  const parsed = CreateAlarmRuleBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }
  const body = req.body as Record<string, unknown>;

  // The server is what will call this address, so it is checked here rather than
  // only in the browser — see lib/outbound-url.ts for why that matters.
  const newWebhookUrl = typeof body.webhookUrl === "string" ? body.webhookUrl || null : null;
  if (newWebhookUrl) {
    const check = checkOutboundUrl(newWebhookUrl);
    if (!check.ok) { res.status(400).json({ error: check.error, code: "unsafe_url" }); return; }
  }

  const [rule] = await db.insert(alarmRulesTable).values({
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
    rocWindow: typeof body.rocWindow === "number" ? body.rocWindow : 60,
    enabled: parsed.data.enabled,
    requireAcknowledge: parsed.data.requireAcknowledge,
    webhookUrl: newWebhookUrl,
    webhookEnabled: typeof body.webhookEnabled === "boolean" ? body.webhookEnabled : false,
  }).returning();
  res.status(201).json(rule);
});

router.put("/alarm-rules/:id", async (req, res): Promise<void> => {
  const params = UpdateAlarmRuleParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }
  const parsed = UpdateAlarmRuleBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }
  const body = req.body as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined)               updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined)        updateData.description = parsed.data.description;
  if (parsed.data.severity !== undefined)           updateData.severity = parsed.data.severity;
  if (parsed.data.threshold !== undefined)          updateData.threshold = parsed.data.threshold;
  if (parsed.data.deadband !== undefined)           updateData.deadband = parsed.data.deadband;
  if (parsed.data.onDelay !== undefined)            updateData.onDelay = parsed.data.onDelay;
  if (parsed.data.offDelay !== undefined)           updateData.offDelay = parsed.data.offDelay;
  if (parsed.data.enabled !== undefined)            updateData.enabled = parsed.data.enabled;
  if (parsed.data.requireAcknowledge !== undefined) updateData.requireAcknowledge = parsed.data.requireAcknowledge;
  if (body.webhookUrl !== undefined) {
    // The server is the one that will call this address, so it is checked
    // here rather than only in the browser — see lib/outbound-url.ts.
    const url = body.webhookUrl || null;
    if (url) {
      const check = checkOutboundUrl(String(url));
      if (!check.ok) { res.status(400).json({ error: check.error, code: "unsafe_url" }); return; }
    }
    updateData.webhookUrl = url;
  }
  if (body.webhookEnabled !== undefined) updateData.webhookEnabled = Boolean(body.webhookEnabled);
  if (body.rocWindow !== undefined)      updateData.rocWindow = Number(body.rocWindow) || 60;
  const [rule] = await db.update(alarmRulesTable).set(updateData).where(eq(alarmRulesTable.id, params.data.id)).returning();
  if (!rule) { res.status(404).json({ error: "Alarm rule not found" }); return; }
  res.json(rule);
});

router.post("/alarm-rules/:id/test-webhook", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [rule] = await db.select().from(alarmRulesTable).where(eq(alarmRulesTable.id, id)).limit(1);
  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  if (!rule.webhookUrl) { res.status(400).json({ error: "No webhook URL configured" }); return; }
  try {
    // Re-checked at call time: a rule stored before this guard existed must
    // not be testable against a private address either.
    assertSafeOutboundUrl(rule.webhookUrl);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as UnsafeUrlError).message, code: "unsafe_url" });
    return;
  }
  try {
    const resp = await fetch(rule.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test", ruleName: rule.name, severity: rule.severity,
        metric: rule.metric, timestamp: new Date().toISOString(), source: "iot-platform" }),
      signal: AbortSignal.timeout(5000),
    });
    res.json({ success: resp.ok, statusCode: resp.status });
  } catch (err) {
    // Same as destinations: the connection error names the target host.
    logger.warn({ ruleId: id, err }, "alarm webhook test failed");
    res.status(502).json({
      success: false,
      error: "The webhook could not be reached.",
      code: "webhook_unreachable",
      correlationId: correlationIdOf(req),
    });
  }
});

router.delete("/alarm-rules/:id", async (req, res): Promise<void> => {
  const params = DeleteAlarmRuleParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }
  const [rule] = await db.delete(alarmRulesTable).where(eq(alarmRulesTable.id, params.data.id)).returning();
  if (!rule) { res.status(404).json({ error: "Alarm rule not found" }); return; }
  res.sendStatus(204);
});

export default router;
