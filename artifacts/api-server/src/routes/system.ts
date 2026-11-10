import { aggregateTelemetryWithMeta } from "../lib/telemetry-aggregate";
import { PLANT_TIME_ZONE } from "../lib/plant-time";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { AggregateQuery, RetentionBody, UpdateRetentionBody, IdParams } from "../schemas/common";
import { eq, and, sql, lt, inArray, notInArray, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  db, assetsTable, telemetryTable, alarmsTable, alarmHistoryTable, dataRetentionTable,
  activityLogsTable, brokerEventsTable, authTokensTable,
} from "@workspace/db";
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
router.get("/system/aggregate", validate({ query: AggregateQuery }), async (req, res): Promise<void> => {
  const { assetId, metric, from, to, limit, bucket } = req.query as unknown as z.infer<typeof AggregateQuery>;

  const { rows: aggRows, truncated } = await aggregateTelemetryWithMeta({ assetId, metric, from, to, limit, bucket });

  res.json({
    bucket,
    count: aggRows.length,
    // True when older buckets were left out to stay within `limit`.
    truncated,
    timeZone: PLANT_TIME_ZONE,
    data: aggRows,
    generatedAt: new Date().toISOString(),
  });
});

// ── Retention policies CRUD ───────────────────────────────────────────────────
router.get("/system/retention", async (_req, res): Promise<void> => {
  const policies = await db.select().from(dataRetentionTable).orderBy(dataRetentionTable.name);
  res.json(policies);
});

router.post("/system/retention", validate({ body: RetentionBody }), async (req, res): Promise<void> => {
  const body = req.body as z.infer<typeof RetentionBody>;

  const [policy] = await db.insert(dataRetentionTable).values({
    name:          body.name,
    assetId:       body.assetId ?? null,
    metric:        body.metric ?? null,
    retentionDays: body.retentionDays,
    enabled:       body.enabled !== false,
  }).returning();

  res.status(201).json(policy);
});

router.put("/system/retention/:id", validate({ params: IdParams, body: UpdateRetentionBody }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const body = req.body as z.infer<typeof UpdateRetentionBody>;

  const update: Record<string, unknown> = {};
  if (body.name          !== undefined) update.name          = body.name;
  if (body.retentionDays !== undefined) update.retentionDays = body.retentionDays;
  if (body.enabled       !== undefined) update.enabled       = body.enabled;
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
  if (result.skipped) {
    res.status(409).json({ error: "A pruning run is already in progress.", code: "pruning_in_progress" });
    return;
  }
  res.json(result);
});

// ── Retention precedence (pure) ───────────────────────────────────────────────

export interface RetentionPolicyLike {
  id: string;
  name?: string;
  assetId: string | null;
  metric: string | null;
  retentionDays: number;
  enabled?: boolean;
}

/** How specific a policy is: asset + metric (3) > asset (2) > metric (1) > global (0). */
export function policyLevel(p: { assetId: string | null; metric: string | null }): number {
  return p.assetId && p.metric ? 3 : p.assetId ? 2 : p.metric ? 1 : 0;
}

export interface RetentionPlanItem {
  policyIds: string[];
  names: string[];
  assetId: string | null;
  metric: string | null;
  retentionDays: number;
  /** Rows these exclusions match belong to a more specific policy and are left alone here. */
  excludeAssets: string[];
  excludeMetrics: string[];
  excludePairs: Array<[string, string]>;
}

/**
 * Turn enabled policies into deletes where the MOST SPECIFIC policy covering a
 * row decides its retention.
 *
 * Each policy used to delete independently, so a 30-day global policy deleted
 * data that a 365-day policy on one asset was meant to keep. Now each policy
 * skips rows that a more specific policy covers. Two enabled policies with the
 * same scope merge, and the longer retention wins.
 */
export function planRetention(policies: RetentionPolicyLike[]): RetentionPlanItem[] {
  const byScope = new Map<string, RetentionPlanItem>();
  for (const p of policies) {
    if (p.enabled === false) continue;
    const key = `${p.assetId ?? "*"}|${p.metric ?? "*"}`;
    const existing = byScope.get(key);
    if (existing) {
      existing.retentionDays = Math.max(existing.retentionDays, p.retentionDays);
      existing.policyIds.push(p.id);
      existing.names.push(p.name ?? p.id);
      continue;
    }
    byScope.set(key, {
      policyIds: [p.id], names: [p.name ?? p.id], assetId: p.assetId, metric: p.metric,
      retentionDays: p.retentionDays, excludeAssets: [], excludeMetrics: [], excludePairs: [],
    });
  }
  const items = [...byScope.values()];
  const assetOnly = items.filter((i) => policyLevel(i) === 2).map((i) => i.assetId!);
  const metricOnly = items.filter((i) => policyLevel(i) === 1).map((i) => i.metric!);
  const pairs = items.filter((i) => policyLevel(i) === 3).map((i) => [i.assetId!, i.metric!] as [string, string]);

  for (const item of items) {
    switch (policyLevel(item)) {
      case 0:
        item.excludeAssets = assetOnly;
        item.excludeMetrics = metricOnly;
        item.excludePairs = pairs;
        break;
      case 1:
        item.excludeAssets = assetOnly;
        item.excludePairs = pairs.filter(([, m]) => m === item.metric);
        break;
      case 2:
        item.excludePairs = pairs.filter(([a]) => a === item.assetId);
        break;
      default:
        break;
    }
  }
  return items;
}

/** Whether a plan item's delete would touch a row of this asset and metric (age aside). */
export function planItemCovers(item: RetentionPlanItem, row: { assetId: string; metric: string }): boolean {
  if (item.assetId && item.assetId !== row.assetId) return false;
  if (item.metric && item.metric !== row.metric) return false;
  if (item.excludeAssets.includes(row.assetId)) return false;
  if (item.excludeMetrics.includes(row.metric)) return false;
  if (item.excludePairs.some(([a, m]) => a === row.assetId && m === row.metric)) return false;
  return true;
}

/** The retention that applies to one row, by the most-specific-wins rule. Null if no policy applies. */
export function effectiveRetentionDays(row: { assetId: string; metric: string }, policies: RetentionPolicyLike[]): number | null {
  let best: { level: number; days: number } | null = null;
  for (const p of policies) {
    if (p.enabled === false) continue;
    if (p.assetId && p.assetId !== row.assetId) continue;
    if (p.metric && p.metric !== row.metric) continue;
    const level = policyLevel(p);
    if (!best || level > best.level) best = { level, days: p.retentionDays };
    else if (level === best.level) best.days = Math.max(best.days, p.retentionDays);
  }
  return best?.days ?? null;
}

// ── Pruning logic (also used by background job) ───────────────────────────────

/** Rows deleted per statement. Small batches keep locks and WAL bursts short. */
const PRUNE_BATCH_SIZE = 5000;
/** Batches per table per run; the hourly job picks up the rest next time. */
const PRUNE_MAX_BATCHES = 200;

/** Delete matching rows in batches by primary key. Returns the number deleted. */
async function deleteInBatches(table: PgTable, where: SQL): Promise<number> {
  let total = 0;
  for (let i = 0; i < PRUNE_MAX_BATCHES; i++) {
    const result = await db.execute(sql`
      DELETE FROM ${table} WHERE id IN (
        SELECT id FROM ${table} WHERE ${where} LIMIT ${PRUNE_BATCH_SIZE}
      )`);
    const n = result.rowCount ?? 0;
    total += n;
    if (n < PRUNE_BATCH_SIZE) break;
  }
  return total;
}

export interface PruneResult {
  policiesRun: number;
  totalRowsDeleted: number;
  details: unknown[];
  /** Set when another run was still in progress, so nothing was done. */
  skipped?: boolean;
}

let pruningInProgress = false;

export async function runPruning(): Promise<PruneResult> {
  // The hourly job and the "Run now" button must not prune the same rows at
  // once, and a slow run must not overlap the next one.
  if (pruningInProgress) return { policiesRun: 0, totalRowsDeleted: 0, details: [], skipped: true };
  pruningInProgress = true;
  try {
    return await pruneTelemetry();
  } finally {
    pruningInProgress = false;
  }
}

async function pruneTelemetry(): Promise<PruneResult> {
  const policies = await db.select().from(dataRetentionTable).where(eq(dataRetentionTable.enabled, true));
  const plan = planRetention(policies);
  let totalDeleted = 0;
  const details: unknown[] = [];

  for (const item of plan) {
    const cutoff = new Date(Date.now() - item.retentionDays * 86_400_000);
    const conditions: SQL[] = [lt(telemetryTable.timestamp, cutoff)];
    if (item.assetId) conditions.push(eq(telemetryTable.assetId, item.assetId));
    if (item.metric)  conditions.push(eq(telemetryTable.metric, item.metric));
    if (item.excludeAssets.length)  conditions.push(notInArray(telemetryTable.assetId, item.excludeAssets));
    if (item.excludeMetrics.length) conditions.push(notInArray(telemetryTable.metric, item.excludeMetrics));
    if (item.excludePairs.length) {
      conditions.push(sql`(${telemetryTable.assetId}, ${telemetryTable.metric}) NOT IN (${sql.join(
        item.excludePairs.map(([a, m]) => sql`(${a}::uuid, ${m}::text)`), sql`, `)})`);
    }

    const count = await deleteInBatches(telemetryTable, and(...conditions)!);
    totalDeleted += count;

    // Rows are credited to the first policy of a merged scope; every one is stamped as run.
    const [first, ...rest] = item.policyIds;
    await db.update(dataRetentionTable)
      .set({ lastPrunedAt: new Date(), rowsPruned: sql`${dataRetentionTable.rowsPruned} + ${count}` })
      .where(eq(dataRetentionTable.id, first));
    if (rest.length) {
      await db.update(dataRetentionTable).set({ lastPrunedAt: new Date() }).where(inArray(dataRetentionTable.id, rest));
    }

    details.push({ policyId: first, mergedPolicyIds: rest, name: item.names[0], rowsDeleted: count, cutoff });
    if (count > 0) logger.info({ policyId: first, name: item.names[0], rowsDeleted: count }, "Pruning complete");
  }

  return { policiesRun: plan.length, totalRowsDeleted: totalDeleted, details };
}

// ── Age-based retention for operational tables ───────────────────────────────

function daysEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Days each operational table is kept. 0 turns that table's pruning off.
 * Defaults are deliberately long: these are records people look back at.
 */
export function operationalRetentionDays(): Record<"clearedAlarms" | "alarmHistory" | "activityLogs" | "brokerEvents" | "authTokens", number> {
  return {
    clearedAlarms: daysEnv("RETENTION_CLEARED_ALARMS_DAYS", 365),
    alarmHistory: daysEnv("RETENTION_ALARM_HISTORY_DAYS", 730),
    activityLogs: daysEnv("RETENTION_ACTIVITY_LOG_DAYS", 365),
    brokerEvents: daysEnv("RETENTION_BROKER_EVENTS_DAYS", 90),
    authTokens: daysEnv("RETENTION_AUTH_TOKENS_DAYS", 30),
  };
}

let operationalPruningInProgress = false;

/**
 * Prune alarms, alarm history, activity logs, broker events and auth tokens by age.
 * These tables used to grow for ever. Open alarms (active or acknowledged) and
 * the history of open alarms are never deleted.
 */
export async function runOperationalPruning(): Promise<{ deleted: Record<string, number>; skipped?: boolean }> {
  if (operationalPruningInProgress) return { deleted: {}, skipped: true };
  operationalPruningInProgress = true;
  try {
    const days = operationalRetentionDays();
    const cutoff = (d: number) => new Date(Date.now() - d * 86_400_000);
    const deleted: Record<string, number> = {};

    if (days.clearedAlarms > 0) {
      const c = cutoff(days.clearedAlarms);
      deleted.alarms = await deleteInBatches(alarmsTable, sql`${alarmsTable.status} = 'cleared'
        AND COALESCE(${alarmsTable.clearedAt}, ${alarmsTable.triggeredAt}) < ${c}`);
    }
    if (days.alarmHistory > 0) {
      const c = cutoff(days.alarmHistory);
      deleted.alarmHistory = await deleteInBatches(alarmHistoryTable, sql`${alarmHistoryTable.triggeredAt} < ${c}
        AND NOT EXISTS (
          SELECT 1 FROM ${alarmsTable} open_alarm
          WHERE open_alarm.id = ${alarmHistoryTable.alarmId}
            AND open_alarm.status IN ('active', 'acknowledged')
        )`);
    }
    if (days.activityLogs > 0) {
      deleted.activityLogs = await deleteInBatches(activityLogsTable,
        sql`${activityLogsTable.timestamp} < ${cutoff(days.activityLogs)}`);
    }
    if (days.brokerEvents > 0) {
      deleted.brokerEvents = await deleteInBatches(brokerEventsTable,
        sql`${brokerEventsTable.timestamp} < ${cutoff(days.brokerEvents)}`);
    }
    if (days.authTokens > 0) {
      // Only tokens that can no longer be used: expired, redeemed or revoked that long ago.
      const c = cutoff(days.authTokens);
      deleted.authTokens = await deleteInBatches(authTokensTable, sql`(${authTokensTable.expiresAt} < ${c}
        OR ${authTokensTable.consumedAt} < ${c} OR ${authTokensTable.revokedAt} < ${c})`);
    }
    return { deleted };
  } finally {
    operationalPruningInProgress = false;
  }
}

export default router;
