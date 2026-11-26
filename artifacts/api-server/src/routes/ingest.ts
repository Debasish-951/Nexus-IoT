import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { respondInvalid } from "../lib/respond";
import { eq, desc, and, gte, lte, count, sql, inArray } from "drizzle-orm";
import {
  db, telemetryTable, assetsTable, attributesTable,
  alarmRulesTable, alarmsTable, alarmHistoryTable,
} from "@workspace/db";
import { GetTelemetryParams, GetTelemetryQueryParams } from "@workspace/api-zod";
import { Parser } from "expr-eval-fork";
import { broadcast } from "../lib/ws-broadcast";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { recordDevice, listSeenDevices, removeSeenDevice, pruneUnusedDevices } from "../lib/seen-devices";
import { assertSafeOutboundUrl, safeFetch } from "../lib/outbound-url";
import { logger } from "../lib/logger";
import { ingestScope, recordIngestOutOfScope } from "../lib/project-access";
import { csvCell } from "../lib/validation";
import { forwardToDestinations } from "./destinations";
import { emitLater } from "../lib/integration/events";

const router: IRouter = Router();

// ── Safe expression parser ────────────────────────────────────────────────────
//
// `expr-eval-fork`, not `expr-eval`. The original was last published in June
// 2022 and carries two HIGH advisories with NO fix available:
//
//   GHSA-jc85-fpwf-qm7x  CWE-94   arbitrary code execution via a crafted
//                                 variables object passed to evaluate()
//   GHSA-8gw3-rxh4-v6jx  CWE-1321 prototype pollution
//
// Both are reachable here. `vars` below is keyed by ATTRIBUTE NAME and the
// expression itself is user-authored, so anyone who can create a runtime
// attribute could reach the evaluator — turning "may edit assets" into code
// execution on the API host. The fork is the resolution named in the advisory
// and is actively maintained.
//
// `allowMemberAccess: false` is the important addition, and the reason the fork
// exists: without it an expression can walk `constructor.constructor(...)` to
// reach the Function constructor. Nothing in a numeric sensor expression needs
// member access, so removing it costs nothing and closes the escape.
const exprParser = new Parser({
  allowMemberAccess: false,
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

/** How far ahead of the server clock a device timestamp may be before it is distrusted. */
const MAX_CLOCK_AHEAD_MS = 5 * 60 * 1000;

/**
 * Read a device clock field. Accepts epoch seconds or milliseconds (number or
 * numeric string) and ISO-like strings, including "2025-11-14 05:11:40.418-05:30".
 * Returns undefined for anything unusable, and for a time more than five minutes
 * in the future, so the caller falls back to server time.
 *
 * A number used to reach `raw.replace` and throw outside any try block, which
 * turned every reading from an epoch-clock device into a 500 (HTTP) or a dropped
 * message (MQTT). A future-dated reading would also stay "latest" for ever and
 * make the next real reading look out of order.
 */
export function parseClock(v: unknown): Date | undefined {
  let d: Date | undefined;
  if (typeof v === "number" && Number.isFinite(v)) d = toDate(v);
  else if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    d = /^\d+(\.\d+)?$/.test(s) ? toDate(Number(s)) : new Date(s.replace(" ", "T"));
  }
  if (!d || Number.isNaN(d.getTime())) return undefined;
  if (d.getTime() > Date.now() + MAX_CLOCK_AHEAD_MS) return undefined;
  return d;
}

// ── Reserved payload envelope fields (never treated as metrics) ───────────────
const ENVELOPE_FIELDS = new Set([
  "deviceId", "assetId", "timestamp", "timestampUnix", "capturedAt", "receivedAt",
  "sensor", "asset", "measurement_point", "data", "metrics",
]);

/**
 * Keys that are structure, not readings — never metrics, at any depth.
 *
 * Split out from ENVELOPE_FIELDS because the clock fields below are envelope only at the
 * ROOT: `timestamp` inside a machine object is that machine's own reading, and the
 * platform's job is to deliver what the payload contains, not to decide it is redundant.
 */
const STRUCTURAL_FIELDS = new Set([
  "deviceId", "assetId", "sensor", "asset", "measurement_point", "data", "metrics",
]);
// NOTE: the clock fields are NOT excluded anywhere. normalise() reads them to stamp the
// record, and they are ALSO passed through as metrics — a payload key the platform keeps
// to itself is a key the user cannot bind an attribute to.

// ── Payload normaliser ────────────────────────────────────────────────────────
export interface NormalisedPayload {
  deviceId: string; timestamp?: Date;
  metrics: Record<string, unknown>;
  payloadFormat: "nested-data" | "nested-metrics" | "flat" | "nested-root" | "unknown";
  sensorSerial?: string; externalAssetName?: string; measurementPoint?: string;
}

export function normalise(body: Record<string, unknown>): NormalisedPayload | null {
  if (!body.deviceId || typeof body.deviceId !== "string") return null;
  // First usable clock field wins; none usable means server time (set later).
  const ts = parseClock(body.timestampUnix) ?? parseClock(body.capturedAt)
    ?? parseClock(body.receivedAt) ?? parseClock(body.timestamp);

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
      // Only structure is skipped — the wrappers whose CONTENTS are flattened anyway, and
      // deviceId, which is the binding itself. Every actual reading in the payload comes
      // through as a metric, including timestamps and `machine`, at any depth.
      if (STRUCTURAL_FIELDS.has(k)) continue;
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

// Hierarchy-level detection mirrors the Hierarchy Generator: BLACKLIST, not
// whitelist. Any string column is a level EXCEPT known categorical metrics, the
// leaf fields (machine/MachineId), and envelope fields. Numbers are never levels.
const NON_LEVEL = new Set([
  "machine", "name", "machineid", "machine_id",
  "status", "state", "mode", "runstate", "machinestatus", "alarmstate",
  "operatorshift", "shift", "operator",
  "batchid", "batch_id", "batchno", "batchnumber", "lot", "lotno", "lotnumber",
  "quality", "grade", "health", "condition", "direction",
  "uom", "unit_of_measure", "recipe", "sku", "color", "colour",
  "description", "note", "notes", "label", "comment", "remark",
]);
function isLevelKV(k: string, v: unknown): boolean {
  const lk = k.toLowerCase();
  return typeof v === "string" && (v as string).trim().length > 0 && !NON_LEVEL.has(lk) && !ENVELOPE_FIELDS.has(k);
}

function rowLevelKeys(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter((k) => isLevelKV(k, row[k]));
}
function leafNameOf(row: Record<string, unknown>): string {
  const idKey = Object.keys(row).find((k) => k.toLowerCase() === "machineid" || k.toLowerCase() === "machine_id");
  if (idKey && typeof row[idKey] === "string" && (row[idKey] as string).trim()) return (row[idKey] as string).trim();
  if (typeof row.machine === "string" && row.machine.trim()) return row.machine.trim();
  return "Machine";
}
function objLevelPath(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => isLevelKV(k, obj[k])).map((k) => (obj[k] as string).trim());
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

// ── Numeric readings ──────────────────────────────────────────────────────────

/**
 * A reading as a number, or null when it is not one.
 *
 * `Number(x)` was used everywhere, and `Number("")`, `Number("  ")` and
 * `Number(null)` are all 0: a sensor sending a blank field read as a real zero,
 * tripping low-limit alarms and producing huge rates of change. Only finite
 * numbers, numeric strings and booleans (as 1/0) count.
 */
export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A reading that carries no value at all. Stored, but marked quality "bad". */
export function isBlankReading(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
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
/**
 * Fire an alarm webhook.
 *
 * Still non-blocking — ingest must not stall behind someone's slow endpoint —
 * but no longer SILENT. Every failure used to be swallowed whole, so a webhook
 * with a typo in its URL failed forever and nobody was told; the rule looked
 * configured and simply never delivered. Failures now reach the log with the
 * rule and the status, which is what makes them diagnosable.
 *
 * The URL is re-checked at call time, not only when the rule was saved: a rule
 * written before this guard existed, or edited straight in the database, must
 * not get a free pass to the metadata endpoint.
 */
async function fireWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    assertSafeOutboundUrl(url);
  } catch (err) {
    logger.warn({ url, err: (err as Error).message }, "Alarm webhook blocked: unsafe target");
    return;
  }

  try {
    const res = await safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "Alarm webhook rejected by the receiver");
    }
  } catch (err) {
    // A timeout, DNS failure or connection refusal. Logged, never rethrown —
    // the caller is fire-and-forget by design.
    logger.warn({ url, err: (err as Error).message }, "Alarm webhook delivery failed");
  }
}

// ── Alarm rule evaluation (threshold + rate-of-change) ────────────────────────
/** The newest stored reading of a metric. `value` is null when it was not a number. */
export interface PrevReading { value: number | null; ts: Date }

interface AlarmEvent {
  ruleId: string; ruleName: string; metric: string;
  value: number; threshold: number | null; operator: string | null;
  severity: string; event: "triggered" | "cleared"; alarmId: string;
  webhookUrl: string | null; webhookEnabled: boolean;
}

/**
 * When each rule's condition started being met (on) or stopped being met (off), by
 * rule and asset. In memory because the API is a single process. A restart only
 * restarts a running delay, which at worst postpones one alarm by the delay.
 */
const pendingOn = new Map<string, number>();
const pendingOff = new Map<string, number>();

/** Drop any running On/Off delay for an asset, when maintenance mode starts or ends. */
export function forgetAssetDelays(assetId: string): void {
  for (const map of [pendingOn, pendingOff]) {
    for (const key of map.keys()) if (key.endsWith(`|${assetId}`)) map.delete(key);
  }
}

/** Drop any running On/Off delay for a rule, after it is disabled, changed or deleted. */
export function forgetRuleDelays(ruleId: string): void {
  for (const map of [pendingOn, pendingOff]) {
    for (const key of map.keys()) if (key.startsWith(`${ruleId}|`)) map.delete(key);
  }
  invalidateAlarmRuleCache();
}

// ── Enabled-rule cache ────────────────────────────────────────────────────────
//
// Every message used to read the whole alarm_rules table. Rules change rarely,
// so the enabled set is kept for a few seconds. Anything that creates, edits,
// enables, disables or deletes a rule should call invalidateAlarmRuleCache();
// the TTL bounds how stale it can be if a caller forgets.
type AlarmRuleRow = typeof alarmRulesTable.$inferSelect;
const RULE_CACHE_TTL_MS = 5_000;
let ruleCache: { at: number; rules: Promise<AlarmRuleRow[]> } | null = null;

export function invalidateAlarmRuleCache(): void {
  ruleCache = null;
}

async function enabledAlarmRules(): Promise<AlarmRuleRow[]> {
  const now = Date.now();
  if (!ruleCache || now - ruleCache.at > RULE_CACHE_TTL_MS) {
    const rules = (async () => db.select().from(alarmRulesTable).where(eq(alarmRulesTable.enabled, true)))();
    const entry = { at: now, rules };
    ruleCache = entry;
    // A failed read must not be served from the cache for the next five seconds.
    rules.catch(() => { if (ruleCache === entry) ruleCache = null; });
  }
  return ruleCache.rules;
}

/** True once a condition has held for the whole delay. Measured in payload time. */
function delayElapsed(pending: Map<string, number>, key: string, seconds: number | null, ts: Date): boolean {
  if (!seconds || seconds <= 0) { pending.delete(key); return true; }
  const start = pending.get(key);
  if (start === undefined) { pending.set(key, ts.getTime()); return false; }
  if (ts.getTime() - start < seconds * 1000) return false;
  pending.delete(key);
  return true;
}

export async function evaluateAlarmRules(
  assetId: string, assetName: string,
  metrics: Record<string, unknown>,
  prevMetrics: Record<string, PrevReading>,
  ts: Date
): Promise<AlarmEvent[]> {
  const events: AlarmEvent[] = [];
  const allRules = await enabledAlarmRules();

  // Resolve a metric value: try exact key first, then strip the first dot-segment
  // (asset-identifier prefix). Rules stored as "testing.grid.consumed_kWh" still match
  // normalised metric keys like "grid.consumed_kWh".
  function resolveMetric(map: Record<string, unknown>, key: string): unknown {
    const v = map[key];
    if (v !== undefined) return v;
    const dot = key.indexOf(".");
    return dot > 0 ? map[key.slice(dot + 1)] : undefined;
  }
  function resolvePrev(map: Record<string, PrevReading>, key: string) {
    const v = map[key];
    if (v !== undefined) return v;
    const dot = key.indexOf(".");
    return dot > 0 ? map[key.slice(dot + 1)] : undefined;
  }

  // Only rules that can apply to this message. Nothing to evaluate means no
  // open-alarm lookup either.
  const rules = allRules.filter((rule) =>
    (!rule.assetId || rule.assetId === assetId)
    && rule.metric && rule.operator && rule.threshold != null
    && resolveMetric(metrics, rule.metric) !== undefined);
  if (rules.length === 0) return events;

  // This asset's open alarms, read once rather than once per rule.
  //
  // An acknowledged alarm is still open: the condition must clear before the rule
  // can raise a new one, or acknowledging would immediately re-fire it.
  //
  // Open alarms are per rule AND asset. A rule with no asset applies to every
  // asset, and keying on the rule alone let one asset's normal reading clear
  // another asset's alarm, and hid a second asset's breach.
  const openRows = await db.select({ id: alarmsTable.id, ruleId: alarmsTable.ruleId }).from(alarmsTable)
    .where(and(
      eq(alarmsTable.assetId, assetId),
      inArray(alarmsTable.status, ["active", "acknowledged"]),
    ));
  const openByRule = new Map<string, string>();
  for (const row of openRows) if (row.ruleId) openByRule.set(row.ruleId, row.id);

  for (const rule of rules) {
    if (!rule.metric || !rule.operator || rule.threshold == null) continue;

    // A reading older than the newest one already stored (a gateway flushing its
    // buffer after an outage) must not decide alarm state: it would clear an alarm
    // that is still real, or produce a huge rate of change from a negative time step.
    const latest = resolvePrev(prevMetrics, rule.metric);
    if (latest && ts.getTime() <= latest.ts.getTime()) continue;

    let effectiveValue: number | null = null;

    // Blank or non-numeric readings are skipped, never evaluated as 0.
    if (rule.alarmType === "threshold") {
      effectiveValue = toNum(resolveMetric(metrics, rule.metric));
      if (effectiveValue === null) continue;
    } else if (rule.alarmType === "rate_of_change") {
      const newVal = toNum(resolveMetric(metrics, rule.metric));
      if (newVal === null) continue;
      // The previous reading must be a number too: a blank one is not a zero.
      const prev = latest;
      if (!prev || prev.value === null) continue;
      const deltaSeconds = (ts.getTime() - prev.ts.getTime()) / 1000;
      if (!(deltaSeconds > 0)) continue;
      effectiveValue = Math.abs((newVal - prev.value) / deltaSeconds);
      if (!Number.isFinite(effectiveValue)) continue;
    } else {
      continue; // other types not yet evaluated here
    }

    if (effectiveValue === null) continue;
    const conditionMet = evalOp(effectiveValue, rule.operator, rule.threshold);

    // The delays stop a value hovering around its limit from opening and clearing
    // alarms repeatedly. The opposite timer resets whenever the condition flips.
    const delayKey = `${rule.id}|${assetId}`;
    (conditionMet ? pendingOff : pendingOn).delete(delayKey);

    const existingId = openByRule.get(rule.id);
    const existing = existingId ? { id: existingId } : undefined;

    if (conditionMet && !existing) {
      if (!delayElapsed(pendingOn, delayKey, rule.onDelay, ts)) continue;
      // The unique index decides the race between concurrent payloads. Only the
      // winner gets a row back, so history and webhooks fire once per alarm.
      const [newAlarm] = await db.insert(alarmsTable).values({
        name: rule.name, assetId, assetName, ruleId: rule.id,
        severity: rule.severity, status: "active", alarmClass: rule.alarmType,
        message: `${rule.metric} ${rule.operator} ${rule.threshold} (value: ${effectiveValue.toFixed(4)})`,
        triggerValue: effectiveValue, triggeredAt: ts,
      }).onConflictDoNothing().returning();
      if (!newAlarm) continue;
      await db.insert(alarmHistoryTable).values({
        alarmId: newAlarm.id, assetId, assetName, name: rule.name,
        severity: rule.severity, status: "active", triggeredAt: ts,
      });
      events.push({ ruleId: rule.id, ruleName: rule.name, metric: rule.metric,
        value: effectiveValue, threshold: rule.threshold, operator: rule.operator,
        severity: rule.severity, event: "triggered", alarmId: newAlarm.id,
        webhookUrl: rule.webhookUrl ?? null, webhookEnabled: rule.webhookEnabled });
    } else if (!conditionMet && existing) {
      // The value must move past the limit by the deadband before the alarm clears:
      // below threshold - deadband for a high limit, above threshold + deadband for
      // a low limit. Subtracting for every operator made low-limit deadbands do nothing.
      const deadband = rule.deadband ?? 0;
      const lowLimit = rule.operator === "lt" || rule.operator === "lte";
      const highLimit = rule.operator === "gt" || rule.operator === "gte";
      const clearOk = deadband === 0 || !(lowLimit || highLimit)
        ? true
        : !evalOp(effectiveValue, rule.operator, lowLimit ? rule.threshold + deadband : rule.threshold - deadband);
      if (!clearOk) pendingOff.delete(delayKey);
      if (clearOk && delayElapsed(pendingOff, delayKey, rule.offDelay, ts)) {
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

// ── Attribute updates ─────────────────────────────────────────────────────────

interface AttrRow {
  id: string; name: string; type: string; value: unknown; expression: string | null;
  tagName: string | null; sourceMetric: string | null;
}

/** Every attribute of the given assets, in one query, grouped by asset. */
async function loadAttributes(assetIds: string[]): Promise<Map<string, AttrRow[]>> {
  const byAsset = new Map<string, AttrRow[]>();
  for (const id of assetIds) byAsset.set(id, []);
  if (assetIds.length === 0) return byAsset;
  const rows = await db.select({
    id: attributesTable.id, assetId: attributesTable.assetId, name: attributesTable.name,
    type: attributesTable.type, value: attributesTable.value, expression: attributesTable.expression,
    tagName: attributesTable.tagName, sourceMetric: attributesTable.sourceMetric,
  }).from(attributesTable).where(inArray(attributesTable.assetId, assetIds));
  for (const { assetId, ...row } of rows) byAsset.get(assetId)?.push(row);
  return byAsset;
}

/**
 * Which attribute receives which value from one message. Same rules as the
 * per-metric UPDATEs this replaces, applied in the same order so the last match
 * wins: the full "deviceId.metric" tag or the bare metric (case-insensitive),
 * then an explicit `sourceMetric` remap, then the sensor serial.
 */
export function assignAttributeValues(
  attrs: Pick<AttrRow, "id" | "tagName" | "sourceMetric">[],
  deviceId: string, metrics: Record<string, unknown>, sensorSerial?: string,
): Map<string, unknown> {
  const byTag = new Map<string, string[]>();
  const bySource = new Map<string, string[]>();
  for (const a of attrs) {
    if (a.tagName) {
      const k = a.tagName.toLowerCase();
      byTag.set(k, [...(byTag.get(k) ?? []), a.id]);
    }
    if (a.sourceMetric) {
      const k = a.sourceMetric.toLowerCase();
      bySource.set(k, [...(bySource.get(k) ?? []), a.id]);
    }
  }
  const out = new Map<string, unknown>();
  for (const [metric, value] of Object.entries(metrics)) {
    const full = `${deviceId}.${metric}`.toLowerCase();
    const bare = metric.toLowerCase();
    const tagged = new Set([...(byTag.get(full) ?? []), ...(byTag.get(bare) ?? [])]);
    for (const id of tagged) out.set(id, value);
    for (const id of bySource.get(bare) ?? []) out.set(id, value);
  }
  if (sensorSerial) {
    for (const a of attrs) if (a.tagName === `${deviceId}.sensor_serial`) out.set(a.id, sensorSerial);
  }
  return out;
}

/**
 * Write the assigned values in ONE statement. A late reading must not overwrite
 * a newer value already shown, so attributes stamped after `ts` are skipped.
 * Returns the ids actually updated.
 */
async function writeAttributeValues(assigned: Map<string, unknown>, ts: Date): Promise<Set<string>> {
  if (assigned.size === 0) return new Set();
  const values = [...assigned].map(([id, value]) =>
    sql`(${id}::uuid, ${value === null || value === undefined ? null : JSON.stringify(value)}::jsonb, ${isBlankReading(value) ? "bad" : "good"}::text)`);
  const result = await db.execute<{ id: string }>(sql`
    UPDATE attributes AS a
    SET value = v.val, "timestamp" = ${ts}, quality = v.q
    FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, val, q)
    WHERE a.id = v.id AND (a."timestamp" IS NULL OR a."timestamp" <= ${ts})
    RETURNING a.id
  `);
  return new Set(result.rows.map((r) => r.id));
}

// ── Runtime attribute evaluator ───────────────────────────────────────────────
/** Evaluate runtime (computed) attributes from the asset's current values, in one write. */
async function evaluateRuntimeAttributes(allAttrs: AttrRow[], ts: Date): Promise<void> {
  const runtime = allAttrs.filter((a) => a.type === "runtime" && a.expression);
  if (runtime.length === 0) return;

  const vars: Record<string, number> = {};
  for (const attr of allAttrs) {
    // Blank values are not variables: they used to become 0.
    const num = toNum(attr.value);
    if (num !== null) {
      vars[attr.name] = num;
      vars[attr.name.replace(/\s+/g, "_")] = num;
      vars[attr.name.replace(/[^a-zA-Z0-9_]/g, "_")] = num;
    }
  }
  const rows = runtime.map((attr) => {
    const result = evalExpression(attr.expression!, vars);
    return sql`(${attr.id}::uuid, ${JSON.stringify(result)}::jsonb, ${result !== null}::boolean)`;
  });
  await db.execute(sql`
    UPDATE attributes AS a
    SET value = CASE WHEN v.ok THEN v.val ELSE a.value END,
        "timestamp" = ${ts},
        quality = CASE WHEN v.ok THEN 'good' ELSE 'bad' END
    FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, val, ok)
    WHERE a.id = v.id
  `);
}

/** The newest stored reading of each metric, one index seek per metric in a single query. */
async function latestReadings(assetId: string, metrics: string[]): Promise<Record<string, PrevReading>> {
  const out: Record<string, PrevReading> = {};
  if (metrics.length === 0) return out;
  const result = await db.execute<{ metric: string; value: unknown; ts: string | Date }>(sql`
    SELECT m.metric, t.value, t."timestamp" AS ts
    FROM unnest(ARRAY[${sql.join(metrics.map((m) => sql`${m}`), sql`, `)}]::text[]) AS m(metric)
    CROSS JOIN LATERAL (
      SELECT value, "timestamp" FROM telemetry
      WHERE asset_id = ${assetId} AND metric = m.metric
      ORDER BY "timestamp" DESC LIMIT 1
    ) t
  `);
  for (const row of result.rows) {
    const ts = new Date(row.ts);
    if (!Number.isNaN(ts.getTime())) out[row.metric] = { value: toNum(row.value), ts };
  }
  return out;
}

// ── Core ingest logic ─────────────────────────────────────────────────────────
/**
 * @param scope Assets this caller may write to, or null for no restriction. Set
 *   for a project-bound API key or a project-restricted user (see ingestScope in
 *   lib/project-access.ts). Matching assets outside it are ignored and the result
 *   reports `outOfScope`.
 */
export async function processNormalised(
  n: NormalisedPayload, assetIdHint?: string, emitBroadcast = true, scope: Set<string> | null = null,
) {
  let assetId: string | null = assetIdHint ?? null;
  let outOfScope = false;
  let assetName = n.externalAssetName ?? n.deviceId;

  /**
   * A device id may be claimed by MORE THAN ONE asset.
   *
   * One gateway payload commonly describes several sections of a plant — chiller,
   * lighting, grid — and the natural modelling is one asset (and one section
   * template) per section, all fed by that single `deviceId`. Resolving to a single
   * asset silently delivered everything to whichever row came back first and dropped
   * the rest, which is what made splitting a master template look broken.
   *
   * With several claimants each asset receives only the metrics it actually defines
   * an attribute for; a metric no asset claims is reported as unclaimed rather than
   * duplicated everywhere. A single claimant keeps the original behaviour — it gets
   * the whole payload, so tags can still be discovered before attributes exist.
   */
  let isInMaintenance = false;
  let siblings: { id: string; name: string; maintenanceMode: boolean | null }[] = [];
  if (!assetId) {
    siblings = await db.select({ id: assetsTable.id, name: assetsTable.name, maintenanceMode: assetsTable.maintenanceMode })
      .from(assetsTable).where(eq(assetsTable.identifier, n.deviceId));
    if (scope) {
      const before = siblings.length;
      siblings = siblings.filter((s) => scope.has(s.id));
      outOfScope = before > 0 && siblings.length === 0;
    }
    const first = siblings[0];
    assetId = first?.id ?? null;
    if (first?.name) assetName = first.name;
    if (first?.maintenanceMode) isInMaintenance = true;
  } else {
    const [asset] = await db.select({ id: assetsTable.id, name: assetsTable.name, maintenanceMode: assetsTable.maintenanceMode }).from(assetsTable).where(eq(assetsTable.id, assetId));
    if (!asset) {
      // An unknown asset id used to be written anyway, leaving telemetry that
      // belongs to no asset.
      assetId = null;
    } else if (scope && !scope.has(asset.id)) {
      assetId = null;
      outOfScope = true;
    } else {
      assetName = asset.name ?? assetName;
      if (asset.maintenanceMode) isInMaintenance = true;
      siblings = [asset];
    }
  }

  const ts = n.timestamp ?? new Date();
  // Remember every deviceId we receive (even unmatched) so the UI can offer real
  // device ids and asset creation can validate against transmitting devices.
  recordDevice(n.deviceId, !!assetId);
  // Do NOT auto-create assets. Telemetry is only stored when its deviceId matches
  // an existing asset's identifier; unknown deviceIds are ignored (no asset created).
  if (!assetId) {
    return { recordsWritten: 0, assetId: null, assetName, alarmEvents: [], claimantIds: [] as string[], outOfScope };
  }
  if (Object.keys(n.metrics).length === 0) {
    return { recordsWritten: 0, assetId, assetName, alarmEvents: [], claimantIds: siblings.map((s) => s.id) };
  }

  // ── Split the payload across every asset claiming this device ────────────────
  //
  // Partitioning is by declared tag: an attribute's tagName may be the bare metric
  // key ("chiller.energy_kWh") or the fully-qualified "<deviceId>.<metric>", and
  // `sourceMetric` is an explicit remap — all three are accepted, as elsewhere.
  let shares: { assetId: string; assetName: string; maintenance: boolean; metrics: Record<string, unknown> }[];
  const unclaimedMetrics: string[] = [];

  // Attributes of every claimant, read once and reused for partitioning,
  // attribute updates and runtime expressions.
  const attrsByAsset = await loadAttributes(siblings.length > 1 ? siblings.map((s) => s.id) : [assetId as string]);

  if (siblings.length <= 1) {
    shares = [{ assetId: assetId as string, assetName, maintenance: isInMaintenance, metrics: n.metrics }];
  } else {
    const claimed = new Set<string>();
    shares = [];
    for (const sib of siblings) {
      const attrs = attrsByAsset.get(sib.id) ?? [];
      const owned = new Set<string>();
      for (const a of attrs) {
        if (a.tagName) owned.add(a.tagName.toLowerCase());
        if (a.sourceMetric) owned.add(a.sourceMetric.toLowerCase());
      }
      const mine: Record<string, unknown> = {};
      for (const [metric, value] of Object.entries(n.metrics)) {
        const bare = metric.toLowerCase();
        const full = `${n.deviceId}.${metric}`.toLowerCase();
        if (owned.has(bare) || owned.has(full)) { mine[metric] = value; claimed.add(metric); }
      }
      if (Object.keys(mine).length > 0) {
        shares.push({ assetId: sib.id, assetName: sib.name, maintenance: !!sib.maintenanceMode, metrics: mine });
      }
    }
    for (const metric of Object.keys(n.metrics)) if (!claimed.has(metric)) unclaimedMetrics.push(metric);
    if (shares.length === 0) {
      return { recordsWritten: 0, assetId, assetName, alarmEvents: [], claimantIds: siblings.map((s) => s.id), unclaimedMetrics };
    }
  }

  let recordsWritten = 0;
  const alarmEvents: Awaited<ReturnType<typeof evaluateAlarmRules>> = [];

  for (const share of shares) {
    const assetId = share.assetId;
    const assetName = share.assetName;
    const metrics = share.metrics;

  // Snapshot previous values for rate-of-change evaluation and the late-data
  // check: one query for all metrics instead of one per metric.
  const prevMetrics = await latestReadings(assetId, Object.keys(metrics));

  // A blank reading is stored as sent but marked bad, so it is visible and
  // never mistaken for a measured zero.
  const records = Object.entries(metrics).map(([metric, value]) => ({
    assetId, deviceId: n.deviceId, metric, value, timestamp: ts,
    quality: isBlankReading(value) ? "bad" : "good",
  }));
  await db.insert(telemetryTable).values(records as any[]);

  // Update dynamic attributes — match either the full "deviceId.metric" tag OR the
  // bare metric name (case-insensitive; telemetry keys are camelCase, tagNames lower).
  // Safe because the caller (/ingest/payload) only reaches this after the payload's
  // root deviceId matched an asset — wrong device id ⇒ no asset ⇒ no values.
  // Matched in memory and written in one statement (it was two UPDATEs per metric).
  const attrs = attrsByAsset.get(assetId) ?? [];
  const assigned = assignAttributeValues(attrs, n.deviceId, metrics, n.sensorSerial);
  const written = await writeAttributeValues(assigned, ts);
  for (const a of attrs) if (written.has(a.id)) a.value = assigned.get(a.id);

  // Evaluate runtime (computed) attributes from the values just written.
  await evaluateRuntimeAttributes(attrs, ts);

  // Evaluate alarm rules — skip when asset is in maintenance mode
  const shareAlarms = share.maintenance
    ? []
    : await evaluateAlarmRules(assetId as string, assetName, metrics, prevMetrics, ts);

  // Skip the WS fan-out for the per-machine distribution — one payload attributes
  // to ~22 machines, and broadcasting each would flood every WS-listening page.
  if (emitBroadcast) {
    broadcast("telemetry", {
      assetId,
      assetName,
      metrics,
      timestamp: ts.toISOString(),
    });
  }

  for (const ev of shareAlarms) {
    const alarmPayload = {
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
    };
    broadcast("alarm", { event: ev.event, ...alarmPayload });
    // Configured destinations (Integration Hub). Fire-and-forget: a slow or
    // failing receiver must never hold up ingest. forwardToDestinations does
    // not throw; the catch is belt and braces for an unhandled rejection.
    void forwardToDestinations("alarm", { alarmEvent: ev.event, ...alarmPayload })
      .catch((err) => logger.warn({ err }, "alarm forwarding to destinations failed"));
    // Outbox for queued destinations and GET /api/v1/events. Never throws.
    emitLater(ev.event === "triggered" ? "alarm.triggered" : "alarm.cleared", { assetId, payload: alarmPayload });
  }

  recordsWritten += records.length;
  alarmEvents.push(...shareAlarms);
  }

  // Timestamp attributes need no special handling any more: the payload's clock fields
  // arrive as ordinary metrics, so they fill by tag match like everything else — and the
  // attribute shows exactly what the device sent rather than a re-formatted copy.

  return {
    recordsWritten, assetId, assetName, alarmEvents,
    // Every asset claiming this device id, so callers do not have to guess which one
    // "the" asset is when a payload is split across sections.
    claimantIds: siblings.map((s) => s.id),
    // Present only when several assets share the device id.
    ...(siblings.length > 1 && {
      assetsAttributed: shares.map((s) => s.assetName),
      unclaimedMetrics,
    }),
  };
}

// ── Seen devices (deviceIds received in telemetry, even if unmatched) ─────────
router.get("/ingest/seen-devices", (_req, res): void => {
  res.json(listSeenDevices().map((d) => ({ ...d, lastSeen: d.lastSeen.toISOString() })));
});

// Register a deviceId as a known device WITHOUT telemetry — used when a device
// payload is pasted into a template, so the id becomes selectable for assets.
//
// A signed-in user passes on the `brokers` module (authorize). A machine caller
// goes through the same checks as /ingest/payload: `ingest:write` scope, status,
// expiry, IP allowlist and the per-client rate limit. Any key used to be enough.
router.post("/ingest/register-device", ingestAuth, (req, res): void => {
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
router.post(["/ingest/validate", "/ingest/k/:clientId/validate", "/ingest/e/:token/validate"],
  ingestAuth, requireMatchingClient, async (req, res): Promise<void> => {
  // `rejectUnusableBody` is declared below — a function declaration, so it is
  // hoisted. Without it this route threw on an unparsed body exactly as
  // /payload did, and validate is the one endpoint whose entire purpose is to
  // tell the caller what is wrong with their payload.
  if (rejectUnusableBody(req, res)) return;
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

  // Every asset claiming this device id — a payload split across section assets has
  // more than one, and the dry run should show exactly which metric lands where.
  const scope = await ingestScope(req);
  const claimants = (await db.select({ id: assetsTable.id, name: assetsTable.name })
    .from(assetsTable).where(eq(assetsTable.identifier, n.deviceId)))
    // Assets outside the caller's project are neither written to nor named.
    .filter((c) => !scope || scope.has(c.id));
  const asset = claimants[0];

  const metricCount = Object.keys(n.metrics).length;
  if (!asset) warnings.push(`No asset found with identifier="${n.deviceId}". Telemetry will be discarded until an asset is bound to it (set the Device ID on its asset template).`);
  if (metricCount === 0) warnings.push("No metrics extracted — check payload format and envelope fields.");
  if (n.payloadFormat === "unknown") warnings.push("Payload format unrecognised (no data, metrics, or flat metric fields found).");

  // Per-asset breakdown: which of the payload's metrics each claimant declares.
  const perAsset: { assetId: string; assetName: string; metrics: string[] }[] = [];
  if (claimants.length > 1) {
    const unclaimed = new Set(Object.keys(n.metrics));
    for (const c of claimants) {
      const attrs = await db.select({ tagName: attributesTable.tagName, sourceMetric: attributesTable.sourceMetric })
        .from(attributesTable).where(eq(attributesTable.assetId, c.id));
      const owned = new Set<string>();
      for (const a of attrs) {
        if (a.tagName) owned.add(a.tagName.toLowerCase());
        if (a.sourceMetric) owned.add(a.sourceMetric.toLowerCase());
      }
      const mine = Object.keys(n.metrics).filter((m) =>
        owned.has(m.toLowerCase()) || owned.has(`${n.deviceId}.${m}`.toLowerCase()));
      mine.forEach((m) => unclaimed.delete(m));
      perAsset.push({ assetId: c.id, assetName: c.name, metrics: mine });
      if (mine.length === 0) warnings.push(`"${c.name}" shares this device id but declares none of these metrics — it will receive nothing.`);
    }
    if (unclaimed.size > 0) {
      warnings.push(`${unclaimed.size} metric(s) are not declared by any asset and will be dropped: ${[...unclaimed].slice(0, 6).join(", ")}${unclaimed.size > 6 ? "…" : ""}`);
    }
  }

  res.json({
    valid: !!asset && Object.keys(n.metrics).length > 0,
    deviceId: n.deviceId,
    assetId: asset?.id ?? null,
    assetName: asset?.name ?? null,
    assetMatched: !!asset,
    // Populated when several section assets share the device id.
    ...(claimants.length > 1 && { assetsSharingDeviceId: perAsset }),
    timestamp: n.timestamp?.toISOString() ?? null,
    payloadFormat: n.payloadFormat,
    extractedMetrics: n.metrics,
    metricCount,
    warnings,
  });
});

// ── Per-client ingest endpoints ───────────────────────────────────────────────
//
// Every API client gets its own ingest URL carrying its public `clientId`:
//
//     POST /api/ingest/k/<clientId>/payload
//     POST /api/ingest/k/<clientId>/batch
//
// Why the id is in the path at all, given the key already identifies the caller:
// it makes each integration's endpoint visibly distinct, so a gateway can be
// pointed at "its own" URL, traffic is attributable at a glance in the access
// log, and a misconfigured device is obvious rather than blending into shared
// counters. The clientId is an identifier, NOT a secret — the API key in the
// header is still what authenticates the request.
//
// `requireMatchingClient` then rejects a request whose key belongs to a
// different client than the URL names, so one integration's credential cannot
// be used to post through another's endpoint and skew its figures.
function requireMatchingClient(req: Request, res: Response, next: NextFunction): void {
  // A signed-in operator (Payload Simulator) has already been authorised by
  // `authorize` against the `brokers` module; they may post to any endpoint.
  if (req.principal) { next(); return; }

  const { clientId } = req.params as { clientId?: string };
  if (!req.apiClient) {
    res.status(401).json({ error: "Authentication required", code: "authentication_required" });
    return;
  }
  if (clientId && req.apiClient.clientId !== clientId) {
    res.status(403).json({
      error: "This API key does not belong to the client in the URL.",
      code: "client_mismatch",
      hint: "Post to your own ingest endpoint, shown on the Broker Management page.",
    });
    return;
  }
  next();
}

/**
 * Ingest accepts EITHER credential:
 *   - an API key carrying `ingest:write` (devices, gateways, SCADA), or
 *   - an authenticated browser session holding the `brokers` module, which is
 *     how the built-in Payload Simulator posts test data.
 *
 * Anonymous posting is no longer possible either way.
 */
async function ingestAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.principal) { next(); return; }

  // Authenticated by a copy-and-paste ingest URL. `attachApiClient` has already
  // resolved the token and verified status, expiry and — critically — that the
  // client is ingest-scoped, so there is nothing left to check here.
  if (req.viaIngestUrlToken && req.apiClient) { next(); return; }

  // A token was present in the URL but did not resolve. Answer the actual
  // question rather than falling through to "send a header", which would be
  // wrong advice for someone who pasted a URL.
  if (req.ingestTokenFailure) {
    const reason = req.ingestTokenFailure;
    res.status(reason === "scope_too_broad" ? 403 : 401).json({
      error:
        reason === "unknown"    ? "This ingest URL is not recognised. It may have been regenerated or deleted."
      : reason === "inactive"   ? "This ingest endpoint has been disabled or revoked."
      : reason === "expired"    ? "This ingest endpoint has expired."
      : reason === "scope_too_broad"
                                ? "This credential is too broadly scoped to be used in a URL. Create a dedicated ingest endpoint instead."
      :                           "This ingest URL is malformed.",
      code: `ingest_url_${reason}`,
      hint: "Copy the endpoint again from Integration Hub → Broker Management.",
    });
    return;
  }

  // `await` (not `void`) matters here: every OTHER apiKeyAuth() caller registers it
  // directly as Express middleware, where Express 5 natively awaits it and forwards
  // any rejection to the error handler in app.ts. `void`-ing the call instead — as
  // this one did, because it also needs the req.principal bypass above — detached
  // the promise from Express entirely, so any exception inside apiKeyAuth (a thrown
  // error, a rejected DB call, anything) became an unhandled rejection at the Node
  // process level instead of a request-scoped 500. Node's default for an unhandled
  // rejection is to crash the whole process — killing every client's connection,
  // not just the one that triggered it. That is what actually took the server down;
  // the header-after-json bug below was only the trigger that happened to surface it.
  await apiKeyAuth("ingest:write")(req, res, next);
}

/**
 * Reject a body that no parser produced an object from.
 *
 * When the Content-Type is not one the parsers claim, Express 5 leaves
 * `req.body` undefined — and reading `.deviceId` off it threw a TypeError that
 * surfaced as a 500 with a correlation id. A malformed request is the caller's
 * to fix, so it has to be a 400 that names which half is wrong: an integrator
 * reading "something went wrong on our side" has no reason to look at their own
 * header, which is exactly where the problem is.
 */
function rejectUnusableBody(req: Request, res: Response): boolean {
  const body = req.body as unknown;
  if (body && typeof body === "object") return false;

  const contentType = String(req.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "";
  res.status(400).json({
    error: contentType && contentType !== "application/json"
      ? `The request body was not read because its Content-Type is "${contentType}".`
      : "The request body is empty or is not JSON.",
    code: "body_not_json",
    hint: 'Send  Content-Type: application/json  with a JSON object, e.g. {"deviceId":"my-device-01","temperature":21.5}.',
  });
  return true;
}

// ── Routes ────────────────────────────────────────────────────────────────────
//
// Ingest now REQUIRES a valid `ingest:write` API key (it was previously open to
// anonymous callers). That is what makes the per-client load figures meaningful:
// traffic can no longer be posted without attribution.
router.post(["/ingest/payload", "/ingest/k/:clientId/payload", "/ingest/e/:token/payload"],
  ingestAuth, requireMatchingClient, async (req, res): Promise<void> => {
  if (rejectUnusableBody(req, res)) return;
  const body = req.body as Record<string, unknown>;

  // Single-device model: the whole tree is attributed to the top-level deviceId
  // (e.g. "testing" = the root). normalise() deep-flattens the nested tree into
  // dotted metric keys; per-machine views resolve their slice by name.
  const scope = await ingestScope(req);
  const normalised = normalise(body);
  if (!normalised) {
    // An array of readings. Every item is processed; only the last one used to be
    // stored, while the response still said success.
    if (Array.isArray(req.body) && req.body.length > 0) {
      const items = req.body as Record<string, unknown>[];
      let recordsWritten = 0, accepted = 0, rejected = 0, outOfScope = 0, triggered = 0, cleared = 0;
      const alarmEvents: AlarmEvent[] = [];
      for (const item of items) {
        const n = item && typeof item === "object" ? normalise(item) : null;
        if (!n) { rejected++; continue; }
        const hint = typeof item.assetId === "string" ? item.assetId : undefined;
        const result = await processNormalised(n, hint, true, scope);
        if (result.outOfScope) { outOfScope++; recordIngestOutOfScope(req, n.deviceId); continue; }
        if (result.assetId) accepted++;
        recordsWritten += result.recordsWritten;
        triggered += result.alarmEvents.filter((e) => e.event === "triggered").length;
        cleared   += result.alarmEvents.filter((e) => e.event === "cleared").length;
        alarmEvents.push(...result.alarmEvents);
      }
      if (accepted > 0 || rejected < items.length) {
        res.status(outOfScope > 0 && accepted === 0 ? 403 : 200).json({
          success: rejected === 0 && outOfScope === 0 && accepted > 0,
          items: items.length, matched: accepted, rejected, outOfScope, recordsWritten,
          message: `Ingested ${recordsWritten} metric(s) from ${accepted} of ${items.length} reading(s)`,
          alarmsTriggered: triggered, alarmsCleared: cleared, alarmEvents,
          ...(outOfScope > 0 && { code: "out_of_project_scope" }),
        });
        return;
      }
    }
    // A gateway shows the caller a status code and nothing else, so the body is
    // the only place this can be explained. Echo the KEYS that did arrive — not
    // their values, which are readings the caller already has and may not want
    // in a log — because "deviceId is missing" and "my payload is nested one
    // level too deep" look identical from the Node-RED side otherwise.
    res.status(400).json({
      error: "Missing required field: deviceId",
      code: "missing_device_id",
      hint: "Every payload needs a top-level string `deviceId`, and it must match an asset's Identifier exactly (case-sensitive).",
      received: {
        contentType: String(req.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "",
        topLevelKeys: Object.keys(body).slice(0, 25),
      },
      example: { deviceId: "my-device-01", temperature: 21.5, pressure: 3.2 },
    });
    return;
  }
  const assetIdHint = typeof body.assetId === "string" ? body.assetId : undefined;
  // 1) Attribute the whole flattened tree to the root device owner (identifier ==
  //    payload deviceId). By-Asset dashboards read these dotted keys and filter by name.
  const result = await processNormalised(normalised, assetIdHint, true, scope);
  if (result.outOfScope) {
    recordIngestOutOfScope(req, normalised.deviceId);
    res.status(403).json({
      success: false,
      error: "This device belongs to a project this credential cannot write to.",
      code: "out_of_project_scope",
      hint: "Use an API key assigned to the device's project, or an unassigned key.",
    });
    return;
  }

  // 2) Distribute each machine's own slice to its asset, resolved by NAME path under
  //    the root. This populates every machine's own Attributes/Telemetry. Gated on the
  //    root device having matched an asset — a wrong root device id ⇒ no root asset ⇒
  //    nothing distributed (no values anywhere), which is the intended behaviour.
  let machinesAttributed = 0;
  const roots = result.claimantIds?.length ? result.claimantIds : (result.assetId ? [result.assetId] : []);
  if (roots.length > 0) {
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
        // Try EVERY asset claiming this device id, not just the first one. When a payload
        // is split across section assets there is no single "root", and resolving under
        // an arbitrary claimant made attribution depend on row order.
        let machineAssetId: string | null = null;
        for (const root of roots) {
          machineAssetId = resolveAssetByPath(root, rec.namePath, childrenOf);
          if (machineAssetId) break;
        }
        if (!machineAssetId) continue;
        await processNormalised(
          { deviceId: normalised.deviceId, timestamp: normalised.timestamp, metrics: rec.metrics, payloadFormat: "flat" },
          machineAssetId,
          false, // no WS broadcast per machine — avoids flooding the UI
          scope,
        );
        machinesAttributed++;
      }
    }
  }

  const triggered = result.alarmEvents.filter((e) => e.event === "triggered");
  const cleared   = result.alarmEvents.filter((e) => e.event === "cleared");
  res.json({ success: true, recordsWritten: result.recordsWritten, assetId: result.assetId,
    assetName: result.assetName, machinesAttributed,
    // False when no asset has this deviceId. Matching is exact and case-sensitive.
    matched: !!result.assetId,
    message: result.assetId
      ? `Ingested ${result.recordsWritten} metric(s); ${machinesAttributed} machine(s) attributed`
      : `No asset has the identifier "${normalised.deviceId}" (matching is case-sensitive), so nothing was stored.`,
    alarmsTriggered: triggered.length, alarmsCleared: cleared.length, alarmEvents: result.alarmEvents });
});

router.post(["/ingest/batch", "/ingest/k/:clientId/batch", "/ingest/e/:token/batch"],
  ingestAuth, requireMatchingClient, async (req, res): Promise<void> => {
  // Same guard as /payload: an unparsed body reaches here as undefined, and
  // "Body must be an array" would send the caller looking at their payload when
  // the fault is their Content-Type header.
  if (rejectUnusableBody(req, res)) return;
  const items = req.body;
  if (!Array.isArray(items)) { res.status(400).json({ error: "Body must be an array" }); return; }
  const scope = await ingestScope(req);
  let successCount = 0, failureCount = 0, totalTriggered = 0, totalCleared = 0, outOfScopeCount = 0;
  for (const item of items) {
    try {
      const n = normalise(item as Record<string, unknown>);
      if (!n) { failureCount++; continue; }
      const result = await processNormalised(n, undefined, true, scope);
      if (result.outOfScope) { outOfScopeCount++; failureCount++; recordIngestOutOfScope(req, n.deviceId); continue; }
      totalTriggered += result.alarmEvents.filter((e) => e.event === "triggered").length;
      totalCleared   += result.alarmEvents.filter((e) => e.event === "cleared").length;
      successCount++;
    } catch { failureCount++; }
  }
  res.json({ success: failureCount === 0, totalRecords: items.length, successCount, failureCount,
    outOfScopeCount, alarmsTriggered: totalTriggered, alarmsCleared: totalCleared });
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
  if (!params.success) { respondInvalid(req, res, params.error); return; }
  const query = GetTelemetryQueryParams.safeParse(req.query);
  if (!query.success) { respondInvalid(req, res, query.error); return; }
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
  // csvCell quotes AND neutralises spreadsheet formulas: a device string or
  // metric name starting with = + - @ used to run as a formula in Excel.
  const rows = records.map((r) =>
    [r.id, r.assetId, r.deviceId ?? "", r.metric,
      r.value !== null && typeof r.value === "object" ? JSON.stringify(r.value) : r.value,
      r.quality ?? "", r.timestamp?.toISOString() ?? ""]
      // A real number cannot be a formula; written as-is so "-5" stays numeric.
      .map((v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : csvCell(v)))
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
