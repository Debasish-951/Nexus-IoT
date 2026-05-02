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
import { GetTelemetryParams, GetTelemetryQueryParams } from "@workspace/api-zod";
import { Parser } from "expr-eval";

const router: IRouter = Router();

// ── Safe expression parser (no JS eval, sandboxed) ───────────────────────────
const exprParser = new Parser({
  operators: {
    add: true, concatenate: false, conditional: true,
    divide: true, factorial: false, multiply: true,
    power: true, remainder: true, subtract: true,
    logical: true, comparison: true, in: false,
    assignment: false,
  },
});

// Evaluate a runtime expression given a map of variable → numeric value.
// Returns null if expression is invalid or variables are missing.
function evalExpression(expr: string, vars: Record<string, number>): number | null {
  try {
    const result = exprParser.evaluate(expr, vars);
    if (typeof result !== "number" || !isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

// ── Timestamp helper ──────────────────────────────────────────────────────────
function toDate(unix: number): Date {
  return new Date(unix > 1e12 ? unix : unix * 1000);
}

// ── Sensorgrow payload normaliser ─────────────────────────────────────────────
interface NormalisedPayload {
  deviceId: string;
  timestamp?: Date;
  metrics: Record<string, unknown>;
  sensorSerial?: string;
  externalAssetName?: string;
  measurementPoint?: string;
}

function normalise(body: Record<string, unknown>): NormalisedPayload | null {
  if (!body.deviceId || typeof body.deviceId !== "string") return null;

  let ts: Date | undefined;
  if (typeof body.timestampUnix === "number") {
    ts = toDate(body.timestampUnix);
  } else if (body.capturedAt) {
    ts = new Date(body.capturedAt as string);
  } else if (body.receivedAt) {
    ts = new Date(body.receivedAt as string);
  } else if (body.timestamp) {
    try { ts = new Date(body.timestamp as string); } catch { ts = new Date(); }
    if (isNaN(ts.getTime())) ts = new Date();
  }

  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
    const sensor = body.sensor as Record<string, unknown> | undefined;
    const asset  = body.asset  as Record<string, unknown> | undefined;
    const mp     = body.measurement_point as Record<string, unknown> | undefined;
    return {
      deviceId: body.deviceId,
      timestamp: ts,
      metrics: body.data as Record<string, unknown>,
      sensorSerial:      sensor?.serial as string | undefined,
      externalAssetName: (asset?.name as string | undefined)?.trim(),
      measurementPoint:  mp?.name as string | undefined,
    };
  }

  if (body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics)) {
    return {
      deviceId: body.deviceId,
      timestamp: ts,
      metrics: body.metrics as Record<string, unknown>,
    };
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

// ── Alarm rule evaluation ─────────────────────────────────────────────────────
interface AlarmEvent {
  ruleId: string; ruleName: string; metric: string;
  value: number; threshold: number | null; operator: string | null;
  severity: string; event: "triggered" | "cleared"; alarmId: string;
}

async function evaluateAlarmRules(
  assetId: string,
  assetName: string,
  metrics: Record<string, unknown>,
  ts: Date
): Promise<AlarmEvent[]> {
  const events: AlarmEvent[] = [];

  const rules = await db
    .select()
    .from(alarmRulesTable)
    .where(and(eq(alarmRulesTable.enabled, true), eq(alarmRulesTable.alarmType, "threshold")));

  for (const rule of rules) {
    if (rule.assetId && rule.assetId !== assetId) continue;
    if (!rule.metric || !rule.operator || rule.threshold == null) continue;
    const raw = metrics[rule.metric];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (isNaN(value)) continue;

    const conditionMet = evalOp(value, rule.operator, rule.threshold);

    const [existing] = await db
      .select({ id: alarmsTable.id })
      .from(alarmsTable)
      .where(and(eq(alarmsTable.ruleId, rule.id), eq(alarmsTable.status, "active")))
      .limit(1);

    if (conditionMet && !existing) {
      const [newAlarm] = await db.insert(alarmsTable).values({
        name: rule.name, assetId, assetName, ruleId: rule.id,
        severity: rule.severity, status: "active", alarmClass: "threshold",
        message: `${rule.metric} ${rule.operator} ${rule.threshold} (value: ${value})`,
        triggerValue: value, triggeredAt: ts,
      }).returning();

      await db.insert(alarmHistoryTable).values({
        alarmId: newAlarm.id, assetId, assetName,
        name: rule.name, severity: rule.severity,
        status: "active", triggeredAt: ts,
      });

      events.push({ ruleId: rule.id, ruleName: rule.name, metric: rule.metric, value,
        threshold: rule.threshold, operator: rule.operator, severity: rule.severity,
        event: "triggered", alarmId: newAlarm.id });

    } else if (!conditionMet && existing) {
      const deadband = rule.deadband ?? 0;
      const clearOk  = deadband === 0 ? true
        : !evalOp(value, rule.operator, rule.threshold - deadband);

      if (clearOk) {
        await db.update(alarmsTable).set({ status: "cleared", clearedAt: ts })
          .where(eq(alarmsTable.id, existing.id));
        await db.update(alarmHistoryTable).set({ status: "cleared", clearedAt: ts })
          .where(eq(alarmHistoryTable.alarmId, existing.id));

        events.push({ ruleId: rule.id, ruleName: rule.name, metric: rule.metric, value,
          threshold: rule.threshold, operator: rule.operator, severity: rule.severity,
          event: "cleared", alarmId: existing.id });
      }
    }
  }
  return events;
}

// ── Runtime attribute evaluator ───────────────────────────────────────────────
// After dynamic attributes are updated, fetch all "runtime" attributes for the asset,
// build a variable scope from ALL current attribute values (name → numeric value),
// evaluate each expression, and write the result back.
async function evaluateRuntimeAttributes(assetId: string, ts: Date): Promise<void> {
  // Fetch every attribute for this asset (we need values for the variable scope)
  const allAttrs = await db
    .select({ id: attributesTable.id, name: attributesTable.name, type: attributesTable.type, value: attributesTable.value, expression: attributesTable.expression })
    .from(attributesTable)
    .where(eq(attributesTable.assetId, assetId));

  // Build variable map: attribute name (spaces replaced with underscore) → number
  const vars: Record<string, number> = {};
  for (const attr of allAttrs) {
    if (attr.value == null) continue;
    const num = Number(attr.value);
    if (!isNaN(num)) {
      // Support both exact name and underscore variant so expressions work either way
      vars[attr.name] = num;
      vars[attr.name.replace(/\s+/g, "_")] = num;
      // Also strip special chars for bare identifiers
      const safe = attr.name.replace(/[^a-zA-Z0-9_]/g, "_");
      vars[safe] = num;
    }
  }

  // Evaluate each runtime attribute
  const runtimeAttrs = allAttrs.filter((a) => a.type === "runtime" && a.expression);
  for (const attr of runtimeAttrs) {
    const result = evalExpression(attr.expression!, vars);
    if (result !== null) {
      await db.update(attributesTable)
        .set({ value: result, timestamp: ts, quality: "good" })
        .where(eq(attributesTable.id, attr.id));
    } else {
      // Mark quality as bad if expression failed to evaluate (e.g. missing variable)
      await db.update(attributesTable)
        .set({ quality: "bad", timestamp: ts })
        .where(eq(attributesTable.id, attr.id));
    }
  }
}

// ── Core ingest logic ─────────────────────────────────────────────────────────
async function processNormalised(n: NormalisedPayload, assetIdHint?: string) {
  let assetId: string | null = assetIdHint ?? null;
  let assetName = n.externalAssetName ?? n.deviceId;

  if (!assetId) {
    const [asset] = await db
      .select({ id: assetsTable.id, name: assetsTable.name })
      .from(assetsTable)
      .where(eq(assetsTable.identifier, n.deviceId));
    assetId = asset?.id ?? null;
    if (asset?.name) assetName = asset.name;
  } else {
    const [asset] = await db.select({ name: assetsTable.name })
      .from(assetsTable).where(eq(assetsTable.id, assetId));
    if (asset?.name) assetName = asset.name;
  }

  const ts = n.timestamp ?? new Date();

  if (!assetId || Object.keys(n.metrics).length === 0) {
    return { recordsWritten: 0, assetId, assetName, alarmEvents: [] };
  }

  const records = Object.entries(n.metrics).map(([metric, value]) => ({
    assetId, deviceId: n.deviceId, metric, value, timestamp: ts, quality: "good",
  }));

  await db.insert(telemetryTable).values(records as any[]);

  // Update matching dynamic attributes
  for (const [metric, value] of Object.entries(n.metrics)) {
    await db.update(attributesTable)
      .set({ value, timestamp: ts })
      .where(and(
        eq(attributesTable.assetId, assetId as string),
        eq(attributesTable.tagName, `${n.deviceId}.${metric}`)
      ));
  }

  // Update sensor serial attribute
  if (n.sensorSerial) {
    await db.update(attributesTable)
      .set({ value: n.sensorSerial, timestamp: ts })
      .where(and(
        eq(attributesTable.assetId, assetId as string),
        eq(attributesTable.tagName, `${n.deviceId}.sensor_serial`)
      ));
  }

  // ── Evaluate runtime (computed) attributes ────────────────────────────────
  await evaluateRuntimeAttributes(assetId as string, ts);

  const alarmEvents = await evaluateAlarmRules(assetId as string, assetName, n.metrics, ts);

  return { recordsWritten: records.length, assetId, assetName, alarmEvents };
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.post("/ingest/payload", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const normalised = normalise(body);

  if (!normalised) {
    res.status(400).json({ error: "Missing required field: deviceId" });
    return;
  }

  const assetIdHint = typeof body.assetId === "string" ? body.assetId : undefined;
  const result = await processNormalised(normalised, assetIdHint);

  const triggered = result.alarmEvents.filter((e) => e.event === "triggered");
  const cleared   = result.alarmEvents.filter((e) => e.event === "cleared");

  res.json({
    success: true,
    recordsWritten: result.recordsWritten,
    assetId: result.assetId,
    assetName: result.assetName,
    message: `Ingested ${result.recordsWritten} metric(s)`,
    alarmsTriggered: triggered.length,
    alarmsCleared: cleared.length,
    alarmEvents: result.alarmEvents,
  });
});

router.post("/ingest/batch", async (req, res): Promise<void> => {
  const items = req.body;
  if (!Array.isArray(items)) {
    res.status(400).json({ error: "Body must be an array of payload objects" });
    return;
  }

  let successCount = 0; let failureCount = 0;
  let totalTriggered = 0; let totalCleared = 0;

  for (const item of items) {
    try {
      const n = normalise(item as Record<string, unknown>);
      if (!n) { failureCount++; continue; }
      const result = await processNormalised(n);
      totalTriggered += result.alarmEvents.filter((e) => e.event === "triggered").length;
      totalCleared   += result.alarmEvents.filter((e) => e.event === "cleared").length;
      successCount++;
    } catch {
      failureCount++;
    }
  }

  res.json({ success: failureCount === 0, totalRecords: items.length,
    successCount, failureCount,
    alarmsTriggered: totalTriggered, alarmsCleared: totalCleared });
});

router.get("/telemetry/:assetId", async (req, res): Promise<void> => {
  const params = GetTelemetryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const query = GetTelemetryQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const conditions = [eq(telemetryTable.assetId, params.data.assetId)];
  if (query.data.metric) conditions.push(eq(telemetryTable.metric, query.data.metric));
  if (query.data.from) conditions.push(gte(telemetryTable.timestamp, new Date(query.data.from as string)));
  if (query.data.to)   conditions.push(lte(telemetryTable.timestamp, new Date(query.data.to as string)));

  const records = await db.select().from(telemetryTable)
    .where(and(...conditions))
    .orderBy(desc(telemetryTable.timestamp))
    .limit(query.data.limit ?? 100);

  res.json(records);
});

export default router;
