/**
 * Pure audit-log logic: field diffs with secret redaction, the hash chain, the
 * decision whether a request needs a generic entry from the safety net, and the
 * sensitive-action rules. No database or Express imports, so it is unit-tested
 * directly (tests/audit.test.ts).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// ── Field diffs ──────────────────────────────────────────────────────────────

export interface AuditChange { field: string; from: unknown; to: unknown }

export const REDACTED = "[redacted]";

/** Field names whose values are never written to the audit log. */
const SECRET_NAME = /pass(word|phrase)?|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credential|auth(orization)?[-_]?header|^authorization$|^headers$|hash$|salt|signing|cookie|session[-_]?id|^otp|mfa[-_]?seed|totp/i;

export function isSecretField(name: string): boolean { return SECRET_NAME.test(name); }

/** Fields that change on every write and say nothing about the edit. */
const NOISE = new Set(["updatedAt", "updated_at", "createdAt", "created_at", "lastSeen", "lastLogin", "version"]);

const MAX_VALUE_CHARS = 500;

function clip(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v.length > MAX_VALUE_CHARS ? `${clipText(v, MAX_VALUE_CHARS)}…` : v;
  if (v && typeof v === "object") {
    const s = JSON.stringify(redactDeep(v));
    return s.length > MAX_VALUE_CHARS ? `${clipText(s, MAX_VALUE_CHARS)}…` : JSON.parse(s);
  }
  return v;
}

/** Copy of a JSON-ish value with secret-named keys (at any depth) replaced. */
export function redactDeep(v: unknown, depth = 0): unknown {
  if (depth > 6 || v == null || typeof v !== "object") return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = isSecretField(k) ? REDACTED : redactDeep(x, depth + 1);
  return out;
}

/** Hosts whose webhook URLs carry the secret in the path (Slack, Teams, Discord, Google Chat, Power Automate...). */
const WEBHOOK_HOST = /(^|\.)(hooks\.slack\.com|webhook\.office\.com|office\.com|office365\.com|discord(app)?\.com|chat\.googleapis\.com|logic\.azure\.com|powerplatform\.com|zapier\.com|ifttt\.com|pipedream\.net)$/i;

/** A path segment that looks like a token: long, and mixing letters and digits. */
function secretSegment(s: string): boolean {
  return s.length >= 16 && /^[A-Za-z0-9_\-.~=+%@]+$/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s);
}

/**
 * A URL with credentials, a query string or a token in its path can carry a
 * secret: keep the scheme, host and the harmless part of the path. Credentials
 * and the fragment are dropped, the query becomes "?…", token-like path
 * segments become "…", and on webhook hosts every segment after the first does.
 */
export function maskUrl(v: unknown): unknown {
  if (typeof v !== "string" || !v) return v;
  try {
    const u = new URL(v);
    const hook = WEBHOOK_HOST.test(u.hostname);
    const path = u.pathname.split("/").map((seg, i) => {
      let d = seg;
      try { d = decodeURIComponent(seg); } catch { /* keep as is */ }
      if (!d || d === "…") return d;
      return (hook ? i > 1 : secretSegment(d)) ? "…" : d;
    }).join("/");
    return `${u.protocol}//${u.host}${path}${u.search ? "?…" : ""}`;
  } catch { return v.length > 60 ? `${v.slice(0, 60)}…` : v; }
}

/** Every URL inside free text, masked as maskUrl does. */
export function redactUrlsInText(s: string): string {
  return s.replace(/\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>]+/gi, (m) => String(maskUrl(m)));
}

// ── Text normalisation ───────────────────────────────────────────────────────

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * The string without half surrogate pairs (from cutting an emoji in two, or
 * sent like that). PostgreSQL cannot store them: in jsonb the insert fails, in
 * text they come back as U+FFFD, so the stored entry no longer matched its hash.
 */
export function wellFormed(s: string): string {
  return s.replace(LONE_SURROGATE, "");
}

/** At most `max` UTF-16 units, never ending in half a surrogate pair. */
export function clipText(s: string, max: number): string {
  return wellFormed(s.length > max ? s.slice(0, max) : s);
}

/** A JSON-ish value with every string made well-formed and its URLs masked. */
export function sanitiseDeep(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return redactUrlsInText(wellFormed(v));
  if (depth > 8 || v == null || typeof v !== "object") return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => sanitiseDeep(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[wellFormed(k)] = sanitiseDeep(x, depth + 1);
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return new Date(a as Date).getTime() === new Date(b as Date).getTime();
  if (a && b && typeof a === "object") return canonical(a) === canonical(b);
  return (a ?? null) === (b ?? null);
}

/**
 * Field-level differences between two versions of a record. Only keys present
 * in `after` are compared (a partial update lists what it may change). Secret
 * fields show as "[redacted]" on both sides, but the change is still recorded.
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts: { only?: string[]; ignore?: string[] } = {},
): AuditChange[] {
  if (!after) return [];
  const b = before ?? {};
  const ignore = new Set([...(opts.ignore ?? []), ...NOISE]);
  const keys = opts.only ?? Object.keys(after);
  const out: AuditChange[] = [];
  for (const k of keys) {
    if (ignore.has(k) || !(k in after)) continue;
    const from = b[k], to = after[k];
    if (same(from, to)) continue;
    if (isSecretField(k)) out.push({ field: k, from: from == null ? null : REDACTED, to: to == null ? null : REDACTED });
    else if (/(url|endpoint|uri)$/i.test(k)) out.push({ field: k, from: maskUrl(from), to: maskUrl(to) });
    else out.push({ field: k, from: clip(from), to: clip(to) });
  }
  return out;
}

// ── Hash chain ───────────────────────────────────────────────────────────────

/** The fields an entry's hash covers, in their stored form. */
export interface HashedFields {
  id: string;
  action: string; category: string;
  actorName: string; actorRole: string; actorUsername: string | null; actorUserId: string | null;
  targetId: string | null; targetName: string | null; detail: string | null;
  changes: unknown; outcome: string;
  ip: string | null; userAgent: string | null; correlationId: string | null;
  assetId: string | null; projectId: string | null;
  timestamp: Date | string;
}

/** JSON with object keys sorted at every depth, so equal values always serialise the same. */
export function canonical(v: unknown): string {
  if (v === undefined) return "null";
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function hashFieldsOf(row: HashedFields): HashedFields {
  return {
    id: row.id, action: row.action, category: row.category,
    actorName: row.actorName, actorRole: row.actorRole, actorUsername: row.actorUsername ?? null, actorUserId: row.actorUserId ?? null,
    targetId: row.targetId ?? null, targetName: row.targetName ?? null, detail: row.detail ?? null,
    changes: row.changes ?? null, outcome: row.outcome,
    ip: row.ip ?? null, userAgent: row.userAgent ?? null, correlationId: row.correlationId ?? null,
    assetId: row.assetId ?? null, projectId: row.projectId ?? null,
    // Millisecond precision: what JavaScript reads back from timestamptz.
    timestamp: new Date(row.timestamp).toISOString(),
  };
}

/** sha256(previous hash + canonical JSON of the entry). The first entry chains from "" or the last pruning checkpoint. */
export function entryHash(prevHash: string, row: HashedFields): string {
  return createHash("sha256").update(prevHash).update("\n").update(canonical(hashFieldsOf(row))).digest("hex");
}

/** `hash_alg` of entries keyed from SECRETS_ENC_KEY: "hmac-sha256:<key id>". Null = plain SHA-256 (older entries). */
export const HMAC_ALG_PREFIX = "hmac-sha256:";

/** Looks up a derived audit key by its id (null when that key is not loaded). */
export type AuditKeyLookup = (keyId: string) => Buffer | null;

/**
 * The hash of an entry under its algorithm: plain SHA-256 when `alg` is null
 * (so every existing entry still verifies), else HMAC-SHA256 over the
 * algorithm, the previous hash and the canonical entry. Null when the key is
 * not available.
 */
export function entryHashFor(prevHash: string, row: HashedFields, alg: string | null | undefined, keyFor: AuditKeyLookup): string | null {
  if (!alg) return entryHash(prevHash, row);
  if (!alg.startsWith(HMAC_ALG_PREFIX)) return null;
  const key = keyFor(alg.slice(HMAC_ALG_PREFIX.length));
  if (!key) return null;
  return createHmac("sha256", key).update(alg).update("\n").update(prevHash).update("\n").update(canonical(hashFieldsOf(row))).digest("hex");
}

/** "<key id>:<HMAC>" over a chain mark (checkpoint, anchor, keyed start, verified position). */
export function markMac(kind: string, seq: number, hash: string, key: { id: string; key: Buffer }): string {
  return `${key.id}:${createHmac("sha256", key.key).update(`audit-mark\n${kind}\n${seq}\n${hash}`).digest("hex")}`;
}

/** Whether a mark's MAC is valid: "unsigned" when it has none, "invalid" when it does not match or its key is missing. */
export function checkMarkMac(kind: string, seq: number, hash: string, mac: string | null | undefined, keyFor: AuditKeyLookup): "valid" | "invalid" | "unsigned" {
  if (!mac) return "unsigned";
  const i = mac.indexOf(":");
  if (i <= 0) return "invalid";
  const id = mac.slice(0, i);
  const key = keyFor(id);
  if (!key) return "invalid";
  const want = Buffer.from(markMac(kind, seq, hash, { id, key }));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got) ? "valid" : "invalid";
}

export interface ChainRow extends HashedFields { seq: number; prevHash: string | null; hash: string | null; hashAlg?: string | null }
export type ChainBreakReason =
  | "prev_mismatch" | "hash_mismatch" | "missing_hash"
  /** An entry without seq: it is outside the chain. */
  | "missing_seq"
  /** A plain SHA-256 entry after keyed hashing started. */
  | "downgrade"
  /** The key an entry was keyed with is not loaded. */
  | "key_missing"
  /** The pruning checkpoint's MAC does not match. */
  | "checkpoint_invalid"
  /** Entries recorded earlier as the chain head are gone. */
  | "head_rollback"
  /** The entry recorded as the chain head now has another hash. */
  | "anchor_mismatch";
export interface ChainBreak { id: string; seq: number; timestamp: string; reason: ChainBreakReason }

export interface VerifyOptions {
  keyFor?: AuditKeyLookup;
  /** A keyed entry was already seen (in an earlier batch, or before the starting point). */
  keyedSeen?: boolean;
  /** Entries after this seq must be keyed (the signed hmac_start mark). */
  keyedAfter?: number | null;
}

/**
 * Check rows in sequence order against the expected previous hash. Returns the
 * first break, or the last hash (and whether keyed entries were seen) to
 * continue from with the next batch. Once one keyed entry has been seen, a
 * plain SHA-256 entry after it is a break: anyone can compute those.
 */
export function verifyChain(rows: ChainRow[], startPrev: string, opts: VerifyOptions = {}): { ok: true; lastHash: string; keyedSeen: boolean } | { ok: false; broken: ChainBreak } {
  let prev = startPrev;
  let keyed = opts.keyedSeen ?? false;
  const keyFor = opts.keyFor ?? (() => null);
  for (const r of rows) {
    const at = new Date(r.timestamp).toISOString();
    const brk = (reason: ChainBreakReason) => ({ ok: false as const, broken: { id: r.id, seq: r.seq, timestamp: at, reason } });
    if (!r.hash) return brk("missing_hash");
    if ((r.prevHash ?? "") !== prev) return brk("prev_mismatch");
    if (!r.hashAlg && (keyed || (opts.keyedAfter != null && r.seq > opts.keyedAfter))) return brk("downgrade");
    const h = entryHashFor(prev, r, r.hashAlg, keyFor);
    if (h === null) return brk("key_missing");
    if (h !== r.hash) return brk("hash_mismatch");
    if (r.hashAlg) keyed = true;
    prev = r.hash;
  }
  return { ok: true, lastHash: prev, keyedSeen: keyed };
}

/**
 * Pruning: the seq and hash of the last entry in the longest run, from the
 * oldest, that is entirely older than the cutoff (rows in seq order). Null when
 * the oldest entry is still within the retention.
 */
export function pruneBoundary(rows: { seq: number | string; hash: string | null; ts: Date | string }[], cutoff: Date): { seq: number; hash: string; count: number } | null {
  let last: { seq: number; hash: string; count: number } | null = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!(new Date(r.ts).getTime() < cutoff.getTime())) break;
    last = { seq: Number(r.seq), hash: r.hash ?? "", count: i + 1 };
  }
  return last;
}

// ── Safety net ───────────────────────────────────────────────────────────────

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Endpoints the safety net never records: device ingest (very high volume),
 * POSTs that only read (twin values, AI chat which records itself), and sign-in
 * flows whose outcomes already go to security_events.
 */
const SKIP = [
  /^\/api\/ingest(\/|$)/, /^\/api\/v\d+\/ingest/, /^\/api\/telemetry\/ingest/, /^\/api\/devices\/[^/]+\/telemetry/,
  /^\/api\/plant-twins\/values$/, /^\/api\/ai\/chat$/, /^\/api\/ws(\/|$)/,
  /^\/api\/assets\/live-summary\/?$/, // Live Feed poll: a read sent as POST
  /^\/api\/auth\//, /^\/api\/csrf/, /^\/api\/client-errors?/, /^\/api\/health/,
  /^\/api\/telemetry\/query/, /^\/api\/telemetry\/batch/, /^\/api\/export\/query/,
  // POSTs that only read or preview: nothing changes, so a generic entry is noise.
  /^\/api\/system\/alerts\/check$/, /^\/api\/system\/retention\/preview$/, /^\/api\/system\/changes\/range-preview$/,
];

export type AuditOutcome = "success" | "failure" | "denied";

export function outcomeFor(status: number): AuditOutcome {
  if (status === 401 || status === 403) return "denied";
  return status >= 400 ? "failure" : "success";
}

/**
 * Whether a finished request needs a generic entry: a write under /api that no
 * route recorded itself. 401s are not recorded (no actor; the sign-in flow and
 * security_events cover them) and neither are rate-limit 429s (security_events).
 */
export function needsSafetyNetEntry(method: string, path: string, status: number, alreadyAudited: boolean): boolean {
  if (alreadyAudited) return false;
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  if (!path.startsWith("/api/")) return false;
  if (status === 401 || status === 429 || status === 404 || status === 304) return false;
  if (SKIP.some((re) => re.test(path))) return false;
  return true;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** "/api/alarm-rules/5f0c…/test" -> { pattern: "/api/alarm-rules/:id/test", id: "5f0c…", category: "alarm_rules" } */
export function describeRequest(path: string): { pattern: string; id: string | null; category: string } {
  const clean = path.split("?")[0]!.replace(/\/+$/, "");
  const id = clean.match(UUID)?.[0] ?? null;
  const pattern = clean.replace(new RegExp(UUID.source, "gi"), ":id").replace(/\/\d+(?=\/|$)/g, "/:n");
  const first = clean.replace(/^\/api\//, "").split("/")[0] ?? "system";
  return { pattern, id, category: first.replace(/-/g, "_") || "system" };
}

// ── Sensitive actions ────────────────────────────────────────────────────────

export const SENSITIVE_RULES = {
  alarm_rule_removed: { title: "Alarm rule deleted or disabled", severity: "high" },
  admin_granted: { title: "Administrator role granted", severity: "critical" },
  user_deleted: { title: "User deleted", severity: "high" },
  data_deleted: { title: "Data deleted", severity: "high" },
  secret_rotated: { title: "API client secret rotated", severity: "medium" },
  audit_verify_failed: { title: "Audit log integrity check failed", severity: "critical" },
  failed_signins: { title: "Repeated failed sign-ins", severity: "high" },
  audit_guard_missing: { title: "Audit log protection not installed", severity: "critical" },
} as const;

export type SensitiveRule = keyof typeof SENSITIVE_RULES;
export const SENSITIVE_RULE_KEYS = Object.keys(SENSITIVE_RULES) as SensitiveRule[];

const ADMIN_ROLES = new Set(["admin", "company_admin", "super_admin"]);

export interface MatchInput { action: string; changes?: AuditChange[] | null; detail?: string | null; outcome?: string }

/** The rule an entry matches, if any. Only successful actions raise alerts (except a failed verify). */
export function matchSensitive(e: MatchInput): SensitiveRule | null {
  if (e.action === "audit.verify_failed") return "audit_verify_failed";
  if ((e.outcome ?? "success") !== "success") return null;
  const a = e.action;
  if (a === "alarm_rule.deleted") return "alarm_rule_removed";
  if (a === "alarm_rule.updated" && (e.changes ?? []).some((c) => c.field === "enabled" && c.from === true && c.to === false)) return "alarm_rule_removed";
  if (a === "user.deleted") return "user_deleted";
  if (a === "user.updated" || a === "user.access_updated" || a === "user.invited") {
    const role = (e.changes ?? []).find((c) => c.field === "role");
    if (role && typeof role.to === "string" && ADMIN_ROLES.has(role.to) && !(typeof role.from === "string" && ADMIN_ROLES.has(role.from) && rank(role.from) >= rank(role.to))) return "admin_granted";
  }
  if (a === "data_change.range_deleted" || a === "archive.deleted") return "data_deleted";
  if (a === "retention.run" && /deleted[^0-9]*[1-9]/i.test(e.detail ?? "")) return "data_deleted";
  if (a === "api_client.secret_rotated") return "secret_rotated";
  return null;
}

function rank(role: string): number { return role === "super_admin" ? 3 : role === "company_admin" ? 2 : role === "admin" ? 1 : 0; }

export const FAILED_SIGNIN_THRESHOLD = 5;
export const FAILED_SIGNIN_WINDOW_MS = 10 * 60_000;

/** Effective audit retention: 0 keeps for ever; anything else is at least 365 days. */
export const AUDIT_MIN_RETENTION_DAYS = 365;
export function effectiveAuditRetention(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.max(AUDIT_MIN_RETENTION_DAYS, Math.floor(days));
}

// ── Project scope ────────────────────────────────────────────────────────────

/**
 * The one rule for project-restricted users, applied by the Audit Log search
 * (audit-store.ts whereOf: target_id, asset_id, project_id) and by the live
 * feed (ws-broadcast.ts): an entry is theirs when its target, asset or project
 * is one of their assets. Anything else (users, brokers, API clients, security
 * events) is withheld.
 */
export const AUDIT_SCOPE_FIELDS = ["targetId", "assetId", "projectId"] as const;

export function auditEntryInScope(entry: unknown, allowed: Set<string>): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return AUDIT_SCOPE_FIELDS.some((k) => typeof e[k] === "string" && allowed.has(e[k] as string));
}

// ── Search filters ───────────────────────────────────────────────────────────

export interface AuditFilters {
  q?: string; from?: Date; to?: Date; actor?: string; action?: string; category?: string;
  outcome?: AuditOutcome; targetId?: string; assetId?: string; includeSecurity?: boolean;
}

const OUTCOMES = new Set(["success", "failure", "denied"]);

/** Query-string values to filters; returns an error message for a bad value. */
export function parseAuditFilters(q: Record<string, unknown>): AuditFilters | string {
  const str = (k: string, max = 200): string | undefined => {
    const v = q[k];
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t ? t.slice(0, max) : undefined;
  };
  const date = (k: string): Date | undefined | null => {
    const v = str(k, 40);
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const from = date("from"), to = date("to");
  if (from === null) return "\"from\" is not a valid date.";
  if (to === null) return "\"to\" is not a valid date.";
  if (from && to && from > to) return "\"from\" must be earlier than \"to\".";
  const outcome = str("outcome", 16);
  if (outcome && !OUTCOMES.has(outcome)) return "\"outcome\" must be success, failure or denied.";
  const legacyActor = str("actorName");
  const inc = str("includeSecurity", 8);
  return {
    q: str("q"), from, to, actor: str("actor") ?? legacyActor, action: str("action", 100), category: str("category", 64),
    outcome: outcome as AuditOutcome | undefined, targetId: str("targetId", 100), assetId: str("assetId", 100),
    includeSecurity: inc === "true" || inc === "1",
  };
}
