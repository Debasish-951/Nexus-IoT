/**
 * One-time remap: children share the parent/root device.
 *
 * - Clears `identifier` (device id) on every child asset (parentId != null).
 * - Removes stale rows from the seen_devices registry whose deviceId no longer
 *   matches any root asset's identifier, so "Connected Devices" reflects the
 *   real device count.
 *
 * Run after applying the nullable-identifier schema change:
 *   pnpm --filter @workspace/db run push-force
 *   pnpm --filter @workspace/db run remap-children
 */
import "dotenv/config";
import { sql, isNotNull, inArray } from "drizzle-orm";
import { db, pool, assetsTable, seenDevicesTable } from "./index.js";

async function main() {
  const children = await db
    .update(assetsTable)
    .set({ identifier: null })
    .where(sql`${assetsTable.parentId} IS NOT NULL`)
    .returning({ id: assetsTable.id });
  console.log(`  ✅  Cleared device id on ${children.length} child asset(s).`);

  const roots = await db
    .select({ identifier: assetsTable.identifier })
    .from(assetsTable)
    .where(isNotNull(assetsTable.identifier));
  const keep = new Set(roots.map((r) => r.identifier as string));

  const all = await db.select().from(seenDevicesTable);
  const stale = all.filter((d) => !keep.has(d.deviceId)).map((d) => d.deviceId);
  if (stale.length) {
    await db.delete(seenDevicesTable).where(inArray(seenDevicesTable.deviceId, stale));
  }
  console.log(`  ✅  Removed ${stale.length} stale seen-device(s): ${stale.join(", ") || "none"}`);
  console.log(`  🔌  Connected devices now = ${keep.size} (${[...keep].join(", ")})`);

  await pool.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
