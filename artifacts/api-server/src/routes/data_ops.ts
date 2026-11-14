/**
 * Data Management operations beyond storage and retention (routes/system.ts):
 * data health, database health, storage of everything, alerts, backups, legal
 * holds, archives, bad-data removal and approvals, and settings.
 * See docs/features/data-management.md.
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { and, desc, eq, sql, gte, lte, type SQL } from "drizzle-orm";
import {
  db, pool, telemetryTable, backupRunsTable, systemAlertsTable, dataHoldsTable, dataArchivesTable, dataChangeRequestsTable,
} from "@workspace/db";
import { validate } from "../middleware/validate";
import { IdParams } from "../schemas/common";
import { logActivity } from "./activity_log";
import { logger } from "../lib/logger";
import { DataSettingsUpdate, getDataSettings, saveDataSettings } from "../lib/data-settings";
import { maskWebhookUrl } from "./alarm_rules";
import { computeStorage, applyPolicyChange, runPruning, invalidateStorageCache } from "./system";
import { evaluateAlerts } from "../services/system-alerts";
import { activeHolds, holdOverlaps } from "../services/holds";
import { archiveRoot, archiveFilePath, restoreArchive, archivedUntil, archiveError } from "../services/archive";
import { isPartitioned, listPartitions, conversionState, PART_SCHEMA } from "../services/partitions";
import { activeTiers, summarise } from "../services/rollups";
import { uploadStorage } from "../lib/upload/storage";
import { broadcast } from "../lib/ws-broadcast";

const router: IRouter = Router();
const who = (req: Request) => req.principal?.user.username ?? "unknown";

// ── Settings ──────────────────────────────────────────────────────────────────
router.get("/system/data-settings", async (_req, res): Promise<void> => {
  const s = await getDataSettings();
  res.json({ ...s, alerts: { ...s.alerts, webhookUrl: maskWebhookUrl(s.alerts.webhookUrl), webhookSet: !!s.alerts.webhookUrl } });
});

router.put("/system/data-settings", validate({ body: DataSettingsUpdate }), async (req, res): Promise<void> => {
  const body = req.body as z.infer<typeof DataSettingsUpdate>;
  // A masked URL sent back unchanged keeps the stored one.
  if (body.alerts?.webhookUrl && body.alerts.webhookUrl.includes("•")) delete body.alerts.webhookUrl;
  const before = await getDataSettings();
  const s = await saveDataSettings(body);
  const changed = (Object.keys(body) as Array<keyof typeof body>).map((k) => k).join(", ");
  await logActivity("data_settings.updated", "system", null, "Data Management settings", `Changed: ${changed}${before.approval.enabled && !s.approval.enabled ? " (approval switched OFF)" : ""}`, req);
  res.json({ ...s, alerts: { ...s.alerts, webhookUrl: maskWebhookUrl(s.alerts.webhookUrl), webhookSet: !!s.alerts.webhookUrl } });
});

// ── Alerts ────────────────────────────────────────────────────────────────────
router.get("/system/alerts", async (_req, res): Promise<void> => {
  const rows = await db.select().from(systemAlertsTable).orderBy(desc(systemAlertsTable.raisedAt)).limit(100);
  res.json(rows);
});

router.post("/system/alerts/check", async (_req, res): Promise<void> => {
  res.json(await evaluateAlerts(computeStorage));
});

router.post("/system/alerts/:id/acknowledge", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const [row] = await db.update(systemAlertsTable)
    .set({ status: "acknowledged", acknowledgedBy: who(req), acknowledgedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(systemAlertsTable.id, id), eq(systemAlertsTable.status, "active"))).returning();
  if (!row) { res.status(404).json({ error: "No active alert with that id" }); return; }
  await logActivity("system_alert.acknowledged", "system", row.id, row.title, null, req);
  broadcast("system_alerts", { changed: true }, { requireModule: "reports" });
  res.json(row);
});

// ── Backups ───────────────────────────────────────────────────────────────────
router.get("/system/backups", async (_req, res): Promise<void> => {
  const rows = await db.select().from(backupRunsTable).orderBy(desc(backupRunsTable.startedAt)).limit(60);
  const lastGood = rows.find((r) => r.status === "ok") ?? null;
  const s = await getDataSettings();
  const ageHours = lastGood ? (Date.now() - (lastGood.finishedAt ?? lastGood.startedAt).getTime()) / 3_600_000 : null;
  res.json({
    runs: rows,
    lastGood,
    lastGoodAgeHours: ageHours,
    maxAgeHours: s.alerts.backupMaxAgeHours,
    ok: !!lastGood && (s.alerts.backupMaxAgeHours === 0 || (ageHours ?? Infinity) <= s.alerts.backupMaxAgeHours) && rows[0]?.status === "ok",
  });
});

// ── Storage of everything ─────────────────────────────────────────────────────
let uploadsCache: { at: number; bytes: number; files: number; truncated: boolean } | null = null;

async function folderSize(root: string, cap = 200_000): Promise<{ bytes: number; files: number; truncated: boolean }> {
  let bytes = 0, files = 0, truncated = false;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files >= cap) { truncated = true; return; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) { try { bytes += (await stat(full)).size; files++; } catch { /* vanished */ } }
    }
  };
  await walk(root);
  return { bytes, files, truncated };
}

router.get("/system/storage/all", async (_req, res): Promise<void> => {
  const [tables, dbSize, storage, archives, backups, partitioned, conv] = await Promise.all([
    pool.query<{ schema: string; name: string; bytes: string; est: string; partition: boolean }>(`
      SELECT n.nspname AS schema, c.relname AS name, pg_total_relation_size(c.oid) AS bytes,
             GREATEST(c.reltuples, 0)::bigint AS est, c.relispartition AS partition
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('public', '${PART_SCHEMA}')`),
    pool.query<{ bytes: string }>(`SELECT pg_database_size(current_database()) AS bytes`),
    computeStorage(),
    pool.query<{ n: string; bytes: string }>(`SELECT count(*)::bigint AS n, COALESCE(SUM(bytes), 0)::bigint AS bytes FROM data_archives`),
    db.select().from(backupRunsTable).where(eq(backupRunsTable.status, "ok")).orderBy(desc(backupRunsTable.startedAt)).limit(1),
    isPartitioned(),
    conversionState(),
  ]);
  if (!uploadsCache || Date.now() - uploadsCache.at > 10 * 60_000) uploadsCache = { at: Date.now(), ...(await folderSize(uploadStorage.root)) };

  // Partitions count as "telemetry"; an old copy left by the partition tool is shown on its own.
  const grouped = new Map<string, { name: string; bytes: number; estRows: number; parts: number }>();
  for (const t of tables.rows) {
    let label = t.name;
    if (t.schema === PART_SCHEMA && (t.partition || /^p(\d{4}_\d{2}|default)$/.test(t.name))) label = "telemetry";
    else if (t.schema === PART_SCHEMA) label = `${t.name} (old copy)`;
    const g = grouped.get(label) ?? { name: label, bytes: 0, estRows: 0, parts: 0 };
    g.bytes += Number(t.bytes); g.estRows += Number(t.est); g.parts += t.partition ? 1 : 0;
    grouped.set(label, g);
  }
  res.json({
    database: { bytes: Number(dbSize.rows[0]?.bytes ?? 0) },
    tables: [...grouped.values()].sort((a, b) => b.bytes - a.bytes),
    uploads: { path: uploadStorage.root, ...uploadsCache },
    archives: { path: archiveRoot(), files: Number(archives.rows[0]?.n ?? 0), bytes: Number(archives.rows[0]?.bytes ?? 0) },
    backups: { lastSizeBytes: backups[0]?.sizeBytes ?? null, lastAt: backups[0]?.startedAt ?? null, location: backups[0]?.location ?? null },
    disk: storage.disk,
    partitioning: {
      partitioned,
      conversion: conv,
      partitions: partitioned ? (await listPartitions()).map((p) => ({ ...p })) : [],
      command: "pnpm --filter @workspace/db run partition-telemetry",
    },
  });
});

// ── Database health ───────────────────────────────────────────────────────────
router.get("/system/db-health", async (_req, res): Promise<void> => {
  const [conn, maxConn, longQ, cache, tables, size, version] = await Promise.all([
    pool.query<{ state: string | null; n: string }>(`SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY state`),
    pool.query<{ setting: string }>(`SELECT setting FROM pg_settings WHERE name = 'max_connections'`),
    pool.query<{ pid: number; state: string; seconds: string; wait: string | null; query: string; app: string | null }>(`
      SELECT pid, state, EXTRACT(EPOCH FROM now() - query_start)::int AS seconds, wait_event AS wait,
             left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS query, application_name AS app
      FROM pg_stat_activity
      WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid() AND now() - query_start > interval '10 seconds'
      ORDER BY query_start LIMIT 20`),
    pool.query<{ ratio: string | null; commits: string; rollbacks: string; deadlocks: string; temp: string }>(`
      SELECT round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS ratio, xact_commit AS commits, xact_rollback AS rollbacks,
             deadlocks, temp_bytes AS temp FROM pg_stat_database WHERE datname = current_database()`),
    pool.query<{ schema: string; name: string; live: string; dead: string; bytes: string; last_vacuum: Date | null; last_autovacuum: Date | null; last_analyze: Date | null; last_autoanalyze: Date | null }>(`
      SELECT schemaname AS schema, relname AS name, n_live_tup AS live, n_dead_tup AS dead,
             pg_total_relation_size(relid) AS bytes, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
      FROM pg_stat_user_tables WHERE schemaname IN ('public', '${PART_SCHEMA}')
      ORDER BY pg_total_relation_size(relid) DESC LIMIT 40`),
    pool.query<{ bytes: string }>(`SELECT pg_database_size(current_database()) AS bytes`),
    pool.query<{ v: string }>(`SHOW server_version`),
  ]);
  const tableRows = tables.rows.map((t) => {
    const live = Number(t.live), dead = Number(t.dead), bytes = Number(t.bytes);
    const deadPct = live + dead > 0 ? (dead / (live + dead)) * 100 : 0;
    return {
      schema: t.schema, name: t.name, liveRows: live, deadRows: dead, bytes, deadPct: Math.round(deadPct * 10) / 10,
      wastedBytes: live + dead > 0 ? Math.round(bytes * dead / (live + dead)) : 0,
      lastVacuum: [t.last_vacuum, t.last_autovacuum].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null,
      lastAnalyze: [t.last_analyze, t.last_autoanalyze].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null,
    };
  });
  const c = cache.rows[0];
  res.json({
    version: version.rows[0]?.v ?? null,
    databaseBytes: Number(size.rows[0]?.bytes ?? 0),
    connections: {
      byState: Object.fromEntries(conn.rows.map((r) => [r.state ?? "unknown", Number(r.n)])),
      total: conn.rows.reduce((n, r) => n + Number(r.n), 0),
      max: Number(maxConn.rows[0]?.setting ?? 0),
      poolTotal: pool.totalCount, poolIdle: pool.idleCount, poolWaiting: pool.waitingCount,
    },
    longQueries: longQ.rows.map((q) => ({ ...q, seconds: Number(q.seconds) })),
    cacheHitPct: c?.ratio != null ? Number(c.ratio) : null,
    commits: Number(c?.commits ?? 0), rollbacks: Number(c?.rollbacks ?? 0), deadlocks: Number(c?.deadlocks ?? 0), tempBytes: Number(c?.temp ?? 0),
    tables: tableRows,
    wastedBytes: tableRows.reduce((n, t) => n + t.wastedBytes, 0),
    vacuumRunning,
  });
});

let vacuumRunning: string | null = null;
const VacuumBody = z.object({ schema: z.enum(["public", PART_SCHEMA]).default("public"), table: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/) });

router.post("/system/db-health/vacuum", validate({ body: VacuumBody }), async (req, res): Promise<void> => {
  const { schema, table } = req.body as z.infer<typeof VacuumBody>;
  if (vacuumRunning) { res.status(409).json({ error: `Maintenance is already running on ${vacuumRunning}.`, code: "vacuum_running" }); return; }
  const exists = await pool.query(`SELECT 1 FROM pg_stat_user_tables WHERE schemaname = $1 AND relname = $2`, [schema, table]);
  if (!exists.rowCount) { res.status(404).json({ error: "Unknown table" }); return; }
  vacuumRunning = `${schema}.${table}`;
  await logActivity("db.vacuum", "system", null, `${schema}.${table}`, "VACUUM (ANALYZE) started", req);
  // Plain VACUUM does not block reads or writes; it can take minutes on a large table.
  void (async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET statement_timeout = 0`);
      await client.query(`VACUUM (ANALYZE) "${schema}"."${table}"`);
      logger.info({ table: vacuumRunning }, "VACUUM finished");
    } catch (err) {
      logger.warn({ err, table: vacuumRunning }, "VACUUM failed");
    } finally {
      await client.query(`RESET statement_timeout`).catch(() => {});
      client.release();
      vacuumRunning = null;
    }
  })();
  res.status(202).json({ started: true, table: `${schema}.${table}` });
});

// ── Data health ───────────────────────────────────────────────────────────────
router.get("/system/data-health", async (_req, res): Promise<void> => {
  const now = Date.now();
  const [storage, settings, hours, rates, rej, rejHourly] = await Promise.all([
    computeStorage(),
    getDataSettings(),
    pool.query<{ asset_id: string; bucket: Date }>(`
      SELECT asset_id, bucket FROM telemetry_rollups WHERE bucket >= now() - interval '7 days' GROUP BY asset_id, bucket ORDER BY asset_id, bucket`),
    pool.query<{ asset_id: string; metric: string; rows: string }>(`
      SELECT asset_id, metric, SUM("rows")::bigint AS rows FROM telemetry_rollups
      WHERE bucket >= now() - interval '24 hours' GROUP BY asset_id, metric ORDER BY 3 DESC LIMIT 15`),
    pool.query<{ source: string; route: string; status: number; code: string; n: string; last_at: Date; last_message: string | null; last_client: string | null }>(`
      SELECT source, route, status, code, SUM(count)::bigint AS n, max(last_at) AS last_at,
             (array_agg(last_message ORDER BY last_at DESC))[1] AS last_message,
             (array_agg(last_client ORDER BY last_at DESC))[1] AS last_client
      FROM ingest_rejections WHERE hour >= now() - interval '24 hours'
      GROUP BY source, route, status, code ORDER BY 5 DESC LIMIT 30`),
    pool.query<{ hour: Date; n: string }>(`
      SELECT hour, SUM(count)::bigint AS n FROM ingest_rejections WHERE hour >= now() - interval '24 hours' GROUP BY hour ORDER BY hour`),
  ]);
  const names = new Map(storage.perAsset.map((a) => [a.assetId, a.assetName]));

  // Coverage over the last 7 days, from the first hour each asset was seen in that window.
  const byAsset = new Map<string, number[]>();
  for (const h of hours.rows) {
    const list = byAsset.get(h.asset_id) ?? [];
    list.push(new Date(h.bucket).getTime());
    byAsset.set(h.asset_id, list);
  }
  const lastFullHour = Math.floor(now / 3_600_000) * 3_600_000 - 3_600_000;
  const quietMs = settings.health.quietMinutes * 60_000;
  const assets = storage.perAsset.filter((a) => !a.deleted).map((a) => {
    const list = byAsset.get(a.assetId) ?? [];
    const first = list[0] ?? null;
    const expected = first !== null ? Math.max(1, Math.round((lastFullHour - first) / 3_600_000) + 1) : 0;
    const present = new Set(list);
    const gaps: Array<{ from: string; to: string; hours: number }> = [];
    if (first !== null) {
      let gapStart: number | null = null;
      for (let t = first; t <= lastFullHour; t += 3_600_000) {
        if (!present.has(t)) { if (gapStart === null) gapStart = t; }
        else if (gapStart !== null) { gaps.push({ from: new Date(gapStart).toISOString(), to: new Date(t).toISOString(), hours: (t - gapStart) / 3_600_000 }); gapStart = null; }
      }
      if (gapStart !== null) gaps.push({ from: new Date(gapStart).toISOString(), to: new Date(lastFullHour + 3_600_000).toISOString(), hours: (lastFullHour + 3_600_000 - gapStart) / 3_600_000 });
    }
    const newest = a.newest ? new Date(a.newest).getTime() : null;
    return {
      assetId: a.assetId, assetName: a.assetName, newest: a.newest,
      quiet: newest !== null && now - newest > quietMs,
      minutesSinceLast: newest !== null ? Math.round((now - newest) / 60_000) : null,
      coveragePct: expected ? Math.round((list.filter((t) => t <= lastFullHour).length / expected) * 1000) / 10 : null,
      missingHours: gaps.reduce((n, g) => n + g.hours, 0),
      gaps: gaps.sort((x, y) => y.hours - x.hours).slice(0, 5),
    };
  }).sort((x, y) => Number(y.quiet) - Number(x.quiet) || (x.coveragePct ?? 101) - (y.coveragePct ?? 101));

  res.json({
    quietMinutes: settings.health.quietMinutes,
    assets,
    busiest: rates.rows.map((r) => {
      const perHour = Number(r.rows) / 24;
      return { assetId: r.asset_id, assetName: names.get(r.asset_id) ?? "Deleted asset", metric: r.metric, readingsPerDay: Number(r.rows), perMinute: Math.round(perHour / 60 * 10) / 10, everySeconds: perHour > 0 ? Math.round(3600 / perHour * 10) / 10 : null };
    }),
    rejections: rej.rows.map((r) => ({ ...r, count: Number(r.n) })),
    rejectionsHourly: rejHourly.rows.map((r) => ({ hour: r.hour, count: Number(r.n) })),
    rejectionsTotal: rej.rows.reduce((n, r) => n + Number(r.n), 0),
  });
});

// ── Legal holds ───────────────────────────────────────────────────────────────
const HoldBody = z.object({
  name: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(2000).nullable().optional(),
  assetId: z.string().uuid().nullable().optional(),
  metric: z.string().trim().min(1).max(200).nullable().optional(),
  fromTs: z.coerce.date().nullable().optional(),
  toTs: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
}).refine((b) => !b.fromTs || !b.toTs || b.fromTs <= b.toTs, { message: "The start must be before the end", path: ["toTs"] });

router.get("/system/holds", async (_req, res): Promise<void> => {
  const rows = await db.select().from(dataHoldsTable).orderBy(desc(dataHoldsTable.createdAt)).limit(200);
  res.json(rows);
});

router.post("/system/holds", validate({ body: HoldBody }), async (req, res): Promise<void> => {
  const b = req.body as z.infer<typeof HoldBody>;
  const [row] = await db.insert(dataHoldsTable).values({
    name: b.name, reason: b.reason ?? null, assetId: b.assetId ?? null, metric: b.metric ?? null,
    fromTs: b.fromTs ?? null, toTs: b.toTs ?? null, expiresAt: b.expiresAt ?? null, createdBy: who(req),
  }).returning();
  await logActivity("data_hold.created", "system", row.id, row.name, b.reason ?? null, req);
  invalidateStorageCache();
  res.status(201).json(row);
});

router.post("/system/holds/:id/release", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const [row] = await db.update(dataHoldsTable).set({ releasedAt: new Date(), releasedBy: who(req) })
    .where(and(eq(dataHoldsTable.id, id), sql`${dataHoldsTable.releasedAt} IS NULL`)).returning();
  if (!row) { res.status(404).json({ error: "No active hold with that id" }); return; }
  await logActivity("data_hold.released", "system", row.id, row.name, null, req);
  res.json(row);
});

// ── Archives ──────────────────────────────────────────────────────────────────
router.get("/system/archives", async (_req, res): Promise<void> => {
  const [rows, until, settings] = await Promise.all([
    db.select().from(dataArchivesTable).orderBy(desc(dataArchivesTable.day)).limit(400),
    archivedUntil(), getDataSettings(),
  ]);
  res.json({ enabled: settings.archive.enabled, path: archiveRoot(), archivedUntil: until, error: archiveError(), files: rows });
});

router.get("/system/archives/:id/download", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const [a] = await db.select().from(dataArchivesTable).where(eq(dataArchivesTable.id, id));
  if (!a) { res.status(404).json({ error: "Archive not found" }); return; }
  const file = archiveFilePath(a.path);
  try { await stat(file); } catch { res.status(410).json({ error: "The archive file is no longer in the archive folder.", code: "archive_file_missing" }); return; }
  await logActivity("archive.downloaded", "system", a.id, a.day, `${a.rows} reading(s)`, req);
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="telemetry-${a.day}.jsonl.gz"`);
  createReadStream(file).pipe(res);
});

router.post("/system/archives/:id/restore", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  try {
    const r = await restoreArchive(id, who(req));
    await logActivity("archive.restored", "system", id, null, `${r.inserted} reading(s) restored; legal hold placed`, req);
    invalidateStorageCache();
    res.json(r);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) { res.status(404).json({ error: "Archive not found" }); return; }
    throw err;
  }
});

// ── Bad-data removal and approvals ────────────────────────────────────────────
const RangeBody = z.object({
  assetId: z.string().uuid(),
  metric: z.string().trim().min(1).max(200).nullable().optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  includeSummaries: z.boolean().default(true),
  reason: z.string().trim().min(3).max(2000),
}).refine((b) => b.from < b.to, { message: "The start must be before the end", path: ["to"] });
type RangeBody = z.infer<typeof RangeBody>;

function rangeWhere(b: { assetId: string; metric?: string | null; from: Date; to: Date }): SQL {
  const c: SQL[] = [eq(telemetryTable.assetId, b.assetId), gte(telemetryTable.timestamp, b.from), lte(telemetryTable.timestamp, b.to)];
  if (b.metric) c.push(eq(telemetryTable.metric, b.metric));
  return and(...c)!;
}

async function countRange(b: RangeBody): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(telemetryTable).where(rangeWhere(b));
  return r?.n ?? 0;
}

async function holdConflict(b: RangeBody): Promise<string | null> {
  const hit = (await activeHolds()).find((h) => holdOverlaps(h, { assetId: b.assetId, metric: b.metric ?? null, from: b.from, to: b.to }));
  return hit ? hit.name : null;
}

/** Delete the range, then make the summaries match. Returns readings deleted. */
async function executeRangeDelete(b: RangeBody): Promise<number> {
  let total = 0;
  for (let i = 0; i < 5000; i++) {
    const r = await db.execute(sql`DELETE FROM ${telemetryTable} WHERE id IN (SELECT id FROM ${telemetryTable} WHERE ${rangeWhere(b)} LIMIT 5000)`);
    total += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) < 5000) break;
  }
  for (const tier of await activeTiers()) {
    const step = tier.stepSec * 1000;
    const from = new Date(Math.floor(b.from.getTime() / step) * step);
    const to = new Date(Math.ceil((b.to.getTime() + 1) / step) * step);
    if (b.includeSummaries) {
      await pool.query(`DELETE FROM ${tier.table} WHERE asset_id = $1 AND bucket >= $2 AND bucket < $3${b.metric ? " AND metric = $4" : ""}`,
        b.metric ? [b.assetId, from, to, b.metric] : [b.assetId, from, to]);
    }
    // Recount buckets that still have raw readings, in 6-hour slices.
    for (let t = from.getTime(); t < to.getTime(); t += 6 * 3_600_000) {
      await summarise(tier, new Date(t), new Date(Math.min(t + 6 * 3_600_000, to.getTime())), { force: true, assetId: b.assetId, metric: b.metric ?? undefined });
    }
  }
  invalidateStorageCache();
  return total;
}

router.get("/system/changes", async (_req, res): Promise<void> => {
  const rows = await db.select().from(dataChangeRequestsTable).orderBy(desc(dataChangeRequestsTable.requestedAt)).limit(100);
  res.json(rows);
});

router.post("/system/changes/range-preview", validate({ body: RangeBody }), async (req, res): Promise<void> => {
  const b = req.body as RangeBody;
  const [rows, conflict, s] = await Promise.all([countRange(b), holdConflict(b), getDataSettings()]);
  res.json({ rows, heldBy: conflict, needsApproval: s.approval.enabled && rows > s.approval.thresholdRows });
});

router.post("/system/changes/range-delete", validate({ body: RangeBody }), async (req, res): Promise<void> => {
  const b = req.body as RangeBody;
  const conflict = await holdConflict(b);
  if (conflict) { res.status(409).json({ error: `Part of this range is under the legal hold "${conflict}". Release it first.`, code: "hold_conflict" }); return; }
  const rows = await countRange(b);
  if (rows === 0) { res.status(400).json({ error: "No readings in this range.", code: "nothing_to_delete" }); return; }
  const s = await getDataSettings();
  const summary = `Remove ${b.metric ? `"${b.metric}" of ` : "all metrics of "}asset ${b.assetId} from ${b.from.toISOString()} to ${b.to.toISOString()}`;
  const [request] = await db.insert(dataChangeRequestsTable).values({
    kind: "range_delete", payload: b, summary, estimatedRows: rows,
    requestedById: req.principal?.user.id ?? null, requestedBy: who(req),
    status: s.approval.enabled && rows > s.approval.thresholdRows ? "pending" : "approved",
  }).returning();
  if (request.status === "pending") {
    await logActivity("data_change.requested", "system", request.id, summary, `${rows} reading(s); reason: ${b.reason}`, req);
    res.status(202).json({ pendingApproval: true, request });
    return;
  }
  const done = await carryOut(request, req);
  res.json(done);
});

/** Carry out an approved request and record the outcome. */
async function carryOut(request: typeof dataChangeRequestsTable.$inferSelect, req: Request) {
  let rowsDeleted = 0;
  try {
    const p = request.payload as Record<string, unknown>;
    if (request.kind === "range_delete") {
      const b = RangeBody.parse(p);
      const conflict = await holdConflict(b);
      if (conflict) throw new Error(`Now under the legal hold "${conflict}"`);
      rowsDeleted = await executeRangeDelete(b);
      await logActivity("data_change.range_deleted", "system", request.id, request.summary, `${rowsDeleted} reading(s) deleted; reason: ${b.reason}`, req);
    } else if (request.kind === "policy_change") {
      await applyPolicyChange(p.op as "create" | "update", (p.id as string) ?? null, p.body as Record<string, unknown>, req);
    } else if (request.kind === "manual_prune") {
      const r = await runPruning({ record: { trigger: "manual", userId: req.principal?.user.id ?? null, username: `${who(req)}, approving ${request.requestedBy ?? "a request"}` } });
      if (r.skipped) throw new Error("A pruning run was already in progress; approve again later.");
      rowsDeleted = r.totalRowsDeleted;
    } else {
      throw new Error(`Unknown request kind ${request.kind}`);
    }
    const [row] = await db.update(dataChangeRequestsTable).set({ status: "done", rowsDeleted, finishedAt: new Date() })
      .where(eq(dataChangeRequestsTable.id, request.id)).returning();
    return row;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [row] = await db.update(dataChangeRequestsTable).set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(dataChangeRequestsTable.id, request.id)).returning();
    return row;
  }
}

const DecisionBody = z.object({ note: z.string().trim().max(2000).optional() });

router.post("/system/changes/:id/approve", validate({ params: IdParams, body: DecisionBody }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const [request] = await db.select().from(dataChangeRequestsTable).where(eq(dataChangeRequestsTable.id, id));
  if (!request || request.status !== "pending") { res.status(404).json({ error: "No pending request with that id" }); return; }
  if (request.requestedById && request.requestedById === req.principal?.user.id) {
    res.status(403).json({ error: "A second administrator must approve this; you made the request.", code: "self_approval" });
    return;
  }
  const [claimed] = await db.update(dataChangeRequestsTable).set({
    status: "approved", decidedById: req.principal?.user.id ?? null, decidedBy: who(req), decidedAt: new Date(), decisionNote: (req.body as { note?: string }).note ?? null,
  }).where(and(eq(dataChangeRequestsTable.id, id), eq(dataChangeRequestsTable.status, "pending"))).returning();
  if (!claimed) { res.status(409).json({ error: "Someone else decided this request just now." }); return; }
  await logActivity("data_change.approved", "system", id, request.summary, null, req);
  res.json(await carryOut(claimed, req));
});

router.post("/system/changes/:id/reject", validate({ params: IdParams, body: DecisionBody }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const own = await db.select().from(dataChangeRequestsTable).where(eq(dataChangeRequestsTable.id, id));
  const note = (req.body as { note?: string }).note ?? (own[0]?.requestedById === req.principal?.user.id ? "Withdrawn by the requester" : null);
  const [row] = await db.update(dataChangeRequestsTable).set({
    status: "rejected", decidedById: req.principal?.user.id ?? null, decidedBy: who(req), decidedAt: new Date(), decisionNote: note,
  }).where(and(eq(dataChangeRequestsTable.id, id), eq(dataChangeRequestsTable.status, "pending"))).returning();
  if (!row) { res.status(404).json({ error: "No pending request with that id" }); return; }
  await logActivity("data_change.rejected", "system", id, row.summary, note, req);
  res.json(row);
});

export default router;
