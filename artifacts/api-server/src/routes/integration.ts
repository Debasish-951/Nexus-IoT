import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, isNull, sql, type SQL } from "drizzle-orm";
import {
  db, apiClientsTable, assetsTable, destinationsTable, destinationDeliveriesTable, integrationEventsTable,
  apiRequestLogTable, pullConnectorsTable, securityEventsTable,
} from "@workspace/db";
import { logActivity } from "./activity_log";
import { recordSecurityEvent } from "../lib/security-log";
import { hashToken } from "../lib/tokens";
import { API_SCOPE_OPTIONS, API_SCOPE_ALL, ungrantableScopes } from "../lib/rbac";
import { refuseIfAboveCeiling } from "../lib/api-client-ceiling";
import { EVENT_TYPES } from "../lib/integration/events";
import { newSigningSecret, verifySignature, signPayload } from "../lib/integration/signing";
import { revokeAccessTokens, ACCESS_TOKEN_TTL_SEC } from "../lib/integration/client-auth";
import { encryptSecret } from "../lib/secret-box";
import { checkOutboundUrl } from "../lib/outbound-url";
import { CONNECTOR_TYPES, runConnector, runAndRecord, secretContext, assertSelectOnly } from "../services/connectors";
import { BACKOFF_SEC } from "../services/delivery-worker";

/**
 * Integration Hub management API (/api/integration/*), used by the new
 * Integration Hub screens. Additive: the original /api-clients and
 * /destinations routes are untouched and the original pages keep using them.
 */

const router: IRouter = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3_600_000;

/** Ready-made client set-ups shown when creating or reviewing a client. */
export const CLIENT_TEMPLATES = [
  { id: "gateway", label: "Gateway (send telemetry)", scopes: ["ingest:write"], description: "Edge gateway or Node-RED flow posting readings." },
  { id: "scada", label: "SCADA / HMI (read-only)", scopes: ["read:assets", "read:telemetry", "read:alarms", "read:events"], description: "Reads live values, alarms and the event feed." },
  { id: "cmms", label: "CMMS / maintenance", scopes: ["read:assets", "read:alarms", "read:alarm-history", "read:events", "write:alarms", "write:maintenance"], description: "Reads alarms, acknowledges them and sets maintenance mode." },
  { id: "bi", label: "BI / reporting (read telemetry)", scopes: ["read:assets", "read:telemetry", "read:alarm-history"], description: "Pulls history into Power BI, Grafana or a data lake." },
  { id: "mes", label: "MES / ERP (read + set values)", scopes: ["read:assets", "read:telemetry", "write:attributes", "read:events"], description: "Reads production values and writes order or shift data into attributes." },
] as const;

function projectFilter(req: Request): { restricted: boolean; allowed: Set<string> } {
  const access = req.principal?.access;
  if (!access?.restrictProjects) return { restricted: false, allowed: new Set() };
  return { restricted: true, allowed: new Set(access.allowedProjects) };
}

/**
 * Load a client the caller may see. `change` also applies the scope ceiling
 * (H-1): access, rotation and grace changes need every scope on the key to be
 * one the caller could grant (same rule as routes/api_clients.ts).
 */
async function loadClient(req: Request, res: Response, id: string, opts: { change?: boolean } = {}): Promise<typeof apiClientsTable.$inferSelect | null> {
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return null; }
  const [client] = await db.select().from(apiClientsTable).where(eq(apiClientsTable.id, id));
  const { restricted, allowed } = projectFilter(req);
  if (!client || (restricted && !(client.projectId && allowed.has(client.projectId)))) {
    res.status(404).json({ error: "API client not found", code: "not_found" });
    return null;
  }
  if (opts.change && refuseIfAboveCeiling(req, res, client)) return null;
  return client;
}

function clientView(c: typeof apiClientsTable.$inferSelect) {
  const legacySuperKey = c.scopes.length === 0 || c.scopes.includes(API_SCOPE_ALL);
  return {
    id: c.id, name: c.name, clientId: c.clientId, description: c.description, projectId: c.projectId, status: c.status,
    scopes: c.scopes, allowedIps: c.allowedIps, expiresAt: c.expiresAt, lastUsedAt: c.lastUsedAt, totalRequests: c.totalRequests,
    secretRotatedAt: c.secretRotatedAt, createdAt: c.createdAt,
    allowedAssetIds: c.allowedAssetIds, maxRows: c.maxRows, maxRangeDays: c.maxRangeDays, sandbox: c.sandbox, template: c.template,
    graceUntil: c.previousSecretHash && c.previousSecretExpiresAt && c.previousSecretExpiresAt > new Date() ? c.previousSecretExpiresAt : null,
    legacySuperKey,
  };
}

// ── Catalogues ───────────────────────────────────────────────────────────────

router.get("/integration/catalog", (req, res): void => {
  res.json({
    scopes: API_SCOPE_OPTIONS,
    grantableScopes: req.principal?.access.apiScopes ?? [],
    templates: CLIENT_TEMPLATES,
    eventTypes: EVENT_TYPES,
    connectorTypes: CONNECTOR_TYPES,
    retryScheduleSec: BACKOFF_SEC,
    accessTokenTtlSec: ACCESS_TOKEN_TTL_SEC,
    emptyScopesDenied: process.env.API_KEY_EMPTY_SCOPES_DENY === "true",
  });
});

// ── API clients: access, rotation, usage ─────────────────────────────────────

router.get("/integration/clients", async (req, res): Promise<void> => {
  const since = new Date(Date.now() - 24 * HOUR);
  const [clients, usage, projects] = await Promise.all([
    db.select().from(apiClientsTable).orderBy(apiClientsTable.name),
    db.select({
      apiClientId: apiRequestLogTable.apiClientId,
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${apiRequestLogTable.statusCode} >= 400)::int`,
      avgMs: sql<number>`coalesce(avg(${apiRequestLogTable.durationMs}), 0)::int`,
    }).from(apiRequestLogTable).where(gte(apiRequestLogTable.ts, since)).groupBy(apiRequestLogTable.apiClientId),
    db.select({ id: assetsTable.id, name: assetsTable.name }).from(assetsTable).where(isNull(assetsTable.parentId)),
  ]);
  const { restricted, allowed } = projectFilter(req);
  const byClient = new Map(usage.map((u) => [u.apiClientId, u]));
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  res.json(clients
    .filter((c) => !restricted || (c.projectId && allowed.has(c.projectId)))
    .map((c) => ({ ...clientView(c), projectName: c.projectId ? projectNames.get(c.projectId) ?? null : null,
      usage24h: byClient.get(c.id) ?? { total: 0, errors: 0, avgMs: 0 } })));
});

router.put("/integration/clients/:id/access", async (req, res): Promise<void> => {
  const client = await loadClient(req, res, String(req.params.id), { change: true });
  if (!client) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const set: Partial<typeof apiClientsTable.$inferInsert> = {};
  const access = req.principal?.access;

  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes) || body.scopes.some((s) => typeof s !== "string")) { res.status(400).json({ error: "scopes must be a list" }); return; }
    const scopes = [...new Set(body.scopes as string[])];
    const known = new Set<string>([...API_SCOPE_OPTIONS.map((s) => s.id), API_SCOPE_ALL]);
    const unknown = scopes.filter((s) => !known.has(s));
    if (unknown.length) { res.status(400).json({ error: `Unknown scope: ${unknown.join(", ")}`, code: "unknown_scope" }); return; }
    if (scopes.length === 0) { res.status(400).json({ error: "At least one scope is required. A credential with no scopes would have full access.", code: "scopes_required" }); return; }
    if (access) {
      const added = scopes.filter((s) => !client.scopes.includes(s));
      const denied = ungrantableScopes(access, added);
      if (denied.length) { res.status(403).json({ error: `You are not permitted to grant: ${denied.join(", ")}.`, code: "scope_forbidden" }); return; }
    }
    set.scopes = scopes;
  }
  if (body.allowedAssetIds !== undefined) {
    if (!Array.isArray(body.allowedAssetIds) || body.allowedAssetIds.some((s) => typeof s !== "string" || !UUID_RE.test(s))) {
      res.status(400).json({ error: "allowedAssetIds must be a list of asset ids" }); return;
    }
    const ids = [...new Set(body.allowedAssetIds as string[])].slice(0, 500);
    if (ids.length) {
      const found = await db.select({ id: assetsTable.id, parentId: assetsTable.parentId }).from(assetsTable);
      const exists = new Set(found.map((a) => a.id));
      const missing = ids.filter((i) => !exists.has(i));
      if (missing.length) { res.status(400).json({ error: `Unknown asset: ${missing.join(", ")}`, code: "unknown_asset" }); return; }
      if (client.projectId) {
        const { assetSubtree } = await import("../lib/asset-subtree");
        const inProject = assetSubtree([client.projectId], found);
        const outside = ids.filter((i) => !inProject.has(i));
        if (outside.length) { res.status(400).json({ error: "Every asset must belong to the client's project.", code: "asset_outside_project" }); return; }
      }
    }
    set.allowedAssetIds = ids;
  }
  for (const key of ["maxRows", "maxRangeDays"] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === "") { set[key] = null; continue; }
    const n = Math.floor(Number(body[key]));
    if (!Number.isFinite(n) || n < 1 || n > (key === "maxRows" ? 100_000 : 3650)) { res.status(400).json({ error: `${key} is out of range` }); return; }
    set[key] = n;
  }
  if (body.sandbox !== undefined) set.sandbox = body.sandbox === true;
  if (body.template !== undefined) set.template = typeof body.template === "string" && CLIENT_TEMPLATES.some((t) => t.id === body.template) ? body.template : null;
  if (Object.keys(set).length === 0) { res.status(400).json({ error: "Nothing to change" }); return; }

  const [row] = await db.update(apiClientsTable).set(set).where(eq(apiClientsTable.id, client.id)).returning();
  const changes = Object.keys(set).map((k) => ({ field: k, from: (client as Record<string, unknown>)[k], to: (row as Record<string, unknown>)[k] }));
  void logActivity("api_client.access_changed", "api_client", client.id, client.name, Object.keys(set).join(", "), req, { changes });
  recordSecurityEvent({ type: "api_client.updated", outcome: "success", userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null, req,
    detail: { apiClientId: client.id, clientId: client.clientId, fields: Object.keys(set) } });
  res.json(clientView(row!));
});

/**
 * Rotate with a grace period: the new secret works at once and the old one
 * keeps working for `graceHours` (0–720), so the gateway can be updated
 * without a gap. graceHours 0 is an immediate cut-over.
 */
router.post("/integration/clients/:id/rotate", async (req, res): Promise<void> => {
  const client = await loadClient(req, res, String(req.params.id), { change: true });
  if (!client) return;
  const graceHours = Math.min(720, Math.max(0, Math.floor(Number((req.body ?? {}).graceHours ?? 24)) || 0));
  const oldHash = client.clientSecretHash ?? (client.clientSecret ? hashToken(client.clientSecret) : null);
  const newSecret = randomUUID();
  const [row] = await db.update(apiClientsTable).set({
    clientSecret: null, clientSecretHash: hashToken(newSecret), secretRotatedAt: new Date(),
    previousSecretHash: graceHours > 0 ? oldHash : null,
    previousSecretExpiresAt: graceHours > 0 && oldHash ? new Date(Date.now() + graceHours * HOUR) : null,
  }).where(eq(apiClientsTable.id, client.id)).returning();
  await revokeAccessTokens(client.id);
  void logActivity("api_client.secret_rotated", "api_client", client.id, client.name, graceHours ? `old secret valid ${graceHours} h more` : "immediate", req);
  recordSecurityEvent({ type: "api_client.secret_rotated", outcome: "success", userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null, req,
    detail: { apiClientId: client.id, clientId: client.clientId, graceHours } });
  res.json({ ...clientView(row!), clientSecret: newSecret });
});

router.post("/integration/clients/:id/end-grace", async (req, res): Promise<void> => {
  const client = await loadClient(req, res, String(req.params.id), { change: true });
  if (!client) return;
  const [row] = await db.update(apiClientsTable).set({ previousSecretHash: null, previousSecretExpiresAt: null })
    .where(eq(apiClientsTable.id, client.id)).returning();
  void logActivity("api_client.grace_ended", "api_client", client.id, client.name, "previous secret stopped", req);
  res.json(clientView(row!));
});

router.get("/integration/clients/:id/usage", async (req, res): Promise<void> => {
  const client = await loadClient(req, res, String(req.params.id));
  if (!client) return;
  const hours = Math.min(720, Math.max(1, Math.floor(Number(req.query.hours ?? 24)) || 24));
  const since = new Date(Date.now() - hours * HOUR);
  const where = and(eq(apiRequestLogTable.apiClientId, client.id), gte(apiRequestLogTable.ts, since));
  const bucket = hours > 72 ? "day" : "hour";
  const [series, paths, recent, denials] = await Promise.all([
    db.select({
      at: sql<string>`date_trunc(${bucket}, ${apiRequestLogTable.ts})`,
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${apiRequestLogTable.statusCode} >= 400)::int`,
      avgMs: sql<number>`coalesce(avg(${apiRequestLogTable.durationMs}), 0)::int`,
    }).from(apiRequestLogTable).where(where).groupBy(sql`1`).orderBy(sql`1`),
    db.select({
      method: apiRequestLogTable.method, path: apiRequestLogTable.path,
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${apiRequestLogTable.statusCode} >= 400)::int`,
      avgMs: sql<number>`coalesce(avg(${apiRequestLogTable.durationMs}), 0)::int`,
    }).from(apiRequestLogTable).where(where).groupBy(apiRequestLogTable.method, apiRequestLogTable.path).orderBy(desc(sql`3`)).limit(20),
    db.select().from(apiRequestLogTable).where(where).orderBy(desc(apiRequestLogTable.ts)).limit(100),
    db.select({ at: securityEventsTable.createdAt, type: securityEventsTable.eventType, reason: securityEventsTable.reason, ip: securityEventsTable.ip, detail: securityEventsTable.detail })
      .from(securityEventsTable)
      .where(and(gte(securityEventsTable.createdAt, since), eq(securityEventsTable.outcome, "failure"), sql`${securityEventsTable.detail}->>'apiClientId' = ${client.id}`))
      .orderBy(desc(securityEventsTable.createdAt)).limit(50),
  ]);
  const total = series.reduce((s, r) => s + r.total, 0);
  const errors = series.reduce((s, r) => s + r.errors, 0);
  res.json({ client: clientView(client), hours, bucket, total, errors, series, paths, recent, denials });
});

// ── Alerts ───────────────────────────────────────────────────────────────────

router.get("/integration/alerts", async (req, res): Promise<void> => {
  const now = Date.now();
  const { restricted, allowed } = projectFilter(req);
  const [clients, dests, deadCounts, failures, connectors] = await Promise.all([
    db.select().from(apiClientsTable),
    db.select().from(destinationsTable),
    db.select({ destinationId: destinationDeliveriesTable.destinationId, n: sql<number>`count(*)::int` })
      .from(destinationDeliveriesTable)
      .where(and(eq(destinationDeliveriesTable.status, "dead"), gte(destinationDeliveriesTable.updatedAt, new Date(now - 24 * HOUR))))
      .groupBy(destinationDeliveriesTable.destinationId),
    db.select({ clientId: sql<string>`${securityEventsTable.detail}->>'apiClientId'`, n: sql<number>`count(*)::int` })
      .from(securityEventsTable)
      .where(and(gte(securityEventsTable.createdAt, new Date(now - HOUR)), eq(securityEventsTable.outcome, "failure"), sql`${securityEventsTable.detail} ? 'apiClientId'`))
      .groupBy(sql`1`),
    db.select().from(pullConnectorsTable),
  ]);
  type Alert = { level: "high" | "medium" | "low"; kind: string; title: string; detail: string; targetId: string; target: "client" | "destination" | "connector" };
  const alerts: Alert[] = [];
  const visible = clients.filter((c) => !restricted || (c.projectId && allowed.has(c.projectId)));
  const failuresBy = new Map(failures.map((f) => [f.clientId, f.n]));
  for (const c of visible) {
    if (c.status !== "active") continue;
    if (c.expiresAt) {
      const days = (c.expiresAt.getTime() - now) / 86_400_000;
      if (days < 0) alerts.push({ level: "high", kind: "expired", title: `${c.name}: key has expired`, detail: "Requests with this key are refused. Extend or rotate it.", targetId: c.id, target: "client" });
      else if (days <= 7) alerts.push({ level: "medium", kind: "expiring", title: `${c.name}: key expires in ${Math.ceil(days)} day(s)`, detail: "Rotate it or extend the expiry before it stops working.", targetId: c.id, target: "client" });
    }
    const lastSeen = c.lastUsedAt?.getTime() ?? c.createdAt.getTime();
    if (now - lastSeen > 90 * 86_400_000) alerts.push({ level: "low", kind: "unused", title: `${c.name}: not used for 90+ days`, detail: "An unused key is a risk with no benefit. Revoke it if nothing needs it.", targetId: c.id, target: "client" });
    if (c.scopes.length === 0 || c.scopes.includes(API_SCOPE_ALL)) alerts.push({ level: "medium", kind: "super_key", title: `${c.name}: full-access key`, detail: "This key can do everything. Give it only the scopes it needs.", targetId: c.id, target: "client" });
    const fails = failuresBy.get(c.id) ?? 0;
    if (fails >= 20) alerts.push({ level: "high", kind: "auth_failures", title: `${c.name}: ${fails} refused requests in the last hour`, detail: "Wrong address, missing scope or out-of-project access. Check the Usage tab.", targetId: c.id, target: "client" });
    if (c.previousSecretHash && c.previousSecretExpiresAt && c.previousSecretExpiresAt.getTime() > now) {
      alerts.push({ level: "low", kind: "grace", title: `${c.name}: old secret still accepted`, detail: `Until ${c.previousSecretExpiresAt.toISOString()}. End the grace period once the gateway uses the new secret.`, targetId: c.id, target: "client" });
    }
  }
  if (!restricted) {
    const deadBy = new Map(deadCounts.map((d) => [d.destinationId, d.n]));
    for (const d of dests) {
      if (!d.enabled) continue;
      const dead = deadBy.get(d.id) ?? 0;
      if (dead > 0) alerts.push({ level: "high", kind: "dead_deliveries", title: `${d.name}: ${dead} undelivered event(s) in 24 h`, detail: "Retries ran out. Fix the receiver, then use Resend on the Deliveries tab.", targetId: d.id, target: "destination" });
      else if (d.lastError) alerts.push({ level: "medium", kind: "destination_error", title: `${d.name}: last send failed`, detail: d.lastError, targetId: d.id, target: "destination" });
    }
    for (const c of connectors) {
      if (c.enabled && c.lastStatus === "error") alerts.push({ level: "high", kind: "connector_error", title: `${c.name}: connector failing`, detail: c.lastError ?? "Read failed", targetId: c.id, target: "connector" });
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);
  res.json(alerts);
});

// ── Destinations: delivery settings, log, resend, signing ────────────────────

router.get("/integration/destinations", async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 24 * HOUR);
  const [dests, stats] = await Promise.all([
    db.select().from(destinationsTable).orderBy(destinationsTable.name),
    db.select({
      destinationId: destinationDeliveriesTable.destinationId,
      delivered: sql<number>`count(*) filter (where ${destinationDeliveriesTable.status} = 'delivered')::int`,
      pending: sql<number>`count(*) filter (where ${destinationDeliveriesTable.status} = 'pending')::int`,
      dead: sql<number>`count(*) filter (where ${destinationDeliveriesTable.status} = 'dead')::int`,
      avgMs: sql<number>`coalesce(avg(${destinationDeliveriesTable.durationMs}) filter (where ${destinationDeliveriesTable.status} = 'delivered'), 0)::int`,
    }).from(destinationDeliveriesTable).where(gte(destinationDeliveriesTable.createdAt, since)).groupBy(destinationDeliveriesTable.destinationId),
  ]);
  const byDest = new Map(stats.map((s) => [s.destinationId, s]));
  res.json(dests.map((d) => ({
    id: d.id, name: d.name, endpoint: d.endpoint, enabled: d.enabled, eventTypes: d.eventTypes, authType: d.authType,
    deliveryMode: d.deliveryMode, signatureEnabled: d.signatureEnabled, hasSigningSecret: !!d.secretKey, projectId: d.projectId,
    maxAttempts: d.maxAttempts, lastSentAt: d.lastSentAt, lastError: d.lastError, sendCount: d.sendCount,
    stats24h: byDest.get(d.id) ?? { delivered: 0, pending: 0, dead: 0, avgMs: 0 },
  })));
});

router.put("/integration/destinations/:id/delivery", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const set: Partial<typeof destinationsTable.$inferInsert> = {};
  if (body.deliveryMode !== undefined) {
    if (body.deliveryMode !== "direct" && body.deliveryMode !== "queued") { res.status(400).json({ error: "deliveryMode must be direct or queued" }); return; }
    set.deliveryMode = body.deliveryMode;
  }
  if (body.signatureEnabled !== undefined) set.signatureEnabled = body.signatureEnabled === true;
  if (body.projectId !== undefined) {
    if (body.projectId === null || body.projectId === "") set.projectId = null;
    else if (typeof body.projectId === "string" && UUID_RE.test(body.projectId)) set.projectId = body.projectId;
    else { res.status(400).json({ error: "Invalid projectId" }); return; }
  }
  if (body.maxAttempts !== undefined) {
    const n = Math.floor(Number(body.maxAttempts));
    if (!Number.isFinite(n) || n < 1 || n > 20) { res.status(400).json({ error: "maxAttempts must be 1–20" }); return; }
    set.maxAttempts = n;
  }
  if (body.eventTypes !== undefined) {
    const valid = new Set<string>(["*", "alarm", "telemetry", "asset", "connector", ...EVENT_TYPES.map((e) => e.id)]);
    if (!Array.isArray(body.eventTypes) || body.eventTypes.some((e) => typeof e !== "string" || !valid.has(e))) { res.status(400).json({ error: "Unknown event type" }); return; }
    set.eventTypes = [...new Set(body.eventTypes as string[])];
  }
  if (Object.keys(set).length === 0) { res.status(400).json({ error: "Nothing to change" }); return; }
  const [before] = await db.select().from(destinationsTable).where(eq(destinationsTable.id, id));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  if (set.signatureEnabled && !before.secretKey) { res.status(400).json({ error: "Generate a signing secret first.", code: "no_signing_secret" }); return; }
  const [row] = await db.update(destinationsTable).set(set).where(eq(destinationsTable.id, id)).returning();
  const changes = Object.keys(set).map((k) => ({ field: k, from: (before as Record<string, unknown>)[k], to: (row as Record<string, unknown>)[k] }));
  void logActivity("destination.delivery_changed", "destination", id, row!.name, Object.keys(set).join(", "), req, { changes });
  res.json({ ok: true });
});

router.post("/integration/destinations/:id/signing-secret", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const secret = newSigningSecret();
  const [row] = await db.update(destinationsTable)
    .set({ secretKey: encryptSecret(secret, "destinations.secretKey"), signatureEnabled: true })
    .where(eq(destinationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  void logActivity("destination.signing_secret_set", "destination", id, row.name, "new signing secret; signatures on", req);
  // Shown once; it is encrypted at rest and never returned again.
  res.json({ signingSecret: secret, signatureEnabled: true });
});

/** Queue a test event to one destination, through the same worker and retries as real events. */
router.post("/integration/destinations/:id/test-event", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [dest] = await db.select().from(destinationsTable).where(eq(destinationsTable.id, id));
  if (!dest) { res.status(404).json({ error: "Not found" }); return; }
  if (dest.deliveryMode !== "queued") { res.status(400).json({ error: "Switch this destination to queued delivery first. Direct destinations use the Test button on the Destinations tab.", code: "not_queued" }); return; }
  const [event] = await db.insert(integrationEventsTable).values({
    type: "test", payload: { type: "test", message: "Test event from Integration Hub", by: req.principal?.user.username ?? null },
  }).returning();
  const [delivery] = await db.insert(destinationDeliveriesTable).values({ eventId: event!.id, destinationId: id, eventType: "test" }).returning();
  res.status(202).json({ queued: true, deliveryId: delivery!.id });
});

router.get("/integration/deliveries", async (req, res): Promise<void> => {
  const conditions: SQL[] = [];
  if (typeof req.query.destinationId === "string" && UUID_RE.test(req.query.destinationId)) conditions.push(eq(destinationDeliveriesTable.destinationId, req.query.destinationId));
  if (typeof req.query.status === "string" && ["pending", "delivered", "dead"].includes(req.query.status)) conditions.push(eq(destinationDeliveriesTable.status, req.query.status));
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
  const rows = await db.select({
    id: destinationDeliveriesTable.id, destinationId: destinationDeliveriesTable.destinationId, destinationName: destinationsTable.name,
    eventId: destinationDeliveriesTable.eventId, eventType: destinationDeliveriesTable.eventType, status: destinationDeliveriesTable.status,
    attempts: destinationDeliveriesTable.attempts, nextAttemptAt: destinationDeliveriesTable.nextAttemptAt,
    lastStatusCode: destinationDeliveriesTable.lastStatusCode, lastError: destinationDeliveriesTable.lastError,
    durationMs: destinationDeliveriesTable.durationMs, deliveredAt: destinationDeliveriesTable.deliveredAt,
    createdAt: destinationDeliveriesTable.createdAt, payload: integrationEventsTable.payload,
  }).from(destinationDeliveriesTable)
    .leftJoin(destinationsTable, eq(destinationsTable.id, destinationDeliveriesTable.destinationId))
    .leftJoin(integrationEventsTable, eq(integrationEventsTable.id, destinationDeliveriesTable.eventId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(destinationDeliveriesTable.createdAt)).limit(limit);
  res.json(rows);
});

router.post("/integration/deliveries/:id/resend", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(destinationDeliveriesTable)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null })
    .where(eq(destinationDeliveriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  void logActivity("destination.delivery_resent", "destination", row.destinationId, null, `delivery ${row.id} (${row.eventType})`, req);
  res.json({ ok: true });
});

router.post("/integration/destinations/:id/resend-dead", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.update(destinationDeliveriesTable)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null })
    .where(and(eq(destinationDeliveriesTable.destinationId, id), eq(destinationDeliveriesTable.status, "dead")))
    .returning({ id: destinationDeliveriesTable.id });
  void logActivity("destination.deliveries_resent", "destination", id, null, `${rows.length} undelivered event(s) queued again`, req);
  res.json({ resent: rows.length });
});

/** Check a signature the way a receiver would; used by the Integration Guide. */
router.post("/integration/verify-signature", (req, res): void => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const secret = String(b.secret ?? ""), body = String(b.body ?? ""), signature = String(b.signature ?? "");
  const ts = Math.floor(Number(b.timestamp));
  if (!secret || !Number.isFinite(ts)) { res.status(400).json({ error: "Send secret, timestamp, body and signature." }); return; }
  const expected = signPayload(secret, ts, body);
  res.json({ valid: !!signature && verifySignature(secret, ts, body, signature, Number.MAX_SAFE_INTEGER), expected });
});

// ── Pull connectors ──────────────────────────────────────────────────────────

function connectorView(c: typeof pullConnectorsTable.$inferSelect) {
  const { secretEnc, ...rest } = c;
  return { ...rest, hasSecret: !!secretEnc };
}

function validateConnector(type: string, config: Record<string, unknown>): string | null {
  if (type === "rest") {
    const url = String(config.url ?? "");
    const check = checkOutboundUrl(url);
    return check.ok ? null : check.error;
  }
  if (type === "sql") {
    try { assertSelectOnly(String(config.query ?? "")); } catch (e) { return (e as Error).message; }
    return null;
  }
  if (type === "modbus") {
    if (!config.host) return "Set the Modbus host.";
    if (!config.deviceId) return "Set the device id (asset identifier) the readings belong to.";
    if (!Array.isArray(config.registers) || config.registers.length === 0) return "Add at least one register.";
    return null;
  }
  if (type === "opcua") return config.endpointUrl ? null : "Set the OPC UA endpoint URL.";
  return "Unknown connector type";
}

router.get("/integration/connectors", async (_req, res): Promise<void> => {
  const rows = await db.select().from(pullConnectorsTable).orderBy(pullConnectorsTable.name);
  res.json(rows.map(connectorView));
});

router.post("/integration/connectors", async (req, res): Promise<void> => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const type = String(b.type ?? "");
  if (!(CONNECTOR_TYPES as readonly string[]).includes(type)) { res.status(400).json({ error: "type must be rest, sql, modbus or opcua" }); return; }
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 120) : "";
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }
  const config = b.config && typeof b.config === "object" && !Array.isArray(b.config) ? b.config as Record<string, unknown> : {};
  const problem = validateConnector(type, config);
  if (problem) { res.status(400).json({ error: problem, code: "invalid_config" }); return; }
  const id = randomUUID();
  const [row] = await db.insert(pullConnectorsTable).values({
    id, name, type, description: typeof b.description === "string" ? b.description.slice(0, 500) : null,
    projectId: typeof b.projectId === "string" && UUID_RE.test(b.projectId) ? b.projectId : null,
    enabled: false,
    intervalSec: Math.min(86_400, Math.max(5, Math.floor(Number(b.intervalSec ?? 60)) || 60)),
    config, secretEnc: typeof b.secret === "string" && b.secret ? encryptSecret(b.secret, secretContext(id)) : null,
  }).returning();
  void logActivity("connector.created", "connector", id, name, type, req);
  res.status(201).json(connectorView(row!));
});

router.put("/integration/connectors/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [current] = await db.select().from(pullConnectorsTable).where(eq(pullConnectorsTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const set: Partial<typeof pullConnectorsTable.$inferInsert> = {};
  if (typeof b.name === "string" && b.name.trim()) set.name = b.name.trim().slice(0, 120);
  if (b.description !== undefined) set.description = typeof b.description === "string" ? b.description.slice(0, 500) : null;
  if (b.projectId !== undefined) set.projectId = typeof b.projectId === "string" && UUID_RE.test(b.projectId) ? b.projectId : null;
  if (b.intervalSec !== undefined) set.intervalSec = Math.min(86_400, Math.max(5, Math.floor(Number(b.intervalSec)) || 60));
  if (b.enabled !== undefined) set.enabled = b.enabled === true;
  if (b.config !== undefined) {
    if (!b.config || typeof b.config !== "object" || Array.isArray(b.config)) { res.status(400).json({ error: "config must be an object" }); return; }
    const problem = validateConnector(current.type, b.config as Record<string, unknown>);
    if (problem) { res.status(400).json({ error: problem, code: "invalid_config" }); return; }
    set.config = b.config as Record<string, unknown>;
  }
  // Omitted = keep; empty string = clear (same convention as destinations).
  if (b.secret !== undefined) set.secretEnc = typeof b.secret === "string" && b.secret ? encryptSecret(b.secret, secretContext(id)) : null;
  if (Object.keys(set).length === 0) { res.status(400).json({ error: "Nothing to change" }); return; }
  const [row] = await db.update(pullConnectorsTable).set(set).where(eq(pullConnectorsTable.id, id)).returning();
  void logActivity(set.enabled === undefined ? "connector.updated" : set.enabled ? "connector.enabled" : "connector.disabled", "connector", id, row!.name,
    Object.keys(set).filter((k) => k !== "secretEnc").join(", ") || "secret", req);
  res.json(connectorView(row!));
});

router.delete("/integration/connectors/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(pullConnectorsTable).where(eq(pullConnectorsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  void logActivity("connector.deleted", "connector", id, row.name, row.type, req);
  res.sendStatus(204);
});

/** Read once without storing: shows the first readings so mapping can be checked. */
router.post("/integration/connectors/:id/test", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(pullConnectorsTable).where(eq(pullConnectorsTable.id, id));
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await runConnector(c, { dryRun: true }));
});

router.post("/integration/connectors/:id/run", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(pullConnectorsTable).where(eq(pullConnectorsTable.id, id));
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  const result = await runAndRecord(c);
  void logActivity("connector.run", "connector", id, c.name, `${result.status}: ${result.records} record(s)`, req, { outcome: result.ok ? "success" : "failure" });
  res.json(result);
});


export default router;
