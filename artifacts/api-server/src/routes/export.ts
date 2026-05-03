import { Router, type IRouter } from "express";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import {
  db, assetsTable, attributesTable, telemetryTable,
  alarmsTable, alarmHistoryTable, brokersTable,
} from "@workspace/db";
import { apiKeyAuth } from "../middleware/apiKeyAuth";

const router: IRouter = Router();

// ── CSV helper ────────────────────────────────────────────────────────────────
function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
}

function sendResult(
  res: import("express").Response,
  format: string | undefined,
  filename: string,
  data: Record<string, unknown>[],
  meta?: Record<string, unknown>
) {
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(toCSV(data));
  } else {
    res.json({ count: data.length, ...(meta ?? {}), data, exportedAt: new Date().toISOString() });
  }
}

// ── Platform health (no auth) ─────────────────────────────────────────────────
router.get("/export/health", async (_req, res): Promise<void> => {
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
    rateLimiting: { requestsPerMinute: 120, header: "Retry-After" },
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
router.get("/export/assets", apiKeyAuth("read:assets"), async (req, res): Promise<void> => {
  const { format } = req.query as Record<string, string | undefined>;
  const assets = await db.select().from(assetsTable).orderBy(assetsTable.name);
  const attrs  = await db.select().from(attributesTable);

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
router.get("/export/telemetry", apiKeyAuth("read:telemetry"), async (req, res): Promise<void> => {
  const { assetId, metric, from, to, limit, format } = req.query as Record<string, string | undefined>;
  const maxLimit = Math.min(Number(limit ?? 500), 5000);

  const conditions = [];
  if (assetId) conditions.push(eq(telemetryTable.assetId, assetId));
  if (metric)  conditions.push(eq(telemetryTable.metric, metric));
  if (from)    conditions.push(gte(telemetryTable.timestamp, new Date(from) as unknown as Date));
  if (to)      conditions.push(lte(telemetryTable.timestamp, new Date(to) as unknown as Date));

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
router.get("/export/alarms", apiKeyAuth("read:alarms"), async (req, res): Promise<void> => {
  const { status, severity, format } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (status)   conditions.push(eq(alarmsTable.status, status));
  if (severity) conditions.push(eq(alarmsTable.severity, severity));

  const rows = await db
    .select()
    .from(alarmsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alarmsTable.triggeredAt));

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

  sendResult(res, format, "alarms", flat as Record<string, unknown>[]);
});

// ── Alarm history export ──────────────────────────────────────────────────────
router.get("/export/alarm-history", apiKeyAuth("read:alarm-history"), async (req, res): Promise<void> => {
  const { assetId, from, to, limit, format } = req.query as Record<string, string | undefined>;
  const maxLimit = Math.min(Number(limit ?? 200), 5000);

  const conditions = [];
  if (assetId) conditions.push(eq(alarmHistoryTable.assetId, assetId));
  if (from)    conditions.push(gte(alarmHistoryTable.triggeredAt, new Date(from) as unknown as Date));
  if (to)      conditions.push(lte(alarmHistoryTable.triggeredAt, new Date(to) as unknown as Date));

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
