import { and, eq, inArray, lte, lt, sql } from "drizzle-orm";
import {
  db, destinationsTable, destinationDeliveriesTable, integrationEventsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { checkOutboundUrl, safeFetch } from "../lib/outbound-url";
import { authHeaders, withPlaintext } from "../routes/destinations";
import { signPayload, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../lib/integration/signing";

/**
 * Delivery worker for destinations in "queued" mode.
 *
 * Every few seconds it takes due deliveries, sends each with the destination's
 * auth headers (and an HMAC signature when enabled), and records the outcome.
 * A failure is retried with backoff; after the destination's maxAttempts the
 * delivery is parked as "dead" and waits for a manual Resend.
 *
 * Destinations in "direct" mode never get rows here, so this worker cannot
 * change how the original destinations behave.
 */

/** Wait before attempt n+1, in seconds: 30 s, 2 min, 10 min, 30 min, 2 h, 6 h, then 6 h. */
export const BACKOFF_SEC = [30, 120, 600, 1800, 7200, 21600];
export function backoffSeconds(attemptsSoFar: number): number {
  return BACKOFF_SEC[Math.min(Math.max(attemptsSoFar - 1, 0), BACKOFF_SEC.length - 1)]!;
}

const TICK_MS = 5_000;
const BATCH = 25;
let running = false;
let timer: NodeJS.Timeout | null = null;
let lastFailureLog = 0;

/** Outcome of one delivery, recorded on the row. */
async function settle(id: string, attempts: number, maxAttempts: number, ok: boolean, statusCode: number | null, error: string | null, durationMs: number): Promise<void> {
  if (ok) {
    await db.update(destinationDeliveriesTable).set({
      status: "delivered", attempts, lastStatusCode: statusCode, lastError: null, durationMs, deliveredAt: new Date(),
    }).where(eq(destinationDeliveriesTable.id, id));
    return;
  }
  const dead = attempts >= maxAttempts;
  await db.update(destinationDeliveriesTable).set({
    status: dead ? "dead" : "pending", attempts, lastStatusCode: statusCode, lastError: error?.slice(0, 500) ?? null, durationMs,
    nextAttemptAt: new Date(Date.now() + backoffSeconds(attempts) * 1000),
  }).where(eq(destinationDeliveriesTable.id, id));
}

export async function runDeliveryTick(): Promise<number> {
  const due = await db.select().from(destinationDeliveriesTable)
    .where(and(eq(destinationDeliveriesTable.status, "pending"), lte(destinationDeliveriesTable.nextAttemptAt, new Date())))
    .orderBy(destinationDeliveriesTable.nextAttemptAt)
    .limit(BATCH);
  if (due.length === 0) return 0;

  const destIds = [...new Set(due.map((d) => d.destinationId))];
  const eventIds = [...new Set(due.map((d) => d.eventId))];
  const [dests, events] = await Promise.all([
    db.select().from(destinationsTable).where(inArray(destinationsTable.id, destIds)),
    db.select().from(integrationEventsTable).where(inArray(integrationEventsTable.id, eventIds)),
  ]);
  const destById = new Map(dests.map((d) => [d.id, d]));
  const eventById = new Map(events.map((e) => [e.id, e]));

  await Promise.all(due.map(async (row) => {
    const stored = destById.get(row.destinationId);
    const event = eventById.get(row.eventId);
    const attempts = row.attempts + 1;
    if (!stored || !event) {
      await settle(row.id, attempts, 1, false, null, !stored ? "Destination was deleted" : "Event no longer exists", 0);
      return;
    }
    if (!stored.enabled) {
      // Paused, not failed: try again later without spending an attempt.
      await db.update(destinationDeliveriesTable).set({ nextAttemptAt: new Date(Date.now() + 60_000), lastError: "Destination is disabled" })
        .where(eq(destinationDeliveriesTable.id, row.id));
      return;
    }
    let dest: ReturnType<typeof withPlaintext>;
    try { dest = withPlaintext(stored); } catch {
      await settle(row.id, attempts, stored.maxAttempts, false, null, "Stored credential could not be decrypted", 0);
      return;
    }
    const safe = checkOutboundUrl(dest.endpoint);
    if (!safe.ok) { await settle(row.id, attempts, 1, false, null, safe.error, 0); return; }

    const body = JSON.stringify({
      id: row.id, event: event.type, eventId: event.id, attempt: attempts,
      createdAt: event.createdAt.toISOString(), projectId: event.projectId, assetId: event.assetId,
      data: event.payload,
    });
    const headers = authHeaders(dest);
    headers["X-Nexus-Event"] = event.type;
    headers["X-Nexus-Delivery"] = row.id;
    if (stored.signatureEnabled && dest.secretKey) {
      const ts = Math.floor(Date.now() / 1000);
      headers[TIMESTAMP_HEADER] = String(ts);
      headers[SIGNATURE_HEADER] = signPayload(dest.secretKey, ts, body);
    }
    const started = Date.now();
    try {
      const r = await safeFetch(dest.endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
      const ms = Date.now() - started;
      await settle(row.id, attempts, stored.maxAttempts, r.ok, r.status, r.ok ? null : `HTTP ${r.status}`, ms);
      await db.update(destinationsTable).set(r.ok
        ? { lastSentAt: new Date(), lastError: null, sendCount: sql`${destinationsTable.sendCount} + 1` }
        : { lastError: `HTTP ${r.status}` }).where(eq(destinationsTable.id, stored.id));
    } catch (err) {
      const msg = (err as Error)?.name === "TimeoutError" ? "Timed out after 10 s" : ((err as Error)?.message ?? "Delivery failed");
      await settle(row.id, attempts, stored.maxAttempts, false, null, msg, Date.now() - started);
      await db.update(destinationsTable).set({ lastError: msg.slice(0, 300) }).where(eq(destinationsTable.id, stored.id));
    }
  }));
  return due.length;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Drain a backlog quickly, but yield between batches.
    for (let i = 0; i < 8; i++) { if ((await runDeliveryTick()) < BATCH) break; }
  } catch (err) {
    const now = Date.now();
    if (now - lastFailureLog > 300_000) {
      lastFailureLog = now;
      logger.warn({ err: (err as Error).message }, "Delivery worker tick failed (run `pnpm --filter @workspace/db run push` if the integration tables are missing)");
    }
  } finally {
    running = false;
  }
}

export function startDeliveryWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref();
}

export function stopDeliveryWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Retention for the outbox and the delivery log (hourly from index.ts). */
export async function pruneIntegrationData(days = Number(process.env.INTEGRATION_LOG_RETENTION_DAYS ?? 30)): Promise<void> {
  const cutoff = new Date(Date.now() - Math.max(1, days) * 86_400_000);
  await db.delete(destinationDeliveriesTable).where(and(
    lt(destinationDeliveriesTable.createdAt, cutoff),
    inArray(destinationDeliveriesTable.status, ["delivered", "dead"]),
  ));
  // An event still referenced by a pending delivery is kept.
  await db.execute(sql`DELETE FROM integration_events e WHERE e.created_at < ${cutoff}
    AND NOT EXISTS (SELECT 1 FROM destination_deliveries d WHERE d.event_id = e.id AND d.status = 'pending')`);
}
