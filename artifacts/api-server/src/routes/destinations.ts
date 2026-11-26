import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, destinationsTable } from "@workspace/db";
import { logActivity } from "./activity_log";
import { diffFields } from "../lib/audit-core";
import { z } from "zod";
import { checkOutboundUrl, assertSafeOutboundUrl, safeFetch, UnsafeUrlError } from "../lib/outbound-url";
import { validate } from "../middleware/validate";
import { logger } from "../lib/logger";
import { correlationIdOf } from "../lib/errors";
import { CreateDestinationBody, UpdateDestinationBody, IdParams } from "../schemas/common";
import { encryptSecret, decryptSecret } from "../lib/secret-box";
import { projectOf } from "../lib/integration/events";
import { signPayload, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../lib/integration/signing";

/**
 * Credential columns on this table, and the AAD context each is bound to.
 *
 * The context is part of the ciphertext's authentication, so a value lifted from
 * one column cannot be pasted into another and still decrypt.
 */
const SECRET_FIELDS = ["token", "secretKey", "basicPass"] as const;
const ctx = (field: string) => `destinations.${field}`;

/**
 * Strip credentials from anything returned to a client.
 *
 * This route used to `res.json(rows)` straight from `db.select()`, which sent
 * every destination's bearer token, HMAC signing key and basic-auth password to
 * any user who could open the Destinations page — including roles with read-only
 * access. The credentials were write-only by intent and readable by accident.
 *
 * The response now reports only WHETHER each credential is set, which is all the
 * UI needs to render "configured / not configured". A credential that has to be
 * changed is re-entered, never read back.
 */
function toClient(row: typeof destinationsTable.$inferSelect) {
  const { token: _t, secretKey: _s, basicPass: _b, ...safe } = row;
  return {
    ...safe,
    hasToken: !!row.token,
    hasSecretKey: !!row.secretKey,
    hasBasicPass: !!row.basicPass,
  };
}

/** Decrypt the credentials for a row that is about to be USED, never returned. */
export function withPlaintext(row: typeof destinationsTable.$inferSelect) {
  return {
    ...row,
    token: decryptSecret(row.token, ctx("token")),
    secretKey: decryptSecret(row.secretKey, ctx("secretKey")),
    basicPass: decryptSecret(row.basicPass, ctx("basicPass")),
  };
}

const router: IRouter = Router();

router.get("/destinations", async (req, res): Promise<void> => {
  const rows = await db.select().from(destinationsTable).orderBy(destinationsTable.name);
  res.json(rows.map(toClient));
});

router.post("/destinations", validate({ body: CreateDestinationBody }), async (req, res): Promise<void> => {
  // Types, lengths, the URL scheme and the auth-type allow-list are all settled
  // by the schema. The `String(...)` coercions that used to be here were doing
  // the opposite of validation: `String({})` is "[object Object]", so a wrong
  // type became a plausible-looking row rather than a 400.
  const body = req.body as z.infer<typeof CreateDestinationBody>;

  // Syntax is not the same question as reachability: this checks WHERE the
  // server would be sending the request — see lib/outbound-url.ts.
  const check = checkOutboundUrl(body.endpoint);
  if (!check.ok) { res.status(400).json({ error: check.error, code: "unsafe_url" }); return; }

  const [row] = await db.insert(destinationsTable).values({
    name: body.name,
    description: body.description ?? null,
    endpoint: body.endpoint,
    authType: body.authType,
    // Encrypted at rest. See lib/secret-box.ts — these must stay reversible
    // because the server presents them to the third party on every send.
    token: encryptSecret(body.token, ctx("token")),
    secretKey: encryptSecret(body.secretKey, ctx("secretKey")),
    apiKeyHeader: body.apiKeyHeader,
    basicUser: body.basicUser ?? null,
    basicPass: encryptSecret(body.basicPass, ctx("basicPass")),
    eventTypes: body.eventTypes,
    enabled: body.enabled,
  }).returning();
  void logActivity("destination.created", "destination", row.id, row.name, null, req);
  res.status(201).json(toClient(row));
});

router.put("/destinations/:id", validate({ params: IdParams, body: UpdateDestinationBody }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof IdParams>;
  const body = req.body as z.infer<typeof UpdateDestinationBody>;
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined)        updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description || null;
  if (body.endpoint !== undefined) {
    const check = checkOutboundUrl(body.endpoint);
    if (!check.ok) { res.status(400).json({ error: check.error, code: "unsafe_url" }); return; }
    updateData.endpoint = body.endpoint;
  }
  if (body.authType !== undefined)    updateData.authType = body.authType;
  // An omitted credential leaves the stored one alone; an explicit empty string
  // clears it. That distinction is what lets the UI edit a destination's name
  // without having to re-type its token — the form cannot read the token back,
  // so it must be able to leave it untouched.
  if (body.token !== undefined)       updateData.token = body.token ? encryptSecret(body.token, ctx("token")) : null;
  if (body.secretKey !== undefined)   updateData.secretKey = body.secretKey ? encryptSecret(body.secretKey, ctx("secretKey")) : null;
  if (body.apiKeyHeader !== undefined) updateData.apiKeyHeader = body.apiKeyHeader;
  if (body.basicUser !== undefined)   updateData.basicUser = body.basicUser || null;
  if (body.basicPass !== undefined)   updateData.basicPass = body.basicPass ? encryptSecret(body.basicPass, ctx("basicPass")) : null;
  if (body.eventTypes !== undefined)  updateData.eventTypes = body.eventTypes;
  if (body.enabled !== undefined)     updateData.enabled = body.enabled;
  const [before] = await db.select().from(destinationsTable).where(eq(destinationsTable.id, id));
  const [row] = await db.update(destinationsTable).set(updateData).where(eq(destinationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  void logActivity("destination.updated", "destination", row.id, row.name, null, req,
    { changes: diffFields(before as unknown as Record<string, unknown>, row as unknown as Record<string, unknown>, { only: Object.keys(updateData) }) });
  res.json(toClient(row));
});

router.delete("/destinations/:id", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof IdParams>;
  const [row] = await db.delete(destinationsTable).where(eq(destinationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  void logActivity("destination.deleted", "destination", row.id, row.name, null, req);
  res.sendStatus(204);
});

// Test-fire to a destination
router.post("/destinations/:id/test", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [row] = await db.select().from(destinationsTable).where(eq(destinationsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  // Decrypted here and used immediately. `dest` never reaches a response.
  const dest = withPlaintext(row);
  try {
    // Re-checked at call time so a destination stored before this guard
    // existed cannot be used to probe the internal network either.
    assertSafeOutboundUrl(dest.endpoint);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as UnsafeUrlError).message, code: "unsafe_url" });
    return;
  }
  try {
    const headers = authHeaders(dest);
    const resp = await safeFetch(dest.endpoint, {
      method: "POST", headers,
      body: JSON.stringify({ event: "test", source: "iot-platform", timestamp: new Date().toISOString(), destinationId: dest.id }),
      signal: AbortSignal.timeout(6000),
    });
    void logActivity("destination.tested", "destination", row.id, row.name, `test event answered ${resp.status}`, req, { outcome: resp.ok ? "success" : "failure" });
    res.json({ success: resp.ok, statusCode: resp.status });
  } catch (err) {
    // A fetch failure carries the resolved host and the OS error
    // (`ECONNREFUSED 10.0.0.5:8080`). Useful in the log, a network map in a
    // response — so the caller is told only that the send failed.
    logger.warn({ destinationId: id, err }, "destination test-fire failed");
    void logActivity("destination.tested", "destination", row.id, row.name, "the destination could not be reached", req, { outcome: "failure" });
    res.status(502).json({
      success: false,
      error: "The destination could not be reached.",
      code: "destination_unreachable",
      correlationId: correlationIdOf(req),
    });
  }
});

// ── Forward event to all matching destinations ─────────────────────────────

/** Headers for a destination's auth type. `apikey` is the legacy spelling of `api_key`. */
export function authHeaders(dest: ReturnType<typeof withPlaintext>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authType = dest.authType === "apikey" ? "api_key" : dest.authType;
  if (authType === "bearer" && dest.token)     headers["Authorization"] = `Bearer ${dest.token}`;
  if (authType === "api_key" && dest.token)    headers[dest.apiKeyHeader ?? "X-API-Key"] = dest.token;
  if (authType === "basic" && dest.basicUser)  headers["Authorization"] = `Basic ${Buffer.from(`${dest.basicUser}:${dest.basicPass ?? ""}`).toString("base64")}`;
  return headers;
}

/** Record a delivery outcome. Awaited inside a caught chain, so it actually runs. */
async function recordOutcome(destId: string, set: Record<string, unknown>): Promise<void> {
  try {
    await db.update(destinationsTable).set(set).where(eq(destinationsTable.id, destId));
  } catch (err) {
    logger.warn({ destinationId: destId, err }, "could not record destination delivery outcome");
  }
}

/**
 * Send an event to every enabled destination subscribed to its type.
 *
 * Called fire-and-forget from ingest for alarm triggered/cleared events. It
 * never throws: a failing destination, or the database being unavailable, must
 * not stall or fail ingest.
 *
 * Destinations have no project column, so every destination receives alarms
 * from every project.
 */
export async function forwardToDestinations(eventType: "alarm" | "telemetry", payload: Record<string, unknown>): Promise<void> {
  let destinations: (typeof destinationsTable.$inferSelect)[];
  try {
    destinations = await db.select().from(destinationsTable)
      .where(eq(destinationsTable.enabled, true));
  } catch (err) {
    logger.warn({ err }, "could not load destinations; event not forwarded");
    return;
  }
  // Destinations switched to "queued" delivery get their events from the outbox
  // (lib/integration/events.ts) with retries, so they are skipped here to avoid
  // sending twice. Old rows default to "direct" and are unaffected.
  destinations = destinations.filter((d) => d.deliveryMode !== "queued");
  const scoped = destinations.some((d) => d.projectId);
  const eventProject = scoped ? await projectOf(typeof payload.assetId === "string" ? payload.assetId : null).catch(() => null) : null;
  await Promise.all(destinations.map(async (stored) => {
    if (!(stored.eventTypes ?? []).includes(eventType)) return;
    if (stored.projectId && stored.projectId !== eventProject) return;
    let dest: ReturnType<typeof withPlaintext>;
    try {
      // Decrypted per send, at the moment the header is built, and never held
      // beyond this call.
      dest = withPlaintext(stored);
    } catch (err) {
      await recordOutcome(stored.id, { lastError: "Stored credential could not be decrypted" });
      return;
    }
    // Checked per send, not just on save: a row edited directly in the
    // database must not become an outbound request to a private address.
    // The reason is written to `lastError`, so it shows on the Destinations
    // page instead of the destination just appearing to never fire. (This
    // update used to be built and discarded without running.)
    const safe = checkOutboundUrl(dest.endpoint);
    if (!safe.ok) {
      await recordOutcome(dest.id, { lastError: safe.error });
      return;
    }
    try {
      const body = JSON.stringify({ event: eventType, ...payload });
      const headers = authHeaders(dest);
      if (stored.signatureEnabled && dest.secretKey) {
        const ts = Math.floor(Date.now() / 1000);
        headers[TIMESTAMP_HEADER] = String(ts);
        headers[SIGNATURE_HEADER] = signPayload(dest.secretKey, ts, body);
      }
      const r = await safeFetch(dest.endpoint, {
        method: "POST", headers,
        body,
        signal: AbortSignal.timeout(6000),
      });
      await recordOutcome(dest.id, {
        lastSentAt: new Date(), lastError: r.ok ? null : `HTTP ${r.status}`,
        sendCount: sql`${destinationsTable.sendCount} + 1`,
      });
    } catch (err) {
      await recordOutcome(dest.id, { lastError: (err as Error)?.message ?? "Delivery failed" });
    }
  }));
}

export default router;
