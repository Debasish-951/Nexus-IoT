/**
 * Map view (Live Twin → Map view, Visualization → Sites map widget): one row per
 * project (root asset) with its location, size and how fresh its data is.
 *
 * Pure, so it is tested without a database. The route (routes/sites.ts) loads
 * the rows and narrows them to the caller's projects first.
 *
 * A site's location is kept as static attributes on the project's root asset,
 * named "Latitude", "Longitude" and optionally "Address" (any letter case), so
 * it is edited in Asset Hub like any other attribute and needs no extra table.
 */
export interface SiteAsset { id: string; name: string; parentId: string | null; maintenanceMode?: boolean | null }
export interface SiteAttr { assetId: string; name: string; value: unknown }
export interface SiteRow {
  projectId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  /** Attribute ids, so the map can update a location in place instead of adding a second one. */
  latitudeAttrId: string | null;
  longitudeAttrId: string | null;
  addressAttrId: string | null;
  assetCount: number;
  maintenanceCount: number;
  /** Newest telemetry from any asset in the project, ISO, or null if none ever reported. */
  lastDataAt: string | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** Root of an asset, walking parent links; null for a cycle or a dangling parent. */
function rootOf(id: string, byId: Map<string, SiteAsset>): string | null {
  let cur = byId.get(id);
  for (let i = 0; cur && i < 200; i++) {
    if (!cur.parentId) return cur.id;
    cur = byId.get(cur.parentId);
  }
  return null;
}

export function buildSites(
  assets: SiteAsset[],
  attrs: (SiteAttr & { id?: string })[],
  lastSeen: { assetId: string; ts: Date | string | null }[],
  /** Projects the caller may open; null = all. */
  roots: Set<string> | null,
): SiteRow[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const rows = new Map<string, SiteRow>();
  for (const a of assets) {
    if (a.parentId || (roots && !roots.has(a.id))) continue;
    rows.set(a.id, {
      projectId: a.id, name: a.name, latitude: null, longitude: null, address: null,
      latitudeAttrId: null, longitudeAttrId: null, addressAttrId: null,
      assetCount: 0, maintenanceCount: 0, lastDataAt: null,
    });
  }
  for (const a of assets) {
    const r = rootOf(a.id, byId);
    const row = r ? rows.get(r) : undefined;
    if (!row) continue;
    row.assetCount++;
    if (a.maintenanceMode) row.maintenanceCount++;
  }
  for (const at of attrs) {
    const row = rows.get(at.assetId);
    if (!row) continue;
    const n = at.name.trim().toLowerCase();
    if (n === "latitude") {
      const v = num(at.value);
      if (v !== null && v >= -90 && v <= 90) row.latitude = v;
      row.latitudeAttrId = at.id ?? null;
    } else if (n === "longitude") {
      const v = num(at.value);
      if (v !== null && v >= -180 && v <= 180) row.longitude = v;
      row.longitudeAttrId = at.id ?? null;
    } else if (n === "address") {
      row.address = at.value == null ? null : String(at.value).slice(0, 300);
      row.addressAttrId = at.id ?? null;
    }
  }
  for (const s of lastSeen) {
    if (!s.ts) continue;
    const r = rootOf(s.assetId, byId);
    const row = r ? rows.get(r) : undefined;
    if (!row) continue;
    const iso = new Date(s.ts).toISOString();
    if (!row.lastDataAt || iso > row.lastDataAt) row.lastDataAt = iso;
  }
  // A location needs both halves; one alone is not placeable.
  for (const row of rows.values()) {
    if (row.latitude === null || row.longitude === null) { row.latitude = null; row.longitude = null; }
  }
  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
}
