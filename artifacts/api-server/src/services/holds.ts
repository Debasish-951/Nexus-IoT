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
