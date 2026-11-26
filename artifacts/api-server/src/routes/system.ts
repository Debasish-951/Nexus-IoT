import { aggregateTelemetryWithMeta } from "../lib/telemetry-aggregate";
import { auditRetentionDays, pruneAuditLog } from "../lib/audit-store";
import { PLANT_TIME_ZONE } from "../lib/plant-time";
import { Router, type IRouter, type Request } from "express";
import { statfs } from "node:fs/promises";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { AggregateQuery, RetentionBody, UpdateRetentionBody, RetentionPreviewBody, IdParams } from "../schemas/common";
import { eq, and, sql, lt, inArray, notInArray, desc, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  db, pool, assetsTable, telemetryTable, alarmsTable, alarmHistoryTable, dataRetentionTable,
  activityLogsTable, brokerEventsTable, authTokensTable, retentionRunsTable, dataChangeRequestsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { csvCell } from "../lib/validation";
import { logActivity } from "./activity_log";
import { diffFields } from "../lib/audit-core";
import {
  rollupsEnabled, getRollupState, rawPruneLimit, floorHour, rollupJobError, pruneRollups, pruneTier, TIERS, activeTiers, onRollupsAdvanced,
} from "../services/rollups";
import { getDataSettings, insideWindow } from "../lib/data-settings";
import { activeHolds, heldRowsSql, heldFraction, expireHolds, type HoldLike } from "../services/holds";
import { archiveUntil, archivedUntil } from "../services/archive";
import { isPartitioned, conversionState, dropExpiredPartitions, ensureFuturePartitions, listPartitions } from "../services/partitions";
import { flushIngestRejections } from "../services/ingest-rejections";

const router: IRouter = Router();

// ── Storage stats ──────────────────────────────────────────────────────────────
//
// Counting the raw telemetry table on every page load stopped working once it
// held tens of millions of rows (the per-asset GROUP BY hit the statement
// timeout). The page now reads:
//   - the row total from the planner's estimate (pg_class.reltuples),
//   - oldest and newest reading through the timestamp index,
//   - everything per asset, per metric and per day from the hourly summaries
//     (telemetry_rollups, services/rollups.ts), cached for a minute.

const DAY_MS = 86_400_000;

export interface PairDays {
  assetId: string;
  metric: string;
  /** Oldest and newest raw reading still stored, or null when none is left. */
  first: Date | null;
  last: Date | null;
  /** Per plant-time day: readings that arrived, and how many of them are still stored. */
  days: Array<{ day: Date; rows: number; stored: number }>;
}

let pairCache: { at: number; pairs: PairDays[] } | null = null;
const PAIR_CACHE_MS = 60_000;

/** Forget cached counts, e.g. after pruning or when the summaries moved on. */
export function invalidateStorageCache(): void {
  pairCache = null;
}
onRollupsAdvanced(invalidateStorageCache);

async function loadPairs(): Promise<PairDays[]> {
  if (pairCache && Date.now() - pairCache.at < PAIR_CACHE_MS) return pairCache.pairs;
  // First/last raw reading per asset+metric come from idx_telemetry_asset_metric_ts
  // (one index probe each). A summary hour counts as stored from the hour of the
  // oldest raw reading on: pruning deletes oldest first.
  const r = await pool.query<{
    asset_id: string; metric: string; day: Date; rows: string; stored: string | null;
    first_ts: Date | null; last_ts: Date | null;
  }>(`
    WITH p AS (
      SELECT k.asset_id, k.metric, f.ts AS first_ts, l.ts AS last_ts
      FROM (SELECT DISTINCT asset_id, metric FROM telemetry_rollups) k
      LEFT JOIN LATERAL (SELECT t."timestamp" AS ts FROM telemetry t
        WHERE t.asset_id = k.asset_id AND t.metric = k.metric ORDER BY t."timestamp" ASC LIMIT 1) f ON true
      LEFT JOIN LATERAL (SELECT t."timestamp" AS ts FROM telemetry t
        WHERE t.asset_id = k.asset_id AND t.metric = k.metric ORDER BY t."timestamp" DESC LIMIT 1) l ON true
    )
    SELECT r.asset_id, r.metric,
           (date_trunc('day', r.bucket AT TIME ZONE $1) AT TIME ZONE $1) AS day,
           SUM(r."rows")::bigint AS rows,
           (SUM(r."rows") FILTER (WHERE p.first_ts IS NOT NULL
              AND r.bucket >= date_trunc('hour', p.first_ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::bigint AS stored,
           p.first_ts, p.last_ts
    FROM telemetry_rollups r JOIN p ON p.asset_id = r.asset_id AND p.metric = r.metric
    GROUP BY r.asset_id, r.metric, 3, p.first_ts, p.last_ts
  `, [PLANT_TIME_ZONE]);
  const byPair = new Map<string, PairDays>();
  for (const row of r.rows) {
    const key = `${row.asset_id}|${row.metric}`;
    let p = byPair.get(key);
    if (!p) {
      p = { assetId: row.asset_id, metric: row.metric, first: row.first_ts, last: row.last_ts, days: [] };
      byPair.set(key, p);
    }
    p.days.push({ day: new Date(row.day), rows: Number(row.rows), stored: Number(row.stored ?? 0) });
  }
  const pairs = [...byPair.values()];
  pairCache = { at: Date.now(), pairs };
  return pairs;
}

export interface PruneEstimate {
  rows: number;
  byAsset: Map<string, number>;
  /** True when the summary guard moved a cutoff later than its policy asked for. */
  limited: boolean;
}

/**
 * How many stored readings a pruning run would delete under `policies`, from
 * per-day counts. Pure, for the preview and for tests. The day that contains a
 * cutoff counts in proportion to the part of it before the cutoff.
 */
export function estimatePrune(
  pairs: PairDays[], policies: RetentionPolicyLike[], now: Date, limit: Date | null, holds: HoldLike[] = [],
): PruneEstimate {
  const byAsset = new Map<string, number>();
  let rows = 0;
  let limited = false;
  for (const p of pairs) {
    const days = effectiveRetentionDays(p, policies);
    if (days === null) continue;
    let cutoff = now.getTime() - days * DAY_MS;
    if (limit && limit.getTime() < cutoff) { cutoff = limit.getTime(); limited = true; }
    let n = 0;
    // Stored readings begin at the oldest one left, so a day that was already
    // partly pruned only spreads its stored count from that point on.
    const firstLeft = p.first ? p.first.getTime() : -Infinity;
    for (const d of p.days) {
      const start = Math.max(d.day.getTime(), firstLeft);
      const end = d.day.getTime() + DAY_MS;
      if (end <= start) continue;
      const until = Math.min(end, cutoff);
      if (until <= start) continue;
      // Share of the stored day before the cutoff, minus any part under a legal hold.
      const share = (until - start) / (end - start);
      n += d.stored * share * (1 - heldFraction(holds, p, start, until));
    }
    n = Math.round(n);
    if (n > 0) {
      rows += n;
      byAsset.set(p.assetId, (byAsset.get(p.assetId) ?? 0) + n);
    }
  }
  return { rows, byAsset, limited };
}

/**
 * Readings per day that no policy will ever delete, averaged over the last
 * `window` complete days. This is what keeps growing the disk; readings under a
 * policy level off once they reach their retention age.
 */
export function unboundedRowsPerDay(pairs: PairDays[], policies: RetentionPolicyLike[], now: Date, window = 7): number {
  const since = now.getTime() - window * DAY_MS;
  let n = 0;
  for (const p of pairs) {
    if (effectiveRetentionDays(p, policies) !== null) continue;
    for (const d of p.days) {
      // The last `window` complete days: ended before now, and ended within the window.
      const end = d.day.getTime() + DAY_MS;
      if (end <= now.getTime() && end > since) n += d.rows;
    }
  }
  return n / window;
}

async function telemetrySize(): Promise<{ estRows: number; bytes: number; pretty: string }> {
  const r = await pool.query<{ est: string; bytes: string; pretty: string }>(`
    SELECT c.reltuples::bigint AS est,
           pg_total_relation_size(c.oid) AS bytes,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty
    FROM pg_class c WHERE c.oid = 'telemetry'::regclass`);
  const row = r.rows[0];
  return { estRows: Number(row?.est ?? -1), bytes: Number(row?.bytes ?? 0), pretty: row?.pretty ?? "unknown" };
}

async function diskSpace(): Promise<{ path: string; totalBytes: number; freeBytes: number } | null> {
  const path = process.env.STORAGE_DISK_PATH?.trim() || "/";
  try {
    const s = await statfs(path);
    return { path, totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

const OPERATIONAL_LABELS: Record<keyof ReturnType<typeof operationalRetentionDays>, { label: string; env: string }> = {
  clearedAlarms:   { label: "Cleared alarms",              env: "RETENTION_CLEARED_ALARMS_DAYS" },
  alarmHistory:    { label: "Alarm history",               env: "RETENTION_ALARM_HISTORY_DAYS" },
  activityLogs:    { label: "Activity log",                env: "RETENTION_ACTIVITY_LOG_DAYS" },
  brokerEvents:    { label: "Broker events",               env: "RETENTION_BROKER_EVENTS_DAYS" },
  authTokens:      { label: "Used or expired sign-in links", env: "RETENTION_AUTH_TOKENS_DAYS" },
  telemetryRollups:{ label: "Hourly summaries",            env: "RETENTION_ROLLUP_DAYS" },
  retentionRuns:   { label: "Pruning history",             env: "RETENTION_RUNS_DAYS" },
};

/** Everything the Storage tab and the alert checks need. */
export async function computeStorage() {
  const now = new Date();
  const [size, oldestRow, newestRow, policies, state, summaryRow, lastRunRows, assets, disk, settings, tierRows, holds] = await Promise.all([
    telemetrySize(),
    db.select({ ts: telemetryTable.timestamp }).from(telemetryTable).orderBy(telemetryTable.timestamp).limit(1),
    db.select({ ts: telemetryTable.timestamp }).from(telemetryTable).orderBy(sql`${telemetryTable.timestamp} DESC`).limit(1),
    db.select().from(dataRetentionTable),
    getRollupState(),
    pool.query<{ n: string; oldest: Date | null; pretty: string }>(`
      -- The estimate is -1 until the table is first analysed; count then (it is still small).
      SELECT (SELECT CASE WHEN reltuples < 0 THEN (SELECT count(*) FROM telemetry_rollups) ELSE reltuples::bigint END
              FROM pg_class WHERE oid = 'telemetry_rollups'::regclass) AS n,
             (SELECT min(bucket) FROM telemetry_rollups) AS oldest,
             pg_size_pretty(pg_total_relation_size('telemetry_rollups')) AS pretty`),
    db.select().from(retentionRunsTable).orderBy(desc(retentionRunsTable.startedAt)).limit(1),
    db.select({ id: assetsTable.id, name: assetsTable.name, parentId: assetsTable.parentId }).from(assetsTable),
    diskSpace(),
    getDataSettings(),
    Promise.all(TIERS.map(async (t) => {
      const st = await getRollupState(t);
      const r = await pool.query<{ n: string; oldest: Date | null; pretty: string }>(`
        SELECT (SELECT CASE WHEN reltuples < 0 THEN (SELECT count(*) FROM ${t.table}) ELSE reltuples::bigint END
                FROM pg_class WHERE oid = '${t.table}'::regclass) AS n,
               (SELECT min(bucket) FROM ${t.table}) AS oldest,
               pg_size_pretty(pg_total_relation_size('${t.table}')) AS pretty`);
      return { tier: t, state: st, row: r.rows[0] };
    })),
    activeHolds(),
  ]);
  const pairs = rollupsEnabled() ? await loadPairs() : [];
  const assetNames = new Map(assets.map((a) => [a.id, a.name]));

  const storedTotal = pairs.reduce((n, p) => n + p.days.reduce((m, d) => m + d.stored, 0), 0);
  const totalRows = size.estRows > 0 ? size.estRows : storedTotal;
  const bytesPerRow = totalRows > 0 ? size.bytes / totalRows : null;

  // Per asset
  const perAssetMap = new Map<string, {
    assetId: string; assetName: string; rows: number; metrics: number; oldest: Date | null; newest: Date | null;
    minDays: number | null; maxDays: number | null; keptForever: boolean; deleted: boolean;
  }>();
  for (const p of pairs) {
    const stored = p.days.reduce((m, d) => m + d.stored, 0);
    if (stored === 0 && !p.first) continue;
    let a = perAssetMap.get(p.assetId);
    if (!a) {
      a = {
        assetId: p.assetId, assetName: assetNames.get(p.assetId) ?? "Deleted asset", rows: 0, metrics: 0,
        oldest: null, newest: null, minDays: null, maxDays: null, keptForever: false, deleted: !assetNames.has(p.assetId),
      };
      perAssetMap.set(p.assetId, a);
    }
    a.rows += stored;
    a.metrics += 1;
    if (p.first && (!a.oldest || p.first < a.oldest)) a.oldest = p.first;
    if (p.last && (!a.newest || p.last > a.newest)) a.newest = p.last;
    const days = effectiveRetentionDays(p, policies);
    if (days === null) a.keptForever = true;
    else {
      a.minDays = a.minDays === null ? days : Math.min(a.minDays, days);
      a.maxDays = a.maxDays === null ? days : Math.max(a.maxDays, days);
    }
  }
  const perAsset = [...perAssetMap.values()]
    .sort((x, y) => y.rows - x.rows)
    .map((a) => ({ ...a, bytes: bytesPerRow ? Math.round(a.rows * bytesPerRow) : null }));

  // Per project: a project is a root asset; every asset counts towards its root.
  const parentOf = new Map(assets.map((a) => [a.id, a.parentId]));
  const rootOf = (id: string): string | null => {
    let cur: string | null | undefined = id;
    for (let i = 0; cur && i < 50; i++) {
      const parent = parentOf.get(cur);
      if (parent === undefined) return null; // deleted asset
      if (!parent) return cur;
      cur = parent;
    }
    return cur ?? null;
  };
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const projMap = new Map<string, { projectId: string | null; projectName: string; rows: number; assets: number; rowsPerDay: number }>();
  const pairRowsLastWeek = new Map<string, number>();
  for (const p of pairs) {
    let n = 0;
    for (const d of p.days) if (d.day.getTime() >= weekAgo && d.day.getTime() + DAY_MS <= now.getTime()) n += d.rows;
    pairRowsLastWeek.set(p.assetId, (pairRowsLastWeek.get(p.assetId) ?? 0) + n);
  }
  for (const a of perAsset) {
    const root = a.deleted ? null : rootOf(a.assetId);
    const key = root ?? "__none__";
    let e = projMap.get(key);
    if (!e) {
      e = { projectId: root, projectName: root ? assetNames.get(root) ?? "Project" : "Deleted assets", rows: 0, assets: 0, rowsPerDay: 0 };
      projMap.set(key, e);
    }
    e.rows += a.rows;
    e.assets += 1;
    e.rowsPerDay += (pairRowsLastWeek.get(a.assetId) ?? 0) / 7;
  }
  const perProject = [...projMap.values()].sort((x, y) => y.rows - x.rows).map((e) => ({
    ...e,
    bytes: bytesPerRow ? Math.round(e.rows * bytesPerRow) : null,
    bytesPerMonth: bytesPerRow ? Math.round(e.rowsPerDay * 30 * bytesPerRow) : null,
  }));

  // Growth: readings per plant-time day over the last 30 days.
  const dayTotals = new Map<number, number>();
  const since = now.getTime() - 31 * DAY_MS;
  for (const p of pairs) for (const d of p.days) {
    const t = d.day.getTime();
    if (t >= since) dayTotals.set(t, (dayTotals.get(t) ?? 0) + d.rows);
  }
  const daily = [...dayTotals.entries()].sort((a, b) => a[0] - b[0]).map(([t, rows]) => ({ day: new Date(t).toISOString(), rows }));
  const complete = daily.filter((d) => new Date(d.day).getTime() + DAY_MS <= now.getTime()).slice(-7);
  const rowsPerDay = complete.length ? complete.reduce((n, d) => n + d.rows, 0) / complete.length : null;
  const unbounded = complete.length ? unboundedRowsPerDay(pairs, policies, now, complete.length) : null;
  const bytesPerDay = rowsPerDay !== null && bytesPerRow ? rowsPerDay * bytesPerRow : null;
  const netBytesPerDay = unbounded !== null && bytesPerRow ? unbounded * bytesPerRow : null;

  // Summary job progress
  const startedFrom = state.startedFrom ?? oldestRow[0]?.ts ?? null;
  const target = floorHour(now).getTime();
  let progressPct = 0;
  if (state.watermark && startedFrom) {
    const span = target - startedFrom.getTime();
    progressPct = span <= 0 ? 100 : Math.max(0, Math.min(100, ((state.watermark.getTime() - startedFrom.getTime()) / span) * 100));
  }
  const summary = summaryRow.rows[0];

  const opDays = operationalRetentionDays();
  if (settings.tiers.hourDays !== null) opDays.telemetryRollups = settings.tiers.hourDays;
  const lastRun = lastRunRows[0] ?? null;
  const tierTarget = (stepSec: number) => Math.floor(now.getTime() / (stepSec * 1000)) * stepSec * 1000;
  const activeKeys = new Set((await activeTiers()).map((t) => t.key));
  const tiers = tierRows.map(({ tier, state: st, row }) => {
    const from = st.startedFrom ?? oldestRow[0]?.ts ?? null;
    let pct = 0;
    if (st.watermark && from) {
      const span = tierTarget(tier.stepSec) - from.getTime();
      pct = span <= 0 ? 100 : Math.max(0, Math.min(100, ((st.watermark.getTime() - from.getTime()) / span) * 100));
    }
    return {
      key: tier.key, label: tier.label, enabled: activeKeys.has(tier.key),
      days: tier.key === "m15" ? settings.tiers.m15Days : opDays.telemetryRollups,
      watermark: st.watermark, progressPct: Math.round(pct * 10) / 10,
      complete: !!st.watermark && st.watermark.getTime() >= tierTarget(tier.stepSec) - Math.max(2 * tier.stepSec * 1000, 3_600_000),
      summaryRows: Math.max(0, Number(row?.n ?? 0)), oldestSummary: row?.oldest ?? null, size: row?.pretty ?? "unknown",
    };
  });

  return {
    telemetry: {
      totalRows,
      totalRowsEstimated: true,
      tableSize: size.pretty,
      tableBytes: size.bytes,
      bytesPerRow,
      oldestRecord: oldestRow[0]?.ts ?? null,
      newestRecord: newestRow[0]?.ts ?? null,
    },
    perAsset,
    growth: {
      daily,
      rowsPerDay,
      bytesPerDay,
      bytesPerMonth: bytesPerDay !== null ? bytesPerDay * 30 : null,
      netRowsPerDay: unbounded,
      netBytesPerDay,
      netBytesPerMonth: netBytesPerDay !== null ? netBytesPerDay * 30 : null,
    },
    disk: disk ? {
      ...disk,
      daysUntilFull: netBytesPerDay && netBytesPerDay > 0 ? Math.floor(disk.freeBytes / netBytesPerDay) : null,
    } : null,
    rollups: {
      enabled: rollupsEnabled(),
      watermark: state.watermark,
      startedFrom,
      progressPct: Math.round(progressPct * 10) / 10,
      complete: !!state.watermark && state.watermark.getTime() >= target - 3_600_000,
      summaryRows: Math.max(0, Number(summary?.n ?? 0)),
      oldestSummary: summary?.oldest ?? null,
      size: summary?.pretty ?? "unknown",
      error: rollupJobError(),
    },
    retention: {
      enabledPolicies: policies.filter((p) => p.enabled).length,
      operational: [
        ...(Object.keys(OPERATIONAL_LABELS) as Array<keyof typeof OPERATIONAL_LABELS>).map((k) => ({
          key: k, label: OPERATIONAL_LABELS[k].label,
          env: k === "telemetryRollups" && settings.tiers.hourDays !== null ? "Data Management settings" : OPERATIONAL_LABELS[k].env,
          days: opDays[k],
        })),
        { key: "telemetryRollups15m", label: "15-minute summaries", env: "Data Management settings", days: settings.tiers.m15Days },
        { key: "ingestRejections", label: "Refused ingest counts", env: "fixed", days: 30 },
      ],
      activeHolds: holds.length,
      pruneWindow: settings.pruneWindow,
      approval: settings.approval,
      archive: settings.archive,
    },
    perProject,
    tiers,
    lastRun,
    generatedAt: now.toISOString(),
  };
}

router.get("/system/storage", async (_req, res): Promise<void> => {
  res.json(await computeStorage());
});

/**
 * The newest instant pruning may delete raw readings before: the summary guard
 * and, with archiving on, the end of the archived days. Archiving catches up to
 * `wanted` first when asked.
 */
export async function deleteLimit(wanted?: Date): Promise<Date | null> {
  let limit = await rawPruneLimit();
  const settings = await getDataSettings();
  if (settings.archive.enabled) {
    const archived = wanted ? await archiveUntil(limit && limit < wanted ? limit : wanted) : await archivedUntil();
    const a = archived ?? new Date(0);
    if (!limit || a < limit) limit = a;
  }
  return limit;
}

/** Readings the next pruning run would delete with `policies`, and how many with the current ones. */
async function estimateFor(policies: RetentionPolicyLike[]): Promise<{ rows: number; current: number; byAsset: Map<string, number>; limited: boolean; bytesPerRow: number | null }> {
  const now = new Date();
  const [current, pairs, limit, size, holds] = await Promise.all([
    db.select().from(dataRetentionTable), loadPairs(), rawPruneLimit(), telemetrySize(), activeHolds(),
  ]);
  const before = estimatePrune(pairs, current, now, limit, holds);
  const after = estimatePrune(pairs, policies, now, limit, holds);
  return { rows: after.rows, current: before.rows, byAsset: after.byAsset, limited: after.limited, bytesPerRow: size.estRows > 0 ? size.bytes / size.estRows : null };
}

/** Whether a deletion of this size must wait for a second administrator. */
async function approvalRequired(rows: number): Promise<boolean> {
  const s = await getDataSettings();
  return s.approval.enabled && rows > s.approval.thresholdRows;
}

async function requestApproval(req: Request, kind: string, payload: unknown, summary: string, rows: number) {
  const [row] = await db.insert(dataChangeRequestsTable).values({
    kind, payload, summary, estimatedRows: rows,
    requestedById: req.principal?.user.id ?? null, requestedBy: req.principal?.user.username ?? null,
  }).returning();
  await logActivity("data_change.requested", "system", row.id, summary, `about ${rows} reading(s); waits for a second administrator`, req);
  return row;
}

/** Create or update a policy. Used directly and when an approved request is carried out. */
export async function applyPolicyChange(op: "create" | "update", id: string | null, body: Record<string, unknown>, req?: Request) {
  if (op === "create") {
    const b = body as z.infer<typeof RetentionBody>;
    const [policy] = await db.insert(dataRetentionTable).values({
      name: b.name, assetId: b.assetId ?? null, metric: b.metric ?? null, retentionDays: b.retentionDays, enabled: b.enabled !== false,
    }).returning();
    await logActivity("retention.created", "system", policy.id, policy.name, describePolicy(policy), req);
    return policy;
  }
  const b = body as z.infer<typeof UpdateRetentionBody>;
  const update: Record<string, unknown> = {};
  if (b.name          !== undefined) update.name          = b.name;
  if (b.retentionDays !== undefined) update.retentionDays = b.retentionDays;
  if (b.enabled       !== undefined) update.enabled       = b.enabled;
  if (b.metric        !== undefined) update.metric        = b.metric ?? null;
  if (b.assetId       !== undefined) update.assetId       = b.assetId ?? null;
  const [beforePolicy] = await db.select().from(dataRetentionTable).where(eq(dataRetentionTable.id, id!));
  const [policy] = await db.update(dataRetentionTable).set(update).where(eq(dataRetentionTable.id, id!)).returning();
  if (policy) await logActivity("retention.updated", "system", policy.id, policy.name, describePolicy(policy), req,
    { assetId: policy.assetId ?? null, changes: diffFields(beforePolicy as unknown as Record<string, unknown>, policy as unknown as Record<string, unknown>, { only: Object.keys(update) }) });
  return policy ?? null;
}

// ── Retention preview ─────────────────────────────────────────────────────────
// What the next pruning run would delete if a policy were added, changed or
// removed. Without a body: what it would delete with the current policies.
router.post("/system/retention/preview", validate({ body: RetentionPreviewBody }), async (req, res): Promise<void> => {
  const body = req.body as z.infer<typeof RetentionPreviewBody>;
  const now = new Date();
  const current = await db.select().from(dataRetentionTable);
  let proposed: RetentionPolicyLike[] = current.filter((p) => p.id !== body.removeId);
  if (body.policy) {
    const change = body.policy;
    const existing = change.id ? proposed.find((p) => p.id === change.id) : undefined;
    const merged: RetentionPolicyLike = {
      id: change.id ?? "proposed",
      name: existing?.name ?? "proposed",
      assetId: change.assetId !== undefined ? change.assetId ?? null : existing?.assetId ?? null,
      metric: change.metric !== undefined ? change.metric ?? null : existing?.metric ?? null,
      retentionDays: change.retentionDays,
      enabled: change.enabled ?? existing?.enabled ?? true,
    };
    proposed = [...proposed.filter((p) => p.id !== merged.id), merged];
  }
  if (!rollupsEnabled()) {
    res.json({ available: false, rows: 0, bytes: null, current: { rows: 0, bytes: null }, byAsset: [], complete: false, limited: false });
    return;
  }
  const [pairs, limit, size, state, assets, holds, settings] = await Promise.all([
    loadPairs(), rawPruneLimit(), telemetrySize(), getRollupState(),
    db.select({ id: assetsTable.id, name: assetsTable.name }).from(assetsTable),
    activeHolds(), getDataSettings(),
  ]);
  const bytesPerRow = size.estRows > 0 ? size.bytes / size.estRows : null;
  const before = estimatePrune(pairs, current, now, limit, holds);
  const after = estimatePrune(pairs, proposed, now, limit, holds);
  const names = new Map(assets.map((a) => [a.id, a.name]));
  res.json({
    available: true,
    rows: after.rows,
    bytes: bytesPerRow ? Math.round(after.rows * bytesPerRow) : null,
    current: { rows: before.rows, bytes: bytesPerRow ? Math.round(before.rows * bytesPerRow) : null },
    byAsset: [...after.byAsset.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([assetId, rows]) => ({ assetId, assetName: names.get(assetId) ?? "Deleted asset", rows })),
    complete: !!state.watermark && state.watermark.getTime() >= floorHour(now).getTime() - 3_600_000,
    limited: after.limited,
    heldPolicies: holds.length,
    // Whether saving this change (or running now) would wait for a second administrator.
    needsApproval: settings.approval.enabled && Math.max(0, after.rows - (body.policy || body.removeId ? before.rows : 0)) > settings.approval.thresholdRows,
  });
});

// ── Pruning history ───────────────────────────────────────────────────────────
router.get("/system/retention/runs", async (_req, res): Promise<void> => {
  const rows = await db.select().from(retentionRunsTable).orderBy(desc(retentionRunsTable.startedAt)).limit(50);
  res.json(rows);
});

/** A pruning run as CSV, for the record. */
router.get("/system/retention/runs/:id/report", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const [run] = await db.select().from(retentionRunsTable).where(eq(retentionRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  // csvCell quotes AND neutralises spreadsheet formulas (policy names, notes and error text are free text).
  const esc = (v: unknown) => csvCell(v instanceof Date ? v.toISOString() : v);
  const lines = [
    ["run", run.id], ["trigger", run.trigger], ["run by", run.username ?? "hourly job"],
    ["started", run.startedAt], ["finished", run.finishedAt ?? ""], ["readings deleted", run.telemetryDeleted], ["error", run.error ?? ""],
    [], ["section", "name", "rows deleted", "cutoff", "note"],
    ...((run.details as Array<Record<string, unknown>>) ?? []).map((d) => ["policy", d.name ?? d.partition ?? d.note ?? "", d.rowsDeleted ?? d.estRows ?? "", d.cutoff ?? "", d.limitedBySummaries ? "waited for summaries or archive" : d.note ?? ""]),
    ...Object.entries((run.operational as Record<string, number>) ?? {}).map(([k, v]) => ["other records", k, v, "", ""]),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pruning-run-${run.startedAt.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv"`);
  res.send(lines.map((l) => l.map(esc).join(",")).join("\r\n") + "\r\n");
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
  if (body.enabled !== false && rollupsEnabled()) {
    const current = await db.select().from(dataRetentionTable);
    const est = await estimateFor([...current, { id: "proposed", assetId: body.assetId ?? null, metric: body.metric ?? null, retentionDays: body.retentionDays, enabled: true }]);
    const extra = Math.max(0, est.rows - est.current);
    if (await approvalRequired(extra)) {
      const request = await requestApproval(req, "policy_change", { op: "create", body }, `Create retention policy "${body.name}" (${body.retentionDays} days)`, extra);
      res.status(202).json({ pendingApproval: true, request });
      return;
    }
  }
  const policy = await applyPolicyChange("create", null, body as Record<string, unknown>, req);
  res.status(201).json(policy);
});

router.put("/system/retention/:id", validate({ params: IdParams, body: UpdateRetentionBody }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const body = req.body as z.infer<typeof UpdateRetentionBody>;
  const current = await db.select().from(dataRetentionTable);
  const existing = current.find((p) => p.id === id);
  if (!existing) { res.status(404).json({ error: "Policy not found" }); return; }
  if (rollupsEnabled()) {
    const merged = {
      ...existing,
      ...(body.retentionDays !== undefined ? { retentionDays: body.retentionDays } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.metric !== undefined ? { metric: body.metric ?? null } : {}),
      ...(body.assetId !== undefined ? { assetId: body.assetId ?? null } : {}),
    };
    const est = await estimateFor([...current.filter((p) => p.id !== id), merged]);
    const extra = Math.max(0, est.rows - est.current);
    if (await approvalRequired(extra)) {
      const request = await requestApproval(req, "policy_change", { op: "update", id, body }, `Change retention policy "${existing.name}"`, extra);
      res.status(202).json({ pendingApproval: true, request });
      return;
    }
  }
  const policy = await applyPolicyChange("update", id, body as Record<string, unknown>, req);
  if (!policy) { res.status(404).json({ error: "Policy not found" }); return; }
  res.json(policy);
});

router.delete("/system/retention/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [policy] = await db.delete(dataRetentionTable).where(eq(dataRetentionTable.id, id)).returning();
  if (!policy) { res.status(404).json({ error: "Policy not found" }); return; }
  await logActivity("retention.deleted", "system", policy.id, policy.name, describePolicy(policy), req);
  res.sendStatus(204);
});

// ── Manual pruning trigger ────────────────────────────────────────────────────
router.post("/system/retention/run", async (req, res): Promise<void> => {
  if (rollupsEnabled()) {
    const current = await db.select().from(dataRetentionTable);
    const est = await estimateFor(current);
    if (await approvalRequired(est.rows)) {
      const request = await requestApproval(req, "manual_prune", {}, "Run pruning now", est.rows);
      res.status(202).json({ pendingApproval: true, request });
      return;
    }
  }
  const result = await runPruning({ record: runner(req) });
  if (result.skipped) {
    res.status(409).json({ error: "A pruning run is already in progress.", code: "pruning_in_progress" });
    return;
  }
  await logActivity("retention.run", "system", null, null, `${result.totalRowsDeleted} reading(s) deleted by ${result.policiesRun} policy scope(s)`, req);
  res.json(result);
});

function runner(req: Request): RunRecord {
  return { trigger: "manual", userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null };
}

function describePolicy(p: { retentionDays: number; assetId: string | null; metric: string | null; enabled: boolean }): string {
  const scope = p.assetId && p.metric ? `asset ${p.assetId}, metric ${p.metric}` : p.assetId ? `asset ${p.assetId}` : p.metric ? `metric ${p.metric}` : "all assets and metrics";
  return `${p.retentionDays} day(s), ${scope}${p.enabled ? "" : ", disabled"}`;
}

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

export interface RunRecord { trigger: "manual" | "hourly"; userId: string | null; username: string | null }

async function recordRun(rec: RunRecord, startedAt: Date, fields: {
  telemetryDeleted?: number; details?: unknown[]; operational?: Record<string, number>; error?: string | null;
}): Promise<void> {
  try {
    await db.insert(retentionRunsTable).values({
      trigger: rec.trigger, userId: rec.userId, username: rec.username, startedAt, finishedAt: new Date(),
      telemetryDeleted: fields.telemetryDeleted ?? 0, details: fields.details ?? [], operational: fields.operational ?? {},
      error: fields.error ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "Could not record the retention run");
  }
}

/**
 * Prune telemetry by the retention policies. With `record`, the run is written
 * to the pruning history (the hourly job records through runScheduledRetention).
 */
export async function runPruning(opts: { record?: RunRecord } = {}): Promise<PruneResult> {
  // The hourly job and the "Run now" button must not prune the same rows at
  // once, and a slow run must not overlap the next one.
  if (pruningInProgress) return { policiesRun: 0, totalRowsDeleted: 0, details: [], skipped: true };
  pruningInProgress = true;
  const startedAt = new Date();
  try {
    const result = await pruneTelemetry();
    if (opts.record) await recordRun(opts.record, startedAt, { telemetryDeleted: result.totalRowsDeleted, details: result.details });
    return result;
  } catch (err) {
    if (opts.record) await recordRun(opts.record, startedAt, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    pruningInProgress = false;
    invalidateStorageCache();
  }
}

/**
 * The hourly job: telemetry policies, then the age-based tables, the hourly
 * summaries and the pruning history itself. One history row per run.
 */
export async function runScheduledRetention(): Promise<void> {
  const startedAt = new Date();
  const errors: string[] = [];
  let telemetry: PruneResult | null = null;
  let operational: Record<string, number> = {};
  const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const settings = await getDataSettings();
  const notes: unknown[] = [];
  try { await expireHolds(); } catch (err) { errors.push(`holds: ${msg(err)}`); }
  try { await ensureFuturePartitions(); } catch (err) { errors.push(`partitions: ${msg(err)}`); }
  if (insideWindow(startedAt, settings.pruneWindow, PLANT_TIME_ZONE)) {
    try { telemetry = await runPruning(); } catch (err) { errors.push(`telemetry: ${msg(err)}`); }
  } else {
    notes.push({ note: `outside the pruning window (${settings.pruneWindow.start}–${settings.pruneWindow.end}); telemetry not pruned` });
  }
  try { operational = (await runOperationalPruning()).deleted; } catch (err) { errors.push(`records: ${msg(err)}`); }
  const days = operationalRetentionDays();
  const hourDays = settings.tiers.hourDays ?? days.telemetryRollups;
  try { operational.telemetryRollups = await pruneRollups(hourDays); } catch (err) { errors.push(`summaries: ${msg(err)}`); }
  try { if (settings.tiers.m15Days > 0) operational.telemetryRollups15m = await pruneTier(TIERS[0], settings.tiers.m15Days); } catch (err) { errors.push(`15-minute summaries: ${msg(err)}`); }
  try {
    await flushIngestRejections();
    const r = await pool.query(`DELETE FROM ingest_rejections WHERE hour < now() - interval '30 days'`);
    operational.ingestRejections = r.rowCount ?? 0;
  } catch (err) { errors.push(`ingest counts: ${msg(err)}`); }
  if (days.retentionRuns > 0) {
    try {
      const r = await db.delete(retentionRunsTable).where(lt(retentionRunsTable.startedAt, new Date(Date.now() - days.retentionRuns * 86_400_000)));
      operational.retentionRuns = r.rowCount ?? 0;
    } catch (err) { errors.push(`history: ${msg(err)}`); }
  }
  if (telemetry?.skipped) errors.push("telemetry: skipped, a run was already in progress");
  if (telemetry && telemetry.totalRowsDeleted > 0) logger.info({ rows: telemetry.totalRowsDeleted }, "Retention pruning completed");
  if (Object.values(operational).some((n) => n > 0)) logger.info({ deleted: operational }, "Operational data pruning completed");
  for (const e of errors) logger.warn({ error: e }, "Retention run problem");
  await recordRun({ trigger: "hourly", userId: null, username: null }, startedAt, {
    telemetryDeleted: telemetry?.totalRowsDeleted ?? 0, details: [...notes, ...(telemetry?.details ?? [])], operational,
    error: errors.length ? errors.join("; ") : null,
  });
}

async function pruneTelemetry(): Promise<PruneResult> {
  // The partition tool copies the table; deleting meanwhile would bring rows back.
  if ((await conversionState()).inProgress) {
    return { policiesRun: 0, totalRowsDeleted: 0, details: [{ note: "paused: telemetry is being converted to monthly partitions" }] };
  }
  const policies = await db.select().from(dataRetentionTable).where(eq(dataRetentionTable.enabled, true));
  const plan = planRetention(policies);
  let totalDeleted = 0;
  const details: unknown[] = [];
  if (plan.length === 0) return { policiesRun: 0, totalRowsDeleted: 0, details };
  // Raw readings are only deleted once summarised and, with archiving on, archived.
  const longest = Math.max(...plan.map((i) => i.retentionDays));
  const shortest = Math.min(...plan.map((i) => i.retentionDays));
  const limit = await deleteLimit(new Date(Date.now() - shortest * 86_400_000));
  const holds = await activeHolds();
  const held = heldRowsSql(holds);

  // Whole months first, when telemetry is partitioned: only if a policy covers
  // every reading (an all-assets policy) and the month is past the longest one.
  if (await isPartitioned() && policies.some((p) => !p.assetId && !p.metric)) {
    let safe = new Date(Date.now() - longest * 86_400_000);
    if (limit && limit < safe) safe = limit;
    const dropped = await dropExpiredPartitions(safe, (from, to) => holds.some((h) => (!h.fromTs || h.fromTs < to) && (!h.toTs || h.toTs >= from)));
    for (const d of dropped) {
      totalDeleted += d.estRows;
      details.push({ partition: d.name, name: `Month ${d.name.slice(1).replace("_", "-")} (whole partition)`, rowsDeleted: d.estRows, note: "partition dropped" });
    }
  }

  for (const item of plan) {
    let cutoff = new Date(Date.now() - item.retentionDays * 86_400_000);
    const limitedBySummaries = !!limit && limit < cutoff;
    if (limitedBySummaries) cutoff = limit!;
    const conditions: SQL[] = [lt(telemetryTable.timestamp, cutoff)];
    if (item.assetId) conditions.push(eq(telemetryTable.assetId, item.assetId));
    if (item.metric)  conditions.push(eq(telemetryTable.metric, item.metric));
    if (item.excludeAssets.length)  conditions.push(notInArray(telemetryTable.assetId, item.excludeAssets));
    if (item.excludeMetrics.length) conditions.push(notInArray(telemetryTable.metric, item.excludeMetrics));
    if (item.excludePairs.length) {
      conditions.push(sql`(${telemetryTable.assetId}, ${telemetryTable.metric}) NOT IN (${sql.join(
        item.excludePairs.map(([a, m]) => sql`(${a}::uuid, ${m}::text)`), sql`, `)})`);
    }
    // Readings under a legal hold stay.
    if (held) conditions.push(sql`NOT ${held}`);

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

    details.push({ policyId: first, mergedPolicyIds: rest, name: item.names[0], rowsDeleted: count, cutoff, limitedBySummaries });
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
export function operationalRetentionDays(): Record<"clearedAlarms" | "alarmHistory" | "activityLogs" | "brokerEvents" | "authTokens" | "telemetryRollups" | "retentionRuns", number> {
  return {
    clearedAlarms: daysEnv("RETENTION_CLEARED_ALARMS_DAYS", 365),
    alarmHistory: daysEnv("RETENTION_ALARM_HISTORY_DAYS", 730),
    activityLogs: daysEnv("RETENTION_ACTIVITY_LOG_DAYS", 365),
    brokerEvents: daysEnv("RETENTION_BROKER_EVENTS_DAYS", 90),
    authTokens: daysEnv("RETENTION_AUTH_TOKENS_DAYS", 30),
    // Hourly summaries are small (one row per asset, metric and hour) and are
    // what keeps long-term trends once raw readings are pruned.
    telemetryRollups: daysEnv("RETENTION_ROLLUP_DAYS", 1825),
    retentionRuns: daysEnv("RETENTION_RUNS_DAYS", 90),
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
    {
      // The audit log is append-only and hash-chained: lib/audit-store.ts prunes it
      // oldest-first with a checkpoint, never under 365 days (setting on the Audit Log page).
      const auditDays = await auditRetentionDays(days.activityLogs);
      if (auditDays > 0) deleted.activityLogs = await pruneAuditLog(auditDays);
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
