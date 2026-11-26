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
import { pipeline } from "node:stream/promises";
import { and, desc, eq, sql, gte, lte, inArray, type SQL } from "drizzle-orm";
import {
  db, pool, telemetryTable, backupRunsTable, systemAlertsTable, dataHoldsTable, dataArchivesTable, dataChangeRequestsTable,
} from "@workspace/db";
import { validate } from "../middleware/validate";
import { IdParams } from "../schemas/common";
import { logActivity } from "./activity_log";
import { diffFields } from "../lib/audit-core";
import { logger } from "../lib/logger";
import { DataSettingsUpdate, getDataSettings, saveDataSettings, type DataSettings } from "../lib/data-settings";
import { checkOutboundUrl } from "../lib/outbound-url";
import { hasPermission } from "../lib/rbac";
import { series } from "../lib/series";
import { maskWebhookUrl } from "./alarm_rules";
import { computeStorage, applyPolicyChange, runPruning, invalidateStorageCache, requestApproval, pruningBusy, operationalRetentionDays } from "./system";
import { evaluateAlerts } from "../services/system-alerts";
import { activeHolds, holdOverlaps, insertHold, deleteUnheldTelemetry } from "../services/holds";
import { archiveRoot, archiveFilePath, restoreArchive, archivedUntil, archiveError } from "../services/archive";
import { isPartitioned, listPartitions, conversionState, PART_SCHEMA } from "../services/partitions";
import { activeTiers, summarise, flushLateReadings } from "../services/rollups";
import { uploadStorage } from "../lib/upload/storage";
import { broadcast } from "../lib/ws-broadcast";

const router: IRouter = Router();
const who = (req: Request) => req.principal?.user.username ?? "unknown";

// ── Settings ──────────────────────────────────────────────────────────────────
router.get("/system/data-settings", async (_req, res): Promise<void> => {
  const s = await getDataSettings();
  res.json({ ...s, alerts: { ...s.alerts, webhookUrl: maskWebhookUrl(s.alerts.webhookUrl), webhookSet: !!s.alerts.webhookUrl } });
});

type SettingsUpdate = z.infer<typeof DataSettingsUpdate>;

/**
 * Split a settings update into the part that weakens the deletion safeguards and
 * the rest. While approval is on, the weakening part waits for a second
 * administrator (audit H-2): switching approval off, raising its limit,
 * switching archiving off, or keeping summaries for a shorter time (which deletes
 * them). Pure, for tests.
 */
export function splitGuardedSettings(before: DataSettings, update: SettingsUpdate, envHourDays: number): { guarded: SettingsUpdate | null; rest: SettingsUpdate } {
  const rest: SettingsUpdate = JSON.parse(JSON.stringify(update));
  if (!before.approval.enabled) return { guarded: null, rest };
  const guarded: SettingsUpdate = {};
  const move = <S extends "approval" | "archive" | "tiers">(sec: S, key: keyof NonNullable<SettingsUpdate[S]>) => {
    const from = rest[sec] as Record<string, unknown> | undefined;
    if (!from || !(key in from)) return;
    guarded[sec] = { ...(guarded[sec] ?? {}), [key]: from[key as string] } as never;
    delete from[key as string];
    if (Object.keys(from).length === 0) delete rest[sec];
  };
  const a = update.approval;
  if (a?.enabled === false) move("approval", "enabled");
  if (a?.thresholdRows !== undefined && a.thresholdRows > before.approval.thresholdRows) move("approval", "thresholdRows");
  if (before.archive.enabled && update.archive?.enabled === false) move("archive", "enabled");
  const t = update.tiers;
  if (t?.m15Days !== undefined && t.m15Days > 0 && (before.tiers.m15Days === 0 || t.m15Days < before.tiers.m15Days)) move("tiers", "m15Days");
  if (t && "hourDays" in t) {
    const was = before.tiers.hourDays ?? envHourDays;
    const next = t.hourDays ?? envHourDays;
    if (next > 0 && (was === 0 || next < was)) move("tiers", "hourDays");
  }
  return { guarded: Object.keys(guarded).length ? guarded : null, rest };
}

const maskSettings = (s: DataSettings) => ({ ...s, alerts: { ...s.alerts, webhookUrl: maskWebhookUrl(s.alerts.webhookUrl), webhookSet: !!s.alerts.webhookUrl } });

async function applySettings(body: SettingsUpdate, req: Request, note = ""): Promise<DataSettings> {
  const before = await getDataSettings();
  const s = await saveDataSettings(body);
  const changed = (Object.keys(body) as Array<keyof typeof body>).map((k) => k).join(", ");
  // Field-level changes as "section.field".
  const flat = (o: Record<string, Record<string, unknown>>) => Object.fromEntries(Object.entries(o).flatMap(([sec, v]) => Object.entries(v ?? {}).map(([k, x]) => [`${sec}.${k}`, x])));
  const changes = diffFields(flat(before as never), flat(s as never));
  await logActivity("data_settings.updated", "system", null, "Data Management settings", `Changed: ${changed}${before.approval.enabled && !s.approval.enabled ? " (approval switched OFF)" : ""}${note}`, req, { changes });
  return s;
}

router.put("/system/data-settings", validate({ body: DataSettingsUpdate }), async (req, res): Promise<void> => {
  const body = req.body as SettingsUpdate;
  // A masked URL sent back unchanged keeps the stored one.
  if (body.alerts?.webhookUrl && body.alerts.webhookUrl.includes("•")) delete body.alerts.webhookUrl;
  if (body.alerts?.webhookUrl) {
    const check = checkOutboundUrl(body.alerts.webhookUrl);
    if (!check.ok) { res.status(400).json({ error: check.error, code: "unsafe_url" }); return; }
  }
  const before = await getDataSettings();
  const { guarded, rest } = splitGuardedSettings(before, body, operationalRetentionDays().telemetryRollups);
  const s = Object.keys(rest).length ? await applySettings(rest, req) : before;
  if (guarded) {
    const request = await requestApproval(req, "settings_change", { update: guarded },
      `Change Data Management settings: ${Object.entries(guarded).flatMap(([sec, v]) => Object.entries(v ?? {}).map(([k, x]) => `${sec}.${k} = ${x === null ? "default" : String(x)}`)).join(", ")}`, 0);
    res.status(202).json({ ...maskSettings(s), pendingApproval: true, request });
    return;
  }
  res.json(maskSettings(s));
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
  broadcast("system_alerts", { changed: true }, { requireModule: "data_management" });
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
  const [tables, dbSize, storage, archives, backups, partitioned, conv] = await series(
    () => pool.query<{ schema: string; name: string; bytes: string; est: string; partition: boolean }>(`
      SELECT n.nspname AS schema, c.relname AS name, pg_total_relation_size(c.oid) AS bytes,
             GREATEST(c.reltuples, 0)::bigint AS est, c.relispartition AS partition
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('public', '${PART_SCHEMA}')`),
    () => pool.query<{ bytes: string }>(`SELECT pg_database_size(current_database()) AS bytes`),
    () => computeStorage(),
    () => pool.query<{ n: string; bytes: string }>(`SELECT count(*)::bigint AS n, COALESCE(SUM(bytes), 0)::bigint AS bytes FROM data_archives`),
    () => db.select().from(backupRunsTable).where(eq(backupRunsTable.status, "ok")).orderBy(desc(backupRunsTable.startedAt)).limit(1),
    () => isPartitioned(),
    () => conversionState(),
  );
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
  const [conn, maxConn, longQ, cache, tables, size, version] = await series(
    () => pool.query<{ state: string | null; n: string }>(`SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY state`),
    () => pool.query<{ setting: string }>(`SELECT setting FROM pg_settings WHERE name = 'max_connections'`),
    () => pool.query<{ pid: number; state: string; seconds: string; wait: string | null; query: string; app: string | null }>(`
      SELECT pid, state, EXTRACT(EPOCH FROM now() - query_start)::int AS seconds, wait_event AS wait,
             left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS query, application_name AS app
      FROM pg_stat_activity
      WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid() AND now() - query_start > interval '10 seconds'
      ORDER BY query_start LIMIT 20`),
    () => pool.query<{ ratio: string | null; commits: string; rollbacks: string; deadlocks: string; temp: string }>(`
      SELECT round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS ratio, xact_commit AS commits, xact_rollback AS rollbacks,
             deadlocks, temp_bytes AS temp FROM pg_stat_database WHERE datname = current_database()`),
    () => pool.query<{ schema: string; name: string; live: string; dead: string; bytes: string; last_vacuum: Date | null; last_autovacuum: Date | null; last_analyze: Date | null; last_autoanalyze: Date | null }>(`
      SELECT schemaname AS schema, relname AS name, n_live_tup AS live, n_dead_tup AS dead,
             pg_total_relation_size(relid) AS bytes, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
      FROM pg_stat_user_tables WHERE schemaname IN ('public', '${PART_SCHEMA}')
      ORDER BY pg_total_relation_size(relid) DESC LIMIT 40`),
    () => pool.query<{ bytes: string }>(`SELECT pg_database_size(current_database()) AS bytes`),
    () => pool.query<{ v: string }>(`SHOW server_version`),
  );
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
  const [storage, settings, hours, rates, rej, rejHourly] = await series(
    () => computeStorage(),
    () => getDataSettings(),
    () => pool.query<{ asset_id: string; bucket: Date }>(`
      SELECT asset_id, bucket FROM telemetry_rollups WHERE bucket >= now() - interval '7 days' GROUP BY asset_id, bucket ORDER BY asset_id, bucket`),
    () => pool.query<{ asset_id: string; metric: string; rows: string }>(`
      SELECT asset_id, metric, SUM("rows")::bigint AS rows FROM telemetry_rollups
      WHERE bucket >= now() - interval '24 hours' GROUP BY asset_id, metric ORDER BY 3 DESC LIMIT 15`),
    () => pool.query<{ source: string; route: string; status: number; code: string; n: string; last_at: Date; last_message: string | null; last_client: string | null }>(`
      SELECT source, route, status, code, SUM(count)::bigint AS n, max(last_at) AS last_at,
             (array_agg(last_message ORDER BY last_at DESC))[1] AS last_message,
             (array_agg(last_client ORDER BY last_at DESC))[1] AS last_client
      FROM ingest_rejections WHERE hour >= now() - interval '24 hours'
      GROUP BY source, route, status, code ORDER BY 5 DESC LIMIT 30`),
    () => pool.query<{ hour: Date; n: string }>(`
      SELECT hour, SUM(count)::bigint AS n FROM ingest_rejections WHERE hour >= now() - interval '24 hours' GROUP BY hour ORDER BY hour`),
  );
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
  // Under the hold lock: a removal running now stops short of what this hold covers.
  const row = await insertHold({
    name: b.name, reason: b.reason ?? null, assetId: b.assetId ?? null, metric: b.metric ?? null,
    fromTs: b.fromTs ?? null, toTs: b.toTs ?? null, expiresAt: b.expiresAt ?? null, createdBy: who(req),
  });
  await logActivity("data_hold.created", "system", row.id, row.name, b.reason ?? null, req);
  invalidateStorageCache();
  res.status(201).json(row);
});

async function releaseHold(id: string, by: string) {
  const [row] = await db.update(dataHoldsTable).set({ releasedAt: new Date(), releasedBy: by })
    .where(and(eq(dataHoldsTable.id, id), sql`${dataHoldsTable.releasedAt} IS NULL`)).returning();
  return row ?? null;
}

// Needs approve_data_changes (ROUTE_RULES). While approval is on, releasing a hold
// is itself a request a second administrator approves (audit H-2).
router.post("/system/holds/:id/release", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const [hold] = await db.select().from(dataHoldsTable).where(and(eq(dataHoldsTable.id, id), sql`${dataHoldsTable.releasedAt} IS NULL`));
  if (!hold) { res.status(404).json({ error: "No active hold with that id" }); return; }
  if ((await getDataSettings()).approval.enabled) {
    const open = await db.select({ id: dataChangeRequestsTable.id }).from(dataChangeRequestsTable)
      .where(and(eq(dataChangeRequestsTable.kind, "hold_release"), eq(dataChangeRequestsTable.status, "pending"), sql`${dataChangeRequestsTable.payload}->>'holdId' = ${id}`));
    if (open.length) { res.status(409).json({ error: "Releasing this hold is already waiting for approval.", code: "already_requested" }); return; }
    const request = await requestApproval(req, "hold_release", { holdId: id }, `Release legal hold "${hold.name}"`, 0);
    res.status(202).json({ pendingApproval: true, request });
    return;
  }
  const row = await releaseHold(id, who(req));
  if (!row) { res.status(404).json({ error: "No active hold with that id" }); return; }
  await logActivity("data_hold.released", "system", row.id, row.name, null, req);
  res.json(row);
});

// ── Archives ──────────────────────────────────────────────────────────────────
router.get("/system/archives", async (_req, res): Promise<void> => {
  const [rows, until, settings] = await series(
    () => db.select().from(dataArchivesTable).orderBy(desc(dataArchivesTable.day)).limit(400),
    () => archivedUntil(), () => getDataSettings(),
  );
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
  // pipeline forwards a read error (file removed meanwhile, share gone) and ends
  // the response; .pipe() left it unhandled and crashed the API (audit H-4).
  try {
    await pipeline(createReadStream(file), res);
  } catch (err) {
    logger.warn({ err, archive: a.id }, "Archive download failed part-way");
    if (!res.headersSent) res.status(500).json({ error: "The archive file could not be read." });
  }
});

router.post("/system/archives/:id/restore", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  try {
    const r = await restoreArchive(id, who(req));
    await logActivity("archive.restored", "system", id, null, `${r.inserted} reading(s) restored; legal hold placed`, req);
    invalidateStorageCache();
    res.json(r);
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string };
    if (e.status === 404) { res.status(404).json({ error: "Archive not found" }); return; }
    if (e.status === 410 || e.status === 422) { res.status(e.status).json({ error: e.message, code: e.code }); return; }
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

/** Counting stops here; above it the request shows "more than" and, with approval on, always waits. */
export const RANGE_COUNT_CAP = 2_000_000;

/** Readings in the range, counted up to RANGE_COUNT_CAP so the request stays short (audit L-24). */
async function countRange(b: RangeBody): Promise<{ rows: number; capped: boolean }> {
  const r = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${telemetryTable} WHERE ${rangeWhere(b)} LIMIT ${RANGE_COUNT_CAP + 1}) x`);
  const n = Number(r.rows[0]?.n ?? 0);
  return { rows: Math.min(n, RANGE_COUNT_CAP), capped: n > RANGE_COUNT_CAP };
}

/** Whether a removal must wait for approval. A capped count fails closed. Pure, for tests. */
export function rangeNeedsApproval(s: Pick<DataSettings, "approval">, count: { rows: number; capped: boolean }): boolean {
  return s.approval.enabled && (count.capped || count.rows > s.approval.thresholdRows);
}

async function holdConflict(b: RangeBody): Promise<string | null> {
  const hit = (await activeHolds()).find((h) => holdOverlaps(h, { assetId: b.assetId, metric: b.metric ?? null, from: b.from, to: b.to }));
  return hit ? hit.name : null;
}

/**
 * Delete the range, then make the summaries match. Readings under a hold stay,
 * including a hold placed while this runs (atomic check, audit L-24).
 * `progress.rows` is kept current, so a failure part-way records what was
 * deleted, and the summaries are recounted even then (18 Nov FN-6).
 */
async function executeRangeDelete(b: RangeBody, progress: { rows: number }): Promise<number> {
  // Late-reading totals waiting in memory go in first; the recount below replaces them.
  await flushLateReadings().catch(() => {});
  try {
    progress.rows = await deleteUnheldTelemetry(rangeWhere(b), { onBatch: (n) => { progress.rows = n; } });
  } catch (err) {
    if (progress.rows > 0) await recountRange(b).catch((e) => logger.warn({ err: e }, "Summaries not recounted after a failed removal"));
    throw err;
  }
  await recountRange(b);
  return progress.rows;
}

async function recountRange(b: RangeBody): Promise<void> {
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
}

router.get("/system/changes", async (_req, res): Promise<void> => {
  const rows = await db.select().from(dataChangeRequestsTable).orderBy(desc(dataChangeRequestsTable.requestedAt)).limit(100);
  res.json(rows);
});

router.post("/system/changes/range-preview", validate({ body: RangeBody }), async (req, res): Promise<void> => {
  const b = req.body as RangeBody;
  const [count, conflict, s] = await series(() => countRange(b), () => holdConflict(b), () => getDataSettings());
  res.json({ rows: count.rows, capped: count.capped, heldBy: conflict, needsApproval: rangeNeedsApproval(s, count) });
});

router.post("/system/changes/range-delete", validate({ body: RangeBody }), async (req, res): Promise<void> => {
  const b = req.body as RangeBody;
  const conflict = await holdConflict(b);
  if (conflict) { res.status(409).json({ error: `Part of this range is under the legal hold "${conflict}". Release it first.`, code: "hold_conflict" }); return; }
  const count = await countRange(b);
  const rows = count.rows;
  if (rows === 0) { res.status(400).json({ error: "No readings in this range.", code: "nothing_to_delete" }); return; }
  const s = await getDataSettings();
  const summary = `Remove ${b.metric ? `"${b.metric}" of ` : "all metrics of "}asset ${b.assetId} from ${b.from.toISOString()} to ${b.to.toISOString()}`;
  const pending = rangeNeedsApproval(s, count);
  const [request] = await db.insert(dataChangeRequestsTable).values({
    kind: "range_delete", payload: b, summary, estimatedRows: rows,
    requestedById: req.principal?.user.id ?? null, requestedBy: who(req),
    status: pending ? "pending" : "running",
  }).returning();
  if (pending) {
    await logActivity("data_change.requested", "system", request.id, summary, `${count.capped ? "more than " : ""}${rows} reading(s); reason: ${b.reason}`, req);
    res.status(202).json({ pendingApproval: true, request });
    return;
  }
  // Runs in the background; the outcome appears in the list of requests.
  startInBackground(request, req);
  res.status(202).json({ pendingApproval: false, started: true, request });
});

/** Request kinds that can take minutes; they run in the background with status "running". */
const LONG_KINDS = new Set(["range_delete", "manual_prune"]);

/** Thrown for a passing collision: the request goes back to pending instead of failing for ever (audit L-20). */
class RetryLater extends Error {}

function startInBackground(request: typeof dataChangeRequestsTable.$inferSelect, req: Request): void {
  void carryOut(request, req).catch((err) => logger.error({ err, request: request.id }, "Data change failed in the background"));
}

/**
 * Requests left "running" (or "approved") by an API restart are marked failed
 * with what is known; run at start-up.
 */
export async function recoverInterruptedChanges(): Promise<number> {
  const r = await db.update(dataChangeRequestsTable).set({
    status: "failed", finishedAt: new Date(),
    error: "Interrupted: the API stopped while this was running. Readings already deleted stay deleted; submit it again for the rest.",
  }).where(inArray(dataChangeRequestsTable.status, ["running", "approved"])).returning({ id: dataChangeRequestsTable.id });
  return r.length;
}

/** Carry out an approved request and record the outcome. */
async function carryOut(request: typeof dataChangeRequestsTable.$inferSelect, req: Request) {
  const progress = { rows: 0 };
  try {
    const p = request.payload as Record<string, unknown>;
    if (request.kind === "range_delete") {
      const b = RangeBody.parse(p);
      const conflict = await holdConflict(b);
      if (conflict) throw new Error(`Now under the legal hold "${conflict}"`);
      await executeRangeDelete(b, progress);
      await logActivity("data_change.range_deleted", "system", request.id, request.summary, `${progress.rows} reading(s) deleted; reason: ${b.reason}`, req);
    } else if (request.kind === "policy_change") {
      const op = p.op as "create" | "update" | "delete";
      const policy = await applyPolicyChange(op, (p.id as string) ?? null, (p.body as Record<string, unknown>) ?? {}, req);
      // A policy deleted after the request was made: nothing was changed (audit L-20).
      if (!policy) throw new Error("The retention policy no longer exists; nothing was changed.");
    } else if (request.kind === "manual_prune") {
      const r = await runPruning({ record: { trigger: "manual", userId: req.principal?.user.id ?? null, username: `${who(req)}, approving ${request.requestedBy ?? "a request"}` } });
      if (r.skipped) throw new RetryLater("A pruning run was in progress, so this was not done. It is waiting for approval again.");
      progress.rows = r.totalRowsDeleted;
    } else if (request.kind === "settings_change") {
      await applySettings(p.update as SettingsUpdate, req, `, approving ${request.requestedBy ?? "a request"}`);
    } else if (request.kind === "hold_release") {
      const row = await releaseHold(String(p.holdId), `${who(req)}, approving ${request.requestedBy ?? "a request"}`);
      if (!row) throw new Error("The hold was already released or has ended; nothing was changed.");
      await logActivity("data_hold.released", "system", row.id, row.name, `requested by ${request.requestedBy ?? "?"}`, req);
    } else {
      throw new Error(`Unknown request kind ${request.kind}`);
    }
    const [row] = await db.update(dataChangeRequestsTable).set({ status: "done", rowsDeleted: progress.rows, finishedAt: new Date() })
      .where(eq(dataChangeRequestsTable.id, request.id)).returning();
    return row;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof RetryLater) {
      const [row] = await db.update(dataChangeRequestsTable).set({ status: "pending", error: message, decidedById: null, decidedBy: null, decidedAt: null })
        .where(eq(dataChangeRequestsTable.id, request.id)).returning();
      return row;
    }
    // What was deleted before the failure is recorded, not 0 (18 Nov FN-6).
    const [row] = await db.update(dataChangeRequestsTable).set({ status: "failed", error: message, rowsDeleted: progress.rows || null, finishedAt: new Date() })
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
  // A pruning run going on would only bounce the request back; say so now.
  if (request.kind === "manual_prune" && pruningBusy()) {
    res.status(409).json({ error: "A pruning run is in progress. Approve again when it has finished.", code: "pruning_in_progress" });
    return;
  }
  const long = LONG_KINDS.has(request.kind);
  const [claimed] = await db.update(dataChangeRequestsTable).set({
    status: long ? "running" : "approved", error: null,
    decidedById: req.principal?.user.id ?? null, decidedBy: who(req), decidedAt: new Date(), decisionNote: (req.body as { note?: string }).note ?? null,
  }).where(and(eq(dataChangeRequestsTable.id, id), eq(dataChangeRequestsTable.status, "pending"))).returning();
  if (!claimed) { res.status(409).json({ error: "Someone else decided this request just now." }); return; }
  await logActivity("data_change.approved", "system", id, request.summary, null, req);
  if (long) {
    // Minutes of work stay off the request; the list shows "running", then the result.
    startInBackground(claimed, req);
    res.status(202).json({ started: true, request: claimed });
    return;
  }
  const done = await carryOut(claimed, req);
  // An approval that could not be carried out is an error, not "approved and carried out" (18 Nov FN-5).
  if (done?.status === "failed") { res.status(422).json({ error: `Approved, but not carried out: ${done.error}`, code: "change_failed", request: done }); return; }
  if (done?.status === "pending") { res.status(409).json({ error: done.error, code: "retry_later", request: done }); return; }
  res.json(done);
});

router.post("/system/changes/:id/reject", validate({ params: IdParams, body: DecisionBody }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof IdParams>;
  const own = await db.select().from(dataChangeRequestsTable).where(eq(dataChangeRequestsTable.id, id));
  if (!own[0] || own[0].status !== "pending") { res.status(404).json({ error: "No pending request with that id" }); return; }
  const mine = !!own[0].requestedById && own[0].requestedById === req.principal?.user.id;
  // The requester may withdraw; rejecting someone else's request is an approver's decision (audit H-2).
  if (!mine && req.principal && !hasPermission(req.principal.access, "approve_data_changes")) {
    res.status(403).json({ error: "Only an administrator who may approve data changes can reject this request.", code: "insufficient_permission" });
    return;
  }
  const note = (req.body as { note?: string }).note ?? (mine ? "Withdrawn by the requester" : null);
  const [row] = await db.update(dataChangeRequestsTable).set({
    status: "rejected", decidedById: req.principal?.user.id ?? null, decidedBy: who(req), decidedAt: new Date(), decisionNote: note,
  }).where(and(eq(dataChangeRequestsTable.id, id), eq(dataChangeRequestsTable.status, "pending"))).returning();
  if (!row) { res.status(404).json({ error: "No pending request with that id" }); return; }
  await logActivity("data_change.rejected", "system", id, row.summary, note, req);
  res.json(row);
});

export default router;
