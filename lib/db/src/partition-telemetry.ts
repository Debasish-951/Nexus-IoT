/**
 * Convert `telemetry` to a table partitioned by month, with the API running.
 *
 *   pnpm --filter @workspace/db run partition-telemetry            # check only: what would happen
 *   pnpm --filter @workspace/db run partition-telemetry -- --yes   # convert
 *   pnpm --filter @workspace/db run partition-telemetry -- --rollback
 *   pnpm --filter @workspace/db run partition-telemetry -- --drop-old
 *
 * How the conversion works:
 *  1. Pruning is paused (job_state `telemetry_partitioning`).
 *  2. A partitioned copy `telemetry_new` is created, with one partition per month
 *     in the `telemetry_parts` schema (pYYYY_MM) plus `pdefault`.
 *  3. A trigger copies every new reading (and deletion) to it while
 *  4. the history is copied day by day.
 *  5. The indexes are built, then the tables are swapped in one short
 *     transaction. The old table is kept as telemetry_parts.telemetry_unpartitioned
 *     for rollback; `--drop-old` deletes it and frees its space.
 *
 * It needs free disk space about the size of the current table. Take a backup
 * first. The drizzle config detects the partitioned table and leaves it alone
 * (lib/db/drizzle.config.ts); the partitions and the old table sit in a schema
 * that `push` never reads.
 */
import * as dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });

const args = new Set(process.argv.slice(2));
const PARTS = "telemetry_parts";
const STATE = "telemetry_partitioning";
const COLS = `id, asset_id, device_id, metric, value, quality, "timestamp"`;

function log(msg: string): void {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)}  ${msg}\n`);
}

async function setState(c: pg.Client, value: Record<string, unknown>): Promise<void> {
  await c.query(
    `INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [STATE, JSON.stringify(value)]);
}

async function relkind(c: pg.Client, name: string): Promise<string | null> {
  const r = await c.query<{ relkind: string }>(`SELECT relkind FROM pg_class WHERE oid = to_regclass($1)`, [name]);
  return r.rows[0]?.relkind ?? null;
}

function monthStart(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function addMonths(d: Date, n: number): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); }
function pname(d: Date): string { return `p${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }

async function check(c: pg.Client): Promise<{ first: Date | null; bytes: number }> {
  const kind = await relkind(c, "public.telemetry");
  const size = await c.query<{ bytes: string; pretty: string; est: string }>(
    `SELECT pg_total_relation_size('public.telemetry') AS bytes, pg_size_pretty(pg_total_relation_size('public.telemetry')) AS pretty,
            GREATEST(reltuples, 0)::bigint AS est FROM pg_class WHERE oid = 'public.telemetry'::regclass`);
  const range = await c.query<{ a: Date | null; b: Date | null }>(`SELECT min("timestamp") AS a, max("timestamp") AS b FROM telemetry`);
  const first = range.rows[0]?.a ?? null;
  log(`telemetry: ${kind === "p" ? "already partitioned" : "a plain table"}, about ${Number(size.rows[0].est).toLocaleString()} readings, ${size.rows[0].pretty}`);
  if (first) log(`readings from ${first.toISOString()} to ${range.rows[0].b?.toISOString()}`);
  const old = await relkind(c, `${PARTS}.telemetry_unpartitioned`);
  if (old) log(`an old copy is kept as ${PARTS}.telemetry_unpartitioned (drop it with --drop-old)`);
  return { first, bytes: Number(size.rows[0].bytes) };
}

async function convert(c: pg.Client): Promise<void> {
  if ((await relkind(c, "public.telemetry")) === "p") throw new Error("telemetry is already partitioned");
  if (await relkind(c, "public.telemetry_new")) throw new Error("public.telemetry_new exists from an earlier attempt; drop it first (DROP TABLE public.telemetry_new CASCADE)");
  if (await relkind(c, `${PARTS}.telemetry_unpartitioned`)) throw new Error(`${PARTS}.telemetry_unpartitioned already exists; drop it with --drop-old first`);
  const { first, bytes } = await check(c);
  log(`needs about ${(bytes / 1024 ** 3).toFixed(1)} GB of free disk space while both copies exist`);

  const startedAt = new Date().toISOString();
  await setState(c, { inProgress: true, startedAt, step: "prepare" });
  log("pruning paused");

  await c.query(`CREATE SCHEMA IF NOT EXISTS ${PARTS}`);
  await c.query(`CREATE TABLE public.telemetry_new (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      asset_id uuid NOT NULL,
      device_id text,
      metric text NOT NULL,
      value jsonb,
      quality text,
      "timestamp" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT telemetry_new_pkey PRIMARY KEY (id, "timestamp")
    ) PARTITION BY RANGE ("timestamp")`);
  const from = monthStart(first ?? new Date());
  const until = addMonths(monthStart(new Date()), 3);
  let months = 0;
  for (let m = from; m < until; m = addMonths(m, 1)) {
    await c.query(`CREATE TABLE ${PARTS}.${pname(m)} PARTITION OF public.telemetry_new FOR VALUES FROM ('${m.toISOString()}') TO ('${addMonths(m, 1).toISOString()}')`);
    months++;
  }
  await c.query(`CREATE TABLE ${PARTS}.pdefault PARTITION OF public.telemetry_new DEFAULT`);
  log(`created ${months} monthly partitions and a default partition in ${PARTS}`);

  // Mirror live changes while the history is copied.
  await c.query(`CREATE OR REPLACE FUNCTION ${PARTS}.telemetry_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO public.telemetry_new (${COLS}) VALUES (NEW.id, NEW.asset_id, NEW.device_id, NEW.metric, NEW.value, NEW.quality, NEW."timestamp") ON CONFLICT DO NOTHING;
        RETURN NEW;
      ELSE
        DELETE FROM public.telemetry_new WHERE id = OLD.id AND "timestamp" = OLD."timestamp";
        RETURN OLD;
      END IF;
    END $$`);
  await c.query(`CREATE TRIGGER telemetry_mirror AFTER INSERT OR DELETE ON public.telemetry FOR EACH ROW EXECUTE FUNCTION ${PARTS}.telemetry_mirror()`);
  log("live readings are now copied as they arrive");

  await setState(c, { inProgress: true, startedAt, step: "copy" });
  if (first) {
    const dayMs = 86_400_000;
    let day = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()));
    const end = new Date(Date.now() + dayMs);
    let total = 0;
    while (day < end) {
      const next = new Date(day.getTime() + dayMs);
      const r = await c.query(`INSERT INTO public.telemetry_new (${COLS})
        SELECT ${COLS} FROM public.telemetry WHERE "timestamp" >= $1 AND "timestamp" < $2 ON CONFLICT DO NOTHING`, [day, next]);
      total += r.rowCount ?? 0;
      log(`copied ${day.toISOString().slice(0, 10)}: ${(r.rowCount ?? 0).toLocaleString()} (total ${total.toLocaleString()})`);
      day = next;
    }
  }

  await setState(c, { inProgress: true, startedAt, step: "indexes" });
  log("building indexes");
  await c.query(`CREATE INDEX idx_telemetry_new_asset_metric_ts ON public.telemetry_new (asset_id, metric, "timestamp")`);
  await c.query(`CREATE INDEX idx_telemetry_new_ts ON public.telemetry_new ("timestamp")`);
  await c.query(`CREATE INDEX idx_telemetry_new_asset_ts ON public.telemetry_new (asset_id, "timestamp")`);
  await c.query(`ANALYZE public.telemetry_new`);

  await setState(c, { inProgress: true, startedAt, step: "swap" });
  log("swapping tables (ingest waits a moment)");
  await c.query("BEGIN");
  try {
    await c.query(`SET LOCAL lock_timeout = '30s'`);
    await c.query(`LOCK TABLE public.telemetry IN ACCESS EXCLUSIVE MODE`);
    await c.query(`DROP TRIGGER telemetry_mirror ON public.telemetry`);
    await c.query(`ALTER TABLE public.telemetry RENAME TO telemetry_unpartitioned`);
    await c.query(`ALTER TABLE public.telemetry_unpartitioned RENAME CONSTRAINT telemetry_pkey TO telemetry_unpartitioned_pkey`);
    for (const i of ["idx_telemetry_asset_metric_ts", "idx_telemetry_ts", "idx_telemetry_asset_ts"]) {
      await c.query(`ALTER INDEX IF EXISTS public.${i} RENAME TO ${i}_unpartitioned`);
    }
    await c.query(`ALTER TABLE public.telemetry_unpartitioned SET SCHEMA ${PARTS}`);
    await c.query(`ALTER TABLE public.telemetry_new RENAME TO telemetry`);
    await c.query(`ALTER TABLE public.telemetry RENAME CONSTRAINT telemetry_new_pkey TO telemetry_pkey`);
    await c.query(`ALTER INDEX public.idx_telemetry_new_asset_metric_ts RENAME TO idx_telemetry_asset_metric_ts`);
    await c.query(`ALTER INDEX public.idx_telemetry_new_ts RENAME TO idx_telemetry_ts`);
    await c.query(`ALTER INDEX public.idx_telemetry_new_asset_ts RENAME TO idx_telemetry_asset_ts`);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  }
  await setState(c, { inProgress: false, completedAt: new Date().toISOString(), oldTable: `${PARTS}.telemetry_unpartitioned` });
  log("done: telemetry is partitioned by month and pruning is back on");
  log(`check the application, then run --drop-old to delete ${PARTS}.telemetry_unpartitioned and free its space`);
}

async function rollback(c: pg.Client): Promise<void> {
  if ((await relkind(c, "public.telemetry")) !== "p") throw new Error("telemetry is not partitioned; nothing to roll back");
  if (!(await relkind(c, `${PARTS}.telemetry_unpartitioned`))) throw new Error("the old table is gone (dropped with --drop-old); roll back from a backup instead");
  const st = await c.query<{ value: { completedAt?: string } }>(`SELECT value FROM job_state WHERE key = $1`, [STATE]);
  const since = new Date(new Date(st.rows[0]?.value?.completedAt ?? Date.now()).getTime() - 86_400_000);
  await setState(c, { inProgress: true, step: "rollback" });
  await c.query("BEGIN");
  try {
    await c.query(`SET LOCAL lock_timeout = '30s'`);
    await c.query(`LOCK TABLE public.telemetry IN ACCESS EXCLUSIVE MODE`);
    // Readings that arrived after the swap go back into the old table.
    const r = await c.query(`INSERT INTO ${PARTS}.telemetry_unpartitioned (${COLS})
      SELECT ${COLS} FROM public.telemetry WHERE "timestamp" >= $1 ON CONFLICT DO NOTHING`, [since]);
    log(`copied ${(r.rowCount ?? 0).toLocaleString()} recent readings back`);
    await c.query(`ALTER TABLE public.telemetry RENAME TO telemetry_partitioned_old`);
    await c.query(`ALTER TABLE public.telemetry_partitioned_old RENAME CONSTRAINT telemetry_pkey TO telemetry_partitioned_old_pkey`);
    for (const i of ["idx_telemetry_asset_metric_ts", "idx_telemetry_ts", "idx_telemetry_asset_ts"]) {
      await c.query(`ALTER INDEX public.${i} RENAME TO ${i}_partitioned_old`);
    }
    await c.query(`ALTER TABLE public.telemetry_partitioned_old SET SCHEMA ${PARTS}`);
    await c.query(`ALTER TABLE ${PARTS}.telemetry_unpartitioned SET SCHEMA public`);
    await c.query(`ALTER TABLE public.telemetry_unpartitioned RENAME TO telemetry`);
    await c.query(`ALTER TABLE public.telemetry RENAME CONSTRAINT telemetry_unpartitioned_pkey TO telemetry_pkey`);
    for (const i of ["idx_telemetry_asset_metric_ts", "idx_telemetry_ts", "idx_telemetry_asset_ts"]) {
      await c.query(`ALTER INDEX IF EXISTS public.${i}_unpartitioned RENAME TO ${i}`);
    }
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  }
  await setState(c, { inProgress: false, rolledBackAt: new Date().toISOString(), oldTable: `${PARTS}.telemetry_partitioned_old` });
  log(`rolled back: telemetry is a plain table again; the partitioned copy is ${PARTS}.telemetry_partitioned_old (drop it with --drop-old)`);
}

async function dropOld(c: pg.Client): Promise<void> {
  let n = 0;
  for (const t of ["telemetry_unpartitioned", "telemetry_partitioned_old"]) {
    if (await relkind(c, `${PARTS}.${t}`)) {
      await c.query(`DROP TABLE ${PARTS}.${t} CASCADE`);
      log(`dropped ${PARTS}.${t}`);
      n++;
    }
  }
  await c.query(`DROP FUNCTION IF EXISTS ${PARTS}.telemetry_mirror()`);
  const st = await c.query<{ value: Record<string, unknown> }>(`SELECT value FROM job_state WHERE key = $1`, [STATE]);
  if (st.rows[0]) await setState(c, { ...st.rows[0].value, inProgress: false, oldTable: null });
  if (!n) log("nothing to drop");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 0 });
  await c.connect();
  try {
    if (args.has("--rollback")) await rollback(c);
    else if (args.has("--drop-old")) await dropOld(c);
    else if (args.has("--yes")) {
      try { await convert(c); }
      catch (err) {
        // Leave the database usable: stop mirroring and resume pruning. The
        // half-built copy is left for inspection; drop it before retrying.
        await c.query(`DROP TRIGGER IF EXISTS telemetry_mirror ON public.telemetry`).catch(() => {});
        await setState(c, { inProgress: false, failedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) }).catch(() => {});
        throw err;
      }
    } else {
      await check(c);
      log("check only. Take a backup, then run again with --yes to convert.");
    }
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  process.stderr.write(`partition-telemetry failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
