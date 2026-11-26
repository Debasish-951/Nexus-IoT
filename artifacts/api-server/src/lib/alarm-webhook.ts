import { and, eq, isNotNull, not, like } from "drizzle-orm";
import { db, alarmRulesTable } from "@workspace/db";
import { decryptSecret, encryptSecret, encryptionEnabled, isEncrypted } from "./secret-box";
import { logger } from "./logger";

/**
 * Alarm webhook URLs at rest and in logs (audit 23 Nov 2026, L-8).
 *
 * A Slack, Teams or similar incoming-webhook URL is a bearer credential: the
 * secret is in its path or query. It is stored with the same AES-256-GCM
 * envelope as destination tokens and MQTT passwords (lib/secret-box.ts), and
 * only its origin is ever written to the application log.
 *
 * Rows saved before this change hold the URL in clear. They keep working
 * (`openWebhookUrl` passes plaintext through), are encrypted on their next
 * save, and `encryptStoredWebhookUrls` converts them at start-up when a key is
 * configured. `rotate-secrets` covers the column as well.
 */

/** GCM additional data: binds the ciphertext to this column. */
export const ALARM_WEBHOOK_AAD = "alarm_rules.webhookUrl";

/** For storing. Unchanged (plaintext) when no SECRETS_ENC_KEY is configured. */
export function sealWebhookUrl(url: string | null | undefined): string | null {
  return encryptSecret(url, ALARM_WEBHOOK_AAD);
}

/** For using. Plaintext rows pass through; an unreadable envelope gives null. */
export function openWebhookUrl(stored: string | null | undefined): string | null {
  return decryptSecret(stored, ALARM_WEBHOOK_AAD);
}

/** A rule row with its webhook URL decrypted. */
export function withOpenWebhook<T extends { webhookUrl: string | null }>(rule: T): T {
  return rule.webhookUrl ? { ...rule, webhookUrl: openWebhookUrl(rule.webhookUrl) } : rule;
}

/** Scheme and host only, for logs: the path and query are where the secret is. */
export function redactUrlForLog(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/[redacted]`;
  } catch {
    return "[redacted]";
  }
}

/**
 * Encrypt any webhook URL still stored in clear. Idempotent and guarded: does
 * nothing without a key, skips rows already encrypted, and each update only
 * applies if the row still holds the value that was read (a concurrent edit
 * wins). Never throws; called non-blocking at start-up.
 */
export async function encryptStoredWebhookUrls(): Promise<number> {
  if (!encryptionEnabled()) return 0;
  try {
    const rows = await db.select({ id: alarmRulesTable.id, webhookUrl: alarmRulesTable.webhookUrl })
      .from(alarmRulesTable)
      .where(and(isNotNull(alarmRulesTable.webhookUrl), not(like(alarmRulesTable.webhookUrl, "enc:v1:%"))));
    let done = 0;
    for (const row of rows) {
      if (!row.webhookUrl || isEncrypted(row.webhookUrl)) continue;
      const sealed = sealWebhookUrl(row.webhookUrl);
      if (!sealed || sealed === row.webhookUrl) continue;
      await db.update(alarmRulesTable).set({ webhookUrl: sealed })
        .where(and(eq(alarmRulesTable.id, row.id), eq(alarmRulesTable.webhookUrl, row.webhookUrl)));
      done++;
    }
    if (done) logger.info({ count: done }, "encrypted stored alarm webhook URLs");
    return done;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "could not encrypt stored alarm webhook URLs; will retry at next start");
    return 0;
  }
}
