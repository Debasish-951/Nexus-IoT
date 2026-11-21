/**
 * Audit log storage: writing entries into the hash chain, the append-only
 * trigger, the one-time hash backfill, verification, retention pruning with
 * checkpoints, settings, sensitive-action alerts, search, export and summary.
 * Pure logic lives in audit-core.ts.
 */
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { db, pool, activityLogsTable, auditAlertsTable, type ActivityLog } from "@workspace/db";
import { broadcast } from "./ws-broadcast";
import { clientIp, userAgent, onSecurityEvent } from "./security-log";
import { correlationIdOf } from "./errors";
import { logger } from "./logger";
import { currentAuditContext } from "./audit-context";
import {
  entryHash, verifyChain, matchSensitive, effectiveAuditRetention, SENSITIVE_RULES, SENSITIVE_RULE_KEYS,
  FAILED_SIGNIN_THRESHOLD, FAILED_SIGNIN_WINDOW_MS,
  type AuditChange, type AuditOutcome, type ChainBreak, type SensitiveRule, type AuditFilters,
} from "./audit-core";

/** pg advisory lock serialising appends to the chain (and pruning/backfill). */
const CHAIN_LOCK = 727_274_001;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Settings ─────────────────────────────────────────────────────────────────

export const AuditSettingsSchema = z.object({
  /** Days entries are kept; null = RETENTION_ACTIVITY_LOG_DAYS (default 365); 0 = for ever. Minimum 365. */
  retentionDays: z.number().int().min(0).max(36500).nullable().default(null),
  /** Sensitive-action alerts switched on (missing = on). */
  alerts: z.record(z.boolean()).default({}),
});
export type AuditSettings = z.infer<typeof AuditSettingsSchema>;

export const AuditSettingsUpdate = z.object({
  retentionDays: z.number().int().min(0).max(36500).nullable().optional(),
  alerts: z.record(z.boolean()).optional(),
}).strict();

const SETTINGS_KEY = "audit_settings";
const CHECKPOINT_KEY = "audit_checkpoint";
let settingsCache: { at: number; value: AuditSettings } | null = null;

export async function getAuditSettings(): Promise<AuditSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 15_000) return settingsCache.value;
  const r = await pool.query<{ value: unknown }>(`SELECT value FROM job_state WHERE key = $1`, [SETTINGS_KEY]);
  const parsed = AuditSettingsSchema.safeParse(r.rows[0]?.value ?? {});
  const value = parsed.success ? parsed.data : AuditSettingsSchema.parse({});
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function saveAuditSettings(update: z.infer<typeof AuditSettingsUpdate>): Promise<AuditSettings> {
  const current = await getAuditSettings();
  const merged = AuditSettingsSchema.parse({
    retentionDays: update.retentionDays === undefined ? current.retentionDays : update.retentionDays,
    alerts: { ...current.alerts, ...update.alerts },
  });
  // The minimum is enforced here too, so a value below it is stored as the minimum.
  if (merged.retentionDays != null) merged.retentionDays = effectiveAuditRetention(merged.retentionDays);
  await pool.query(
    `INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(merged)],
  );
  settingsCache = { at: Date.now(), value: merged };
  return merged;
}

/** Days the audit log is kept: the setting, else the environment default; never under 365 (0 = for ever). */
export async function auditRetentionDays(envDays: number): Promise<number> {
  const s = await getAuditSettings();
  return effectiveAuditRetention(s.retentionDays ?? envDays);
}

export interface Checkpoint { seq: number; hash: string; prunedAt: string; pruned: number }

export async function getCheckpoint(): Promise<Checkpoint | null> {
  const r = await pool.query<{ value: Checkpoint }>(`SELECT value FROM job_state WHERE key = $1`, [CHECKPOINT_KEY]);
  return r.rows[0]?.value ?? null;
}

// ── Append-only trigger and backfill ─────────────────────────────────────────

const GUARD_SQL = `
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    IF current_setting('app.audit_retention', true) = 'on' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'activity_logs is append-only (% refused)', TG_OP USING ERRCODE = '42501';
  END IF;
  -- UPDATE: only the hash backfill, only on rows without a hash, and only the two hash columns.
  IF current_setting('app.audit_maint', true) = 'on' AND OLD.hash IS NULL
     AND (to_jsonb(NEW) - 'hash' - 'prev_hash') = (to_jsonb(OLD) - 'hash' - 'prev_hash') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'activity_logs is append-only (UPDATE refused)' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS audit_logs_guard_row ON activity_logs;
CREATE TRIGGER audit_logs_guard_row BEFORE UPDATE OR DELETE ON activity_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();
DROP TRIGGER IF EXISTS audit_logs_guard_truncate ON activity_logs;
CREATE TRIGGER audit_logs_guard_truncate BEFORE TRUNCATE ON activity_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_guard();
`;

const COLS = `id, seq, action, category, actor_name AS "actorName", actor_role AS "actorRole", actor_username AS "actorUsername",
  actor_user_id AS "actorUserId", target_id AS "targetId", target_name AS "targetName", detail, changes, outcome, ip,
  user_agent AS "userAgent", correlation_id AS "correlationId", asset_id AS "assetId", project_id AS "projectId",
  prev_hash AS "prevHash", hash, "timestamp"`;

type RawRow = {
  id: string; seq: string | number; action: string; category: string; actorName: string; actorRole: string; actorUsername: string | null;
  actorUserId: string | null; targetId: string | null; targetName: string | null; detail: string | null; changes: unknown; outcome: string;
  ip: string | null; userAgent: string | null; correlationId: string | null; assetId: string | null; projectId: string | null;
  prevHash: string | null; hash: string | null; timestamp: Date;
};
const asChain = (r: RawRow) => ({ ...r, seq: Number(r.seq) });

/** Hash rows that have none (entries written before the chain existed), in sequence order. Caller holds CHAIN_LOCK. */
async function backfill(tx: Tx): Promise<string> {
  await tx.execute(sql`SELECT set_config('app.audit_maint', 'on', true)`);
  const head = await tx.execute<{ seq: string; hash: string }>(sql`SELECT seq, hash FROM activity_logs WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1`);
  let prev = head.rows[0]?.hash ?? (await getCheckpoint())?.hash ?? "";
  let after = Number(head.rows[0]?.seq ?? 0);
  let total = 0;
  for (;;) {
    const batch = await tx.execute<RawRow>(sql.raw(`SELECT ${COLS} FROM activity_logs WHERE seq > ${after} AND hash IS NULL ORDER BY seq LIMIT 1000`));
    if (!batch.rows.length) break;
    const ids: string[] = [], prevs: string[] = [], hashes: string[] = [];
    for (const r of batch.rows) {
      const h = entryHash(prev, asChain(r));
      ids.push(r.id); prevs.push(prev); hashes.push(h);
      prev = h; after = Number(r.seq);
    }
    const vals = JSON.stringify(ids.map((id, i) => ({ id, p: prevs[i], h: hashes[i] })));
    await tx.execute(sql`UPDATE activity_logs a SET prev_hash = v.p, hash = v.h
      FROM jsonb_to_recordset(${vals}::jsonb) AS v(id uuid, p text, h text) WHERE a.id = v.id`);
    total += ids.length;
  }
  if (total) logger.info({ total }, "audit log: hashed existing entries");
  return prev;
}

/** The hash the next entry chains from. Caller holds CHAIN_LOCK. */
async function chainHead(tx: Tx): Promise<string> {
  const last = await tx.execute<{ hash: string | null }>(sql`SELECT hash FROM activity_logs ORDER BY seq DESC LIMIT 1`);
  if (!last.rows.length) return (await getCheckpoint())?.hash ?? "";
  return last.rows[0]!.hash ?? backfill(tx);
}

let ensured: Promise<void> | null = null;

/** Create the append-only trigger and hash any old entries. Idempotent; run at start. */
export function ensureAuditStore(): Promise<void> {
  ensured ??= (async () => {
    try {
      await pool.query(GUARD_SQL);
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`);
        await chainHead(tx);
      });
    } catch (err) {
      ensured = null;
      logger.error({ err }, "audit log: could not set up the append-only trigger or hash chain (run `pnpm --filter @workspace/db run push`?)");
    }
  })();
  return ensured;
}

// ── Writing entries ──────────────────────────────────────────────────────────

export interface AuditOptions {
  changes?: AuditChange[] | null;
  outcome?: AuditOutcome;
  /** The asset the entry is about; its project is looked up. */
  assetId?: string | null;
  projectId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function projectOf(assetId: string): Promise<string | null> {
  if (!UUID_RE.test(assetId)) return null;
  const r = await pool.query<{ id: string }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, 0 AS d FROM assets WHERE id = $1::uuid
       UNION ALL SELECT a.id, a.parent_id, up.d + 1 FROM assets a JOIN up ON a.id = up.parent_id WHERE up.d < 50
     ) SELECT id::text FROM up WHERE parent_id IS NULL LIMIT 1`, [assetId]);
  return r.rows[0]?.id ?? null;
}

function actorOf(req: Request | undefined): { actorName: string; actorRole: string; actorUsername: string | null; actorUserId: string | null } {
  const p = req?.principal;
  if (p?.kind === "user") return { actorName: p.user.fullName || p.user.username, actorRole: p.user.role, actorUsername: p.user.username, actorUserId: p.user.id };
  const client = (req as (Request & { apiClient?: { name?: string; clientId?: string; id?: string } }) | undefined)?.apiClient;
  if (client) return { actorName: client.name ?? client.clientId ?? "API client", actorRole: "api_client", actorUsername: client.clientId ?? null, actorUserId: null };
  // System and background jobs (and the few public routes): the headers, which
  // stripForgedActorHeaders removes on unauthenticated requests.
  const h = (k: string) => { const v = req?.headers[k]; return typeof v === "string" && v ? v.slice(0, 200) : null; };
  return { actorName: h("x-actor-name") ?? "system", actorRole: h("x-actor-role") ?? "system", actorUsername: h("x-actor-username"), actorUserId: null };
}

/** Write one entry into the chain. Never throws: an audit failure must not fail the action. */
export async function recordAudit(
  base: { action: string; category: string; targetId: string | null; targetName: string | null; detail: string | null },
  reqIn?: Request,
  opts: AuditOptions = {},
): Promise<ActivityLog | null> {
  const ctx = currentAuditContext();
  if (ctx) ctx.audited = true;
  const req = reqIn ?? ctx?.req;
  try {
    const assetId = opts.assetId ?? null;
    const projectId = opts.projectId ?? (assetId ? await projectOf(assetId) : null);
    const row = {
      id: randomUUID(),
      action: base.action.slice(0, 200), category: base.category.slice(0, 64),
      ...actorOf(req),
      targetId: base.targetId, targetName: base.targetName?.slice(0, 500) ?? null, detail: base.detail?.slice(0, 4000) ?? null,
      changes: opts.changes && opts.changes.length ? opts.changes : null,
      outcome: opts.outcome ?? "success",
      ip: clientIp(req), userAgent: userAgent(req), correlationId: req ? correlationIdOf(req) : null,
      assetId, projectId,
      timestamp: new Date(),
    };
    const entry = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`);
      const prevHash = await chainHead(tx);
      const hash = entryHash(prevHash, row);
      const [e] = await tx.insert(activityLogsTable).values({ ...row, prevHash, hash }).returning();
      return e ?? null;
    });
    if (entry) {
      broadcast("activity_log", { ...entry, timestamp: entry.timestamp.toISOString() });
      const rule = matchSensitive({ action: entry.action, changes: entry.changes, detail: entry.detail, outcome: entry.outcome });
      if (rule) void raiseAuditAlert(rule, `${entry.actorName}: ${entry.action}${entry.targetName ? ` (${entry.targetName})` : ""}${entry.detail ? ` - ${entry.detail.slice(0, 200)}` : ""}`, { entryId: entry.id });
    }
    return entry;
  } catch (err) {
    logger.error({ err, action: base.action }, "audit log: entry not written");
    return null;
  }
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export async function alertEnabled(rule: SensitiveRule): Promise<boolean> {
  return (await getAuditSettings()).alerts[rule] ?? true;
}

export async function raiseAuditAlert(rule: SensitiveRule, message: string, opts: { entryId?: string | null; dedupeKey?: string | null } = {}): Promise<void> {
  try {
    if (!(await alertEnabled(rule))) return;
    if (opts.dedupeKey) {
      const dup = await pool.query(`SELECT 1 FROM audit_alerts WHERE dedupe_key = $1 AND raised_at > now() - interval '1 hour' LIMIT 1`, [opts.dedupeKey]);
      if (dup.rows.length) return;
    }
    const meta = SENSITIVE_RULES[rule];
    await db.insert(auditAlertsTable).values({ rule, severity: meta.severity, title: meta.title, message: message.slice(0, 1000), entryId: opts.entryId ?? null, dedupeKey: opts.dedupeKey ?? null });
    broadcast("audit_alerts", { changed: true }, { requireModule: "security" });
  } catch (err) {
    logger.error({ err, rule }, "audit log: alert not raised");
  }
}

/** 5 failed sign-ins for one user name within 10 minutes raise one alert (per user, per hour). */
async function checkFailedSignins(username: string): Promise<void> {
  try {
    const r = await pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM security_events WHERE event_type = 'login.failure' AND lower(username) = lower($1) AND created_at > now() - ($2::int * interval '1 millisecond')`,
      [username, FAILED_SIGNIN_WINDOW_MS]);
    const n = Number(r.rows[0]?.n ?? 0);
    if (n >= FAILED_SIGNIN_THRESHOLD) await raiseAuditAlert("failed_signins", `${n} failed sign-ins for "${username}" in the last ${FAILED_SIGNIN_WINDOW_MS / 60_000} minutes`, { dedupeKey: `failed_signins:${username.toLowerCase()}` });
  } catch (err) {
    logger.error({ err }, "audit log: failed sign-in check");
  }
}

onSecurityEvent((type, username) => { if (type === "login.failure" && username) void checkFailedSignins(username); });

// ── Verification ─────────────────────────────────────────────────────────────

export interface VerifyResult { ok: boolean; checked: number; checkpoint: Checkpoint | null; broken: ChainBreak | null; verifiedAt: string }

export async function verifyAuditChain(): Promise<VerifyResult> {
  await ensureAuditStore();
  const checkpoint = await getCheckpoint();
  let prev = checkpoint?.hash ?? "";
  let after = 0, checked = 0;
  for (;;) {
    const rows = await pool.query<RawRow>(`SELECT ${COLS} FROM activity_logs WHERE seq > $1 ORDER BY seq LIMIT 2000`, [after]);
    if (!rows.rows.length) break;
    const res = verifyChain(rows.rows.map(asChain), prev);
    if (!res.ok) return { ok: false, checked: checked + rows.rows.findIndex((r) => r.id === res.broken.id), checkpoint, broken: res.broken, verifiedAt: new Date().toISOString() };
    prev = res.lastHash; checked += rows.rows.length; after = Number(rows.rows[rows.rows.length - 1]!.seq);
  }
  return { ok: true, checked, checkpoint, broken: null, verifiedAt: new Date().toISOString() };
}

// ── Retention ────────────────────────────────────────────────────────────────

/**
 * Delete entries older than the retention, oldest first and only as a
 * contiguous run of the chain, recording the last deleted hash as the
 * checkpoint the remaining chain is verified from.
 */
export async function pruneAuditLog(days: number): Promise<number> {
  const eff = effectiveAuditRetention(days);
  if (!eff) return 0;
  await ensureAuditStore();
  const cutoff = new Date(Date.now() - eff * 86_400_000);
  let total = 0;
  for (let i = 0; i < 200; i++) {
    const n = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`);
      await chainHead(tx);
      await tx.execute(sql`SELECT set_config('app.audit_retention', 'on', true)`);
      const keep = await tx.execute<{ keep: string | null; last: string | null }>(sql`SELECT
        (SELECT min(seq) FROM activity_logs WHERE "timestamp" >= ${cutoff}) AS keep,
        (SELECT max(seq) FROM activity_logs) AS last`);
      const k = keep.rows[0];
      const upto = k?.keep != null ? Number(k.keep) - 1 : k?.last != null ? Number(k.last) : 0;
      if (upto <= 0) return 0;
      const batch = await tx.execute<{ seq: string; hash: string | null }>(sql`SELECT seq, hash FROM activity_logs WHERE seq <= ${upto} ORDER BY seq LIMIT 5000`);
      if (!batch.rows.length) return 0;
      const last = batch.rows[batch.rows.length - 1]!;
      const del = await tx.execute(sql`DELETE FROM activity_logs WHERE seq <= ${Number(last.seq)}`);
      const prevCpRow = await tx.execute<{ value: Checkpoint }>(sql`SELECT value FROM job_state WHERE key = ${CHECKPOINT_KEY}`);
      const prevCp = prevCpRow.rows[0]?.value ?? null;
      const cp: Checkpoint = { seq: Number(last.seq), hash: last.hash ?? "", prunedAt: new Date().toISOString(), pruned: (prevCp?.pruned ?? 0) + (del.rowCount ?? 0) };
      await tx.execute(sql`INSERT INTO job_state (key, value, updated_at) VALUES (${CHECKPOINT_KEY}, ${JSON.stringify(cp)}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
      return del.rowCount ?? 0;
    });
    total += n;
    if (n < 5000) break;
  }
  return total;
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface AuditListEntry {
  id: string; source: "audit" | "security"; timestamp: string; action: string; category: string;
  actorName: string; actorRole: string; actorUsername: string | null; actorUserId: string | null;
  targetId: string | null; targetName: string | null; detail: string | null; changes: AuditChange[] | null; outcome: string;
  ip: string | null; userAgent: string | null; correlationId: string | null; assetId: string | null; projectId: string | null;
  hash: string | null; seq: number | null;
}

const AUDIT_SELECT = sql`SELECT id::text AS id, 'audit' AS source, "timestamp" AS ts, action, category, actor_name, actor_role, actor_username,
  actor_user_id, target_id, target_name, detail, changes, outcome, ip, user_agent, correlation_id, asset_id, project_id, hash, seq FROM activity_logs`;
const SECURITY_SELECT = sql`SELECT id::text, 'security', created_at, event_type, 'security', COALESCE(username, 'unknown'), 'security', username,
  user_id::text, user_id::text, username, NULLIF(concat_ws(' ', reason, CASE WHEN detail IS NULL THEN NULL ELSE detail::text END), ''),
  NULL::jsonb, outcome, ip, user_agent, NULL::text, NULL::text, NULL::text, NULL::text, NULL::bigint FROM security_events`;

/** Assets (ids) the caller is limited to, or null for everyone. */
export interface AuditScope { assetIds: Set<string> }

function whereOf(f: AuditFilters, scope: AuditScope | null): SQL {
  const c: SQL[] = [sql`TRUE`];
  if (f.q) { const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`; c.push(sql`(action ILIKE ${like} OR target_name ILIKE ${like} OR detail ILIKE ${like} OR actor_name ILIKE ${like} OR actor_username ILIKE ${like} OR target_id ILIKE ${like})`); }
  if (f.from) c.push(sql`ts >= ${f.from}`);
  if (f.to) c.push(sql`ts <= ${f.to}`);
  if (f.actor) c.push(sql`(actor_user_id = ${f.actor} OR actor_username ILIKE ${f.actor} OR actor_name ILIKE ${`%${f.actor}%`})`);
  if (f.action) c.push(sql`action ILIKE ${`${f.action.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`);
  if (f.category) c.push(sql`category = ${f.category}`);
  if (f.outcome) c.push(sql`outcome = ${f.outcome}`);
  if (f.targetId) c.push(sql`target_id = ${f.targetId}`);
  if (f.assetId) c.push(sql`(target_id = ${f.assetId} OR asset_id = ${f.assetId} OR project_id = ${f.assetId})`);
  if (scope) {
    const ids = [...scope.assetIds];
    const idsJson = JSON.stringify(ids);
    c.push(sql`source = 'audit'`);
    c.push(ids.length ? sql`(target_id = ANY(SELECT jsonb_array_elements_text(${idsJson}::jsonb)) OR asset_id = ANY(SELECT jsonb_array_elements_text(${idsJson}::jsonb)) OR project_id = ANY(SELECT jsonb_array_elements_text(${idsJson}::jsonb)))` : sql`FALSE`);
  }
  return sql.join(c, sql` AND `);
}

function fromOf(f: AuditFilters, scope: AuditScope | null): SQL {
  return f.includeSecurity && !scope ? sql`(${AUDIT_SELECT} UNION ALL ${SECURITY_SELECT})` : sql`(${AUDIT_SELECT})`;
}

const COLUMN_NAMES = ["id", "source", "ts", "action", "category", "actor_name", "actor_role", "actor_username", "actor_user_id", "target_id",
  "target_name", "detail", "changes", "outcome", "ip", "user_agent", "correlation_id", "asset_id", "project_id", "hash", "seq"];

function toEntry(r: Record<string, unknown>): AuditListEntry {
  return {
    id: String(r.id), source: r.source === "security" ? "security" : "audit", timestamp: new Date(r.ts as string).toISOString(),
    action: String(r.action), category: String(r.category), actorName: String(r.actor_name ?? "system"), actorRole: String(r.actor_role ?? ""),
    actorUsername: (r.actor_username as string) ?? null, actorUserId: (r.actor_user_id as string) ?? null,
    targetId: (r.target_id as string) ?? null, targetName: (r.target_name as string) ?? null, detail: (r.detail as string) ?? null,
    changes: (r.changes as AuditChange[]) ?? null, outcome: String(r.outcome ?? "success"),
    ip: (r.ip as string) ?? null, userAgent: (r.user_agent as string) ?? null, correlationId: (r.correlation_id as string) ?? null,
    assetId: (r.asset_id as string) ?? null, projectId: (r.project_id as string) ?? null, hash: (r.hash as string) ?? null,
    seq: r.seq == null ? null : Number(r.seq),
  };
}

export async function listAudit(f: AuditFilters, scope: AuditScope | null, limit: number, offset: number, withTotal = true): Promise<{ entries: AuditListEntry[]; total: number }> {
  const cols = sql.raw(`x(${COLUMN_NAMES.join(", ")})`);
  const where = whereOf(f, scope);
  const from = fromOf(f, scope);
  const rows = await db.execute<Record<string, unknown>>(sql`SELECT * FROM ${from} AS ${cols} WHERE ${where} ORDER BY ts DESC, seq DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`);
  let total = rows.rows.length + offset;
  if (withTotal) {
    const t = await db.execute<{ n: string }>(sql`SELECT count(*)::bigint AS n FROM ${from} AS ${cols} WHERE ${where}`);
    total = Number(t.rows[0]?.n ?? 0);
  }
  return { entries: rows.rows.map(toEntry), total };
}

// ── Summary ──────────────────────────────────────────────────────────────────

const CANDIDATE_ACTIONS = ["alarm_rule.deleted", "alarm_rule.updated", "user.deleted", "user.updated", "user.access_updated", "user.invited",
  "data_change.range_deleted", "archive.deleted", "retention.run", "api_client.secret_rotated", "audit.verify_failed"];

export async function auditSummary(scope: AuditScope | null, timeZone: string): Promise<{
  perDay: { day: string; count: number }[]; topActors: { name: string; count: number }[];
  sensitive: { count: number; byRule: Record<string, number>; recent: { action: string; actorName: string; targetName: string | null; timestamp: string; rule: SensitiveRule }[] };
  failures: { audit: number; security: number };
}> {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const scopeSql = scope ? whereOf({}, scope) : sql`TRUE`;
  const base = sql`(${AUDIT_SELECT}) AS ${sql.raw(`x(${COLUMN_NAMES.join(", ")})`)}`;
  const [days, actors, cand, failA, failS] = await Promise.all([
    db.execute<{ day: string; n: string }>(sql`SELECT to_char(date_trunc('day', ts AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM ${base} WHERE ts >= ${since} AND ${scopeSql} GROUP BY 1 ORDER BY 1`),
    db.execute<{ name: string; n: string }>(sql`SELECT actor_name AS name, count(*)::int AS n FROM ${base}
      WHERE ts >= ${since} AND actor_role <> 'system' AND ${scopeSql} GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
    db.execute<Record<string, unknown>>(sql`SELECT * FROM ${base} WHERE ts >= ${since} AND action IN (SELECT jsonb_array_elements_text(${JSON.stringify(CANDIDATE_ACTIONS)}::jsonb)) AND ${scopeSql} ORDER BY ts DESC LIMIT 2000`),
    db.execute<{ n: string }>(sql`SELECT count(*)::int AS n FROM ${base} WHERE ts >= ${since} AND outcome <> 'success' AND ${scopeSql}`),
    scope ? Promise.resolve({ rows: [{ n: "0" }] }) : db.execute<{ n: string }>(sql`SELECT count(*)::int AS n FROM security_events WHERE created_at >= ${since} AND outcome <> 'success'`),
  ]);
  const map = new Map(days.rows.map((r) => [r.day, Number(r.n)]));
  const perDay: { day: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - i * 86_400_000));
    perDay.push({ day: d, count: map.get(d) ?? 0 });
  }
  const byRule: Record<string, number> = {};
  const recent: { action: string; actorName: string; targetName: string | null; timestamp: string; rule: SensitiveRule }[] = [];
  for (const raw of cand.rows) {
    const e = toEntry(raw);
    const rule = matchSensitive({ action: e.action, changes: e.changes, detail: e.detail, outcome: e.outcome });
    if (!rule) continue;
    byRule[rule] = (byRule[rule] ?? 0) + 1;
    if (recent.length < 5) recent.push({ action: e.action, actorName: e.actorName, targetName: e.targetName, timestamp: e.timestamp, rule });
  }
  return {
    perDay, topActors: actors.rows.map((r) => ({ name: r.name, count: Number(r.n) })),
    sensitive: { count: Object.values(byRule).reduce((a, b) => a + b, 0), byRule, recent },
    failures: { audit: Number(failA.rows[0]?.n ?? 0), security: Number(failS.rows[0]?.n ?? 0) },
  };
}

export { SENSITIVE_RULE_KEYS };
