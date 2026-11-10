import { sql } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";
import { assetSubtree } from "./asset-subtree";
import type { AssetScope } from "./project-access";

/**
 * Distinct metrics on one asset, walked through the (asset_id, metric, timestamp)
 * index. A plain DISTINCT reads every row, which takes seconds on 20 million rows.
 */
async function assetMetrics(assetId: string): Promise<string[]> {
  const rows = await db.execute<{ metric: string | null }>(sql`
    WITH RECURSIVE m AS (
      SELECT (SELECT t.metric FROM telemetry t WHERE t.asset_id = ${assetId} ORDER BY t.metric LIMIT 1) AS metric
      UNION ALL
      SELECT (SELECT t.metric FROM telemetry t
              WHERE t.asset_id = ${assetId} AND t.metric > m.metric ORDER BY t.metric LIMIT 1)
      FROM m WHERE m.metric IS NOT NULL
    )
    SELECT metric FROM m WHERE metric IS NOT NULL
  `);
  return rows.rows.map((r) => r.metric!);
}

const TAG_INDEX_TTL_MS = 60_000;
interface TagEntry { assetId: string; assetName: string; projectId: string; projectName: string; metric: string }
let tagIndex: { at: number; value: Promise<TagEntry[]> } | null = null;

async function buildTagIndex(): Promise<TagEntry[]> {
  const assets = await db.select({ id: assetsTable.id, name: assetsTable.name, parentId: assetsTable.parentId }).from(assetsTable);
  const out: TagEntry[] = [];
  for (const root of assets.filter((a) => !a.parentId)) {
    for (const assetId of assetSubtree([root.id], assets)) {
      const assetName = assets.find((a) => a.id === assetId)?.name ?? "";
      for (const metric of await assetMetrics(assetId)) {
        out.push({ assetId, assetName, projectId: root.id, projectName: root.name, metric });
      }
    }
  }
  return out;
}

/** Every telemetry tag this user may combine, across their projects. */
export async function tagsForViewer(scope: AssetScope | null): Promise<TagEntry[]> {
  if (!tagIndex || Date.now() - tagIndex.at >= TAG_INDEX_TTL_MS) {
    const value = buildTagIndex();
    tagIndex = { at: Date.now(), value };
    value.catch(() => { tagIndex = null; });
  }
  const all = await tagIndex.value;
  return scope ? all.filter((t) => scope.assetIds.has(t.assetId)) : all;
}
