/**
 * Storage and data-pipeline alerts.
 *
 * Every 10 minutes the conditions below are checked against the thresholds in
 * Data Management settings. A condition that becomes true raises one alert row
 * (system_alerts); while it stays true the row is updated; when it goes away the
 * row is cleared. Raised and cleared alerts are posted to the optional webhook,
 * written to the activity log, and announced over the WebSocket so the bell and
 * the page refresh. Email, SMS and WhatsApp delivery do not exist yet in the
 * platform; Notification Groups cannot receive these.
 */
import { db, pool, systemAlertsTable, backupRunsTable } from "@workspace/db";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getDataSettings, type DataSettings } from "../lib/data-settings";
import { broadcast } from "../lib/ws-broadcast";
import { logActivity } from "../routes/activity_log";
import { archiveError } from "./archive";
import { partitionError } from "./partitions";
import { safeFetch } from "../lib/outbound-url";

export interface AlertCondition { key: string; severity: "critical" | "high" | "medium"; title: string; message: string }

/** The storage figures the checks need; filled by routes/system.ts computeStorage(). */
export interface StorageFacts {
  disk: { freeBytes: number; totalBytes: number; daysUntilFull: number | null } | null;
  rollups: { enabled: boolean; watermark: Date | string | null };
  lastRun: { error: string | null; startedAt: Date | string } | null;
  perAsset: Array<{ assetName: string; newest: Date | string | null; deleted?: boolean }>;
}

const GB = 1024 ** 3;

/** Pure: which conditions hold. Exported for tests. */
export function conditionsFor(s: DataSettings, facts: StorageFacts, extra: {
  lastBackup: { status: string; startedAt: Date } | null; lastGoodBackup: Date | null;
  rejectionsLastHour: number; archiveError: string | null; now: Date;
  /** Last failed partition create/drop (services/partitions.ts), if any. */
  partitionError?: string | null;
}): AlertCondition[] {
  const out: AlertCondition[] = [];
  const a = s.alerts;
  const now = extra.now.getTime();
  if (facts.disk && a.diskFreePctBelow > 0) {
    const pct = (facts.disk.freeBytes / Math.max(1, facts.disk.totalBytes)) * 100;
    if (pct < a.diskFreePctBelow) {
      out.push({ key: "disk_low", severity: pct < a.diskFreePctBelow / 2 ? "critical" : "high", title: "Disk space low",
        message: `${pct.toFixed(1)}% free (${(facts.disk.freeBytes / GB).toFixed(1)} GB of ${(facts.disk.totalBytes / GB).toFixed(1)} GB). The alert level is ${a.diskFreePctBelow}%.` });
    }
  }
  if (facts.disk?.daysUntilFull != null && a.daysUntilFullBelow > 0 && facts.disk.daysUntilFull < a.daysUntilFullBelow) {
    out.push({ key: "disk_full_soon", severity: facts.disk.daysUntilFull < 7 ? "critical" : "high", title: "Disk expected to fill up",
      message: `At the current growth the disk is full in about ${facts.disk.daysUntilFull} days. Add or shorten a retention policy.` });
  }
  if (a.backupMaxAgeHours > 0) {
    if (!extra.lastBackup) {
      out.push({ key: "backup_missing", severity: "medium", title: "No backup reported",
        message: "No backup run has been recorded. Set up the backup script (docs/operations/backup-restore.md) so it reports here." });
    } else {
      if (extra.lastBackup.status !== "ok") {
        out.push({ key: "backup_failed", severity: "high", title: "Last backup failed", message: `The backup started ${extra.lastBackup.startedAt.toISOString()} failed.` });
      }
      const ageH = extra.lastGoodBackup ? (now - extra.lastGoodBackup.getTime()) / 3_600_000 : Infinity;
      if (ageH > a.backupMaxAgeHours) {
        out.push({ key: "backup_stale", severity: "high", title: "Backup out of date",
          message: extra.lastGoodBackup ? `The last good backup is ${Math.floor(ageH)} hours old (limit ${a.backupMaxAgeHours} h).` : "No successful backup has been recorded." });
      }
    }
  }
  if (facts.rollups.enabled && a.summariesBehindHours > 0) {
    const wm = facts.rollups.watermark ? new Date(facts.rollups.watermark).getTime() : null;
    const behind = wm === null ? Infinity : (now - wm) / 3_600_000;
    if (behind > a.summariesBehindHours + 1) {
      out.push({ key: "summaries_behind", severity: "medium", title: "Summaries are behind",
        message: wm === null ? "The summary job has not started." : `Summaries are ${Math.floor(behind)} hours behind. Pruning waits for them.` });
    }
  }
  if (facts.lastRun?.error && !/^telemetry: skipped|outside the pruning window/.test(facts.lastRun.error)) {
    out.push({ key: "pruning_failed", severity: "high", title: "Pruning run had a problem", message: facts.lastRun.error.slice(0, 500) });
  }
  if (a.rejectionsPerHourAbove > 0 && extra.rejectionsLastHour > a.rejectionsPerHourAbove) {
    out.push({ key: "ingest_rejections", severity: "medium", title: "Many ingest requests refused",
      message: `${extra.rejectionsLastHour} requests or messages were refused in the last hour (limit ${a.rejectionsPerHourAbove}). See Data health.` });
  }
  if (a.quietAssets) {
    const quietMs = s.health.quietMinutes * 60_000;
    const quiet = facts.perAsset.filter((p) => !p.deleted && p.newest && now - new Date(p.newest).getTime() > quietMs && now - new Date(p.newest).getTime() < 7 * 86_400_000);
    if (quiet.length) {
      out.push({ key: "assets_quiet", severity: "medium", title: `${quiet.length} asset(s) stopped sending`,
        message: `No readings for more than ${s.health.quietMinutes} minutes: ${quiet.slice(0, 5).map((q) => q.assetName).join(", ")}${quiet.length > 5 ? ", …" : ""}.` });
    }
  }
  if (extra.archiveError) {
    out.push({ key: "archive_failed", severity: "high", title: "Archiving failed", message: `${extra.archiveError.slice(0, 400)} Pruning waits until archiving works.` });
  }
  if (extra.partitionError) {
    out.push({ key: "partitions_failed", severity: "high", title: "Partition maintenance failed",
      message: `${extra.partitionError.slice(0, 400)} The database role may lack the right to create or drop partitions; see docs/operations/backup-restore.md. Expired months are pruned row by row meanwhile.` });
  }
  return out;
}

/** Post an alert to the Data Management webhook. Exported for tests. */
export async function notify(url: string | null, event: "raised" | "cleared", alert: { key: string; severity: string; title: string; message: string }): Promise<string | null> {
  if (!url) return null;
  try {
    // Same outbound guard as alarm webhooks and destinations: no private or
    // loopback targets (unless ALLOW_PRIVATE_WEBHOOK_TARGETS), redirects not followed.
    const r = await safeFetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "integrated-suite", event, ...alert, at: new Date().toISOString(), installation: process.env.AUTH_PUBLIC_URL ?? null }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.status >= 300 && r.status < 400) return `failed (${r.status}, redirect not followed)`;
    return r.ok ? `delivered (${r.status})` : `failed (${r.status})`;
  } catch (err) {
    return `failed (${err instanceof Error ? err.message : String(err)})`.slice(0, 200);
  }
}

let running = false;

/** Check every condition and raise/update/clear alerts. `computeFacts` comes from routes/system.ts. */
export async function evaluateAlerts(computeFacts: () => Promise<StorageFacts>): Promise<{ raised: string[]; cleared: string[] }> {
  if (running) return { raised: [], cleared: [] };
  running = true;
  try {
    const now = new Date();
    const [settings, facts, backups, rej] = await Promise.all([
      getDataSettings(),
      computeFacts(),
      db.select().from(backupRunsTable).orderBy(desc(backupRunsTable.startedAt)).limit(50),
      pool.query<{ n: string }>(`SELECT COALESCE(SUM(count), 0)::bigint AS n FROM ingest_rejections WHERE last_at >= now() - interval '1 hour'`),
    ]);
    const lastGood = backups.find((b) => b.status === "ok");
    const conds = conditionsFor(settings, facts, {
      lastBackup: backups[0] ? { status: backups[0].status, startedAt: backups[0].startedAt } : null,
      lastGoodBackup: lastGood ? lastGood.finishedAt ?? lastGood.startedAt : null,
      rejectionsLastHour: Number(rej.rows[0]?.n ?? 0),
      archiveError: settings.archive.enabled ? archiveError() : null,
      partitionError: partitionError()?.message ?? null,
      now,
    });
    const open = await db.select().from(systemAlertsTable).where(ne(systemAlertsTable.status, "cleared"));
    const openByKey = new Map(open.map((o) => [o.key, o]));
    const raised: string[] = [];
    const cleared: string[] = [];
    for (const c of conds) {
      const existing = openByKey.get(c.key);
      if (existing) {
        await db.update(systemAlertsTable).set({ message: c.message, title: c.title, severity: c.severity, updatedAt: now }).where(eq(systemAlertsTable.id, existing.id));
        continue;
      }
      const result = await notify(settings.alerts.webhookUrl, "raised", c);
      await db.insert(systemAlertsTable).values({ ...c, raisedAt: now, updatedAt: now, notifiedAt: result ? now : null, notifyResult: result });
      await logActivity("system_alert.raised", "system", null, c.title, c.message);
      raised.push(c.key);
    }
    const firing = new Set(conds.map((c) => c.key));
    const toClear = open.filter((o) => !firing.has(o.key));
    if (toClear.length) {
      await db.update(systemAlertsTable).set({ status: "cleared", clearedAt: now, updatedAt: now })
        .where(and(inArray(systemAlertsTable.id, toClear.map((o) => o.id)), ne(systemAlertsTable.status, "cleared")));
      for (const o of toClear) {
        const result = await notify(settings.alerts.webhookUrl, "cleared", o);
        if (result) await db.update(systemAlertsTable).set({ notifiedAt: now, notifyResult: result }).where(eq(systemAlertsTable.id, o.id));
        await logActivity("system_alert.cleared", "system", null, o.title, null);
        cleared.push(o.key);
      }
    }
    if (raised.length || cleared.length) broadcast("system_alerts", { changed: true }, { requireModule: "reports" });
    return { raised, cleared };
  } finally {
    running = false;
  }
}

export function startAlertJob(computeFacts: () => Promise<StorageFacts>): void {
  const tick = () => {
    evaluateAlerts(computeFacts)
      .then((r) => { if (r.raised.length || r.cleared.length) logger.info(r, "System alerts changed"); })
      .catch((e) => logger.warn({ err: e }, "System alert check failed"));
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 10 * 60_000);
}
