/**
 * Telemetry summaries: 15-minute (`telemetry_rollups_15m`) and hourly
 * (`telemetry_rollups`).
 *
 * For each level the job walks forward through raw telemetry in 6-hour slices,
 * starting at the oldest reading, and writes one row per asset, metric and
 * bucket: how many readings arrived, and for the numeric ones count, sum, min
 * and max. After catching up it only summarises what completed since the last
 * run.
 *
 * Every bucket before a level's watermark has been summarised. The last
 * LATE_WINDOW before the watermark is summarised again on each run, so readings
 * that a gateway delivers a little late still count. Retention pruning never
 * deletes raw readings newer than `watermark - LATE_WINDOW` of any level that is
 * switched on (see `rawPruneLimit`), so nothing is deleted before it has been
 * summarised.
 *
 * TELEMETRY_ROLLUPS=false turns the job off entirely. The 15-minute level is off
 * when its retention (Data Management settings) is 0.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { getDataSettings } from "../lib/data-settings";

const HOUR = 3_600_000;
/** Raw time summarised per statement. Small slices keep each query well inside the statement timeout. */
const SLICE_MS = 6 * HOUR;
/** Readings up to this late are still counted. Pruning keeps this much raw data behind the watermark. */
export const LATE_WINDOW_MS = 6 * HOUR;
const NUMERIC = "'^-?[0-9]+(\\.[0-9]+)?$'";

export interface Tier { key: "hour" | "m15"; table: string; stepSec: number; stateKey: string; label: string }
export const TIERS: Tier[] = [
  { key: "m15", table: "telemetry_rollups_15m", stepSec: 900, stateKey: "telemetry_rollups_15m", label: "15-minute summaries" },
  { key: "hour", table: "telemetry_rollups", stepSec: 3600, stateKey: "telemetry_rollups", label: "Hourly summaries" },
];
const HOUR_TIER = TIERS[1];

export function rollupsEnabled(): boolean {
  return process.env.TELEMETRY_ROLLUPS !== "false";
}

/** The levels being built right now. */
export async function activeTiers(): Promise<Tier[]> {
  if (!rollupsEnabled()) return [];
  const s = await getDataSettings();
  return TIERS.filter((t) => t.key === "hour" || s.tiers.m15Days > 0);
}

export function floorHour(d: Date): Date {
  return new Date(Math.floor(d.getTime() / HOUR) * HOUR);
}

function floorStep(d: Date, stepSec: number): Date {
  const ms = stepSec * 1000;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}

export interface RollupState {
  /** Every bucket before this instant has been summarised. Null until the first slice. */
  watermark: Date | null;
  /** Where the job started, i.e. the oldest reading when it first ran. */
  startedFrom: Date | null;
}

export async function getRollupState(tier: Tier = HOUR_TIER): Promise<RollupState> {
  const r = await pool.query<{ value: { watermark?: string; startedFrom?: string } }>(
    `SELECT value FROM job_state WHERE key = $1`, [tier.stateKey]);
  const v = r.rows[0]?.value ?? {};
  return {
    watermark: v.watermark ? new Date(v.watermark) : null,
    startedFrom: v.startedFrom ? new Date(v.startedFrom) : null,
  };
}

async function saveState(tier: Tier, s: RollupState): Promise<void> {
  await pool.query(
    `INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [tier.stateKey, JSON.stringify({ watermark: s.watermark?.toISOString(), startedFrom: s.startedFrom?.toISOString() })],
  );
}

/**
 * The newest instant retention may delete raw readings before, or null when
 * there is no limit (summaries switched off). Before a level's first slice is
 * done nothing may be deleted.
 */
export async function rawPruneLimit(): Promise<Date | null> {
  const tiers = await activeTiers();
  if (tiers.length === 0) return null;
  let limit: Date | null = null;
  for (const t of tiers) {
    const l = rawPruneLimitFrom((await getRollupState(t)).watermark);
    if (!limit || l < limit) limit = l;
  }
  return limit;
}

/** Pure part of `rawPruneLimit`, for tests. */
export function rawPruneLimitFrom(watermark: Date | null): Date {
  if (!watermark) return new Date(0);
  return new Date(watermark.getTime() - LATE_WINDOW_MS);
}

function bucketSql(stepSec: number): string {
  return `to_timestamp(FLOOR(EXTRACT(EPOCH FROM "timestamp") / ${stepSec}) * ${stepSec})`;
}

/**
 * Summarise raw readings in [from, to) into one level. A recount is only
 * accepted when it is not smaller, unless `force` (used after bad-data removal):
 * a smaller count normally means raw rows of that bucket were already pruned,
 * and the stored summary is then the better record of what arrived.
 */
export async function summarise(tier: Tier, from: Date, to: Date, opts: { force?: boolean; assetId?: string; metric?: string } = {}): Promise<number> {
  const params: unknown[] = [from, to];
  let extra = "";
  if (opts.assetId) { params.push(opts.assetId); extra += ` AND asset_id = $${params.length}`; }
  if (opts.metric) { params.push(opts.metric); extra += ` AND metric = $${params.length}`; }
  // Background work on dense history can take longer than the request timeout
  // (DB_STATEMENT_TIMEOUT_MS); it gets its own, longer limit.
  const client = await pool.connect();
  let r;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 300000");
    r = await client.query(`
    INSERT INTO ${tier.table} (asset_id, metric, bucket, "rows", n, sum, min, max)
    SELECT asset_id, metric, ${bucketSql(tier.stepSec)},
           COUNT(*)::int,
           (COUNT(*) FILTER (WHERE value::text ~ ${NUMERIC}))::int,
           SUM(CASE WHEN value::text ~ ${NUMERIC} THEN (value::text)::float8 END),
           MIN(CASE WHEN value::text ~ ${NUMERIC} THEN (value::text)::float8 END),
           MAX(CASE WHEN value::text ~ ${NUMERIC} THEN (value::text)::float8 END)
    FROM telemetry
    WHERE "timestamp" >= $1 AND "timestamp" < $2${extra}
    GROUP BY 1, 2, 3
    ON CONFLICT (asset_id, metric, bucket) DO UPDATE
      SET "rows" = EXCLUDED."rows", n = EXCLUDED.n, sum = EXCLUDED.sum, min = EXCLUDED.min, max = EXCLUDED.max
      ${opts.force ? "" : `WHERE EXCLUDED."rows" >= ${tier.table}."rows"`}`, params);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return r.rowCount ?? 0;
}

function isTimeout(err: unknown): boolean {
  return (err as { code?: string })?.code === "57014";
}

/**
 * Summarise [from, to); when a slice is too dense to finish in time, split it in
 * half and try again, down to one bucket.
 */
async function summariseAdaptive(tier: Tier, from: Date, to: Date): Promise<void> {
  try {
    await summarise(tier, from, to);
  } catch (err) {
    const span = to.getTime() - from.getTime();
    if (!isTimeout(err) || span <= tier.stepSec * 1000) throw err;
    const mid = new Date(from.getTime() + Math.max(tier.stepSec * 1000, Math.floor(span / 2 / (tier.stepSec * 1000)) * tier.stepSec * 1000));
    logger.info({ tier: tier.key, from, to }, "Summary slice too dense; splitting it");
    await summariseAdaptive(tier, from, mid);
    await summariseAdaptive(tier, mid, to);
  }
}

let running = false;
let lastError: string | null = null;
const advancedListeners: Array<() => void> = [];

/** Called after the summaries moved forward (Data Management drops its cached counts). */
export function onRollupsAdvanced(fn: () => void): void {
  advancedListeners.push(fn);
}

export function rollupJobError(): string | null {
  return lastError;
}

async function runTier(tier: Tier): Promise<number> {
  let slices = 0;
  const state = await getRollupState(tier);
  const end = floorStep(new Date(), tier.stepSec);
  if (!state.watermark) {
    const first = await pool.query<{ ts: Date | null }>(`SELECT min("timestamp") AS ts FROM telemetry`);
    const ts = first.rows[0]?.ts;
    if (!ts) return 0;
    state.watermark = floorHour(new Date(ts));
    state.startedFrom = state.watermark;
    await saveState(tier, state);
  }
  let from = new Date(state.watermark.getTime() - LATE_WINDOW_MS);
  while (from < end) {
    const to = new Date(Math.min(from.getTime() + SLICE_MS, end.getTime()));
    await summariseAdaptive(tier, from, to);
    slices++;
    if (to > state.watermark!) {
      state.watermark = to;
      await saveState(tier, state);
    }
    from = to;
    // Give live traffic room while catching up on months of history.
    await new Promise((r) => setTimeout(r, 50));
  }
  return slices;
}

/** Bring every active level up to its last completed bucket. Overlapping calls return at once. */
export async function runRollups(): Promise<{ slices: number; skipped?: boolean }> {
  if (!rollupsEnabled() || running) return { slices: 0, skipped: true };
  running = true;
  let slices = 0;
  try {
    for (const tier of await activeTiers()) slices += await runTier(tier);
    if (slices > 0) for (const fn of advancedListeners) fn();
    lastError = null;
    return { slices };
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    running = false;
  }
}

/** Delete hourly summaries older than `days` (0 keeps them for ever). Returns rows deleted. */
export async function pruneRollups(days: number): Promise<number> {
  return pruneTier(HOUR_TIER, days);
}

export async function pruneTier(tier: Tier, days: number): Promise<number> {
  if (days <= 0) return 0;
  const r = await pool.query(`DELETE FROM ${tier.table} WHERE bucket < $1`, [new Date(Date.now() - days * 86_400_000)]);
  return r.rowCount ?? 0;
}

/** Start the job: shortly after boot, then every 10 minutes. */
export function startRollupJob(): void {
  if (!rollupsEnabled()) {
    logger.info("Telemetry summaries are off (TELEMETRY_ROLLUPS=false)");
    return;
  }
  const tick = () => {
    runRollups()
      .then((r) => { if (r.slices > 1) logger.info({ slices: r.slices }, "Telemetry summaries updated"); })
      .catch((e) => logger.warn({ err: e }, "Telemetry summary job failed"));
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 10 * 60_000);
}
