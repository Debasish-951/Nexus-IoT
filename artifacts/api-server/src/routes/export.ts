import { Router, type IRouter } from "express";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import {
  db, assetsTable, attributesTable, telemetryTable,
  alarmsTable, alarmHistoryTable,
} from "@workspace/db";
import { apiKeyAuth } from "../middleware/apiKeyAuth";

const router: IRouter = Router();

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
    scopes: {
      "read:assets":        "List all assets and their current attribute values",
      "read:telemetry":     "Query time-series telemetry data",
      "read:alarms":        "Read active alarm list",
      "read:alarm-history": "Read full alarm event history",
      "*":                  "All scopes (super-key — use carefully)",
    },
    endpoints: [
      {
        method: "GET", path: "/api/export/assets",
        scope: "read:assets",
        description: "All assets with their latest attribute values",
        queryParams: [],
      },
      {
        method: "GET", path: "/api/export/telemetry",
        scope: "read:telemetry",
        description: "Time-series telemetry for an asset metric",
        queryParams: [
          { name: "assetId",  required: false, description: "Filter by asset UUID" },
          { name: "metric",   required: false, description: "Filter by metric name" },
          { name: "from",     required: false, description: "ISO 8601 start timestamp" },
          { name: "to",       required: false, description: "ISO 8601 end timestamp" },
          { name: "limit",    required: false, description: "Max rows (default 500, max 5000)" },
        ],
      },
      {
        method: "GET", path: "/api/export/alarms",
        scope: "read:alarms",
        description: "Current alarm list",
        queryParams: [
          { name: "status",   required: false, description: "active | acknowledged | cleared" },
          { name: "severity", required: false, description: "critical | high | medium | low | info" },
        ],
      },
      {
        method: "GET", path: "/api/export/alarm-history",
        scope: "read:alarm-history",
        description: "Alarm event history",
        queryParams: [
          { name: "assetId", required: false, description: "Filter by asset UUID" },
          { name: "from",    required: false, description: "ISO 8601 start timestamp" },
          { name: "to",      required: false, description: "ISO 8601 end timestamp" },
          { name: "limit",   required: false, description: "Max rows (default 200, max 5000)" },
        ],
      },
    ],
  });
});

// ── Assets export ─────────────────────────────────────────────────────────────
router.get("/export/assets", apiKeyAuth("read:assets"), async (req, res): Promise<void> => {
  const assets = await db.select().from(assetsTable).orderBy(assetsTable.name);

  // Attach latest attribute values
  const attrs = await db.select().from(attributesTable);
  const attrsByAsset: Record<string, any[]> = {};
  for (const a of attrs) {
    if (!attrsByAsset[a.assetId]) attrsByAsset[a.assetId] = [];
    attrsByAsset[a.assetId].push({
      name: a.name,
      value: a.value,
      unit: a.unit,
      dataType: a.dataType,
      updatedAt: a.updatedAt,
    });
  }

  const result = assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    location: asset.location,
    status: asset.status,
    healthScore: asset.healthScore,
    attributes: attrsByAsset[asset.id] ?? [],
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }));

  res.json({ count: result.length, data: result, exportedAt: new Date().toISOString() });
});

// ── Telemetry export ──────────────────────────────────────────────────────────
router.get("/export/telemetry", apiKeyAuth("read:telemetry"), async (req, res): Promise<void> => {
  const { assetId, metric, from, to, limit } = req.query as Record<string, string | undefined>;
  const maxLimit = Math.min(Number(limit ?? 500), 5000);

  const conditions = [];
  if (assetId) conditions.push(eq(telemetryTable.assetId, assetId));
  if (metric)  conditions.push(eq(telemetryTable.metric, metric));
  if (from)    conditions.push(gte(telemetryTable.timestamp, new Date(from) as unknown as Date));
  if (to)      conditions.push(lte(telemetryTable.timestamp, new Date(to)   as unknown as Date));

  const rows = await db
    .select()
    .from(telemetryTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(telemetryTable.timestamp))
    .limit(maxLimit);

  res.json({
    count: rows.length,
    limit: maxLimit,
    data: rows,
    exportedAt: new Date().toISOString(),
  });
});

// ── Alarms export ─────────────────────────────────────────────────────────────
router.get("/export/alarms", apiKeyAuth("read:alarms"), async (req, res): Promise<void> => {
  const { status, severity } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (status)   conditions.push(eq(alarmsTable.status, status));
  if (severity) conditions.push(eq(alarmsTable.severity, severity));

  const rows = await db
    .select()
    .from(alarmsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alarmsTable.triggeredAt));

  res.json({ count: rows.length, data: rows, exportedAt: new Date().toISOString() });
});

// ── Alarm history export ──────────────────────────────────────────────────────
router.get("/export/alarm-history", apiKeyAuth("read:alarm-history"), async (req, res): Promise<void> => {
  const { assetId, from, to, limit } = req.query as Record<string, string | undefined>;
  const maxLimit = Math.min(Number(limit ?? 200), 5000);

  const conditions = [];
  if (assetId) conditions.push(eq(alarmHistoryTable.assetId, assetId));
  if (from)    conditions.push(gte(alarmHistoryTable.triggeredAt, new Date(from) as unknown as Date));
  if (to)      conditions.push(lte(alarmHistoryTable.triggeredAt, new Date(to)   as unknown as Date));

  const rows = await db
    .select()
    .from(alarmHistoryTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alarmHistoryTable.triggeredAt))
    .limit(maxLimit);

  res.json({ count: rows.length, limit: maxLimit, data: rows, exportedAt: new Date().toISOString() });
});

export default router;
