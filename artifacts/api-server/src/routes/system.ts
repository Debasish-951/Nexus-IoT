import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, isNull, or, lt } from "drizzle-orm";
import { db, pool, assetsTable, telemetryTable, alarmsTable, dataRetentionTable } from "@workspace/db";
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
// GET /api/system/aggregate?assetId=&metric=&bucket=5m|15m|30m|1h|6h|12h|1d|1w&from=&to=&limit=
router.get("/system/aggregate", async (req, res): Promise<void> => {
  const { assetId, metric, from, to, limit } = req.query as Record<string, string | undefined>;
  const bucket = (req.query.bucket as string | undefined) ?? "1h";

  // Map bucket names to seconds — used for epoch-floor bucketing (avoids INTERVAL parameterization)
  const bucketSeconds: Record<string, number> = {
    "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "6h": 21600, "12h": 43200,
    "1d": 86400, "1w": 604800,
  };
  const stepSec  = bucketSeconds[bucket] ?? 3600;
  const maxLimit = Math.min(Number(limit ?? 1000), 10000);

  // Build WHERE clause as a raw SQL string to avoid Drizzle prepared-statement
  // type-inference issues with EXTRACT/FLOOR arithmetic.
  // stepSec and maxLimit are validated integers from a whitelist; string params are bound.
  const filters: string[] = ["value::text ~ '^-?[0-9]+(\\.[0-9]+)?$'"];
  const params: (string | number | Date)[] = [];

  if (assetId) { params.push(assetId);           filters.push(`asset_id = $${params.length}`); }
  if (metric)  { params.push(metric);             filters.push(`metric = $${params.length}`); }
  if (from)    { params.push(new Date(from));     filters.push(`"timestamp" >= $${params.length}`); }
  if (to)      { params.push(new Date(to));       filters.push(`"timestamp" <= $${params.length}`); }
  params.push(maxLimit);
  const limitParam = params.length;

  // stepSec is from a fixed whitelist — safe to inline as an integer literal
  const rawSql = `
    SELECT
      to_timestamp(FLOOR(EXTRACT(EPOCH FROM "timestamp") / ${stepSec}) * ${stepSec}) AS bucket,
      asset_id,
      metric,
      AVG((value::text)::numeric)  AS avg_val,
      MIN((value::text)::numeric)  AS min_val,
      MAX((value::text)::numeric)  AS max_val,
      SUM((value::text)::numeric)  AS sum_val,
      COUNT(*)::int                AS count
    FROM telemetry
    WHERE ${filters.join(" AND ")}
    GROUP BY 1, asset_id, metric
    ORDER BY bucket ASC
    LIMIT $${limitParam}
  `;

  const aggResult = await pool.query<{
    bucket: Date; asset_id: string; metric: string;
    avg_val: string; min_val: string; max_val: string; sum_val: string; count: number;
  }>(rawSql, params);
  const aggRows = aggResult.rows;

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
