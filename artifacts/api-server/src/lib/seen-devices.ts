// Registry of deviceIds seen in incoming telemetry — recorded even when no asset
// matches. Backed by the seen_devices table so it survives restarts; an in-memory
// cache fronts it for fast synchronous reads (hasSeenDevice / listSeenDevices).
import { sql, eq, notInArray } from "drizzle-orm";
import { db, assetsTable, seenDevicesTable } from "@workspace/db";

export interface SeenDevice {
  deviceId: string;
  lastSeen: Date;
  count: number;
  matched: boolean; // has this deviceId ever matched an existing asset?
}

const seen = new Map<string, SeenDevice>();

export function recordDevice(deviceId: string, matched: boolean): void {
  if (!deviceId) return;
  const cur = seen.get(deviceId);
  if (cur) {
    cur.lastSeen = new Date();
    cur.count += 1;
    cur.matched = cur.matched || matched;
  } else {
    seen.set(deviceId, { deviceId, lastSeen: new Date(), count: 1, matched });
  }
  // Persist (fire-and-forget — telemetry path must not block on this).
  void db
    .insert(seenDevicesTable)
    .values({ deviceId, lastSeen: new Date(), count: 1, matched })
    .onConflictDoUpdate({
      target: seenDevicesTable.deviceId,
      set: {
        lastSeen: new Date(),
        count: sql`${seenDevicesTable.count} + 1`,
        matched: sql`${seenDevicesTable.matched} OR ${matched}`,
      },
    })
    .catch(() => {});
}

export function hasSeenDevice(deviceId: string): boolean {
  return seen.has(deviceId);
}

// Remove a single device id from the registry (memory + DB).
export async function removeSeenDevice(deviceId: string): Promise<void> {
  seen.delete(deviceId);
  try { await db.delete(seenDevicesTable).where(eq(seenDevicesTable.deviceId, deviceId)); } catch {}
}

// Prune every device id that no existing asset uses — clears stale/test ids
// while keeping ids that are actually bound to assets.
export async function pruneUnusedDevices(): Promise<number> {
  try {
    const assets = await db.select({ identifier: assetsTable.identifier }).from(assetsTable);
    const keep = new Set(assets.map((a) => a.identifier).filter(Boolean) as string[]);
    let removed = 0;
    for (const k of [...seen.keys()]) if (!keep.has(k)) { seen.delete(k); removed++; }
    const keepArr = [...keep];
    if (keepArr.length) await db.delete(seenDevicesTable).where(notInArray(seenDevicesTable.deviceId, keepArr));
    else await db.delete(seenDevicesTable);
    return removed;
  } catch { return 0; }
}

export function listSeenDevices(): SeenDevice[] {
  return [...seen.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
}

// On startup: load the persisted registry, then ensure every existing asset's
// identifier counts as a valid device (covers assets created before this table).
export async function loadSeenDevices(): Promise<number> {
  try {
    const rows = await db.select().from(seenDevicesTable);
    for (const r of rows) {
      seen.set(r.deviceId, { deviceId: r.deviceId, lastSeen: r.lastSeen, count: r.count, matched: r.matched });
    }
    const assets = await db.select({ identifier: assetsTable.identifier }).from(assetsTable);
    for (const a of assets) {
      if (a.identifier && !seen.has(a.identifier)) {
        seen.set(a.identifier, { deviceId: a.identifier, lastSeen: new Date(), count: 0, matched: true });
      }
    }
    return seen.size;
  } catch {
    return 0;
  }
}
