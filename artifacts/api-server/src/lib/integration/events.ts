import { eq } from "drizzle-orm";
import { db, assetsTable, destinationsTable, integrationEventsTable, destinationDeliveriesTable } from "@workspace/db";
import { logger } from "../logger";

/**
 * Integration events (the outbox).
 *
 * Callers emit a business event; it is stored once in integration_events and a
 * delivery row is queued for every destination in "queued" mode that subscribes
 * to it. The delivery worker (services/delivery-worker.ts) does the sending.
 *
 * Destinations still in the original "direct" mode are NOT touched here: they
 * keep receiving alarm events through forwardToDestinations exactly as before.
 *
 * emitIntegrationEvent never throws and never blocks its caller on failure: an
 * outbox problem (for example the tables not pushed yet) must not break ingest,
 * alarm acknowledgement or asset edits.
 */

export const EVENT_TYPES = [
  { id: "alarm.triggered",    group: "alarm",     label: "Alarm raised" },
  { id: "alarm.cleared",      group: "alarm",     label: "Alarm cleared" },
  { id: "alarm.acknowledged", group: "alarm",     label: "Alarm acknowledged" },
  { id: "asset.created",      group: "asset",     label: "Asset created" },
  { id: "asset.updated",      group: "asset",     label: "Asset updated" },
  { id: "asset.deleted",      group: "asset",     label: "Asset deleted" },
  { id: "asset.maintenance",  group: "asset",     label: "Maintenance mode changed" },
  { id: "asset.attributes",   group: "asset",     label: "Attribute values set through the API" },
  { id: "connector.error",    group: "connector", label: "Pull connector failed" },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]["id"];

/**
 * Whether a destination's eventTypes list subscribes to `type`.
 * "alarm" (the original value) matches every alarm.* event, so a destination
 * created on the old page keeps getting alarms after switching to queued mode.
 * "*" matches everything.
 */
export function subscribes(eventTypes: readonly string[] | null | undefined, type: string): boolean {
  const list = eventTypes ?? [];
  if (list.includes("*") || list.includes(type)) return true;
  const group = type.split(".")[0]!;
  return list.includes(group);
}

// ── Project lookup (root asset of an asset), cached briefly ──────────────────
let parentCache: { at: number; parents: Map<string, string | null> } | null = null;

async function parents(): Promise<Map<string, string | null>> {
  if (parentCache && Date.now() - parentCache.at < 60_000) return parentCache.parents;
  const rows = await db.select({ id: assetsTable.id, parentId: assetsTable.parentId }).from(assetsTable);
  const map = new Map(rows.map((r) => [r.id, r.parentId]));
  parentCache = { at: Date.now(), parents: map };
  return map;
}

export function forgetAssetTree(): void { parentCache = null; }

/** The project (root asset) that owns `assetId`, or null when unknown. */
export async function projectOf(assetId: string | null | undefined): Promise<string | null> {
  if (!assetId) return null;
  let map = await parents();
  if (!map.has(assetId)) { parentCache = null; map = await parents(); }
  if (!map.has(assetId)) return null;
  let current = assetId;
  for (let i = 0; i < 64; i++) {
    const parent = map.get(current);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

let lastFailureLog = 0;

export interface EmitInput {
  assetId?: string | null;
  /** Pass when known (for example a deleted asset no longer in the tree). */
  projectId?: string | null;
  payload: Record<string, unknown>;
}

/** Store an event and queue it for subscribed destinations. Never throws. */
export async function emitIntegrationEvent(type: EventType, input: EmitInput): Promise<number | null> {
  try {
    const projectId = input.projectId !== undefined ? input.projectId : await projectOf(input.assetId);
    const [event] = await db.insert(integrationEventsTable).values({
      type, assetId: input.assetId ?? null, projectId,
      payload: { type, ...input.payload },
    }).returning({ id: integrationEventsTable.id });
    if (!event) return null;

    const queued = await db.select({
      id: destinationsTable.id, eventTypes: destinationsTable.eventTypes, projectId: destinationsTable.projectId,
    }).from(destinationsTable)
      .where(eq(destinationsTable.deliveryMode, "queued"));
    const targets = queued.filter((d) => subscribes(d.eventTypes, type) && (!d.projectId || d.projectId === projectId));
    // Disabled destinations are skipped at send time, not here, so re-enabling
    // one does not resurrect a backlog it was never meant to have.
    if (targets.length > 0) {
      await db.insert(destinationDeliveriesTable).values(
        targets.map((d) => ({ eventId: event.id, destinationId: d.id, eventType: type })),
      );
    }
    return event.id;
  } catch (err) {
    const now = Date.now();
    if (now - lastFailureLog > 60_000) {
      lastFailureLog = now;
      logger.warn({ err: (err as Error).message, type },
        "Integration event not stored. If this is a new install step, run `pnpm --filter @workspace/db run push`.");
    }
    return null;
  }
}

/** Fire-and-forget form for request handlers. */
export function emitLater(type: EventType, input: EmitInput): void {
  void emitIntegrationEvent(type, input);
}
