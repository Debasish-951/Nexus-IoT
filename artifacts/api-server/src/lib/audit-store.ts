/**
 * Audit log storage: writing entries into the hash chain, the start-up check of
 * the append-only guard, the one-time hash backfill, verification, retention
 * pruning with checkpoints, chain-head anchors, settings, sensitive-action
 * alerts, search, export and summary. Pure logic lives in audit-core.ts; the
 * guard's SQL lives in lib/db/src/audit-guard-sql.ts (owner-run).
 */
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { db, pool, auditAlertsTable, AUDIT_GUARD_SQL, AUDIT_GUARD_VERSION, AUDIT_CHAIN_LOCK, type ActivityLog } from "@workspace/db";
import { broadcast } from "./ws-broadcast";
import { clientIp, userAgent, onSecurityEvent } from "./security-log";
import { correlationIdOf } from "./errors";
import { logger } from "./logger";
import { currentAuditContext } from "./audit-context";
import { derivedKey } from "./secret-box";
import {
  entryHash, entryHashFor, verifyChain, markMac, checkMarkMac, pruneBoundary, clipText, wellFormed, redactUrlsInText, sanitiseDeep,
  HMAC_ALG_PREFIX, matchSensitive, effectiveAuditRetention, SENSITIVE_RULES, SENSITIVE_RULE_KEYS,
  FAILED_SIGNIN_THRESHOLD, FAILED_SIGNIN_WINDOW_MS,
  type AuditChange, type AuditOutcome, type ChainBreak, type SensitiveRule, type AuditFilters, type AuditKeyLookup,
} from "./audit-core";

/** pg advisory lock serialising appends to the chain (and pruning/backfill). */
const CHAIN_LOCK = AUDIT_CHAIN_LOCK;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Keys ─────────────────────────────────────────────────────────────────────

/** Derived audit keys by key id (SECRETS_ENC_KEY and retired SECRETS_ENC_KEY_<id>). */
const keyCache = new Map<string, Buffer | null>();
const keyFor: AuditKeyLookup = (id) => {
  if (!keyCache.has(id)) keyCache.set(id, derivedKey("audit-log", id)?.key ?? null);
  return keyCache.get(id) ?? null;
};
let currentKeyMemo: { id: string; key: Buffer } | null | undefined;
/** The key new entries and marks are keyed with; null without SECRETS_ENC_KEY (plain SHA-256, as before). */
function currentAuditKey(): { id: string; key: Buffer } | null {
  if (currentKeyMemo === undefined) currentKeyMemo = derivedKey("audit-log");
  return currentKeyMemo;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const AuditSettingsSchema = z.object({
  /** Days entries are kept; null = RETENTION_ACTIVITY_LOG_DAYS (default 365); 0 = for ever. Minimum 365. */
  retentionDays: z.number().int().min(0).max(36500).nullable().default(null),
  /** Sensitive-action alerts switched on (missing = on). */
  alerts: z.record(z.string(), z.boolean()).default({}),
});
export type AuditSettings = z.infer<typeof AuditSettingsSchema>;

export const AuditSettingsUpdate = z.object({
  retentionDays: z.number().int().min(0).max(36500).nullable().optional(),
  alerts: z.record(z.string(), z.boolean()).optional(),
}).strict();

const SETTINGS_KEY = "audit_settings";
/** Where checkpoints were kept before audit_checkpoints existed (still read, never trusted over a signed one). */
const CHECKPOINT_KEY = "audit_checkpoint";
/** Marker that the one-time hash backfill has run. */
const BACKFILL_KEY = "audit_backfill";
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

// ── Guard state (checked at start) ───────────────────────────────────────────

interface GuardState { version: number; triggers: number; owner: boolean; pruneFn: boolean; marks: boolean; hashAlgColumn: boolean }
let guard: GuardState | null = null;

async function guardStatus(): Promise<GuardState> {
  const r = await pool.query<{ triggers: string; owner: boolean | null; ver: boolean; prune: boolean; marks: boolean; alg: boolean }>(`SELECT
    (SELECT count(*) FROM pg_trigger WHERE tgrelid = to_regclass('activity_logs')
       AND tgname IN ('audit_logs_guard_row', 'audit_logs_guard_truncate', 'audit_logs_guard_insert') AND tgenabled <> 'D') AS triggers,
    (SELECT pg_get_userbyid(relowner) = current_user FROM pg_class WHERE oid = to_regclass('activity_logs')) AS owner,
    to_regproc('audit_guard_version') IS NOT NULL AS ver,
    to_regprocedure('audit_prune_upto(bigint,text,integer,text)') IS NOT NULL AS prune,
    to_regclass('audit_checkpoints') IS NOT NULL AS marks,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('activity_logs') AND attname = 'hash_alg' AND NOT attisdropped) AS alg`);
  const row = r.rows[0]!;
  const version = row.ver ? Number((await pool.query<{ v: number }>(`SELECT audit_guard_version() AS v`)).rows[0]?.v ?? 0) : 0;
  return { version, triggers: Number(row.triggers), owner: row.owner === true, pruneFn: row.prune, marks: row.marks, hashAlgColumn: row.alg };
}

const guardComplete = (s: GuardState) => s.version >= AUDIT_GUARD_VERSION && s.triggers >= 3 && s.pruneFn;

/**
 * Check that the append-only guard is installed. The DDL is an owner step
 * (`pnpm --filter @workspace/db run audit-guard`); only when this login owns
 * activity_logs (the default single-login install, where start-up created the
 * trigger before) is it installed or upgraded here, so an upgrade keeps the
 * protection. Otherwise a missing guard raises an alert and is logged.
 */
async function checkGuard(): Promise<void> {
  let st = await guardStatus();
  if (!guardComplete(st) && st.owner) {
    logger.warn("audit log: installing the append-only guard because this database login owns activity_logs. "
      + "For protection against this login itself, give the application a separate login and run "
      + "`pnpm --filter @workspace/db run audit-guard -- --runtime-role <login>` as the owner (docs/features/audit-log.md).");
    try {
      await pool.query(AUDIT_GUARD_SQL);
    } catch (err) {
      logger.error({ err }, "audit log: could not install the append-only guard");
    }
    st = await guardStatus();
  }
  guard = st;
  if (!guardComplete(st)) {
    const what = st.triggers === 0 ? "The audit log's append-only triggers are missing" : `The audit log guard is out of date (version ${st.version}, ${AUDIT_GUARD_VERSION} needed)`;
    logger.error(`audit log: ${what}. Run \`pnpm --filter @workspace/db run audit-guard\` as the owner of activity_logs.`);
    void raiseAuditAlert("audit_guard_missing",
      `${what}, so entries are not protected as the documentation describes. Run "pnpm --filter @workspace/db run audit-guard" as the database owner.`,
      { dedupeKey: "audit_guard_missing" });
  } else if (st.owner) {
    logger.info("audit log: guard installed; this database login owns activity_logs, so it could still switch the guard off (see docs/features/audit-log.md)");
  }
}

// ── Checkpoints and marks ────────────────────────────────────────────────────

export interface Checkpoint { seq: number; hash: string; prunedAt: string; pruned: number; mac?: string | null }

type Q = (text: string) => Promise<Record<string, unknown>[]>;
const poolQ: Q = async (t) => (await pool.query(t)).rows as Record<string, unknown>[];
const txQ = (tx: Tx): Q => async (t) => (await tx.execute(sql.raw(t))).rows as Record<string, unknown>[];

/** The checkpoint the remaining chain starts from: the newest in audit_checkpoints, else the earlier job_state one. */
async function readCheckpoint(q: Q): Promise<Checkpoint | null> {
  let best: Checkpoint | null = null;
  if (guard?.marks) {
    const r = await q(`SELECT seq, hash, pruned, mac, created_at FROM audit_checkpoints WHERE kind = 'checkpoint' ORDER BY seq DESC LIMIT 1`);
    const x = r[0];
    if (x) best = { seq: Number(x.seq), hash: String(x.hash), pruned: Number(x.pruned), prunedAt: new Date(x.created_at as string).toISOString(), mac: (x.mac as string | null) ?? null };
  }
  const j = await q(`SELECT value FROM job_state WHERE key = '${CHECKPOINT_KEY}'`);
  const legacy = j[0]?.value as Checkpoint | undefined;
  // Once audit_prune_upto() writes checkpoints, the writable job_state copy is ignored.
  if (legacy && typeof legacy.seq === "number" && (!best || (!guard?.pruneFn && legacy.seq > best.seq))) best = { ...legacy, mac: null };
  return best;
}

export async function getCheckpoint(): Promise<Checkpoint | null> {
  return readCheckpoint(poolQ);
}

interface Mark { kind: string; seq: number; hash: string; mac: string | null; createdAt: Date }

/** Marks of these kinds, newest seq first, keeping only those whose MAC is valid. */
async function validMarks(kinds: string[], limit = 20): Promise<Mark[]> {
  if (!guard?.marks) return [];
  const r = await pool.query<{ kind: string; seq: string; hash: string; mac: string | null; created_at: Date }>(
    `SELECT kind, seq, hash, mac, created_at FROM audit_checkpoints WHERE kind = ANY($1::text[]) ORDER BY seq DESC, id DESC LIMIT $2`, [kinds, limit]);
  return r.rows
    .map((x) => ({ kind: x.kind, seq: Number(x.seq), hash: x.hash, mac: x.mac, createdAt: new Date(x.created_at) }))
    .filter((m) => checkMarkMac(m.kind, m.seq, m.hash, m.mac, keyFor) === "valid");
}

async function insertMark(kind: string, seq: number, hash: string): Promise<void> {
  const k = currentAuditKey();
  if (!guard?.marks) return;
  await pool.query(`INSERT INTO audit_checkpoints (kind, seq, hash, mac) VALUES ($1, $2, $3, $4)`, [kind, seq, hash, k ? markMac(kind, seq, hash, k) : null]);
}

// ── Backfill, keyed start and anchors ────────────────────────────────────────

function cols(): string {
  return `id, seq, action, category, actor_name AS "actorName", actor_role AS "actorRole", actor_username AS "actorUsername",
  actor_user_id AS "actorUserId", target_id AS "targetId", target_name AS "targetName", detail, changes, outcome, ip,
  user_agent AS "userAgent", correlation_id AS "correlationId", asset_id AS "assetId", project_id AS "projectId",
  prev_hash AS "prevHash", hash, ${guard?.hashAlgColumn ? `hash_alg AS "hashAlg"` : `NULL::text AS "hashAlg"`}, "timestamp"`;
}

type RawRow = {
  id: string; seq: string | number; action: string; category: string; actorName: string; actorRole: string; actorUsername: string | null;
  actorUserId: string | null; targetId: string | null; targetName: string | null; detail: string | null; changes: unknown; outcome: string;
  ip: string | null; userAgent: string | null; correlationId: string | null; assetId: string | null; projectId: string | null;
  prevHash: string | null; hash: string | null; hashAlg: string | null; timestamp: Date;
};
const asChain = (r: RawRow) => ({ ...r, seq: Number(r.seq) });

/** Hash entries up to `upto` that have none (written before the chain existed), in sequence order. Caller holds CHAIN_LOCK. */
async function backfill(tx: Tx, upto: number): Promise<number> {
  await tx.execute(sql`SELECT set_config('app.audit_maint', 'on', true)`);
  let prev = "";
  let after = 0;
  let total = 0;
  for (;;) {
    const batch = await tx.execute<RawRow>(sql.raw(`SELECT ${cols()} FROM activity_logs WHERE seq > ${after} AND seq <= ${upto} AND hash IS NULL ORDER BY seq LIMIT 1000`));
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
  return total;
}

/**
 * The one-time backfill, at start only. It runs only when no entry has a hash
 * yet and nothing was ever pruned (an installation upgraded from before the
 * chain existed); afterwards a marker stops it for good. An unhashed entry that
 * appears later is never sealed: verification reports it.
 */
async function backfillOnce(): Promise<void> {
  const done = await pool.query(`SELECT 1 FROM job_state WHERE key = $1`, [BACKFILL_KEY]);
  if (done.rows.length) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`);
    const hashed = await tx.execute<{ seq: string }>(sql`SELECT seq FROM activity_logs WHERE hash IS NOT NULL AND seq IS NOT NULL ORDER BY seq DESC LIMIT 1`);
    const cp = await readCheckpoint(txQ(tx));
    let upto = Number(hashed.rows[0]?.seq ?? 0);
    let total = 0;
    if (!hashed.rows.length && !cp) {
      const max = await tx.execute<{ m: string | null }>(sql`SELECT max(seq) AS m FROM activity_logs`);
      upto = Number(max.rows[0]?.m ?? 0);
      if (upto > 0) total = await backfill(tx, upto);
    }
    await tx.execute(sql`INSERT INTO job_state (key, value, updated_at)
      VALUES (${BACKFILL_KEY}, ${JSON.stringify({ upto, hashed: total, at: new Date().toISOString() })}::jsonb, now()) ON CONFLICT (key) DO NOTHING`);
  });
}

/** Seq and hash of the newest hashed entry. */
async function headOf(q: Q): Promise<{ seq: number; hash: string } | null> {
  const r = await q(`SELECT seq, hash FROM activity_logs WHERE hash IS NOT NULL AND seq IS NOT NULL ORDER BY seq DESC LIMIT 1`);
  return r[0] ? { seq: Number(r[0].seq), hash: String(r[0].hash) } : null;
}

/**
 * With a key, record (signed) where keyed hashing starts: every entry after it
 * must be keyed, so plain SHA-256 entries cannot be slipped in later.
 */
async function ensureKeyedStart(): Promise<void> {
  if (!currentAuditKey() || !guard?.marks || !guard.hashAlgColumn) return;
  const have = await pool.query(`SELECT 1 FROM audit_checkpoints WHERE kind = 'hmac_start' LIMIT 1`);
  if (have.rows.length) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`);
    const head = await headOf(txQ(tx));
    const cp = head ? null : await readCheckpoint(txQ(tx));
    const seq = head?.seq ?? cp?.seq ?? 0;
    const hash = head?.hash ?? cp?.hash ?? "";
    const k = currentAuditKey()!;
    await tx.execute(sql`INSERT INTO audit_checkpoints (kind, seq, hash, mac) VALUES ('hmac_start', ${seq}, ${hash}, ${markMac("hmac_start", seq, hash, k)})`);
    logger.info({ afterSeq: seq }, "audit log: new entries are keyed (HMAC-SHA256 from SECRETS_ENC_KEY)");
  });
}

let lastAnchorSeq = -1;
let anchorTimer: NodeJS.Timeout | null = null;
const ANCHOR_EVERY_MS = 60 * 60_000;

/**
 * Record the chain head (seq, hash, MAC) outside the database: in the
 * application log (journald/syslog), and in audit_checkpoints so verification
 * fails if the head later goes backwards. The backup script copies the newest
 * anchor next to each backup.
 */
export async function anchorChainHead(): Promise<{ seq: number; hash: string; mac: string | null } | null> {
  const head = await headOf(poolQ);
  if (!head) return null;
  const k = currentAuditKey();
  const mac = k ? markMac("anchor", head.seq, head.hash, k) : null;
  logger.info({ auditAnchor: { seq: head.seq, hash: head.hash, mac } }, "audit log: chain head");
  if (head.seq !== lastAnchorSeq) await insertMark("anchor", head.seq, head.hash);
  lastAnchorSeq = head.seq;
  return { ...head, mac };
}

function startAnchoring(): void {
  if (anchorTimer) return;
  void anchorChainHead().catch((err: unknown) => logger.warn({ err }, "audit log: chain head not anchored"));
  anchorTimer = setInterval(() => { void anchorChainHead().catch((err: unknown) => logger.warn({ err }, "audit log: chain head not anchored")); }, ANCHOR_EVERY_MS);
  anchorTimer.unref();
}

let ensured: Promise<void> | null = null;

/** Check the guard, run the one-time backfill and start anchoring. Idempotent; run at start. */
export function ensureAuditStore(): Promise<void> {
  ensured ??= (async () => {
    try {
      await checkGuard();
    } catch (err) {
      logger.error({ err }, "audit log: could not check or install the append-only guard");
    }
    try {
      await backfillOnce();
      await ensureKeyedStart();
      startAnchoring();
    } catch (err) {
      ensured = null;
      logger.error({ err }, "audit log: could not prepare the hash chain (run `pnpm --filter @workspace/db run push`?)");
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

const wf = (v: string | null | undefined, max = 4000): string | null => (v == null ? null : clipText(v, max));
/** Free text: well-formed, URLs masked (webhook secrets), then clipped on a code-point boundary. */
const freeText = (v: string | null | undefined, max: number): string | null => (v == null ? null : clipText(redactUrlsInText(wellFormed(v)), max));

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
    if (ensured) await ensured;
    const assetId = wf(opts.assetId ?? null, 200);
    const projectId = wf(opts.projectId ?? null, 200) ?? (assetId ? await projectOf(assetId) : null);
    const actor = actorOf(req);
    const row = {
      id: randomUUID(),
      action: wf(base.action, 200)!, category: wf(base.category, 64)!,
      actorName: wf(actor.actorName, 200)!, actorRole: wf(actor.actorRole, 64)!, actorUsername: wf(actor.actorUsername, 200), actorUserId: wf(actor.actorUserId, 200),
      targetId: wf(base.targetId, 500), targetName: freeText(base.targetName, 500), detail: freeText(base.detail, 4000),
      changes: opts.changes && opts.changes.length ? (sanitiseDeep(opts.changes) as AuditChange[]) : null,
      outcome: opts.outcome ?? "success",
      ip: wf(clientIp(req), 200), userAgent: wf(userAgent(req), 1000), correlationId: wf(req ? correlationIdOf(req) : null, 200),
      assetId, projectId,
      timestamp: new Date(),
    };
    const k = guard?.hashAlgColumn ? currentAuditKey() : null;
    const entry = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`);
      const prevHash = await chainHead(tx);
      let hashAlg: string | null = k ? `${HMAC_ALG_PREFIX}${k.id}` : null;
      let hash = entryHashFor(prevHash, row, hashAlg, keyFor);
      if (hash === null) { hashAlg = null; hash = entryHash(prevHash, row); }
      const algCol = guard?.hashAlgColumn ? sql`, hash_alg` : sql``;
      const algVal = guard?.hashAlgColumn ? sql`, ${hashAlg}` : sql``;
      const r = await tx.execute<RawRow>(sql`INSERT INTO activity_logs (id, action, category, actor_name, actor_role, actor_username, actor_user_id,
          target_id, target_name, detail, changes, outcome, ip, user_agent, correlation_id, asset_id, project_id, "timestamp", prev_hash, hash${algCol})
        VALUES (${row.id}, ${row.action}, ${row.category}, ${row.actorName}, ${row.actorRole}, ${row.actorUsername}, ${row.actorUserId},
          ${row.targetId}, ${row.targetName}, ${row.detail}, ${row.changes ? JSON.stringify(row.changes) : null}::jsonb, ${row.outcome}, ${row.ip},
          ${row.userAgent}, ${row.correlationId}, ${row.assetId}, ${row.projectId}, ${row.timestamp.toISOString()}::timestamptz, ${prevHash}, ${hash}${algVal})
        RETURNING ${sql.raw(cols())}`);
      const e = r.rows[0];
      return e ? ({ ...e, seq: e.seq == null ? null : Number(e.seq), timestamp: new Date(e.timestamp) } as unknown as ActivityLog) : null;
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

/** The hash the next entry chains from: the newest hashed entry, else the checkpoint. Caller holds CHAIN_LOCK. */
async function chainHead(tx: Tx): Promise<string> {
  const head = await headOf(txQ(tx));
  if (head) return head.hash;
  return (await readCheckpoint(txQ(tx)))?.hash ?? "";
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

export interface VerifyResult {
  ok: boolean; checked: number; checkpoint: Checkpoint | null; broken: ChainBreak | null; verifiedAt: string;
  /** Only entries after the last signed verification were walked (fromSeq). */
  incremental: boolean; fromSeq: number; lastSeq: number;
  /** Keyed (HMAC) entries were found and checked. */
  keyed: boolean;
}

const VERIFY_BATCH = 2000;
/** A full walk at least this often, even when an incremental one would do. */
const FULL_VERIFY_EVERY_MS = 7 * 86_400_000;
let verifyRun: Promise<VerifyResult> | null = null;

/**
 * Walk the chain in batches. With a key, a check normally starts where the last
 * signed verification ended (incremental) and a full walk runs at least weekly
 * or when `full` is asked for. Retention running at the same time is followed
 * through its checkpoint instead of being reported as a break. Concurrent calls
 * share one walk.
 */
export function verifyAuditChain(opts: { full?: boolean } = {}): Promise<VerifyResult> {
  verifyRun ??= runVerify(opts.full === true).finally(() => { verifyRun = null; });
  return verifyRun;
}

async function runVerify(full: boolean): Promise<VerifyResult> {
  await ensureAuditStore();
  const k = currentAuditKey();
  let checkpoint = await getCheckpoint();
  let checked = 0, after = 0, prev = checkpoint?.hash ?? "", keyedSeen = false, incremental = false;
  let fromSeq = 0, lastSeq = 0;
  const done = (broken: ChainBreak | null): VerifyResult =>
    ({ ok: !broken, checked, checkpoint, broken, verifiedAt: new Date().toISOString(), incremental, fromSeq, lastSeq, keyed: keyedSeen });
  const cpValid = (cp: Checkpoint) => checkMarkMac("checkpoint", cp.seq, cp.hash, cp.mac, keyFor) !== "invalid";

  if (checkpoint && !cpValid(checkpoint)) return done({ id: "", seq: checkpoint.seq, timestamp: checkpoint.prunedAt, reason: "checkpoint_invalid" });

  // Entries without seq sit outside the chain; they cannot be genuine.
  const noSeq = await pool.query<RawRow>(`SELECT ${cols()} FROM activity_logs WHERE seq IS NULL LIMIT 1`);
  if (noSeq.rows[0]) return done({ id: noSeq.rows[0].id, seq: 0, timestamp: new Date(noSeq.rows[0].timestamp).toISOString(), reason: "missing_seq" });

  const keyedStart = (await validMarks(["hmac_start"])).at(-1) ?? null;
  const keyedAfter = keyedStart ? keyedStart.seq : null;

  if (!full && k) {
    const lastFull = (await validMarks(["verified_full"], 5))[0];
    const fullDue = !lastFull || Date.now() - lastFull.createdAt.getTime() > FULL_VERIFY_EVERY_MS;
    const v = (await validMarks(["verified", "verified_full"], 5))[0];
    if (!fullDue && v && v.seq > (checkpoint?.seq ?? 0)) {
      const r = await pool.query<{ hash: string | null; hashAlg: string | null }>(
        `SELECT hash, ${guard?.hashAlgColumn ? "hash_alg" : "NULL::text"} AS "hashAlg" FROM activity_logs WHERE seq = $1`, [v.seq]);
      if (r.rows[0]?.hash === v.hash) {
        after = v.seq; prev = v.hash; keyedSeen = !!r.rows[0].hashAlg; incremental = true;
      }
    }
  }
  fromSeq = after; lastSeq = after;
  let lastHash = prev;

  for (;;) {
    const rows = (await pool.query<RawRow>(`SELECT ${cols()} FROM activity_logs WHERE seq > $1 ORDER BY seq LIMIT ${VERIFY_BATCH}`, [after])).rows.map(asChain);
    if (!rows.length) break;
    let res = verifyChain(rows, prev, { keyFor, keyedSeen, keyedAfter });
    if (!res.ok && res.broken.reason === "prev_mismatch" && res.broken.id === rows[0]!.id) {
      // Retention may have removed entries since the checkpoint (or the last batch) was read: follow its new checkpoint.
      const cp2 = await getCheckpoint();
      if (cp2 && cp2.seq !== checkpoint?.seq && cp2.seq >= after && cp2.seq < rows[0]!.seq && (rows[0]!.prevHash ?? "") === cp2.hash && cpValid(cp2)) {
        checkpoint = cp2;
        res = verifyChain(rows, cp2.hash, { keyFor, keyedSeen, keyedAfter });
      }
    }
    if (!res.ok) {
      const broken = res.broken;
      checked += rows.findIndex((r) => r.id === broken.id);
      return done(broken);
    }
    prev = res.lastHash; lastHash = prev; keyedSeen = res.keyedSeen;
    checked += rows.length; after = Number(rows[rows.length - 1]!.seq); lastSeq = after;
    if (rows.length < VERIFY_BATCH) break;
    await new Promise((r) => setImmediate(r));
  }

  // The head must not go backwards: the newest signed anchor must still be there, unchanged, unless retention removed it.
  const anchor = k ? (await validMarks(["anchor"]))[0] : undefined;
  if (anchor) {
    checkpoint = (await getCheckpoint()) ?? checkpoint;
    if (anchor.seq > (checkpoint?.seq ?? 0)) {
      const r = await pool.query<{ hash: string | null }>(`SELECT hash FROM activity_logs WHERE seq = $1`, [anchor.seq]);
      if (!r.rows[0]) return done({ id: "", seq: anchor.seq, timestamp: anchor.createdAt.toISOString(), reason: "head_rollback" });
      if (r.rows[0].hash !== anchor.hash) return done({ id: "", seq: anchor.seq, timestamp: anchor.createdAt.toISOString(), reason: "anchor_mismatch" });
    }
  }

  if (k && lastSeq > 0 && (lastSeq > fromSeq || !incremental)) {
    await insertMark(incremental ? "verified" : "verified_full", lastSeq, lastHash).catch((err: unknown) => logger.warn({ err }, "audit log: verification mark not written"));
  }
  return done(null);
}

// ── Retention ────────────────────────────────────────────────────────────────

const PRUNE_BATCH = 2000;

/**
 * Delete entries older than the retention, oldest first and only as a
 * contiguous run of the chain, recording the last deleted hash as the
 * checkpoint the remaining chain is verified from. The boundary is read on the
 * seq index outside the chain lock, so the locked part is one small batch.
 * With the guard installed, audit_prune_upto() (running as the table owner)
 * does the delete and writes the signed checkpoint; this login needs no DELETE.
 */
export async function pruneAuditLog(days: number): Promise<number> {
  const eff = effectiveAuditRetention(days);
  if (!eff) return 0;
  await ensureAuditStore();
  // An hour of margin, so a clock difference with the database never asks audit_prune_upto() for an entry it must refuse.
  const cutoff = new Date(Date.now() - eff * 86_400_000 - 3_600_000);
  let total = 0;
  for (let i = 0; i < 500; i++) {
    const r = await pool.query<{ seq: string; hash: string | null; ts: Date }>(
      `SELECT seq, hash, "timestamp" AS ts FROM activity_logs WHERE seq IS NOT NULL ORDER BY seq LIMIT ${PRUNE_BATCH}`);
    const b = pruneBoundary(r.rows, cutoff);
    if (!b) break;
    const n = guard?.pruneFn ? await pruneWithFunction(b, eff) : await pruneLegacy(b);
    total += n;
    if (b.count < PRUNE_BATCH || n === 0) break;
  }
  return total;
}

async function pruneWithFunction(b: { seq: number; hash: string }, days: number): Promise<number> {
  const k = currentAuditKey();
  const mac = k ? markMac("checkpoint", b.seq, b.hash, k) : null;
  const r = await pool.query<{ n: string }>(`SELECT audit_prune_upto($1, $2, $3, $4) AS n`, [b.seq, b.hash, days, mac]);
  return Number(r.rows[0]?.n ?? 0);
}

/** Installations whose guard predates audit_prune_upto(): delete directly, checkpoint in job_state (as before). */
async function pruneLegacy(b: { seq: number; hash: string }): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`);
    await tx.execute(sql`SELECT set_config('app.audit_retention', 'on', true)`);
    const del = await tx.execute(sql`DELETE FROM activity_logs WHERE seq <= ${b.seq}`);
    const prevCp = await readCheckpoint(txQ(tx));
    const cp: Checkpoint = { seq: b.seq, hash: b.hash, prunedAt: new Date().toISOString(), pruned: (prevCp?.pruned ?? 0) + (del.rowCount ?? 0) };
    await tx.execute(sql`INSERT INTO job_state (key, value, updated_at) VALUES (${CHECKPOINT_KEY}, ${JSON.stringify(cp)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
    return del.rowCount ?? 0;
  });
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
    // The same rule as the live feed: audit-core AUDIT_SCOPE_FIELDS (target, asset or project).
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

/** The count stops here: counting every match of a broad search scans the whole table on every page. */
export const AUDIT_COUNT_CAP = 10_000;

export async function listAudit(f: AuditFilters, scope: AuditScope | null, limit: number, offset: number, withTotal = true): Promise<{ entries: AuditListEntry[]; total: number; totalCapped: boolean }> {
  const cols = sql.raw(`x(${COLUMN_NAMES.join(", ")})`);
  const where = whereOf(f, scope);
  const from = fromOf(f, scope);
  const rows = await db.execute<Record<string, unknown>>(sql`SELECT * FROM ${from} AS ${cols} WHERE ${where} ORDER BY ts DESC, seq DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`);
  let total = rows.rows.length + offset;
  let totalCapped = false;
  if (withTotal) {
    const t = await db.execute<{ n: string }>(sql`SELECT count(*)::bigint AS n FROM (SELECT 1 FROM ${from} AS ${cols} WHERE ${where} LIMIT ${AUDIT_COUNT_CAP + 1}) c`);
    const n = Number(t.rows[0]?.n ?? 0);
    totalCapped = n > AUDIT_COUNT_CAP;
    // Past the cap, report at least one more page while pages come back full, so paging still works.
    total = totalCapped ? Math.max(AUDIT_COUNT_CAP, offset + rows.rows.length + (rows.rows.length === limit ? 1 : 0)) : n;
  }
  return { entries: rows.rows.map(toEntry), total, totalCapped };
}

export interface AuditCursor { ts: string; id: string }

/**
 * One export page after `after` (keyset on time and id, newest first), so
 * entries written while the export runs neither shift pages nor repeat rows.
 */
export async function exportAuditPage(f: AuditFilters, scope: AuditScope | null, limit: number, after: AuditCursor | null): Promise<{ entries: AuditListEntry[]; next: AuditCursor | null }> {
  const cols = sql.raw(`x(${COLUMN_NAMES.join(", ")})`);
  const where = whereOf(f, scope);
  const from = fromOf(f, scope);
  const keyset = after ? sql` AND (ts < ${after.ts}::timestamptz OR (ts = ${after.ts}::timestamptz AND id < ${after.id}))` : sql``;
  const rows = await db.execute<Record<string, unknown>>(sql`SELECT *, to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
    FROM ${from} AS ${cols} WHERE ${where}${keyset} ORDER BY ts DESC, id DESC LIMIT ${limit}`);
  const last = rows.rows[rows.rows.length - 1];
  return { entries: rows.rows.map(toEntry), next: last ? { ts: String(last.cursor_ts), id: String(last.id) } : null };
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
