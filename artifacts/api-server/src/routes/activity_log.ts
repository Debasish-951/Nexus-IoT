import { Router, type IRouter } from "express";
import type { Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, auditAlertsTable } from "@workspace/db";
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

router.get("/activity-log", async (req, res): Promise<void> => {
  const f = parseAuditFilters(req.query as Record<string, unknown>);
  if (typeof f === "string") { res.status(400).json({ error: f, code: "invalid_query" }); return; }
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

router.get("/activity-log/verify", async (req, res): Promise<void> => {
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

router.get("/activity-log/alerts", async (_req, res): Promise<void> => {
  const rows = await db.select().from(auditAlertsTable).where(eq(auditAlertsTable.status, "active")).orderBy(desc(auditAlertsTable.raisedAt)).limit(100);
  res.json(rows);
});

router.post("/activity-log/alerts/:id/acknowledge", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  const by = req.principal?.user.username ?? "unknown";
  const [row] = await db.update(auditAlertsTable).set({ status: "acknowledged", acknowledgedBy: by, acknowledgedAt: new Date() })
    .where(and(eq(auditAlertsTable.id, id), eq(auditAlertsTable.status, "active"))).returning();
  if (!row) { res.status(404).json({ error: "Alert not found or already acknowledged." }); return; }
  await logActivity("audit.alert_acknowledged", "activity_log", row.id, row.title, row.message.slice(0, 200), req);
  res.json(row);
});

router.get("/activity-log/settings", async (_req, res): Promise<void> => {
  const s = await getAuditSettings();
  const env = envAuditDays();
  res.json({
    retentionDays: s.retentionDays, effectiveRetentionDays: await auditRetentionDays(env), defaultRetentionDays: env,
    minimumRetentionDays: AUDIT_MIN_RETENTION_DAYS,
    alerts: SENSITIVE_RULE_KEYS.map((k) => ({ key: k, title: SENSITIVE_RULES[k].title, severity: SENSITIVE_RULES[k].severity, enabled: s.alerts[k] ?? true })),
    checkpoint: await getCheckpoint(),
  });
});

router.put("/activity-log/settings", validate({ body: AuditSettingsUpdate }), async (req, res): Promise<void> => {
  const before = await getAuditSettings();
  const after = await saveAuditSettings(req.body);
  const changes: AuditChange[] = [];
  if (before.retentionDays !== after.retentionDays) changes.push({ field: "retentionDays", from: before.retentionDays, to: after.retentionDays });
  for (const k of SENSITIVE_RULE_KEYS) {
    const a = before.alerts[k] ?? true, b = after.alerts[k] ?? true;
    if (a !== b) changes.push({ field: `alerts.${k}`, from: a, to: b });
  }
  await logActivity("audit.settings_updated", "activity_log", null, "Audit log settings", null, req, { changes });
  res.json(after);
});

export { raiseAuditAlert };
export default router;
