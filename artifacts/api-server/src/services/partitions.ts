/**
 * Monthly partitions of `telemetry`, once it has been converted with
 * `pnpm --filter @workspace/db run partition-telemetry` (see
 * lib/db/src/partition-telemetry.ts and docs/features/data-management.md).
 *
 * Partitions live in the `telemetry_parts` schema as `pYYYY_MM`, plus
 * `pdefault` for readings outside every month. While partitioned:
 * - `ensureFuturePartitions()` keeps the current and next two months ready;
 * - pruning drops a whole month in one statement when every reading in it is
 *   past its retention, not held, summarised and (if on) archived. Dropping
 *   frees the disk space at once, unlike row deletes.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export const PART_SCHEMA = "telemetry_parts";

export interface PartitionInfo { name: string; from: Date | null; to: Date | null; isDefault: boolean; estRows: number; bytes: number }

export async function isPartitioned(): Promise<boolean> {
  const r = await pool.query<{ relkind: string }>(`SELECT relkind FROM pg_class WHERE oid = to_regclass('public.telemetry')`);
  return r.rows[0]?.relkind === "p";
}

export async function conversionState(): Promise<{ inProgress: boolean; startedAt?: string; step?: string; oldTable?: string | null }> {
  const r = await pool.query<{ value: Record<string, unknown> }>(`SELECT value FROM job_state WHERE key = 'telemetry_partitioning'`);
  const v = r.rows[0]?.value ?? {};
  return {
    inProgress: v.inProgress === true,
    startedAt: typeof v.startedAt === "string" ? v.startedAt : undefined,
    step: typeof v.step === "string" ? v.step : undefined,
    oldTable: typeof v.oldTable === "string" ? v.oldTable : null,
  };
}

/** Parse "FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00')". */
export function parseBound(expr: string): { from: Date | null; to: Date | null; isDefault: boolean } {
  if (/DEFAULT/i.test(expr)) return { from: null, to: null, isDefault: true };
  const m = expr.match(/FROM \('([^']+)'\) TO \('([^']+)'\)/i);
  if (!m) return { from: null, to: null, isDefault: false };
  return { from: new Date(m[1]), to: new Date(m[2]), isDefault: false };
}

export async function listPartitions(): Promise<PartitionInfo[]> {
  const r = await pool.query<{ name: string; bound: string; est: string; bytes: string }>(`
    SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound,
           GREATEST(c.reltuples, 0)::bigint AS est, pg_total_relation_size(c.oid) AS bytes
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = to_regclass('public.telemetry')
    ORDER BY c.relname`);
  return r.rows.map((x) => ({ name: x.name, ...parseBound(x.bound), estRows: Number(x.est), bytes: Number(x.bytes) }));
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function partitionName(d: Date): string {
  return `p${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Create the current and next two monthly partitions if they are missing. */
export async function ensureFuturePartitions(): Promise<string[]> {
  if (!(await isPartitioned())) return [];
  const existing = new Set((await listPartitions()).map((p) => p.name));
  const created: string[] = [];
  let m = monthStart(new Date());
  for (let i = 0; i < 3; i++) {
    const next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    const name = partitionName(m);
    if (!existing.has(name)) {
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${PART_SCHEMA}.${name} PARTITION OF public.telemetry FOR VALUES FROM ('${m.toISOString()}') TO ('${next.toISOString()}')`);
        created.push(name);
      } catch (err) {
        // Usually rows for that month already sit in the default partition.
        logger.warn({ err, partition: name }, "Could not create telemetry partition");
      }
    }
    m = next;
  }
  return created;
}

/**
 * Drop monthly partitions that hold nothing worth keeping: their whole range is
 * older than `safeBefore` (the earliest of: every policy's cutoff, the summary
 * guard and the archive guard) and no legal hold touches them. Returns what was
 * dropped with its estimated row count.
 */
export async function dropExpiredPartitions(safeBefore: Date, holdsTouch: (from: Date, to: Date) => boolean): Promise<Array<{ name: string; estRows: number }>> {
  if (!(await isPartitioned())) return [];
  const dropped: Array<{ name: string; estRows: number }> = [];
  for (const p of await listPartitions()) {
    if (p.isDefault || !p.from || !p.to) continue;
    if (p.to > safeBefore) continue;
    if (holdsTouch(p.from, p.to)) continue;
    // Exact count for the record; the partition is old and no longer written to.
    const c = await pool.query<{ n: string }>(`SELECT count(*)::bigint AS n FROM ${PART_SCHEMA}.${p.name}`);
    await pool.query(`DROP TABLE ${PART_SCHEMA}.${p.name}`);
    dropped.push({ name: p.name, estRows: Number(c.rows[0]?.n ?? 0) });
    logger.info({ partition: p.name, rows: c.rows[0]?.n }, "Dropped expired telemetry partition");
  }
  return dropped;
}
