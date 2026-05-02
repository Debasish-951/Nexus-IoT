import { Router, type IRouter } from "express";
import { eq, desc, and, gte, lte, count, sql } from "drizzle-orm";
import {
  db, telemetryTable, assetsTable, attributesTable,
  alarmRulesTable, alarmsTable, alarmHistoryTable,
} from "@workspace/db";
import { GetTelemetryParams, GetTelemetryQueryParams } from "@workspace/api-zod";
import { Parser } from "expr-eval";

const router: IRouter = Router();

// ── Safe expression parser ────────────────────────────────────────────────────
const exprParser = new Parser({
  operators: { add: true, concatenate: false, conditional: true, divide: true,
    factorial: false, multiply: true, power: true, remainder: true, subtract: true,
    logical: true, comparison: true, in: false, assignment: false },
});
function evalExpression(expr: string, vars: Record<string, number>): number | null {
  try {
    const result = exprParser.evaluate(expr, vars);
    return (typeof result === "number" && isFinite(result)) ? result : null;
  } catch { return null; }
}

// ── Timestamp helper ──────────────────────────────────────────────────────────
function toDate(unix: number): Date {
  return new Date(unix > 1e12 ? unix : unix * 1000);
}

// ── Payload normaliser ────────────────────────────────────────────────────────
export interface NormalisedPayload {
  deviceId: string; timestamp?: Date;
  metrics: Record<string, unknown>;
  sensorSerial?: string; externalAssetName?: string; measurementPoint?: string;
}

export function normalise(body: Record<string, unknown>): NormalisedPayload | null {
  if (!body.deviceId || typeof body.deviceId !== "string") return null;
  let ts: Date | undefined;
  if (typeof body.timestampUnix === "number") ts = toDate(body.timestampUnix);
  else if (body.capturedAt) ts = new Date(body.capturedAt as string);
  else if (body.receivedAt) ts = new Date(body.receivedAt as string);
  else if (body.timestamp) {
    try { ts = new Date(body.timestamp as string); } catch { ts = new Date(); }
    if (isNaN(ts.getTime())) ts = new Date();
  }
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
    const sensor = body.sensor as Record<string, unknown> | undefined;
    const asset  = body.asset  as Record<string, unknown> | undefined;
    const mp     = body.measurement_point as Record<string, unknown> | undefined;
    return { deviceId: body.deviceId, timestamp: ts,
      metrics: body.data as Record<string, unknown>,
      sensorSerial: sensor?.serial as string | undefined,
      externalAssetName: (asset?.name as string | undefined)?.trim(),
      measurementPoint: mp?.name as string | undefined };
  }
  if (body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics)) {
    return { deviceId: body.deviceId, timestamp: ts, metrics: body.metrics as Record<string, unknown> };
  }
  return { deviceId: body.deviceId, timestamp: ts, metrics: {} };
}

// ── Operator evaluation ───────────────────────────────────────────────────────
function evalOp(value: number, op: string, threshold: number): boolean {
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

// ── Webhook delivery ──────────────────────────────────────────────────────────
async function fireWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* non-blocking — webhook failures are silently ignored */ }
}

// ── Alarm rule evaluation (threshold + rate-of-change) ────────────────────────
interface AlarmEvent {
  ruleId: string; ruleName: string; metric: string;
  value: number; threshold: number | null; operator: string | null;
  severity: string; event: "triggered" | "cleared"; alarmId: string;
  webhookUrl: string | null; webhookEnabled: boolean;
}

async function evaluateAlarmRules(
  assetId: string, assetName: string,
  metrics: Record<string, unknown>,
  prevMetrics: Record<string, { value: number; ts: Date }>,
  ts: Date
): Promise<AlarmEvent[]> {
  const events: AlarmEvent[] = [];
  const rules = await db.select().from(alarmRulesTable)
    .where(and(eq(alarmRulesTable.enabled, true)));

  for (const rule of rules) {
    if (rule.assetId && rule.assetId !== assetId) continue;
    if (!rule.metric || !rule.operator || rule.threshold == null) continue;

    let effectiveValue: number | null = null;

    if (rule.alarmType === "threshold") {
      const raw = metrics[rule.metric];
      if (raw === undefined) continue;
      effectiveValue = Number(raw);
      if (isNaN(effectiveValue)) continue;
    } else if (rule.alarmType === "rate_of_change") {
      const raw = metrics[rule.metric];
      if (raw === undefined) continue;
      const newVal = Number(raw);
      if (isNaN(newVal)) continue;
      const prev = prevMetrics[rule.metric];
      if (!prev) continue;
      const deltaSeconds = Math.max((ts.getTime() - prev.ts.getTime()) / 1000, 0.001);
      effectiveValue = Math.abs((newVal - prev.value) / deltaSeconds);
    } else {
      continue; // other types not yet evaluated here
    }

    if (effectiveValue === null) continue;
    const conditionMet = evalOp(effectiveValue, rule.operator, rule.threshold);

    const [existing] = await db.select({ id: alarmsTable.id }).from(alarmsTable)
      .where(and(eq(alarmsTable.ruleId, rule.id), eq(alarmsTable.status, "active"))).limit(1);

    if (conditionMet && !existing) {
      const [newAlarm] = await db.insert(alarmsTable).values({
        name: rule.name, assetId, assetName, ruleId: rule.id,
        severity: rule.severity, status: "active", alarmClass: rule.alarmType,
        message: `${rule.metric} ${rule.operator} ${rule.threshold} (value: ${effectiveValue.toFixed(4)})`,
        triggerValue: effectiveValue, triggeredAt: ts,
      }).returning();
      await db.insert(alarmHistoryTable).values({
        alarmId: newAlarm.id, assetId, assetName, name: rule.name,
        severity: rule.severity, status: "active", triggeredAt: ts,
      });
      events.push({ ruleId: rule.id, ruleName: rule.name, metric: rule.metric,
        value: effectiveValue, threshold: rule.threshold, operator: rule.operator,
        severity: rule.severity, event: "triggered", alarmId: newAlarm.id,
        webhookUrl: rule.webhookUrl ?? null, webhookEnabled: rule.webhookEnabled });
    } else if (!conditionMet && existing) {
      const deadband = rule.deadband ?? 0;
      const clearOk = deadband === 0 ? true : !evalOp(effectiveValue, rule.operator, rule.threshold - deadband);
      if (clearOk) {
        await db.update(alarmsTable).set({ status: "cleared", clearedAt: ts }).where(eq(alarmsTable.id, existing.id));
        await db.update(alarmHistoryTable).set({ status: "cleared", clearedAt: ts }).where(eq(alarmHistoryTable.alarmId, existing.id));
        events.push({ ruleId: rule.id, ruleName: rule.name, metric: rule.metric,
          value: effectiveValue, threshold: rule.threshold, operator: rule.operator,
          severity: rule.severity, event: "cleared", alarmId: existing.id,
          webhookUrl: rule.webhookUrl ?? null, webhookEnabled: rule.webhookEnabled });
      }
    }
  }

  // Dispatch webhooks non-blocking
  for (const e of events) {
    if (e.webhookEnabled && e.webhookUrl) {
      void fireWebhook(e.webhookUrl, {
        event: e.event, alarmId: e.alarmId, ruleName: e.ruleName,
        metric: e.metric, value: e.value, threshold: e.threshold,
        operator: e.operator, severity: e.severity,
        assetId, assetName, timestamp: ts.toISOString(),
      });
    }
  }
  return events;
}

// ── Runtime attribute evaluator ───────────────────────────────────────────────
async function evaluateRuntimeAttributes(assetId: string, ts: Date): Promise<void> {
  const allAttrs = await db.select({
    id: attributesTable.id, name: attributesTable.name,
    type: attributesTable.type, value: attributesTable.value, expression: attributesTable.expression,
  }).from(attributesTable).where(eq(attributesTable.assetId, assetId));

  const vars: Record<string, number> = {};
  for (const attr of allAttrs) {
    if (attr.value == null) continue;
    const num = Number(attr.value);
    if (!isNaN(num)) {
      vars[attr.name] = num;
      vars[attr.name.replace(/\s+/g, "_")] = num;
      vars[attr.name.replace(/[^a-zA-Z0-9_]/g, "_")] = num;
    }
  }
  for (const attr of allAttrs.filter((a) => a.type === "runtime" && a.expression)) {
    const result = evalExpression(attr.expression!, vars);
    if (result !== null) {
      await db.update(attributesTable).set({ value: result, timestamp: ts, quality: "good" }).where(eq(attributesTable.id, attr.id));
    } else {
      await db.update(attributesTable).set({ quality: "bad", timestamp: ts }).where(eq(attributesTable.id, attr.id));
    }
  }
}

// ── Core ingest logic ─────────────────────────────────────────────────────────
export async function processNormalised(n: NormalisedPayload, assetIdHint?: string) {
  let assetId: string | null = assetIdHint ?? null;
  let assetName = n.externalAssetName ?? n.deviceId;

  if (!assetId) {
    const [asset] = await db.select({ id: assetsTable.id, name: assetsTable.name })
      .from(assetsTable).where(eq(assetsTable.identifier, n.deviceId));
    assetId = asset?.id ?? null;
    if (asset?.name) assetName = asset.name;
  } else {
    const [asset] = await db.select({ name: assetsTable.name }).from(assetsTable).where(eq(assetsTable.id, assetId));
    if (asset?.name) assetName = asset.name;
  }

  const ts = n.timestamp ?? new Date();
  if (!assetId || Object.keys(n.metrics).length === 0) {
    return { recordsWritten: 0, assetId, assetName, alarmEvents: [] };
  }

  // Snapshot previous values for rate-of-change evaluation
  const prevMetrics: Record<string, { value: number; ts: Date }> = {};
  const metricKeys = Object.keys(n.metrics);
  if (metricKeys.length > 0) {
    for (const metric of metricKeys) {
      const [prev] = await db.select({ value: telemetryTable.value, timestamp: telemetryTable.timestamp })
        .from(telemetryTable)
        .where(and(eq(telemetryTable.assetId, assetId), eq(telemetryTable.metric, metric)))
        .orderBy(desc(telemetryTable.timestamp)).limit(1);
      if (prev && prev.timestamp) {
        const v = Number(prev.value);
        if (!isNaN(v)) prevMetrics[metric] = { value: v, ts: prev.timestamp };
      }
    }
  }

  const records = Object.entries(n.metrics).map(([metric, value]) => ({
    assetId, deviceId: n.deviceId, metric, value, timestamp: ts, quality: "good",
  }));
  await db.insert(telemetryTable).values(records as any[]);

  // Update dynamic attributes
  for (const [metric, value] of Object.entries(n.metrics)) {
    await db.update(attributesTable).set({ value, timestamp: ts })
      .where(and(eq(attributesTable.assetId, assetId as string), eq(attributesTable.tagName, `${n.deviceId}.${metric}`)));
  }
  if (n.sensorSerial) {
    await db.update(attributesTable).set({ value: n.sensorSerial, timestamp: ts })
      .where(and(eq(attributesTable.assetId, assetId as string), eq(attributesTable.tagName, `${n.deviceId}.sensor_serial`)));
  }

  // Evaluate runtime (computed) attributes
  await evaluateRuntimeAttributes(assetId as string, ts);

  // Evaluate alarm rules (threshold + rate-of-change)
  const alarmEvents = await evaluateAlarmRules(assetId as string, assetName, n.metrics, prevMetrics, ts);

  return { recordsWritten: records.length, assetId, assetName, alarmEvents };
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.post("/ingest/payload", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const normalised = normalise(body);
  if (!normalised) { res.status(400).json({ error: "Missing required field: deviceId" }); return; }
  const assetIdHint = typeof body.assetId === "string" ? body.assetId : undefined;
  const result = await processNormalised(normalised, assetIdHint);
  const triggered = result.alarmEvents.filter((e) => e.event === "triggered");
  const cleared   = result.alarmEvents.filter((e) => e.event === "cleared");
  res.json({ success: true, recordsWritten: result.recordsWritten, assetId: result.assetId,
    assetName: result.assetName, message: `Ingested ${result.recordsWritten} metric(s)`,
    alarmsTriggered: triggered.length, alarmsCleared: cleared.length, alarmEvents: result.alarmEvents });
});

router.post("/ingest/batch", async (req, res): Promise<void> => {
  const items = req.body;
  if (!Array.isArray(items)) { res.status(400).json({ error: "Body must be an array" }); return; }
  let successCount = 0, failureCount = 0, totalTriggered = 0, totalCleared = 0;
  for (const item of items) {
    try {
      const n = normalise(item as Record<string, unknown>);
      if (!n) { failureCount++; continue; }
      const result = await processNormalised(n);
      totalTriggered += result.alarmEvents.filter((e) => e.event === "triggered").length;
      totalCleared   += result.alarmEvents.filter((e) => e.event === "cleared").length;
      successCount++;
    } catch { failureCount++; }
  }
  res.json({ success: failureCount === 0, totalRecords: items.length, successCount, failureCount,
    alarmsTriggered: totalTriggered, alarmsCleared: totalCleared });
});

router.get("/telemetry/:assetId", async (req, res): Promise<void> => {
  const params = GetTelemetryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const query = GetTelemetryQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const conditions = [eq(telemetryTable.assetId, params.data.assetId)];
  if (query.data.metric) conditions.push(eq(telemetryTable.metric, query.data.metric));
  if (query.data.from) conditions.push(gte(telemetryTable.timestamp, query.data.from as unknown as Date));
  if (query.data.to)   conditions.push(lte(telemetryTable.timestamp, query.data.to as unknown as Date));
  const records = await db.select().from(telemetryTable).where(and(...conditions))
    .orderBy(desc(telemetryTable.timestamp)).limit(query.data.limit ?? 100);
  res.json(records);
});

// ── Telemetry CSV export ──────────────────────────────────────────────────────
router.get("/telemetry/:assetId/export", async (req, res): Promise<void> => {
  const { assetId } = req.params;
  const { metric, from, to } = req.query as Record<string, string>;
  const conditions = [eq(telemetryTable.assetId, assetId)];
  if (metric) conditions.push(eq(telemetryTable.metric, metric));
  if (from) conditions.push(gte(telemetryTable.timestamp, new Date(from)));
  if (to)   conditions.push(lte(telemetryTable.timestamp, new Date(to)));
  const records = await db.select().from(telemetryTable).where(and(...conditions))
    .orderBy(desc(telemetryTable.timestamp)).limit(50000);
  const header = "id,assetId,deviceId,metric,value,quality,timestamp";
  const rows = records.map((r) =>
    [r.id, r.assetId, r.deviceId ?? "", r.metric,
      typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value ?? ""),
      r.quality ?? "", r.timestamp?.toISOString() ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = [header, ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="telemetry_${assetId}_${Date.now()}.csv"`);
  res.send(csv);
});

// ── Asset health endpoint ─────────────────────────────────────────────────────
router.get("/assets/:assetId/health", async (req, res): Promise<void> => {
  const { assetId } = req.params;
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, assetId));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

  const attrs = await db.select({
    id: attributesTable.id, name: attributesTable.name, type: attributesTable.type,
    value: attributesTable.value, uom: attributesTable.uom, timestamp: attributesTable.timestamp,
    quality: attributesTable.quality,
  }).from(attributesTable).where(eq(attributesTable.assetId, assetId));

  const now = Date.now();
  const oneHourAgo = now - 3600_000;
  const dynamicAttrs = attrs.filter((a) => a.type === "dynamic" || a.type === "runtime" || a.type === "metric");
  const freshAttrs   = dynamicAttrs.filter((a) => a.timestamp && new Date(a.timestamp).getTime() > oneHourAgo);

  const [{ count: activeAlarms }] = await db.select({ count: count() })
    .from(alarmsTable).where(and(eq(alarmsTable.assetId, assetId), eq(alarmsTable.status, "active")));

  const [lastTelemetry] = await db.select({ timestamp: telemetryTable.timestamp })
    .from(telemetryTable).where(eq(telemetryTable.assetId, assetId))
    .orderBy(desc(telemetryTable.timestamp)).limit(1);

  const freshnessPct = dynamicAttrs.length > 0 ? Math.round((freshAttrs.length / dynamicAttrs.length) * 100) : null;
  const alarmCount = Number(activeAlarms ?? 0);
  const health = alarmCount > 0 ? "alarm" : (freshnessPct !== null && freshnessPct < 50) ? "stale" : "ok";

  res.json({
    assetId, assetName: asset.name, health,
    freshnessPct, activeAlarms: alarmCount,
    lastSeen: lastTelemetry?.timestamp ?? null,
    totalAttributes: attrs.length, dynamicAttributes: dynamicAttrs.length, freshAttributes: freshAttrs.length,
    keyMetrics: dynamicAttrs.slice(0, 6).map((a) => ({
      name: a.name, value: a.value, uom: a.uom, quality: a.quality, timestamp: a.timestamp,
    })),
  });
});

export default router;
