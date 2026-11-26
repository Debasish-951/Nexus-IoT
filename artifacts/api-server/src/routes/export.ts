import { Router, type IRouter } from "express";
import { authConfig } from "../lib/auth-config";
import { eq, and, desc, gte, lte, sql, inArray, type SQL } from "drizzle-orm";
import {
  db, assetsTable, attributesTable, telemetryTable,
  alarmsTable, alarmHistoryTable, brokersTable,
} from "@workspace/db";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { logActivity } from "./activity_log";
import { csvCell, safeFilename } from "../lib/validation";
import { validate } from "../middleware/validate";
import { z } from "zod";
import { exportScope, exportAssetDecision, refuseExportAsset } from "../lib/project-access";
import {
  ExportQuery, TelemetryExportQuery, AlarmExportQuery, AlarmHistoryExportQuery,
} from "../schemas/common";

const router: IRouter = Router();

/**
 * Per-client read limits (Integration Hub → API Client → Access). Both are
 * optional; a client without them is answered exactly as before.
 */
function capRows(req: import("express").Request, requested: number): number {
  const max = req.apiClient?.maxRows;
  return max && max > 0 ? Math.min(requested, max) : requested;
}
function capFrom(req: import("express").Request, from: Date | undefined, to: Date | undefined): Date | undefined {
  const days = req.apiClient?.maxRangeDays;
  if (!days || days <= 0) return from;
  const earliest = new Date((to ?? new Date()).getTime() - days * 86_400_000);
  return !from || from < earliest ? earliest : from;
}

// Data leaving the platform is audited: one entry per successful export
// download (who, which dataset, the filters used). Nothing of the data itself.
router.use((req, res, next) => {
  const kind = req.path.match(/^\/export\/(assets|telemetry|alarms|alarm-history)$/)?.[1];
  if (!kind) { next(); return; }
  res.on("finish", () => {
    if (req.method !== "GET" || res.statusCode !== 200) return;
    const q = Object.entries(req.query).filter(([k]) => !/key|token|secret/i.test(k)).map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(" ");
    void logActivity("export.downloaded", "export", null, kind, q || null, req, { assetId: typeof req.query.assetId === "string" ? req.query.assetId : null });
  });
  next();
});

// ── CSV helper ────────────────────────────────────────────────────────────────
//
// Cells go through `csvCell`, which does RFC 4180 quoting AND neutralises
// spreadsheet formulas. The previous version quoted correctly but did not do the
// second part, so a value beginning `=`, `+`, `-` or `@` was written to the file
// as-is and executed as a formula when the export was opened. Asset names,
// metric names and alarm descriptions are all user-supplied and all end up in
// these columns, which made the export a delivery mechanism for code running in
// the recipient's spreadsheet — outside this application entirely.
function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((h) => cell(row[h])).join(",")),
  ].join("\r\n"); // RFC 4180 line ending; Excel is happier and Unix tools do not care
}

/**
 * One CSV cell. A finite number cannot be a formula, so it is written as-is
 * (csvCell would turn -5 into the text '-5). Objects such as a JSON trigger
 * value are serialised rather than written as "[object Object]".
 */
function cell(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (v !== null && typeof v === "object" && !(v instanceof Date)) return csvCell(JSON.stringify(v));
  return csvCell(v);
}

function sendResult(
  res: import("express").Response,
  format: string | undefined,
  filename: string,
  data: Record<string, unknown>[],
  meta?: Record<string, unknown>
) {
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // Every current caller passes a literal, so this is not a live hole — it is
    // closed because the function's signature accepts any string and the next
    // caller may well pass an asset name. A quote or CR/LF here would terminate
    // the header and let the rest inject headers of its own; `../` would be a
    // path-traversal hint to whatever writes the download.
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(filename)}.csv"`);
    res.send(toCSV(data));
  } else {
    res.json({ count: data.length, ...(meta ?? {}), data, exportedAt: new Date().toISOString() });
  }
}

// ── Platform health (no auth) ─────────────────────────────────────────────────
router.get("/export/health", async (req, res): Promise<void> => {
  // Public so uptime monitors can reach it, which is why it answers only "up"
  // to anonymous callers. It used to publish the asset count, active alarm count,
  // connected brokers and ingest rate to anyone on the internet. The figures are
  // still returned to a signed-in user who is not restricted to some projects.
  const showStats = !!req.principal && !req.principal.access?.restrictProjects;
  if (!showStats) {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
    return;
  }
  const [[assetRow], [alarmRow], [brokerRow], [telRow]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(assetsTable),
    db.select({ count: sql<number>`count(*)::int` }).from(alarmsTable).where(eq(alarmsTable.status, "active")),
    db.select({ count: sql<number>`count(*)::int` }).from(brokersTable).where(eq(brokersTable.status, "connected")),
    db.select({ count: sql<number>`count(*)::int` }).from(telemetryTable)
      .where(gte(telemetryTable.timestamp, new Date(Date.now() - 60_000) as unknown as Date)),
  ]);

  // Maintenance assets count
  const [maintRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(eq(assetsTable.maintenanceMode, true));

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    platform: "IoT Data Acquisition Platform",
    version: "1.0",
    stats: {
      totalAssets:        assetRow?.count  ?? 0,
      activeAlarms:       alarmRow?.count  ?? 0,
      connectedBrokers:   brokerRow?.count ?? 0,
      telemetryRateLast60s: telRow?.count  ?? 0,
      assetsInMaintenance:  maintRow?.count ?? 0,
    },
  });
});

// ── Self-documenting schema (no auth) ─────────────────────────────────────────
router.get("/export/schema", (_req, res) => {
  res.json({
    version: "1.0",
    baseUrl: "/api/export",
    authentication: {
      methods: [
        { header: "Authorization", format: "Bearer <clientSecret>" },
        { header: "X-API-Key",     format: "<clientSecret>" },
      ],
      note: "Create an API Client in the Security → API Clients section to obtain a clientSecret.",
    },
    // The real per-client limit (INGEST_RATE_LIMIT_RPM), not a fixed figure.
    rateLimiting: { requestsPerMinute: authConfig.apiKey.rateLimitRpm, header: "Retry-After" },
    scopes: {
      "read:assets":        "List all assets and their current attribute values",
      "read:telemetry":     "Query time-series telemetry data",
      "read:alarms":        "Read active alarm list",
      "read:alarm-history": "Read full alarm event history",
      "*":                  "All scopes (super-key — use carefully)",
    },
    formats: ["json (default)", "csv (add ?format=csv)"],
    endpoints: [
      {
        method: "GET", path: "/api/export/health",
        auth: false,
        description: "Platform health snapshot — no authentication required",
      },
      {
        method: "GET", path: "/api/export/assets",
        scope: "read:assets",
        description: "All assets with their latest attribute values",
        queryParams: [{ name: "format", values: "json|csv" }],
      },
      {
        method: "GET", path: "/api/export/telemetry",
        scope: "read:telemetry",
        description: "Time-series telemetry for an asset metric",
        queryParams: [
          { name: "assetId",  description: "Filter by asset UUID" },
          { name: "metric",   description: "Filter by metric name" },
          { name: "from",     description: "ISO 8601 start timestamp" },
          { name: "to",       description: "ISO 8601 end timestamp" },
          { name: "limit",    description: "Max rows (default 500, max 5000)" },
          { name: "format",   values: "json|csv" },
        ],
      },
      {
        method: "GET", path: "/api/export/alarms",
        scope: "read:alarms",
        description: "Current alarm list",
        queryParams: [
          { name: "status",   values: "active|acknowledged|cleared" },
          { name: "severity", values: "critical|high|medium|low|info" },
          { name: "limit",    description: "Max rows, newest first (default 5000, max 5000)" },
          { name: "format",   values: "json|csv" },
        ],
      },
      {
        method: "GET", path: "/api/export/alarm-history",
        scope: "read:alarm-history",
        description: "Alarm event history",
        queryParams: [
          { name: "assetId", description: "Filter by asset UUID" },
          { name: "from",    description: "ISO 8601 start timestamp" },
          { name: "to",      description: "ISO 8601 end timestamp" },
          { name: "limit",   description: "Max rows (default 200, max 5000)" },
          { name: "format",  values: "json|csv" },
        ],
      },
    ],
  });
});

// ── Assets export ─────────────────────────────────────────────────────────────
router.get("/export/assets", apiKeyAuth("read:assets"), validate({ query: ExportQuery }), async (req, res): Promise<void> => {
  const { format } = req.query as z.infer<typeof ExportQuery>;
  // A project-assigned key sees only its project's assets and their attributes.
  const scope = await exportScope(req);
  const assets = (await db.select().from(assetsTable).orderBy(assetsTable.name))
    .filter((a) => !scope || scope.has(a.id));
  const attrs  = (await db.select().from(attributesTable))
    .filter((a) => !scope || scope.has(a.assetId));

  const attrsByAsset: Record<string, Array<{ name: string; value: unknown; unit: string | null; dataType: string; updatedAt: Date }>> = {};
  for (const a of attrs) {
    if (!attrsByAsset[a.assetId]) attrsByAsset[a.assetId] = [];
    attrsByAsset[a.assetId].push({ name: a.name, value: a.value, unit: a.uom, dataType: a.dataType, updatedAt: a.updatedAt });
  }

  if (format === "csv") {
    // Flat rows for CSV
    const rows: Record<string, unknown>[] = assets.map((asset) => ({
      id:               asset.id,
      name:             asset.name,
      identifier:       asset.identifier,
      description:      asset.description ?? "",
      tags:             (asset.tags ?? []).join("|"),
      maintenanceMode:  asset.maintenanceMode,
      maintenanceSince: asset.maintenanceSince?.toISOString() ?? "",
      maintenanceNote:  asset.maintenanceNote ?? "",
      attributeCount:   asset.attributeCount,
      createdAt:        asset.createdAt.toISOString(),
      updatedAt:        asset.updatedAt.toISOString(),
    }));
    sendResult(res, "csv", "assets", rows);
  } else {
    const result = assets.map((asset) => ({
      id:              asset.id,
      name:            asset.name,
      identifier:      asset.identifier,
      description:     asset.description,
      tags:            asset.tags,
      maintenanceMode: asset.maintenanceMode,
      maintenanceSince: asset.maintenanceSince,
      maintenanceNote:  asset.maintenanceNote,
      attributes:      attrsByAsset[asset.id] ?? [],
      createdAt:       asset.createdAt,
      updatedAt:       asset.updatedAt,
    }));
    sendResult(res, format, "assets", result as Record<string, unknown>[]);
  }
});

// ── Telemetry export ──────────────────────────────────────────────────────────
router.get("/export/telemetry", apiKeyAuth("read:telemetry"), validate({ query: TelemetryExportQuery }), async (req, res): Promise<void> => {
  const { assetId, metric, from, to, limit, format } = req.query as z.infer<typeof TelemetryExportQuery>;
  // Already bounded and coerced by the schema; no NaN can reach the query.
  const maxLimit = capRows(req, limit ?? 500);

  const scope = await exportScope(req);
  const decision = exportAssetDecision(scope, assetId);
  if (decision === "forbidden") { refuseExportAsset(req, res, assetId!); return; }

  const conditions: SQL[] = [];
  if (decision === "filtered" && !assetId) {
    if (scope!.size === 0) { sendResult(res, format, "telemetry", [], { limit: maxLimit }); return; }
    conditions.push(inArray(telemetryTable.assetId, [...scope!]));
  }
  if (assetId) conditions.push(eq(telemetryTable.assetId, assetId));
  if (metric)  conditions.push(eq(telemetryTable.metric, metric));
  const fromCapped = capFrom(req, from, to);
  if (fromCapped) conditions.push(gte(telemetryTable.timestamp, fromCapped));
  if (to)      conditions.push(lte(telemetryTable.timestamp, to));

  const rows = await db
    .select()
    .from(telemetryTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(telemetryTable.timestamp))
    .limit(maxLimit);

  const flat = rows.map((r) => ({
    id: r.id, assetId: r.assetId, deviceId: r.deviceId,
    metric: r.metric, value: r.value, quality: r.quality,
    timestamp: r.timestamp?.toISOString() ?? "",
  }));

  sendResult(res, format, "telemetry", flat as Record<string, unknown>[], { limit: maxLimit });
});

// ── Alarms export ─────────────────────────────────────────────────────────────
router.get("/export/alarms", apiKeyAuth("read:alarms"), validate({ query: AlarmExportQuery }), async (req, res): Promise<void> => {
  const { status, severity, limit, format } = req.query as z.infer<typeof AlarmExportQuery>;
  const maxLimit = capRows(req, limit ?? 5000);

  // Alarms with no asset (platform-wide) are left out for a project-assigned key.
  const scope = await exportScope(req);
  const conditions: SQL[] = [];
  if (scope) {
    if (scope.size === 0) { sendResult(res, format, "alarms", [], { limit: maxLimit }); return; }
    conditions.push(inArray(alarmsTable.assetId, [...scope]));
  }
  if (status)   conditions.push(eq(alarmsTable.status, status));
  if (severity) conditions.push(eq(alarmsTable.severity, severity));

  const rows = await db
    .select()
    .from(alarmsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alarmsTable.triggeredAt))
    .limit(maxLimit);

  const flat = rows.map((r) => ({
    id: r.id, assetId: r.assetId, assetName: r.assetName,
    name: r.name, ruleId: r.ruleId ?? "",
    alarmClass: r.alarmClass ?? "", message: r.message ?? "",
    triggerValue: r.triggerValue,
    severity: r.severity, status: r.status,
    triggeredAt: r.triggeredAt?.toISOString() ?? "",
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? "",
    clearedAt: r.clearedAt?.toISOString() ?? "",
  }));

  sendResult(res, format, "alarms", flat as Record<string, unknown>[], { limit: maxLimit });
});

// ── Alarm history export ──────────────────────────────────────────────────────
router.get("/export/alarm-history", apiKeyAuth("read:alarm-history"), validate({ query: AlarmHistoryExportQuery }), async (req, res): Promise<void> => {
  const { assetId, from, to, limit, format } = req.query as z.infer<typeof AlarmHistoryExportQuery>;
  const maxLimit = capRows(req, limit ?? 200);

  const scope = await exportScope(req);
  const decision = exportAssetDecision(scope, assetId);
  if (decision === "forbidden") { refuseExportAsset(req, res, assetId!); return; }

  const conditions: SQL[] = [];
  if (decision === "filtered" && !assetId) {
    if (scope!.size === 0) { sendResult(res, format, "alarm-history", [], { limit: maxLimit }); return; }
    conditions.push(inArray(alarmHistoryTable.assetId, [...scope!]));
  }
  if (assetId) conditions.push(eq(alarmHistoryTable.assetId, assetId));
  const historyFrom = capFrom(req, from, to);
  if (historyFrom) conditions.push(gte(alarmHistoryTable.triggeredAt, historyFrom));
  if (to)      conditions.push(lte(alarmHistoryTable.triggeredAt, to));

  const rows = await db
    .select()
    .from(alarmHistoryTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alarmHistoryTable.triggeredAt))
    .limit(maxLimit);

  const flat = rows.map((r) => ({
    id: r.id, alarmId: r.alarmId, assetId: r.assetId, assetName: r.assetName,
    name: r.name, severity: r.severity, status: r.status,
    triggeredAt: r.triggeredAt?.toISOString() ?? "",
    clearedAt: r.clearedAt?.toISOString() ?? "",
  }));

  sendResult(res, format, "alarm-history", flat as Record<string, unknown>[], { limit: maxLimit });
});

export default router;
