/**
 * Legal holds: readings that must not be deleted (an incident under
 * investigation, an audit, a restored archive). Pruning and bad-data removal
 * skip held readings; null fields mean "any" (asset, metric, start, end).
 */
import { sql, type SQL } from "drizzle-orm";
import { db, pool, dataHoldsTable, telemetryTable } from "@workspace/db";

export interface HoldLike { id?: string; assetId: string | null; metric: string | null; fromTs: Date | null; toTs: Date | null }

export async function activeHolds(): Promise<Array<typeof dataHoldsTable.$inferSelect>> {
  const r = await db.select().from(dataHoldsTable)
    .where(sql`${dataHoldsTable.releasedAt} IS NULL AND (${dataHoldsTable.expiresAt} IS NULL OR ${dataHoldsTable.expiresAt} > now())`);
  return r;
}

/** SQL that is true for telemetry rows covered by any of the holds. */
export function heldRowsSql(holds: HoldLike[]): SQL | null {
  if (holds.length === 0) return null;
  const parts = holds.map((h) => {
    const c: SQL[] = [];
    if (h.assetId) c.push(sql`${telemetryTable.assetId} = ${h.assetId}`);
    if (h.metric) c.push(sql`${telemetryTable.metric} = ${h.metric}`);
    if (h.fromTs) c.push(sql`${telemetryTable.timestamp} >= ${h.fromTs}`);
    if (h.toTs) c.push(sql`${telemetryTable.timestamp} <= ${h.toTs}`);
    return c.length ? sql`(${sql.join(c, sql` AND `)})` : sql`TRUE`;
  });
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/** Whether a hold covers some of this asset/metric/time range. */
export function holdOverlaps(h: HoldLike, r: { assetId: string; metric: string | null; from: Date; to: Date }): boolean {
  if (h.assetId && h.assetId !== r.assetId) return false;
  if (h.metric && r.metric && h.metric !== r.metric) return false;
  if (h.fromTs && h.fromTs > r.to) return false;
  if (h.toTs && h.toTs < r.from) return false;
  return true;
}

/**
 * Fraction of [start, end) held for one asset+metric, for estimates. Overlapping
 * holds are merged, so the fraction never exceeds 1.
 */
export function heldFraction(holds: HoldLike[], pair: { assetId: string; metric: string }, start: number, end: number): number {
  if (end <= start) return 0;
  const spans: Array<[number, number]> = [];
  for (const h of holds) {
    if (h.assetId && h.assetId !== pair.assetId) continue;
    if (h.metric && h.metric !== pair.metric) continue;
    const a = Math.max(start, h.fromTs ? h.fromTs.getTime() : -Infinity);
    const b = Math.min(end, h.toTs ? h.toTs.getTime() : Infinity);
    if (b > a) spans.push([a, b]);
  }
  if (spans.length === 0) return 0;
  spans.sort((x, y) => x[0] - y[0]);
  let covered = 0, cs = spans[0][0], ce = spans[0][1];
  for (const [a, b] of spans.slice(1)) {
    if (a <= ce) ce = Math.max(ce, b);
    else { covered += ce - cs; cs = a; ce = b; }
  }
  covered += ce - cs;
  return Math.min(1, covered / (end - start));
}

/** Expire holds whose end time passed; they stay listed as released. */
export async function expireHolds(): Promise<number> {
  const r = await pool.query(`UPDATE data_holds SET released_at = expires_at, released_by = 'expired'
    WHERE released_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now()`);
  return r.rowCount ?? 0;
}

// ── Atomic hold checks (audit L-24, H-3) ──────────────────────────────────────
//
// A hold created while a deletion runs must bind the rest of that deletion. Hold
// creation takes an exclusive advisory lock and every telemetry delete batch a
// shared one, and each batch re-reads the active holds inside its own statement.
// A new hold therefore waits for the batch in flight and binds every later one.

/** Advisory lock key shared by hold creation (exclusive) and telemetry deletes (shared). */
export const HOLD_LOCK_KEY = 74_201_117;

/** SQL that is true for a telemetry row covered by an active hold, read in the same statement. */
export function underActiveHoldSql(): SQL {
  return sql`EXISTS (SELECT 1 FROM data_holds h
    WHERE h.released_at IS NULL AND (h.expires_at IS NULL OR h.expires_at > now())
      AND (h.asset_id IS NULL OR h.asset_id = ${telemetryTable.assetId})
      AND (h.metric IS NULL OR h.metric = ${telemetryTable.metric})
      AND (h.from_ts IS NULL OR ${telemetryTable.timestamp} >= h.from_ts)
      AND (h.to_ts IS NULL OR ${telemetryTable.timestamp} <= h.to_ts))`;
}

/** Insert a hold under the exclusive lock, so no delete batch is in flight when it commits. */
export async function insertHold(values: typeof dataHoldsTable.$inferInsert): Promise<typeof dataHoldsTable.$inferSelect> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${HOLD_LOCK_KEY})`);
    const [row] = await tx.insert(dataHoldsTable).values(values).returning();
    return row;
  });
}

/**
 * Delete telemetry matching `where` in batches by primary key. Readings under an
 * active hold are never deleted, including holds created while this runs.
 * `onBatch` gets the running total, so a caller can record partial progress.
 */
export async function deleteUnheldTelemetry(where: SQL, opts: { batchSize?: number; maxBatches?: number; onBatch?: (total: number) => void } = {}): Promise<number> {
  const size = opts.batchSize ?? 5000;
  const max = opts.maxBatches ?? Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < max; i++) {
    const n = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${HOLD_LOCK_KEY})`);
      const r = await tx.execute(sql`DELETE FROM ${telemetryTable} WHERE id IN (
        SELECT id FROM ${telemetryTable} WHERE ${where} AND NOT ${underActiveHoldSql()} LIMIT ${size})`);
      return r.rowCount ?? 0;
    });
    total += n;
    opts.onBatch?.(total);
    if (n < size) break;
  }
  return total;
}

/**
 * Pure part of the asset-delete hold check: the first hold that names one of
 * `assetIds`. Holds with no asset are checked against the data separately
 * (`unscopedHolds`), since they only matter if the subtree has readings they cover.
 */
export function assetScopedHoldConflict(holds: Array<HoldLike & { name?: string }>, assetIds: string[]): string | null {
  const ids = new Set(assetIds);
  const hit = holds.find((h) => h.assetId && ids.has(h.assetId));
  return hit ? hit.name ?? "a legal hold" : null;
}

/**
 * Name of an active hold that covers readings of any asset in `assetIds`, or
 * null. Used before deleting an asset or project (audit H-3).
 */
export async function subtreeHoldConflict(assetIds: string[]): Promise<string | null> {
  if (assetIds.length === 0) return null;
  const holds = await activeHolds();
  const scoped = assetScopedHoldConflict(holds, assetIds);
  if (scoped) return scoped;
  for (const h of holds.filter((x) => !x.assetId)) {
    const c: SQL[] = [sql`asset_id = ANY(${assetIds}::uuid[])`];
    if (h.metric) c.push(sql`metric = ${h.metric}`);
    if (h.fromTs) c.push(sql`"timestamp" >= ${h.fromTs}`);
    if (h.toTs) c.push(sql`"timestamp" <= ${h.toTs}`);
    const r = await db.execute(sql`SELECT 1 FROM telemetry WHERE ${sql.join(c, sql` AND `)} LIMIT 1`);
    if (r.rows.length) return h.name;
  }
  return null;
}
