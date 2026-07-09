import { Router, type IRouter } from "express";
import { eq, desc, and, gte, lte, count, sql } from "drizzle-orm";
import {
  db, telemetryTable, assetsTable, attributesTable,
  alarmRulesTable, alarmsTable, alarmHistoryTable,
} from "@workspace/db";
import { GetTelemetryParams, GetTelemetryQueryParams } from "@workspace/api-zod";
import { Parser } from "expr-eval";
import { broadcast } from "../lib/ws-broadcast";
import { optionalApiKeyAuth } from "../middleware/apiKeyAuth";
import { recordDevice, listSeenDevices, removeSeenDevice, pruneUnusedDevices } from "../lib/seen-devices";

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

// ── Reserved payload envelope fields (never treated as metrics) ───────────────
const ENVELOPE_FIELDS = new Set([
  "deviceId", "assetId", "timestamp", "timestampUnix", "capturedAt", "receivedAt",
  "sensor", "asset", "measurement_point", "data", "metrics",
]);

// ── Payload normaliser ────────────────────────────────────────────────────────
export interface NormalisedPayload {
  deviceId: string; timestamp?: Date;
  metrics: Record<string, unknown>;
  payloadFormat: "nested-data" | "nested-metrics" | "flat" | "nested-root" | "unknown";
  sensorSerial?: string; externalAssetName?: string; measurementPoint?: string;
}

export function normalise(body: Record<string, unknown>): NormalisedPayload | null {
  if (!body.deviceId || typeof body.deviceId !== "string") return null;
  let ts: Date | undefined;
  if (typeof body.timestampUnix === "number") ts = toDate(body.timestampUnix);
  else if (body.capturedAt) ts = new Date(body.capturedAt as string);
  else if (body.receivedAt) ts = new Date(body.receivedAt as string);
  else if (body.timestamp) {
    const raw = body.timestamp as string;
    // Normalise non-standard format: "2025-11-14 05:11:40.418-05:30" → ISO 8601
    const isoLike = raw.replace(" ", "T");
    try { ts = new Date(isoLike); } catch { ts = new Date(); }
    if (isNaN(ts.getTime())) ts = new Date();
  }

  // ── Nested {data: {...}} envelope ────────────────────────────────────────
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
    const sensor = body.sensor as Record<string, unknown> | undefined;
    const asset  = body.asset  as Record<string, unknown> | undefined;
    const mp     = body.measurement_point as Record<string, unknown> | undefined;
    return { deviceId: body.deviceId, timestamp: ts, payloadFormat: "nested-data",
      metrics: body.data as Record<string, unknown>,
      sensorSerial: sensor?.serial as string | undefined,
      externalAssetName: (asset?.name as string | undefined)?.trim(),
      measurementPoint: mp?.name as string | undefined };
  }

  // ── Nested {metrics: {...}} envelope ──────────────────────────────────────
  if (body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics)) {
    return { deviceId: body.deviceId, timestamp: ts, payloadFormat: "nested-metrics",
      metrics: body.metrics as Record<string, unknown> };
  }

  // ── Flat / nested-root payload ────────────────────────────────────────────
  // Recursively dot-flattens ANY depth of nested objects and arrays into flat
  // metric keys. Array elements are keyed by their "machine"/"name" field (else
  // index), matching how templates flatten a hierarchy, e.g. a Node-RED tree:
  //   { "Unit 1": { "Synthetic Dyeing": { "Preparation": [{ machine:"Creel Machine", powerKW:5 }] } } }
  //   → { "Unit 1.Synthetic Dyeing.Preparation.Creel Machine.powerKW": 5, ... }
  // Simple one-level payloads (chiller.energy_kWh) still flatten the same way.
  const flatMetrics: Record<string, unknown> = {};
  deepFlatten(body, "", flatMetrics);
  if (Object.keys(flatMetrics).length > 0) {
    const nested = Object.keys(flatMetrics).some((k) => k.includes("."));
    return { deviceId: body.deviceId, timestamp: ts,
      payloadFormat: nested ? "nested-root" : "flat", metrics: flatMetrics };
  }

  return { deviceId: body.deviceId, timestamp: ts, payloadFormat: "unknown", metrics: {} };
}

// Recursively flatten nested objects/arrays into dotted metric keys.
function deepFlatten(v: unknown, prefix: string, out: Record<string, unknown>): void {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (ENVELOPE_FIELDS.has(k)) continue; // skip deviceId/timestamp/sensor/… at every level
      deepFlatten(val, prefix ? `${prefix}.${k}` : k, out);
    }
  } else if (Array.isArray(v)) {
    v.forEach((item, i) => {
      const label = (item && typeof item === "object" && typeof (item as any).machine === "string" && (item as any).machine.trim())
        ? (item as any).machine
        : (item && typeof item === "object" && typeof (item as any).name === "string" && (item as any).name.trim())
          ? (item as any).name
          : String(i);
      deepFlatten(item, prefix ? `${prefix}.${label}` : label, out);
    });
  } else if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
    if (prefix) out[prefix] = v;
  }
}

// Extract per-machine records from a nested payload where each machine object
// carries its own `deviceId` (e.g. a Node-RED factory tree). Each becomes a flat
// telemetry record attributed to the asset whose identifier == that deviceId.
export function extractMachineRecords(body: unknown): { deviceId: string; timestamp?: Date; metrics: Record<string, unknown> }[] {
  const recs: { deviceId: string; timestamp?: Date; metrics: Record<string, unknown> }[] = [];
  function walk(v: unknown) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && !Array.isArray(item) && typeof (item as any).deviceId === "string") {
          const o = item as Record<string, unknown>;
          const metrics: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(o)) {
            if (k === "deviceId" || k === "machine" || ENVELOPE_FIELDS.has(k)) continue;
            if (val != null && typeof val !== "object") metrics[k] = val;
          }
          let ts: Date | undefined;
          if (typeof o.timestamp === "string") { const d = new Date((o.timestamp as string).replace(" ", "T")); if (!isNaN(d.getTime())) ts = d; }
          recs.push({ deviceId: o.deviceId as string, timestamp: ts, metrics });
        } else walk(item);
      }
    } else if (v && typeof v === "object") {
      for (const val of Object.values(v as Record<string, unknown>)) walk(val);
    }
  }
  walk(body);
  return recs;
}

// Extract per-machine records from a nested tree keyed by NAME (not per-machine
// deviceId). Each leaf machine object (has a `machine` field) yields its metrics
// plus the name path to it, e.g.
//   { "Unit 1": { "Synthetic Dyeing": { "Drying": [{ machine:"RF Dryer", powerKW:8.85 }] } } }
//   → { namePath: ["Unit 1","Synthetic Dyeing","Drying","RF Dryer"], metrics: { powerKW:8.85, … } }
// Used by the single-device model: the whole tree belongs to the root device, and
// each machine's slice is attributed to the asset resolved by this name path.
export function extractMachineRecordsByName(body: unknown): { namePath: string[]; metrics: Record<string, unknown> }[] {
  const out: { namePath: string[]; metrics: Record<string, unknown> }[] = [];
  function walk(v: unknown, path: string[]): void {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const o = item as Record<string, unknown>;
          const machine = typeof o.machine === "string" && o.machine.trim() ? o.machine.trim() : null;
          if (machine) {
            const metrics: Record<string, unknown> = {};
            for (const [k, val] of Object.entries(o)) {
              if (k === "deviceId" || k === "machine" || ENVELOPE_FIELDS.has(k)) continue;
              if (val != null && typeof val !== "object") metrics[k] = val;
            }
            out.push({ namePath: [...path, machine], metrics });
          } else walk(o, path);
        }
      }
    } else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (ENVELOPE_FIELDS.has(k)) continue;
        walk(val, [...path, k]);
      }
    }
  }
  walk(body, []);
  return out;
}

// Recognised hierarchy-level columns (mirrors the Hierarchy Generator). Only these
// nest; categorical metrics (status, operatorShift, …) stay as metrics.
const LEVEL_SET = new Set([
  "enterprise", "company", "organization", "org", "corporation", "group",
  "site", "campus", "facility", "location", "region",
  "plant", "factory", "building", "fab", "block",
  "area", "zone", "workshop", "shop", "cleanroom", "room", "bay",
  "unit", "department", "dept", "division", "section",
  "line", "cell", "station",
  "process", "processmodule", "module", "manufacturingstep", "step", "stage",
  "subprocess", "sub_process", "substep",
]);

function rowLevelKeys(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter((k) =>
    LEVEL_SET.has(k.toLowerCase()) && typeof row[k] === "string" && (row[k] as string).trim());
}
function leafNameOf(row: Record<string, unknown>): string {
  const idKey = Object.keys(row).find((k) => k.toLowerCase() === "machineid" || k.toLowerCase() === "machine_id");
  if (idKey && typeof row[idKey] === "string" && (row[idKey] as string).trim()) return (row[idKey] as string).trim();
  if (typeof row.machine === "string" && row.machine.trim()) return row.machine.trim();
  return "Machine";
}
function objLevelPath(obj: Record<string, unknown>): string[] {
  return Object.keys(obj)
    .filter((k) => LEVEL_SET.has(k.toLowerCase()) && typeof obj[k] === "string" && (obj[k] as string).trim())
    .map((k) => (obj[k] as string).trim());
}

// Extract per-machine records from FLAT rows (a top-level array, or an object that
// wraps a rows array, e.g. { enterprise, site, machines:[…] }). Level columns +
// wrapping-object levels form the name path; the leaf is the MachineId. Mirrors the
// Hierarchy Generator's parseFlatRows so telemetry lands on the generated assets.
export function extractFlatRowRecords(body: unknown): { namePath: string[]; metrics: Record<string, unknown> }[] {
  let rows: unknown[] | null = null;
  let prefix: string[] = [];
  const looksLikeRows = (v: unknown): v is Record<string, unknown>[] =>
    Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === "object" && !Array.isArray(r) && typeof (r as any).machine === "string");

  if (looksLikeRows(body)) {
    rows = body;
  } else if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (ENVELOPE_FIELDS.has(k)) continue;
      if (looksLikeRows(v)) { rows = v; prefix = objLevelPath(body as Record<string, unknown>); break; }
    }
  }
  if (!rows) return [];

  const out: { namePath: string[]; metrics: Record<string, unknown> }[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const levelKeys = rowLevelKeys(row);
    const namePath = [...prefix, ...levelKeys.map((k) => (row[k] as string).trim()), leafNameOf(row)];
    const metrics: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(row)) {
      const lk = k.toLowerCase();
      if (lk === "machine" || lk === "name" || lk === "machineid" || lk === "machine_id" || ENVELOPE_FIELDS.has(k) || levelKeys.includes(k)) continue;
      if (val != null && typeof val !== "object") metrics[k] = val;
    }
    out.push({ namePath, metrics });
  }
  return out;
}

// Resolve an asset id by walking a name path down from a root asset.
function resolveAssetByPath(
  rootId: string, names: string[], childrenOf: Map<string | null, { id: string; name: string }[]>
): string | null {
  let cur = rootId;
  for (const name of names) {
    const kids = childrenOf.get(cur) ?? [];
    const match = kids.find((k) => k.name === name);
    if (!match) return null;
    cur = match.id;
  }
  return cur;
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

  // Resolve a metric value: try exact key first, then strip the first dot-segment
  // (asset-identifier prefix). Rules stored as "testing.grid.consumed_kWh" still match
  // normalised metric keys like "grid.consumed_kWh".
  function resolveMetric(map: Record<string, unknown>, key: string): unknown {
    const v = map[key];
    if (v !== undefined) return v;
    const dot = key.indexOf(".");
    return dot > 0 ? map[key.slice(dot + 1)] : undefined;
  }
  function resolvePrev(map: Record<string, { value: number; ts: Date }>, key: string) {
    const v = map[key];
    if (v !== undefined) return v;
    const dot = key.indexOf(".");
    return dot > 0 ? map[key.slice(dot + 1)] : undefined;
  }

  for (const rule of rules) {
    if (rule.assetId && rule.assetId !== assetId) continue;
    if (!rule.metric || !rule.operator || rule.threshold == null) continue;

    let effectiveValue: number | null = null;

    if (rule.alarmType === "threshold") {
      const raw = resolveMetric(metrics, rule.metric);
      if (raw === undefined) continue;
      effectiveValue = Number(raw);
      if (isNaN(effectiveValue)) continue;
    } else if (rule.alarmType === "rate_of_change") {
      const raw = resolveMetric(metrics, rule.metric);
      if (raw === undefined) continue;
      const newVal = Number(raw);
      if (isNaN(newVal)) continue;
      const prev = resolvePrev(prevMetrics, rule.metric);
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

  let isInMaintenance = false;
  if (!assetId) {
    const [asset] = await db.select({ id: assetsTable.id, name: assetsTable.name, maintenanceMode: assetsTable.maintenanceMode })
      .from(assetsTable).where(eq(assetsTable.identifier, n.deviceId));
    assetId = asset?.id ?? null;
    if (asset?.name) assetName = asset.name;
    if (asset?.maintenanceMode) isInMaintenance = true;
  } else {
    const [asset] = await db.select({ name: assetsTable.name, maintenanceMode: assetsTable.maintenanceMode }).from(assetsTable).where(eq(assetsTable.id, assetId));
    if (asset?.name) assetName = asset.name;
    if (asset?.maintenanceMode) isInMaintenance = true;
  }

  const ts = n.timestamp ?? new Date();
  // Remember every deviceId we receive (even unmatched) so the UI can offer real
  // device ids and asset creation can validate against transmitting devices.
  recordDevice(n.deviceId, !!assetId);
  // Do NOT auto-create assets. Telemetry is only stored when its deviceId matches
  // an existing asset's identifier; unknown deviceIds are ignored (no asset created).
  if (!assetId) {
    return { recordsWritten: 0, assetId: null, assetName, alarmEvents: [] };
  }
  if (Object.keys(n.metrics).length === 0) {
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

  // Update dynamic attributes — match either the full "deviceId.metric" tag OR the
  // bare metric name (case-insensitive; telemetry keys are camelCase, tagNames lower).
  // Safe because the caller (/ingest/payload) only reaches this after the payload's
  // root deviceId matched an asset — wrong device id ⇒ no asset ⇒ no values.
  for (const [metric, value] of Object.entries(n.metrics)) {
    const full = `${n.deviceId}.${metric}`.toLowerCase();
    const bare = metric.toLowerCase();
    await db.update(attributesTable).set({ value, timestamp: ts })
      .where(and(
        eq(attributesTable.assetId, assetId as string),
        sql`(lower(${attributesTable.tagName}) = ${full} OR lower(${attributesTable.tagName}) = ${bare})`,
      ));
    // Secondary: explicit sourceMetric remapping (attribute.sourceMetric = "energy_meter_kwh")
    await db.update(attributesTable).set({ value, timestamp: ts })
      .where(and(eq(attributesTable.assetId, assetId as string), sql`lower(${attributesTable.sourceMetric}) = ${metric.toLowerCase()}`));
  }
  if (n.sensorSerial) {
    await db.update(attributesTable).set({ value: n.sensorSerial, timestamp: ts })
      .where(and(eq(attributesTable.assetId, assetId as string), eq(attributesTable.tagName, `${n.deviceId}.sensor_serial`)));
  }

  // Evaluate runtime (computed) attributes
  await evaluateRuntimeAttributes(assetId as string, ts);

  // Evaluate alarm rules — skip when asset is in maintenance mode
  const alarmEvents = isInMaintenance
    ? []
    : await evaluateAlarmRules(assetId as string, assetName, n.metrics, prevMetrics, ts);

  broadcast("telemetry", {
    assetId,
    assetName,
    metrics: n.metrics,
    timestamp: ts.toISOString(),
  });

  for (const ev of alarmEvents) {
    broadcast("alarm", {
      event:     ev.event,
      alarmId:   ev.alarmId,
      ruleName:  ev.ruleName,
      metric:    ev.metric,
      value:     ev.value,
      threshold: ev.threshold,
      operator:  ev.operator,
      severity:  ev.severity,
      assetId,
      assetName,
      timestamp: ts.toISOString(),
    });
  }

  return { recordsWritten: records.length, assetId, assetName, alarmEvents };
}

// ── Seen devices (deviceIds received in telemetry, even if unmatched) ─────────
router.get("/ingest/seen-devices", (_req, res): void => {
  res.json(listSeenDevices().map((d) => ({ ...d, lastSeen: d.lastSeen.toISOString() })));
});

// Register a deviceId as a known device WITHOUT telemetry — used when a device
// payload is pasted into a template, so the id becomes selectable for assets.
router.post("/ingest/register-device", (req, res): void => {
  const deviceId = (req.body?.deviceId ?? "").toString().trim();
  if (!deviceId) { res.status(400).json({ error: "deviceId required" }); return; }
  recordDevice(deviceId, false);
  res.json({ ok: true, deviceId });
});

// Remove one stale device id.
router.delete("/ingest/seen-devices/:deviceId", async (req, res): Promise<void> => {
  await removeSeenDevice(req.params.deviceId);
  res.json({ ok: true });
});

// Prune all device ids not bound to an existing asset (clears old/test ids).
router.post("/ingest/seen-devices/prune", async (_req, res): Promise<void> => {
  const removed = await pruneUnusedDevices();
  res.json({ ok: true, removed });
});

// ── Validate (dry-run) endpoint ───────────────────────────────────────────────
router.post("/ingest/validate", optionalApiKeyAuth("ingest:write"), async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const warnings: string[] = [];

  if (!body.deviceId || typeof body.deviceId !== "string") {
    res.json({ valid: false, assetMatched: false, metricCount: 0,
      warnings: ["Missing required field: deviceId"], extractedMetrics: {}, payloadFormat: "unknown" });
    return;
  }

  const n = normalise(body);
  if (!n) {
    res.json({ valid: false, deviceId: body.deviceId, assetMatched: false,
      metricCount: 0, warnings: ["Payload could not be normalised"], extractedMetrics: {}, payloadFormat: "unknown" });
    return;
  }

  // Lookup asset
  const [asset] = await db.select({ id: assetsTable.id, name: assetsTable.name })
    .from(assetsTable).where(eq(assetsTable.identifier, n.deviceId));

  const metricCount = Object.keys(n.metrics).length;
  if (!asset) warnings.push(`No asset found with identifier="${n.deviceId}". Telemetry will be discarded until the asset is created.`);
  if (metricCount === 0) warnings.push("No metrics extracted — check payload format and envelope fields.");
  if (n.payloadFormat === "unknown") warnings.push("Payload format unrecognised (no data, metrics, or flat metric fields found).");

  res.json({
    valid: !!asset && Object.keys(n.metrics).length > 0,
    deviceId: n.deviceId,
    assetId: asset?.id ?? null,
    assetName: asset?.name ?? null,
    assetMatched: !!asset,
    timestamp: n.timestamp?.toISOString() ?? null,
    payloadFormat: n.payloadFormat,
    extractedMetrics: n.metrics,
    metricCount,
    warnings,
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
router.post("/ingest/payload", optionalApiKeyAuth("ingest:write"), async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  // Single-device model: the whole tree is attributed to the top-level deviceId
  // (e.g. "testing" = the root). normalise() deep-flattens the nested tree into
  // dotted metric keys; per-machine views resolve their slice by name.
  const normalised = normalise(body);
  if (!normalised) {
    if (Array.isArray(req.body) && req.body.length > 0) {
      const item = req.body[req.body.length - 1] as Record<string, unknown>;
      const fallback = normalise(item);
      if (fallback) {
        const assetIdHint = typeof item.assetId === "string" ? item.assetId : undefined;
        const result = await processNormalised(fallback, assetIdHint);
        const triggered = result.alarmEvents.filter((e) => e.event === "triggered");
        const cleared   = result.alarmEvents.filter((e) => e.event === "cleared");
        res.json({ success: true, recordsWritten: result.recordsWritten, assetId: result.assetId,
          assetName: result.assetName, message: `Ingested ${result.recordsWritten} metric(s)`,
          alarmsTriggered: triggered.length, alarmsCleared: cleared.length, alarmEvents: result.alarmEvents });
        return;
      }
    }
    res.status(400).json({ error: "Missing required field: deviceId" });
    return;
  }
  const assetIdHint = typeof body.assetId === "string" ? body.assetId : undefined;
  // 1) Attribute the whole flattened tree to the root device owner (identifier ==
  //    payload deviceId). By-Asset dashboards read these dotted keys and filter by name.
  const result = await processNormalised(normalised, assetIdHint);

  // 2) Distribute each machine's own slice to its asset, resolved by NAME path under
  //    the root. This populates every machine's own Attributes/Telemetry. Gated on the
  //    root device having matched an asset — a wrong root device id ⇒ no root asset ⇒
  //    nothing distributed (no values anywhere), which is the intended behaviour.
  let machinesAttributed = 0;
  if (result.assetId) {
    // Prefer flat-row extraction (array / {…,machines:[…]} with level columns +
    // MachineId leaves); fall back to the nested name-tree walker.
    const flatRecs = extractFlatRowRecords(body);
    const recs = flatRecs.length > 0 ? flatRecs : extractMachineRecordsByName(body);
    if (recs.length > 0) {
      const all = await db.select({ id: assetsTable.id, name: assetsTable.name, parentId: assetsTable.parentId }).from(assetsTable);
      const childrenOf = new Map<string | null, { id: string; name: string }[]>();
      for (const a of all) {
        const arr = childrenOf.get(a.parentId) ?? [];
        arr.push({ id: a.id, name: a.name });
        childrenOf.set(a.parentId, arr);
      }
      for (const rec of recs) {
        const machineAssetId = resolveAssetByPath(result.assetId, rec.namePath, childrenOf);
        if (!machineAssetId) continue;
        await processNormalised(
          { deviceId: normalised.deviceId, timestamp: normalised.timestamp, metrics: rec.metrics, payloadFormat: "flat" },
          machineAssetId,
        );
        machinesAttributed++;
      }
    }
  }

  const triggered = result.alarmEvents.filter((e) => e.event === "triggered");
  const cleared   = result.alarmEvents.filter((e) => e.event === "cleared");
  res.json({ success: true, recordsWritten: result.recordsWritten, assetId: result.assetId,
    assetName: result.assetName, machinesAttributed,
    message: `Ingested ${result.recordsWritten} metric(s); ${machinesAttributed} machine(s) attributed`,
    alarmsTriggered: triggered.length, alarmsCleared: cleared.length, alarmEvents: result.alarmEvents });
});

router.post("/ingest/batch", optionalApiKeyAuth("ingest:write"), async (req, res): Promise<void> => {
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

// ── Distinct metrics for an asset (for widget dialog when no attributes exist) ─
router.get("/telemetry/:assetId/metrics", async (req, res): Promise<void> => {
  const { assetId } = req.params;
  const rows = await db
    .selectDistinct({ metric: telemetryTable.metric })
    .from(telemetryTable)
    .where(eq(telemetryTable.assetId, assetId))
    .orderBy(telemetryTable.metric);
  res.json(rows.map((r) => r.metric));
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
