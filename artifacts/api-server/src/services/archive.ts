/**
 * Archive before delete: raw telemetry is written to one compressed file per
 * UTC day (JSON lines, gzip) before pruning may delete that day.
 *
 * Files go to ARCHIVE_DIR (default `var/archives` next to the uploads folder),
 * as `telemetry/YYYY/MM/YYYY-MM-DD.jsonl.gz`. Mount a network share or object
 * storage there to keep them off the VM. Each line is one reading:
 * {"id","asset_id","device_id","metric","value","quality","timestamp"}.
 *
 * `archivedUntil` (job_state `telemetry_archive`) is the end of the last day in
 * an unbroken run of archived days; pruning never deletes past it while
 * archiving is on. Restoring a day re-inserts its readings (existing ones are
 * skipped) and places a legal hold on that day, so the next pruning run does not
 * delete them again.
 */
import path from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { pool, db, dataArchivesTable, dataHoldsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const DAY = 86_400_000;
const STATE_KEY = "telemetry_archive";

export function archiveRoot(): string {
  return path.resolve(process.env.ARCHIVE_DIR ?? path.resolve(process.cwd(), "var", "archives"));
}

export function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayStart(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export async function archivedUntil(): Promise<Date | null> {
  const r = await pool.query<{ value: { archivedUntil?: string } }>(`SELECT value FROM job_state WHERE key = $1`, [STATE_KEY]);
  const v = r.rows[0]?.value?.archivedUntil;
  return v ? new Date(v) : null;
}

async function setArchivedUntil(d: Date): Promise<void> {
  await pool.query(
    `INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [STATE_KEY, JSON.stringify({ archivedUntil: d.toISOString() })]);
}

let lastError: string | null = null;
export function archiveError(): string | null { return lastError; }

/** Write one UTC day to its file. Returns the archive row. Overwrites an earlier file of that day. */
export async function archiveDay(day: string): Promise<typeof dataArchivesTable.$inferSelect> {
  const start = dayStart(day);
  const rel = path.join("telemetry", day.slice(0, 4), day.slice(5, 7), `${day}.jsonl.gz`);
  const file = path.join(archiveRoot(), rel);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.partial`;
  const gzip = createGzip({ level: 6 });
  const out = createWriteStream(tmp, { mode: 0o640 });
  const hash = createHash("sha256");
  gzip.on("data", (chunk: Buffer) => hash.update(chunk));
  gzip.pipe(out);
  let rows = 0;
  try {
    // One hour per query keeps each statement small.
    for (let h = 0; h < 24; h++) {
      const a = new Date(start.getTime() + h * 3_600_000);
      const b = new Date(a.getTime() + 3_600_000);
      const r = await pool.query(
        `SELECT id, asset_id, device_id, metric, value, quality, "timestamp" FROM telemetry
         WHERE "timestamp" >= $1 AND "timestamp" < $2 ORDER BY "timestamp"`, [a, b]);
      for (const row of r.rows) {
        if (!gzip.write(JSON.stringify(row) + "\n")) await once(gzip, "drain");
        rows++;
      }
    }
    gzip.end();
    await once(out, "close");
    await rename(tmp, file);
  } catch (err) {
    gzip.destroy(); out.destroy();
    await unlink(tmp).catch(() => {});
    throw err;
  }
  const bytes = (await stat(file)).size;
  const values = { day, path: rel, rows, bytes, sha256: hash.digest("hex"), createdAt: new Date() };
  const [row] = await db.insert(dataArchivesTable).values(values)
    .onConflictDoUpdate({ target: dataArchivesTable.day, set: values }).returning();
  return row;
}

let running = false;

/**
 * Archive every complete UTC day before `until` that is not archived yet, from
 * the oldest raw reading on. Returns the new archivedUntil (or the old one if
 * nothing could be done).
 */
export async function archiveUntil(until: Date): Promise<Date | null> {
  if (running) return archivedUntil();
  running = true;
  try {
    let done = await archivedUntil();
    if (!done) {
      const first = await pool.query<{ ts: Date | null }>(`SELECT min("timestamp") AS ts FROM telemetry`);
      if (!first.rows[0]?.ts) return null;
      done = dayStart(dayString(new Date(first.rows[0].ts)));
    }
    // Every day up to and including the one that holds `until`, as long as that
    // day has ended: a cutoff in the middle of a day must be covered too.
    const untilDayEnd = new Date(dayStart(dayString(until)).getTime() + (until.getTime() % DAY === 0 ? 0 : DAY));
    const today = dayStart(dayString(new Date()));
    const limit = untilDayEnd < today ? untilDayEnd : today;
    while (done < limit) {
      const day = dayString(done);
      const r = await archiveDay(day);
      logger.info({ day, rows: r.rows, bytes: r.bytes }, "Telemetry day archived");
      done = new Date(done.getTime() + DAY);
      await setArchivedUntil(done);
    }
    lastError = null;
    return done;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Archiving failed; pruning waits for it");
    return archivedUntil();
  } finally {
    running = false;
  }
}

export function archiveFilePath(rel: string): string {
  const root = archiveRoot();
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error("Archive path outside the archive folder");
  return full;
}

/**
 * Re-insert the readings of an archived day. Readings still in the database are
 * skipped. A legal hold is placed on the day so pruning keeps them.
 */
export async function restoreArchive(id: string, by: string): Promise<{ inserted: number; holdId: string }> {
  const [a] = await db.select().from(dataArchivesTable).where(eq(dataArchivesTable.id, id));
  if (!a) throw Object.assign(new Error("Archive not found"), { status: 404 });
  const file = archiveFilePath(a.path);
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let batch: Array<Record<string, unknown>> = [];
  let inserted = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const values: unknown[] = [];
    const rows = batch.map((r, i) => {
      values.push(r.id, r.asset_id, r.device_id ?? null, r.metric, JSON.stringify(r.value ?? null), r.quality ?? null, r.timestamp);
      const b = i * 7;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb, $${b + 6}, $${b + 7})`;
    });
    const res = await pool.query(`INSERT INTO telemetry (id, asset_id, device_id, metric, value, quality, "timestamp")
      VALUES ${rows.join(", ")} ON CONFLICT DO NOTHING`, values);
    inserted += res.rowCount ?? 0;
    batch = [];
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= 1000) await flush();
  }
  await flush();
  const start = dayStart(a.day);
  const [hold] = await db.insert(dataHoldsTable).values({
    name: `Restored archive ${a.day}`,
    reason: "Readings restored from the archive. Release this hold to let pruning delete them again.",
    fromTs: start, toTs: new Date(start.getTime() + DAY - 1), createdBy: by,
  }).returning();
  await db.update(dataArchivesTable).set({ restoredAt: new Date(), restoredBy: by, restoredRows: inserted }).where(eq(dataArchivesTable.id, id));
  return { inserted, holdId: hold.id };
}
