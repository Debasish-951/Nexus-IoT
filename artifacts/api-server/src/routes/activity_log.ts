import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, auditAlertsTable, activityLogsTable, jobStateTable } from "@workspace/db";
import { hasPermission } from "../lib/rbac";
import { recordSecurityEvent } from "../lib/security-log";
import { planAlertChanges, secondAdminRequired, PENDING_TTL_MS, type PendingDisable } from "../lib/audit-two-person";
import { validate } from "../middleware/validate";
import { assetScope } from "../lib/project-access";
import { parseAuditFilters, SENSITIVE_RULES, SENSITIVE_RULE_KEYS, AUDIT_MIN_RETENTION_DAYS, type AuditOutcome, type AuditChange } from "../lib/audit-core";
import {
  recordAudit, listAudit, exportAuditPage, auditSummary, verifyAuditChain, raiseAuditAlert, getAuditSettings, saveAuditSettings,
  AuditSettingsUpdate, getCheckpoint, auditRetentionDays, type AuditOptions, type AuditCursor,
} from "../lib/audit-store";
import { csvCell } from "../lib/validation";
import { logger } from "../lib/logger";

const toCsv = (head: string[] | null, rows: unknown[][]): string =>
  [...(head ? [head] : []), ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + (head || rows.length ? "\r\n" : "");

/** RETENTION_ACTIVITY_LOG_DAYS, as routes/system.ts reads it (default 365). */
function envAuditDays(): number {
  const raw = process.env.RETENTION_ACTIVITY_LOG_DAYS;
  const n = raw == null || raw.trim() === "" ? 365 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 365;
}

const router: IRouter = Router();

export type { AuditChange, AuditOutcome, AuditOptions };

/**
 * Write an audit entry. The actor, IP, device and request reference come from
 * the signed-in session on `req` (or the current request when `req` is not
 * passed). `opts` adds the field changes, the outcome and the asset. Never
 * throws.
 */
export async function logActivity(
  action: string,
  category: string,
  targetId: string | null,
  targetName: string | null,
  detail: string | null,
  req?: Request,
  opts?: AuditOptions,
): Promise<void> {
  await recordAudit({ action, category, targetId, targetName, detail }, req, opts ?? {});
}

async function scopeOf(req: Request) {
  const s = await assetScope(req);
  return s ? { assetIds: s.assetIds } : null;
}

/**
 * Security events (typed usernames, source IPs, refusals) are the Security
 * Center's data, not the Audit Log module's (M-3): `includeSecurity=true` needs
 * `manage_security`, the same rule as the live `security_event` channel.
 */
function refuseSecurityEvents(req: Request, res: Response, includeSecurity: boolean | undefined): boolean {
  const access = req.principal?.access;
  if (!includeSecurity || !access || hasPermission(access, "manage_security")) return false;
  recordSecurityEvent({
    type: "authz.denied", outcome: "failure", reason: "audit_security_events_forbidden",
    userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null,
    detail: { path: req.path }, req,
  });
  res.status(403).json({ error: "Security events need the Manage security permission.", code: "manage_security_required" });
  return true;
}

router.get("/activity-log", async (req, res): Promise<void> => {
  const f = parseAuditFilters(req.query as Record<string, unknown>);
  if (typeof f === "string") { res.status(400).json({ error: f, code: "invalid_query" }); return; }
  if (refuseSecurityEvents(req, res, f.includeSecurity)) return;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 50) || 50));
  const offset = Math.min(1_000_000, Math.max(0, Number(req.query.offset ?? 0) || 0));
  // A project-restricted user sees only entries about assets in their projects,
  // the same rule the live feed applies (lib/ws-broadcast.ts). Entries about
  // users, brokers or API clients, and security events, are withheld from them.
  const scope = await scopeOf(req);
  if (scope && scope.assetIds.size === 0) { res.json({ entries: [], total: 0 }); return; }
  res.json(await listAudit(f, scope, limit, offset));
});

const EXPORT_MAX = 50_000;

router.get("/activity-log/export", async (req, res): Promise<void> => {
  const f = parseAuditFilters(req.query as Record<string, unknown>);
  if (typeof f === "string") { res.status(400).json({ error: f, code: "invalid_query" }); return; }
  if (refuseSecurityEvents(req, res, f.includeSecurity)) return;
  const scope = await scopeOf(req);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  const head = ["Time", "Source", "Action", "Category", "Outcome", "Actor", "Role", "Username", "Target", "Target ID", "Detail", "Changes", "IP", "Device", "Request ID", "Project", "Hash"];
  res.write(`﻿${toCsv(head, [])}`);
  let written = 0;
  if (!(scope && scope.assetIds.size === 0)) {
    // Keyset pages: entries written during the export neither shift pages nor repeat rows.
    let cursor: AuditCursor | null = null;
    try {
    while (written < EXPORT_MAX) {
      const page = await exportAuditPage(f, scope, Math.min(2000, EXPORT_MAX - written), cursor);
      const entries = page.entries;
      if (!entries.length) break;
      cursor = page.next;
      res.write(toCsv(null, entries.map((e) => [
        e.timestamp, e.source, e.action, e.category, e.outcome, e.actorName, e.actorRole, e.actorUsername ?? "", e.targetName ?? "", e.targetId ?? "",
        e.detail ?? "", (e.changes ?? []).map((c) => `${c.field}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`).join("; "),
        e.ip ?? "", e.userAgent ?? "", e.correlationId ?? "", e.projectId ?? "", e.hash ?? "",
      ])));
      written += entries.length;
      if (entries.length < 2000) break;
    }
    } catch (err) {
      // The header row is already sent: abort the download so the browser reports a failure instead of saving a cut-off file.
      logger.error({ err }, "audit log: export failed");
      res.destroy(err instanceof Error ? err : new Error(String(err)));
      return;
    }
  }
  res.end();
  void logActivity("audit.exported", "activity_log", null, null, `${written} entries exported as CSV`, req);
});

router.get("/activity-log/summary", async (req, res): Promise<void> => {
  const tzRaw = typeof req.query.timeZone === "string" ? req.query.timeZone : "UTC";
  let timeZone = "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: tzRaw }); timeZone = tzRaw; } catch { /* default UTC */ }
  const scope = await scopeOf(req);
  res.json(await auditSummary(scope, timeZone));
});

// POST, not GET (L-9): the walk is costly and writes an entry, so a link or an
// image on another page must not be able to start it. GET is refused by authorize().
router.post("/activity-log/verify", async (req, res): Promise<void> => {
  // Incremental from the last signed check when a key is set; ?full=true walks the whole chain.
  const result = await verifyAuditChain({ full: req.query.full === "true" || req.query.full === "1" });
  if (!result.ok && result.broken) {
    await logActivity("audit.verify_failed", "activity_log", result.broken.id, null,
      `chain broken at entry #${result.broken.seq} (${result.broken.reason}) after ${result.checked} good entries`, req, { outcome: "failure" });
  } else {
    await logActivity("audit.verified", "activity_log", null, null, `${result.checked} entries verified${result.incremental ? ` (from entry #${result.fromSeq})` : ""}`, req);
  }
  res.json(result);
});

/** Who did the action behind each alert, by alert entry id (L-27). */
async function entryActors(entryIds: (string | null)[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(entryIds.filter((e): e is string => !!e && /^[0-9a-f-]{36}$/i.test(e)))];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: activityLogsTable.id, actor: activityLogsTable.actorUserId })
    .from(activityLogsTable).where(inArray(activityLogsTable.id, ids));
  return new Map(rows.map((r) => [r.id, r.actor]));
}

router.get("/activity-log/alerts", async (req, res): Promise<void> => {
  const rows = await db.select().from(auditAlertsTable).where(eq(auditAlertsTable.status, "active")).orderBy(desc(auditAlertsTable.raisedAt)).limit(100);
  const strict = secondAdminRequired();
  const actors = strict ? await entryActors(rows.map((r) => r.entryId)) : new Map<string, string | null>();
  const me = req.principal?.user.id ?? null;
  // `raisedBySelf`: the bell disables Acknowledge on these and says why.
  res.json(rows.map((r) => ({ ...r, raisedBySelf: strict && !!me && !!r.entryId && actors.get(r.entryId) === me })));
});

router.post("/activity-log/alerts/:id/acknowledge", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  const by = req.principal?.user.username ?? "unknown";
  // Nobody acknowledges the alert their own action raised (L-27).
  if (secondAdminRequired() && req.principal) {
    const [alert] = await db.select({ entryId: auditAlertsTable.entryId }).from(auditAlertsTable).where(eq(auditAlertsTable.id, id));
    const actor = alert?.entryId ? (await entryActors([alert.entryId])).get(alert.entryId) : null;
    if (actor && actor === req.principal.user.id) {
      recordSecurityEvent({
        type: "authz.denied", outcome: "failure", reason: "audit_alert_own_action",
        userId: req.principal.user.id, username: req.principal.user.username, detail: { alertId: id }, req,
      });
      res.status(403).json({ error: "This alert was raised by your own action. Another administrator must acknowledge it.", code: "own_action" });
      return;
    }
  }
  const [row] = await db.update(auditAlertsTable).set({ status: "acknowledged", acknowledgedBy: by, acknowledgedAt: new Date() })
    .where(and(eq(auditAlertsTable.id, id), eq(auditAlertsTable.status, "active"))).returning();
  if (!row) { res.status(404).json({ error: "Alert not found or already acknowledged." }); return; }
  await logActivity("audit.alert_acknowledged", "activity_log", row.id, row.title, row.message.slice(0, 200), req);
  res.json(row);
});

// Requests to switch an alert off that wait for a second administrator (L-27).
const PENDING_KEY = "audit_alert_disable_pending";

async function loadPending(): Promise<PendingDisable[]> {
  const [row] = await db.select({ value: jobStateTable.value }).from(jobStateTable).where(eq(jobStateTable.key, PENDING_KEY));
  const list = Array.isArray(row?.value) ? (row.value as PendingDisable[]) : [];
  return list.filter((p) => p && typeof p.rule === "string" && Date.now() - Date.parse(p.requestedAt) < PENDING_TTL_MS);
}

async function savePending(list: PendingDisable[]): Promise<void> {
  await db.insert(jobStateTable).values({ key: PENDING_KEY, value: list })
    .onConflictDoUpdate({ target: jobStateTable.key, set: { value: list, updatedAt: new Date() } });
}

router.get("/activity-log/settings", async (_req, res): Promise<void> => {
  const s = await getAuditSettings();
  const env = envAuditDays();
  const strict = secondAdminRequired();
  const pending = strict ? await loadPending() : [];
  res.json({
    retentionDays: s.retentionDays, effectiveRetentionDays: await auditRetentionDays(env), defaultRetentionDays: env,
    minimumRetentionDays: AUDIT_MIN_RETENTION_DAYS,
    alerts: SENSITIVE_RULE_KEYS.map((k) => {
      const p = pending.find((x) => x.rule === k);
      return { key: k, title: SENSITIVE_RULES[k].title, severity: SENSITIVE_RULES[k].severity, enabled: s.alerts[k] ?? true,
        pendingDisable: p ? { requestedBy: p.requestedBy, requestedAt: p.requestedAt } : null };
    }),
    secondAdminRequired: strict,
    checkpoint: await getCheckpoint(),
  });
});

router.put("/activity-log/settings", validate({ body: AuditSettingsUpdate }), async (req, res): Promise<void> => {
  const before = await getAuditSettings();
  // Switching an alert off needs a second administrator (L-27); switching on does not.
  let body = req.body as import("zod").infer<typeof AuditSettingsUpdate>;
  let waiting: string[] = [];
  if (secondAdminRequired() && body.alerts && req.principal) {
    const plan = planAlertChanges(before.alerts, body.alerts, await loadPending(),
      { id: req.principal.user.id, name: req.principal.user.fullName || req.principal.user.username });
    await savePending(plan.pending);
    waiting = plan.waiting;
    body = { ...body, alerts: plan.apply };
    if (waiting.length) {
      await logActivity("audit.alert_disable_requested", "activity_log", null, "Audit log settings",
        `waiting for a second administrator: ${waiting.join(", ")}`, req);
    }
  }
  const after = await saveAuditSettings(body);
  const changes: AuditChange[] = [];
  if (before.retentionDays !== after.retentionDays) changes.push({ field: "retentionDays", from: before.retentionDays, to: after.retentionDays });
  for (const k of SENSITIVE_RULE_KEYS) {
    const a = before.alerts[k] ?? true, b = after.alerts[k] ?? true;
    if (a !== b) changes.push({ field: `alerts.${k}`, from: a, to: b });
  }
  await logActivity("audit.settings_updated", "activity_log", null, "Audit log settings", null, req, { changes });
  res.json({ ...after, waitingForSecondAdmin: waiting });
});

export { raiseAuditAlert };
export default router;
