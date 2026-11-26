import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, desc, eq, gt, gte, inArray, lte, type SQL } from "drizzle-orm";
import {
  db, apiClientsTable, assetsTable, attributesTable, telemetryTable, alarmsTable, alarmHistoryTable,
  alarmRulesTable, integrationEventsTable,
} from "@workspace/db";
import { apiKeyAuth, ipAllowed } from "../middleware/apiKeyAuth";
import { ingestScope } from "../lib/project-access";
import { logActivity } from "./activity_log";
import { broadcast } from "../lib/ws-broadcast";
import { forgetAssetDelays } from "./ingest";
import { emitLater, EVENT_TYPES } from "../lib/integration/events";
import { idempotent } from "../lib/integration/idempotency";
import { issueAccessToken, secretCondition } from "../lib/integration/client-auth";
import { V1_OPENAPI } from "../lib/integration/v1-openapi";
import { recordSecurityEvent } from "../lib/security-log";
import { clientAddress } from "../lib/client-ip";

/**
 * Third-party API, version 1 (/api/v1/*) and the OAuth token endpoint.
 *
 * New routes only: nothing under /ingest or /export changes. Every route needs
 * an API credential with the named scope, honours the client's project, asset
 * limit, row and range limits, and records the client as the actor in the
 * audit log. Writes accept Idempotency-Key and, for a sandbox client, answer
 * what they would do without changing anything.
 */

const router: IRouter = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Assets this client may reach, or null for every asset. */
async function reach(req: Request): Promise<Set<string> | null> {
  return ingestScope(req);
}

function outOfScope(req: Request, res: Response, assetId: string): void {
  recordSecurityEvent({
    type: "authz.denied", outcome: "failure", reason: "v1_out_of_scope", req,
    detail: { path: req.path, method: req.method, assetId, apiClientId: req.apiClient?.id ?? null },
  });
  res.status(403).json({ error: "This asset is outside what this API client may reach.", code: "asset_forbidden" });
}

function rows(req: Request, requested: unknown, fallback: number, ceiling: number): number {
  const n = Math.floor(Number(requested));
  let limit = Number.isFinite(n) && n > 0 ? Math.min(n, ceiling) : fallback;
  const max = req.apiClient?.maxRows;
  if (max && max > 0) limit = Math.min(limit, max);
  return limit;
}

function parseDate(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function sandbox(req: Request, res: Response, wouldDo: Record<string, unknown>): boolean {
  if (!req.apiClient?.sandbox) return false;
  res.setHeader("X-Nexus-Sandbox", "true");
  res.json({ sandbox: true, applied: false, wouldDo });
  return true;
}

const v1 = (scope: string) => apiKeyAuth(scope);

/** Refuse a human session on the machine API: the scopes, limits and audit actor all assume a client. */
function machineOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.apiClient) { res.status(401).json({ error: "This endpoint requires an API credential.", code: "api_key_required" }); return; }
  next();
}

// ── Discovery ────────────────────────────────────────────────────────────────

router.get("/v1/openapi.json", (_req, res): void => { res.json(V1_OPENAPI); });

router.get("/v1/event-types", (_req, res): void => { res.json(EVENT_TYPES); });

// ── OAuth 2.0 client credentials ─────────────────────────────────────────────

router.post("/oauth/token", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  let clientId = typeof body.client_id === "string" ? body.client_id : "";
  let clientSecret = typeof body.client_secret === "string" ? body.client_secret : "";
  const basic = req.headers.authorization;
  if (basic?.startsWith("Basic ")) {
    const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i > 0) { clientId = decodeURIComponent(decoded.slice(0, i)); clientSecret = decodeURIComponent(decoded.slice(i + 1)); }
  }
  if (body.grant_type !== "client_credentials") {
    res.status(400).json({ error: "unsupported_grant_type", error_description: "Only grant_type=client_credentials is supported." });
    return;
  }
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: "invalid_request", error_description: "Send client_id and client_secret (form, JSON or HTTP Basic)." });
    return;
  }
  const [client] = await db.select().from(apiClientsTable)
    .where(and(eq(apiClientsTable.clientId, clientId), secretCondition(clientSecret)));
  const usable = client && client.status === "active" && !(client.expiresAt && new Date() > client.expiresAt)
    && (client.allowedIps.length === 0 || ipAllowed(clientAddress(req), client.allowedIps));
  if (!usable) {
    recordSecurityEvent({ type: "apikey.invalid", outcome: "failure", reason: "oauth_token_refused", req, detail: { clientId: clientId.slice(0, 80) } });
    res.status(401).json({ error: "invalid_client", error_description: "Unknown client, wrong secret, or the client is inactive, expired or not allowed from this address." });
    return;
  }
  const { token, expiresIn } = await issueAccessToken(client);
  void logActivity("api_client.token_issued", "api_client", client.id, client.name, `access token valid ${Math.round(expiresIn / 60)} min`, req);
  res.setHeader("Cache-Control", "no-store");
  res.json({ access_token: token, token_type: "Bearer", expires_in: expiresIn, scope: client.scopes.join(" ") });
});

// ── Reads ────────────────────────────────────────────────────────────────────

router.get("/v1/assets", v1("read:assets"), machineOnly, async (req, res): Promise<void> => {
  const scope = await reach(req);
  const parentId = typeof req.query.parentId === "string" && UUID_RE.test(req.query.parentId) ? req.query.parentId : null;
  const all = await db.select({
    id: assetsTable.id, name: assetsTable.name, identifier: assetsTable.identifier, parentId: assetsTable.parentId,
    description: assetsTable.description, tags: assetsTable.tags, maintenanceMode: assetsTable.maintenanceMode,
    updatedAt: assetsTable.updatedAt,
  }).from(assetsTable).orderBy(asc(assetsTable.name));
  const list = all.filter((a) => (!scope || scope.has(a.id)) && (!parentId || a.parentId === parentId));
  const limit = rows(req, req.query.limit, 1000, 10_000);
  res.json({ count: Math.min(list.length, limit), total: list.length, data: list.slice(0, limit) });
});

router.get("/v1/assets/:id", v1("read:assets"), machineOnly, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid asset id" }); return; }
  const scope = await reach(req);
  if (scope && !scope.has(id)) { outOfScope(req, res, id); return; }
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  const attrs = await db.select({
    id: attributesTable.id, name: attributesTable.name, type: attributesTable.type, dataType: attributesTable.dataType,
    value: attributesTable.value, uom: attributesTable.uom, timestamp: attributesTable.timestamp, updatedAt: attributesTable.updatedAt,
  }).from(attributesTable).where(eq(attributesTable.assetId, id)).orderBy(asc(attributesTable.sortOrder));
  res.json({
    id: asset.id, name: asset.name, identifier: asset.identifier, parentId: asset.parentId, description: asset.description,
    tags: asset.tags, maintenanceMode: asset.maintenanceMode, maintenanceNote: asset.maintenanceNote, attributes: attrs,
  });
});

router.get("/v1/assets/:id/telemetry", v1("read:telemetry"), machineOnly, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid asset id" }); return; }
  const scope = await reach(req);
  if (scope && !scope.has(id)) { outOfScope(req, res, id); return; }
  const to = parseDate(req.query.to) ?? new Date();
  let from = parseDate(req.query.from) ?? new Date(to.getTime() - 86_400_000);
  const days = req.apiClient?.maxRangeDays;
  if (days && days > 0) {
    const earliest = new Date(to.getTime() - days * 86_400_000);
    if (from < earliest) from = earliest;
  }
  const conditions: SQL[] = [eq(telemetryTable.assetId, id), gte(telemetryTable.timestamp, from), lte(telemetryTable.timestamp, to)];
  if (typeof req.query.metric === "string" && req.query.metric) conditions.push(eq(telemetryTable.metric, req.query.metric));
  const limit = rows(req, req.query.limit, 1000, 10_000);
  const data = await db.select({
    metric: telemetryTable.metric, value: telemetryTable.value, quality: telemetryTable.quality, timestamp: telemetryTable.timestamp,
  }).from(telemetryTable).where(and(...conditions)).orderBy(desc(telemetryTable.timestamp)).limit(limit);
  res.json({ assetId: id, from: from.toISOString(), to: to.toISOString(), count: data.length, limit, data });
});

router.get("/v1/alarms", v1("read:alarms"), machineOnly, async (req, res): Promise<void> => {
  const scope = await reach(req);
  const conditions: SQL[] = [];
  if (scope) {
    if (scope.size === 0) { res.json({ count: 0, data: [] }); return; }
    conditions.push(inArray(alarmsTable.assetId, [...scope]));
  }
  if (typeof req.query.status === "string" && req.query.status) conditions.push(eq(alarmsTable.status, req.query.status));
  if (typeof req.query.assetId === "string" && UUID_RE.test(req.query.assetId)) conditions.push(eq(alarmsTable.assetId, req.query.assetId));
  const limit = rows(req, req.query.limit, 500, 5000);
  const data = await db.select().from(alarmsTable)
    .where(conditions.length ? and(...conditions) : undefined).orderBy(desc(alarmsTable.triggeredAt)).limit(limit);
  res.json({ count: data.length, data });
});

router.get("/v1/alarm-rules", v1("read:alarm-rules"), machineOnly, async (req, res): Promise<void> => {
  const scope = await reach(req);
  const all = await db.select({
    id: alarmRulesTable.id, name: alarmRulesTable.name, assetId: alarmRulesTable.assetId, alarmType: alarmRulesTable.alarmType,
    severity: alarmRulesTable.severity, metric: alarmRulesTable.metric, operator: alarmRulesTable.operator,
    threshold: alarmRulesTable.threshold, deadband: alarmRulesTable.deadband, enabled: alarmRulesTable.enabled,
  }).from(alarmRulesTable).orderBy(asc(alarmRulesTable.name));
  // A rule with no asset applies everywhere; a scoped client sees only rules on its assets.
  const data = all.filter((r) => !scope || (r.assetId && scope.has(r.assetId)));
  res.json({ count: data.length, data });
});

/**
 * Event feed for clients that cannot receive webhooks. Poll with `after` set
 * to the last id received; the answer's `next` is the value for the next call.
 */
router.get("/v1/events", v1("read:events"), machineOnly, async (req, res): Promise<void> => {
  const after = Math.max(0, Math.floor(Number(req.query.after ?? 0)) || 0);
  const limit = rows(req, req.query.limit, 100, 1000);
  const types = typeof req.query.types === "string" ? req.query.types.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const conditions: SQL[] = [gt(integrationEventsTable.id, after)];
  const projectId = req.apiClient?.projectId;
  if (projectId) conditions.push(eq(integrationEventsTable.projectId, projectId));
  if (types.length) conditions.push(inArray(integrationEventsTable.type, types));
  const data = await db.select().from(integrationEventsTable)
    .where(and(...conditions)).orderBy(asc(integrationEventsTable.id)).limit(limit);
  // An asset limit narrower than the project is applied after the query.
  const limitAssets = req.apiClient?.allowedAssetIds?.length ? await reach(req) : null;
  const visible = limitAssets ? data.filter((e) => e.assetId && limitAssets.has(e.assetId)) : data;
  res.json({
    count: visible.length,
    next: data.length ? data[data.length - 1]!.id : after,
    data: visible.map((e) => ({ id: e.id, type: e.type, assetId: e.assetId, projectId: e.projectId, createdAt: e.createdAt, data: e.payload })),
  });
});

// ── Writes ───────────────────────────────────────────────────────────────────

router.post("/v1/alarms/:id/acknowledge", v1("write:alarms"), machineOnly, idempotent, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid alarm id" }); return; }
  const [current] = await db.select().from(alarmsTable).where(eq(alarmsTable.id, id));
  if (!current) { res.status(404).json({ error: "Alarm not found" }); return; }
  const scope = await reach(req);
  if (scope && !(current.assetId && scope.has(current.assetId))) { outOfScope(req, res, current.assetId ?? ""); return; }
  if (current.status !== "active") {
    res.status(409).json({ error: `Cannot acknowledge — current status is '${current.status}'`, code: "alarm_not_active" });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null;
  if (sandbox(req, res, { action: "acknowledge", alarmId: id, note })) return;

  const now = new Date();
  const [alarm] = await db.update(alarmsTable).set({ status: "acknowledged", acknowledgedAt: now })
    .where(and(eq(alarmsTable.id, id), eq(alarmsTable.status, "active"))).returning();
  if (!alarm) { res.status(409).json({ error: "The alarm changed while it was being acknowledged.", code: "alarm_not_active" }); return; }
  await db.update(alarmHistoryTable).set({ status: "acknowledged", acknowledgedAt: now })
    .where(and(eq(alarmHistoryTable.alarmId, alarm.id), eq(alarmHistoryTable.status, "active")));
  void logActivity("alarm.acknowledged", "alarm", alarm.id, alarm.name, note ? `via API: ${note}` : "via API", req, { assetId: alarm.assetId });
  emitLater("alarm.acknowledged", { assetId: alarm.assetId, payload: {
    alarmId: alarm.id, name: alarm.name, severity: alarm.severity, assetId: alarm.assetId, assetName: alarm.assetName,
    acknowledgedAt: now.toISOString(), by: req.apiClient!.name, note,
  } });
  broadcast("alarm", { event: "acknowledged", alarmId: alarm.id, ruleName: alarm.name, severity: alarm.severity, assetId: alarm.assetId, assetName: alarm.assetName });
  res.json(alarm);
});

/**
 * Set attribute values by name: { "values": { "Setpoint": 72.5, "Shift": "B" } }.
 * Calculated (runtime) attributes are refused: their value comes from an expression.
 */
router.put("/v1/assets/:id/attributes", v1("write:attributes"), machineOnly, idempotent, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid asset id" }); return; }
  const scope = await reach(req);
  if (scope && !scope.has(id)) { outOfScope(req, res, id); return; }
  const values = req.body?.values;
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length === 0) {
    res.status(400).json({ error: 'Send { "values": { "<attribute name>": <value>, ... } }.', code: "invalid_body" });
    return;
  }
  const entries = Object.entries(values as Record<string, unknown>).slice(0, 200);
  for (const [, v] of entries) {
    if (v !== null && !["string", "number", "boolean"].includes(typeof v)) {
      res.status(400).json({ error: "Each value must be a string, number, boolean or null.", code: "invalid_value" });
      return;
    }
  }
  const [asset] = await db.select({ id: assetsTable.id, name: assetsTable.name }).from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
  const attrs = await db.select().from(attributesTable).where(eq(attributesTable.assetId, id));
  const byName = new Map(attrs.map((a) => [a.name, a]));
  const unknown = entries.filter(([n]) => !byName.has(n)).map(([n]) => n);
  const calculated = entries.filter(([n]) => byName.get(n)?.type === "runtime").map(([n]) => n);
  if (unknown.length || calculated.length) {
    res.status(400).json({
      error: unknown.length ? `No attribute named: ${unknown.join(", ")}` : `Calculated attributes cannot be set: ${calculated.join(", ")}`,
      code: unknown.length ? "unknown_attribute" : "calculated_attribute",
    });
    return;
  }
  if (sandbox(req, res, { action: "set_attributes", assetId: id, values: Object.fromEntries(entries) })) return;

  const now = new Date();
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const [name, value] of entries) {
    const attr = byName.get(name)!;
    await db.update(attributesTable).set({ value: value as never, timestamp: now }).where(eq(attributesTable.id, attr.id));
    changes.push({ field: name, from: attr.value, to: value });
  }
  void logActivity("attribute.set_via_api", "attributes", id, asset.name, `${entries.length} value(s) set`, req, { assetId: id, changes });
  emitLater("asset.attributes", { assetId: id, payload: { assetId: id, name: asset.name, values: Object.fromEntries(entries), by: req.apiClient!.name } });
  res.json({ assetId: id, updated: entries.length, at: now.toISOString() });
});

router.post("/v1/assets/:id/maintenance", v1("write:maintenance"), machineOnly, idempotent, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid asset id" }); return; }
  const scope = await reach(req);
  if (scope && !scope.has(id)) { outOfScope(req, res, id); return; }
  if (typeof req.body?.enabled !== "boolean") { res.status(400).json({ error: 'Send { "enabled": true | false, "note": "..." }.', code: "invalid_body" }); return; }
  const enable = req.body.enabled as boolean;
  const note = typeof req.body.note === "string" ? req.body.note.slice(0, 500) : null;
  const [current] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!current) { res.status(404).json({ error: "Asset not found" }); return; }
  if (sandbox(req, res, { action: "maintenance", assetId: id, enabled: enable, note })) return;

  const [asset] = await db.update(assetsTable).set({
    maintenanceMode: enable, maintenanceSince: enable ? new Date() : null, maintenanceNote: enable ? note : null,
  }).where(eq(assetsTable.id, id)).returning();
  forgetAssetDelays(id);
  void logActivity(enable ? "asset.maintenance_enabled" : "asset.maintenance_disabled", "asset", id, current.name, "via API", req, { assetId: id });
  emitLater("asset.maintenance", { assetId: id, payload: { assetId: id, name: current.name, maintenanceMode: enable, note, by: req.apiClient!.name } });
  res.json({ id: asset!.id, name: asset!.name, maintenanceMode: asset!.maintenanceMode, maintenanceSince: asset!.maintenanceSince, maintenanceNote: asset!.maintenanceNote });
});

export default router;
