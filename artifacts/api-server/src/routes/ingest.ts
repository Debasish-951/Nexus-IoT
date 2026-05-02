import { Router, type IRouter } from "express";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import {
  db,
  telemetryTable,
  assetsTable,
  attributesTable,
  alarmRulesTable,
  alarmsTable,
  alarmHistoryTable,
} from "@workspace/db";
import {
  IngestPayloadBody,
  IngestBatchBody,
  GetTelemetryParams,
  GetTelemetryQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Operator evaluation ───────────────────────────────────────────────────────
function evalOperator(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case "gt":  return value > threshold;
    case "lt":  return value < threshold;
    case "gte": return value >= threshold;
    case "lte": return value <= threshold;
    case "eq":  return value === threshold;
    case "ne":  return value !== threshold;
    default:    return false;
  }
}

// ── Alarm-rule evaluation after each ingest ───────────────────────────────────
interface AlarmEvent {
  ruleId: string;
  ruleName: string;
  metric: string;
  value: number;
  threshold: number | null;
  operator: string | null;
  severity: string;
  event: "triggered" | "cleared";
  alarmId: string;
}

async function evaluateAlarmRules(
  assetId: string,
  assetName: string,
  metrics: Record<string, unknown>,
  ts: Date
): Promise<AlarmEvent[]> {
  const events: AlarmEvent[] = [];

  // Load all enabled threshold rules for this asset (or asset-independent rules)
  const rules = await db
    .select()
    .from(alarmRulesTable)
    .where(
      and(
        eq(alarmRulesTable.enabled, true),
        eq(alarmRulesTable.alarmType, "threshold")
      )
    );

  for (const rule of rules) {
    // Skip rules scoped to a different asset
    if (rule.assetId && rule.assetId !== assetId) continue;
    // Skip rules without a metric or operator/threshold
    if (!rule.metric || !rule.operator || rule.threshold == null) continue;
    // Skip if this metric isn't in the payload
    const rawValue = metrics[rule.metric];
    if (rawValue === undefined) continue;
    const value = Number(rawValue);
    if (isNaN(value)) continue;

    const conditionMet = evalOperator(value, rule.operator, rule.threshold);

    // Find any currently ACTIVE alarm for this rule
    const [existingAlarm] = await db
      .select({ id: alarmsTable.id, status: alarmsTable.status })
      .from(alarmsTable)
      .where(
        and(
          eq(alarmsTable.ruleId, rule.id),
          eq(alarmsTable.status, "active")
        )
      )
      .limit(1);

    if (conditionMet && !existingAlarm) {
      // ── Trigger new alarm ──
      const [newAlarm] = await db
        .insert(alarmsTable)
        .values({
          name: rule.name,
          assetId,
          assetName,
          ruleId: rule.id,
          severity: rule.severity,
          status: "active",
          alarmClass: "threshold",
          message: `${rule.metric} ${rule.operator} ${rule.threshold} (value: ${value})`,
          triggerValue: value,
          triggeredAt: ts,
        })
        .returning();

      // Write to alarm history
      await db.insert(alarmHistoryTable).values({
        alarmId: newAlarm.id,
        assetId,
        assetName,
        name: rule.name,
        severity: rule.severity,
        status: "active",
        triggeredAt: ts,
      });

      events.push({
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
        operator: rule.operator,
        severity: rule.severity,
        event: "triggered",
        alarmId: newAlarm.id,
      });
    } else if (!conditionMet && existingAlarm) {
      // ── Clear existing alarm (with deadband check) ──
      const deadband = rule.deadband ?? 0;
      const clearOk = deadband === 0
        ? true
        : !evalOperator(value, rule.operator, rule.threshold - deadband);

      if (clearOk) {
        await db
          .update(alarmsTable)
          .set({ status: "cleared", clearedAt: ts })
          .where(eq(alarmsTable.id, existingAlarm.id));

        await db
          .update(alarmHistoryTable)
          .set({ status: "cleared", clearedAt: ts })
          .where(eq(alarmHistoryTable.alarmId, existingAlarm.id));

        events.push({
          ruleId: rule.id,
          ruleName: rule.name,
          metric: rule.metric,
          value,
          threshold: rule.threshold,
          operator: rule.operator,
          severity: rule.severity,
          event: "cleared",
          alarmId: existingAlarm.id,
        });
      }
    }
  }

  return events;
}

// ── Core payload processing ───────────────────────────────────────────────────
async function processPayload(payload: {
  deviceId: string;
  assetId?: string | null;
  timestamp?: Date | string | null;
  timestampUnix?: number | null;
  metrics?: Record<string, unknown>;
}) {
  let assetId = payload.assetId;
  let assetName = payload.deviceId;

  // If no assetId, try to find asset by deviceId as identifier
  if (!assetId) {
    const [asset] = await db
      .select({ id: assetsTable.id, name: assetsTable.name })
      .from(assetsTable)
      .where(eq(assetsTable.identifier, payload.deviceId));
    assetId = asset?.id;
    if (asset?.name) assetName = asset.name;
  } else {
    const [asset] = await db
      .select({ name: assetsTable.name })
      .from(assetsTable)
      .where(eq(assetsTable.id, assetId));
    if (asset?.name) assetName = asset.name;
  }

  if (!assetId || !payload.metrics) {
    return { recordsWritten: 0, assetId: null, assetName: null, alarmEvents: [] };
  }

  let ts: Date;
  if (payload.timestampUnix) {
    ts = new Date(payload.timestampUnix * 1000);
  } else if (payload.timestamp) {
    ts = new Date(payload.timestamp as string);
  } else {
    ts = new Date();
  }

  const records = Object.entries(payload.metrics).map(([metric, value]) => ({
    assetId,
    deviceId: payload.deviceId,
    metric,
    value,
    timestamp: ts,
    quality: "good",
  }));

  if (records.length > 0) {
    await db.insert(telemetryTable).values(records as any[]);

    // Update matching dynamic attributes
    for (const [metric, value] of Object.entries(payload.metrics)) {
      await db
        .update(attributesTable)
        .set({ value, timestamp: ts })
        .where(
          and(
            eq(attributesTable.assetId, assetId as string),
            eq(attributesTable.tagName, `${payload.deviceId}.${metric}`)
          )
        );
    }
  }

  // Evaluate alarm rules against ingested metrics
  const alarmEvents = await evaluateAlarmRules(
    assetId as string,
    assetName,
    payload.metrics,
    ts
  );

  return { recordsWritten: records.length, assetId, assetName, alarmEvents };
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.post("/ingest/payload", async (req, res): Promise<void> => {
  const parsed = IngestPayloadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await processPayload({
    deviceId: parsed.data.deviceId,
    assetId: parsed.data.assetId ?? null,
    timestamp: parsed.data.timestamp ?? null,
    timestampUnix: parsed.data.timestampUnix ?? null,
    metrics: parsed.data.metrics as Record<string, unknown> ?? {},
  });

  const triggered = result.alarmEvents.filter((e) => e.event === "triggered");
  const cleared   = result.alarmEvents.filter((e) => e.event === "cleared");

  res.json({
    success: true,
    recordsWritten: result.recordsWritten,
    assetId: result.assetId,
    message: `Ingested ${result.recordsWritten} metric(s)`,
    alarmsTriggered: triggered.length,
    alarmsCleared: cleared.length,
    alarmEvents: result.alarmEvents,
  });
});

router.post("/ingest/batch", async (req, res): Promise<void> => {
  const parsed = IngestBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let successCount = 0;
  let failureCount = 0;
  let totalAlarmsTriggered = 0;
  let totalAlarmsCleared = 0;

  for (const payload of parsed.data) {
    try {
      const result = await processPayload({
        deviceId: payload.deviceId,
        assetId: payload.assetId ?? null,
        timestamp: payload.timestamp ?? null,
        timestampUnix: payload.timestampUnix ?? null,
        metrics: payload.metrics as Record<string, unknown> ?? {},
      });
      totalAlarmsTriggered += result.alarmEvents.filter((e) => e.event === "triggered").length;
      totalAlarmsCleared   += result.alarmEvents.filter((e) => e.event === "cleared").length;
      successCount++;
    } catch {
      failureCount++;
    }
  }

  res.json({
    success: failureCount === 0,
    totalRecords: parsed.data.length,
    successCount,
    failureCount,
    alarmsTriggered: totalAlarmsTriggered,
    alarmsCleared: totalAlarmsCleared,
  });
});

router.get("/telemetry/:assetId", async (req, res): Promise<void> => {
  const params = GetTelemetryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetTelemetryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [eq(telemetryTable.assetId, params.data.assetId)];

  if (query.data.metric) {
    conditions.push(eq(telemetryTable.metric, query.data.metric));
  }
  if (query.data.from) {
    conditions.push(gte(telemetryTable.timestamp, new Date(query.data.from as string)));
  }
  if (query.data.to) {
    conditions.push(lte(telemetryTable.timestamp, new Date(query.data.to as string)));
  }

  const records = await db
    .select()
    .from(telemetryTable)
    .where(and(...conditions))
    .orderBy(desc(telemetryTable.timestamp))
    .limit(query.data.limit ?? 100);

  res.json(records);
});

export default router;
