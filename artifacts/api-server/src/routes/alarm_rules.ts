import { Router, type IRouter, type Request } from "express";
import { respondInvalid } from "../lib/respond";
import { eq } from "drizzle-orm";
import { db, alarmRulesTable } from "@workspace/db";
import {
  CreateAlarmRuleBody, UpdateAlarmRuleBody,
  UpdateAlarmRuleParams, DeleteAlarmRuleParams,
} from "@workspace/api-zod";
import { checkOutboundUrl, assertSafeOutboundUrl, safeFetch, UnsafeUrlError } from "../lib/outbound-url";
import { logger } from "../lib/logger";
import { correlationIdOf } from "../lib/errors";
import { closeOpenAlarmsForRule } from "../lib/alarm-lifecycle";
import { forgetRuleDelays, invalidateAlarmRuleCache } from "./ingest";
import { hasPermission } from "../lib/rbac";
import { logActivity } from "./activity_log";
import { diffFields } from "../lib/audit-core";
import { sealWebhookUrl, openWebhookUrl, withOpenWebhook } from "../lib/alarm-webhook";

const router: IRouter = Router();

/**
 * Webhook URLs are shown only to people who can manage alarm rules.
 *
 * A Slack or Teams incoming-webhook URL is a bearer credential: whoever has it
 * can post to that channel. Every alarm reader could see it in the rule list.
 * Everyone else now gets the scheme and host only, followed by WEBHOOK_MASK, so the UI
 * can still show that a webhook is configured and where it goes.
 */
export const WEBHOOK_MASK = "••••";

export function maskWebhookUrl(url: string | null): string | null {
  if (!url) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/${WEBHOOK_MASK}`;
  } catch {
    return WEBHOOK_MASK;
  }
}

/** A value that came from maskWebhookUrl, sent back by a client. Never saved. */
export function isMaskedWebhookUrl(value: unknown): boolean {
  return typeof value === "string" && value.includes(WEBHOOK_MASK);
}

function canSeeWebhooks(req: Request): boolean {
  return !!req.principal && hasPermission(req.principal.access, "manage_alarms");
}

function forClient<T extends { webhookUrl: string | null }>(req: Request, rule: T): T {
  return canSeeWebhooks(req) ? rule : { ...rule, webhookUrl: maskWebhookUrl(rule.webhookUrl) };
}

router.get("/alarm-rules", async (req, res): Promise<void> => {
  const rules = await db.select().from(alarmRulesTable).orderBy(alarmRulesTable.name);
  // Stored encrypted (lib/alarm-webhook.ts); decrypted here, then masked for readers.
  res.json(rules.map((r) => forClient(req, withOpenWebhook(r))));
});

router.post("/alarm-rules", async (req, res): Promise<void> => {
  const parsed = CreateAlarmRuleBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }
  const body = req.body as Record<string, unknown>;

  // The server is what will call this address, so it is checked here rather than
  // only in the browser — see lib/outbound-url.ts for why that matters.
  const newWebhookUrl = typeof body.webhookUrl === "string" ? body.webhookUrl || null : null;
  if (isMaskedWebhookUrl(newWebhookUrl)) {
    res.status(400).json({ error: "Enter the full webhook URL.", code: "masked_webhook_url" });
    return;
  }
  if (newWebhookUrl) {
    const check = checkOutboundUrl(newWebhookUrl);
    if (!check.ok) { res.status(400).json({ error: check.error, code: "unsafe_url" }); return; }
  }

  const [sealedRule] = await db.insert(alarmRulesTable).values({
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
    webhookUrl: sealWebhookUrl(newWebhookUrl),
    webhookEnabled: typeof body.webhookEnabled === "boolean" ? body.webhookEnabled : false,
  }).returning();
  const rule = withOpenWebhook(sealedRule!);
  invalidateAlarmRuleCache();
  await logActivity("alarm_rule.created", "alarm_rules", rule!.id, rule!.name,
    `${rule!.severity} ${rule!.alarmType}${rule!.metric ? ` on ${rule!.metric}` : ""}${rule!.operator ? ` ${rule!.operator} ${rule!.threshold}` : ""}`, req,
    { assetId: rule!.assetId ?? null, changes: diffFields({}, rule as unknown as Record<string, unknown>, { ignore: ["id"] }) });
  res.status(201).json(forClient(req, rule));
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
  // These define what the rule watches. They were accepted by the form but not
  // saved, so an edited rule kept evaluating its old condition.
  if (parsed.data.assetId !== undefined)            updateData.assetId = parsed.data.assetId;
  if (parsed.data.alarmType !== undefined)          updateData.alarmType = parsed.data.alarmType;
  if (parsed.data.metric !== undefined)             updateData.metric = parsed.data.metric;
  if (parsed.data.operator !== undefined)           updateData.operator = parsed.data.operator;
  if (parsed.data.scanRate !== undefined)           updateData.scanRate = parsed.data.scanRate;
  // A masked URL sent back (e.g. a form that loaded the list for a reader and
  // was saved later) means "unchanged". Saving it would overwrite the real URL.
  if (body.webhookUrl !== undefined && !isMaskedWebhookUrl(body.webhookUrl)) {
    // The server is the one that will call this address, so it is checked
    // here rather than only in the browser — see lib/outbound-url.ts.
    const url = body.webhookUrl || null;
    if (url) {
      const check = checkOutboundUrl(String(url));
      if (!check.ok) { res.status(400).json({ error: check.error, code: "unsafe_url" }); return; }
    }
    updateData.webhookUrl = sealWebhookUrl(url ? String(url) : null);
  }
  if (body.webhookEnabled !== undefined) updateData.webhookEnabled = Boolean(body.webhookEnabled);
  if (body.rocWindow !== undefined)      updateData.rocWindow = Number(body.rocWindow) || 60;
  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No changes were sent.", code: "no_changes" });
    return;
  }

  const [sealedBefore] = await db.select().from(alarmRulesTable).where(eq(alarmRulesTable.id, params.data.id));
  if (!sealedBefore) { res.status(404).json({ error: "Alarm rule not found" }); return; }
  const [sealedRule] = await db.update(alarmRulesTable).set({ ...updateData, updatedAt: new Date() })
    .where(eq(alarmRulesTable.id, params.data.id)).returning();
  if (!sealedRule) { res.status(404).json({ error: "Alarm rule not found" }); return; }
  // Compared and returned decrypted, so the change record and the response are
  // about the URL itself, not its (randomly re-encrypted) ciphertext.
  const before = withOpenWebhook(sealedBefore);
  const rule = withOpenWebhook(sealedRule);
  // Ingest caches enabled rules for a few seconds; an edit takes effect now.
  invalidateAlarmRuleCache();

  // Disabled rules are not evaluated, and a redefined rule no longer describes
  // the condition its open alarms were raised for. Either way those alarms could
  // never clear on their own, so they are closed now.
  const redefined = (["assetId", "alarmType", "metric", "operator", "threshold"] as const)
    .some((k) => k in updateData && updateData[k] !== before[k]);
  if ((before.enabled && rule.enabled === false) || redefined) {
    await closeOpenAlarmsForRule(rule.id, rule.name);
    forgetRuleDelays(rule.id);
  }
  await logActivity("alarm_rule.updated", "alarm_rules", rule.id, rule.name, null, req,
    { assetId: rule.assetId ?? null, changes: diffFields(before as unknown as Record<string, unknown>, rule as unknown as Record<string, unknown>, { only: Object.keys(updateData) }) });
  res.json(forClient(req, rule));
});

router.post("/alarm-rules/:id/test-webhook", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [rule] = await db.select().from(alarmRulesTable).where(eq(alarmRulesTable.id, id)).limit(1);
  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  if (!rule.webhookUrl) { res.status(400).json({ error: "No webhook URL configured" }); return; }
  const webhookUrl = openWebhookUrl(rule.webhookUrl);
  if (!webhookUrl) { res.status(400).json({ error: "The stored webhook URL could not be decrypted. Enter it again.", code: "webhook_unreadable" }); return; }
  try {
    // Re-checked at call time: a rule stored before this guard existed must
    // not be testable against a private address either.
    assertSafeOutboundUrl(webhookUrl);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as UnsafeUrlError).message, code: "unsafe_url" });
    return;
  }
  try {
    const resp = await safeFetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test", ruleName: rule.name, severity: rule.severity,
        metric: rule.metric, timestamp: new Date().toISOString(), source: "iot-platform" }),
      signal: AbortSignal.timeout(5000),
    });
    await logActivity("alarm_rule.webhook_tested", "alarm_rules", rule.id, rule.name, `test event answered ${resp.status}`, req, { assetId: rule.assetId ?? null, outcome: resp.ok ? "success" : "failure" });
    res.json({ success: resp.ok, statusCode: resp.status });
  } catch (err) {
    // Same as destinations: the connection error names the target host.
    logger.warn({ ruleId: id, err }, "alarm webhook test failed");
    await logActivity("alarm_rule.webhook_tested", "alarm_rules", rule.id, rule.name, "the webhook could not be reached", req, { assetId: rule.assetId ?? null, outcome: "failure" });
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
  // Open alarms of a deleted rule would otherwise stay open for ever.
  await closeOpenAlarmsForRule(rule.id, rule.name);
  forgetRuleDelays(rule.id);
  await logActivity("alarm_rule.deleted", "alarm_rules", rule.id, rule.name, `${rule.severity} ${rule.alarmType}${rule.metric ? ` on ${rule.metric}` : ""}`, req, { assetId: rule.assetId ?? null });
  res.sendStatus(204);
});

export default router;
