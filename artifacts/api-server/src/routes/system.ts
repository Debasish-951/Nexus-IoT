import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, isNull, or, lt } from "drizzle-orm";
import { db, assetsTable, telemetryTable, alarmsTable, dataRetentionTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Storage stats ──────────────────────────────────────────────────────────────
router.get("/system/storage", async (_req, res): Promise<void> => {
  const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(telemetryTable);
  const [oldestRow] = await db
    .select({ ts: telemetryTable.timestamp })
    .from(telemetryTable)
    .orderBy(telemetryTable.timestamp)
    .limit(1);
  const [newestRow] = await db
    .select({ ts: telemetryTable.timestamp })
    .from(telemetryTable)
    .orderBy(sql`${telemetryTable.timestamp} DESC`)
    .limit(1);

  // Per-asset breakdown
  const perAsset = await db
    .select({
      assetId: telemetryTable.assetId,
      count: sql<number>`count(*)::int`,
      metrics: sql<number>`count(distinct metric)::int`,
      oldest: sql<Date>`min(${telemetryTable.timestamp})`,
      newest: sql<Date>`max(${telemetryTable.timestamp})`,
    })
    .from(telemetryTable)
    .groupBy(telemetryTable.assetId);

  // Join asset names
  const assetNames: Record<string, string> = {};
  const assets = await db.select({ id: assetsTable.id, name: assetsTable.name }).from(assetsTable);
  for (const a of assets) assetNames[a.id] = a.name;

  // Approximate table sizes from pg_relation_size
  const sizeResult = await db.execute<{ size: string }>(
    sql`SELECT pg_size_pretty(pg_total_relation_size('telemetry')) AS size`
  );
  const sizeRow = sizeResult.rows?.[0] ?? (sizeResult as unknown as Record<string, unknown>[])[0];

  res.json({
    telemetry: {
      totalRows:  totalRow?.count  ?? 0,
      tableSize:  (sizeRow as Record<string, unknown>)?.size ?? "unknown",
      oldestRecord: oldestRow?.ts ?? null,
      newestRecord: newestRow?.ts ?? null,
    },
    perAsset: perAsset.map((r) => ({
      assetId:    r.assetId,
      assetName:  assetNames[r.assetId] ?? r.assetId,
      rows:       r.count,
      metrics:    r.metrics,
      oldest:     r.oldest,
      newest:     r.newest,
    })),
    generatedAt: new Date().toISOString(),
  });
});

// ── Aggregation endpoint ──────────────────────────────────────────────────────
// GET /api/system/aggregate?assetId=&metric=&bucket=1h|6h|1d|1w&from=&to=&limit=
router.get("/system/aggregate", async (req, res): Promise<void> => {
  const { assetId, metric, from, to, limit } = req.query as Record<string, string | undefined>;
  let bucket = (req.query.bucket as string | undefined) ?? "1h";

  // Map friendly bucket names to pg interval strings
  const intervalMap: Record<string, string> = {
    "5m": "5 minutes", "15m": "15 minutes", "30m": "30 minutes",
    "1h": "1 hour", "6h": "6 hours", "12h": "12 hours",
    "1d": "1 day", "1w": "1 week",
  };
  const pgInterval = intervalMap[bucket] ?? "1 hour";
  const maxLimit   = Math.min(Number(limit ?? 1000), 10000);

  const conditions = [];
  if (assetId) conditions.push(eq(telemetryTable.assetId, assetId));
  if (metric)  conditions.push(eq(telemetryTable.metric, metric));
  if (from)    conditions.push(gte(telemetryTable.timestamp, new Date(from) as unknown as Date));
  if (to)      conditions.push(lte(telemetryTable.timestamp, new Date(to)   as unknown as Date));

  const where = conditions.length > 0 ? and(...conditions) : sql`1=1`;

  const aggResult = await db.execute<{
    bucket: Date; asset_id: string; metric: string;
    avg_val: number; min_val: number; max_val: number; count: number;
  }>(sql`
    SELECT
      date_trunc('hour', timestamp) + 
        FLOOR(EXTRACT(EPOCH FROM timestamp - date_trunc('hour', timestamp))
              / EXTRACT(EPOCH FROM INTERVAL ${pgInterval})
        ) * INTERVAL ${pgInterval} AS bucket,
      asset_id,
      metric,
      AVG((value::text)::numeric)   AS avg_val,
      MIN((value::text)::numeric)   AS min_val,
      MAX((value::text)::numeric)   AS max_val,
      COUNT(*)                      AS count
    FROM telemetry
    WHERE ${where}
      AND value ~ '^-?[0-9]+(\.[0-9]+)?$'
    GROUP BY 1, asset_id, metric
    ORDER BY bucket DESC
    LIMIT ${maxLimit}
  `);
  const aggRows = aggResult.rows ?? (aggResult as unknown as unknown[]);

  res.json({
    bucket,
    count: (aggRows as unknown[]).length,
    data: aggRows,
    generatedAt: new Date().toISOString(),
  });
});

// ── Retention policies CRUD ───────────────────────────────────────────────────
router.get("/system/retention", async (_req, res): Promise<void> => {
  const policies = await db.select().from(dataRetentionTable).orderBy(dataRetentionTable.name);
  res.json(policies);
});

router.post("/system/retention", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  if (!body.name || !body.retentionDays) {
    res.status(400).json({ error: "name and retentionDays are required" });
    return;
  }

  const [policy] = await db.insert(dataRetentionTable).values({
    name:          String(body.name),
    assetId:       body.assetId as string | null ?? null,
    metric:        body.metric as string | null ?? null,
    retentionDays: Number(body.retentionDays),
    enabled:       body.enabled !== false,
  }).returning();

  res.status(201).json(policy);
});

router.put("/system/retention/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if (body.name          !== undefined) update.name          = String(body.name);
  if (body.retentionDays !== undefined) update.retentionDays = Number(body.retentionDays);
  if (body.enabled       !== undefined) update.enabled       = Boolean(body.enabled);
  if (body.metric        !== undefined) update.metric        = body.metric ?? null;
  if (body.assetId       !== undefined) update.assetId       = body.assetId ?? null;

  const [policy] = await db.update(dataRetentionTable).set(update).where(eq(dataRetentionTable.id, id)).returning();
  if (!policy) { res.status(404).json({ error: "Policy not found" }); return; }
  res.json(policy);
});

router.delete("/system/retention/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [policy] = await db.delete(dataRetentionTable).where(eq(dataRetentionTable.id, id)).returning();
  if (!policy) { res.status(404).json({ error: "Policy not found" }); return; }
  res.sendStatus(204);
});

// ── Manual pruning trigger ────────────────────────────────────────────────────
router.post("/system/retention/run", async (_req, res): Promise<void> => {
  const result = await runPruning();
  res.json(result);
});

// ── Pruning logic (also used by background job) ───────────────────────────────
export async function runPruning(): Promise<{ policiesRun: number; totalRowsDeleted: number; details: unknown[] }> {
  const policies = await db.select().from(dataRetentionTable).where(eq(dataRetentionTable.enabled, true));
  let totalDeleted = 0;
  const details: unknown[] = [];

  for (const policy of policies) {
    const cutoff = new Date(Date.now() - policy.retentionDays * 86_400_000);
    const conditions = [lt(telemetryTable.timestamp, cutoff as unknown as Date)];
    if (policy.assetId) conditions.push(eq(telemetryTable.assetId, policy.assetId));
    if (policy.metric)  conditions.push(eq(telemetryTable.metric, policy.metric));

    const deleted = await db.delete(telemetryTable).where(and(...conditions));
    const count = (deleted as unknown as { rowCount?: number }).rowCount ?? 0;
    totalDeleted += count;

    await db.update(dataRetentionTable)
      .set({ lastPrunedAt: new Date(), rowsPruned: sql`${dataRetentionTable.rowsPruned} + ${count}` })
      .where(eq(dataRetentionTable.id, policy.id));

    details.push({ policyId: policy.id, name: policy.name, rowsDeleted: count, cutoff });
    if (count > 0) logger.info({ policyId: policy.id, name: policy.name, rowsDeleted: count }, "Pruning complete");
  }

  return { policiesRun: policies.length, totalRowsDeleted: totalDeleted, details };
}

export default router;
