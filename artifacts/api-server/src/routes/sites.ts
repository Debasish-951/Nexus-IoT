import { Router, type IRouter } from "express";
import { inArray, sql } from "drizzle-orm";
import { db, assetsTable, attributesTable } from "@workspace/db";
import { assetScope } from "../lib/project-access";
import { buildSites } from "../lib/sites";

/**
 * GET /sites — every project the caller may open, with its map location, asset
 * count and newest data time. Read by the Live Twin map view and the Sites map
 * dashboard widget (ROUTE_RULES: Live Twin or Visualization read).
 *
 * Locations are written through the ordinary attribute endpoints (Asset write),
 * so this route only reads. Alarms are not included: the map asks /alarms
 * itself, which keeps them behind the Alarms permission.
 */
const router: IRouter = Router();

router.get("/sites", async (req, res): Promise<void> => {
  const scope = await assetScope(req);
  const assets = await db.select({
    id: assetsTable.id, name: assetsTable.name, parentId: assetsTable.parentId, maintenanceMode: assetsTable.maintenanceMode,
  }).from(assetsTable);
  const roots = assets.filter((a) => !a.parentId && (!scope || scope.roots.has(a.id))).map((a) => a.id);
  if (!roots.length) { res.json([]); return; }

  const attrs = await db.select({ id: attributesTable.id, assetId: attributesTable.assetId, name: attributesTable.name, value: attributesTable.value })
    .from(attributesTable)
    .where(sql`${inArray(attributesTable.assetId, roots)} AND lower(${attributesTable.name}) IN ('latitude', 'longitude', 'address')`);

  // One indexed row per device asset (idx_telemetry_asset_ts), as the dashboard's
  // stale-device check does; never a GROUP BY over the whole telemetry table.
  const last = await db.execute<{ id: string; ts: string | null }>(sql`
    SELECT a.id, ls.ts
    FROM assets a
    LEFT JOIN LATERAL (
      SELECT timestamp AS ts FROM telemetry WHERE asset_id = a.id ORDER BY timestamp DESC LIMIT 1
    ) ls ON true
    WHERE a.identifier IS NOT NULL
  `);

  res.json(buildSites(assets, attrs, last.rows.map((r) => ({ assetId: r.id, ts: r.ts })), scope ? scope.roots : null));
});

export default router;
