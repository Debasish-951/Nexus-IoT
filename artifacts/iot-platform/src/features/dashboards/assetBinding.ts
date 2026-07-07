import type { Asset } from "@/pages/assetShared";

// Walk up to the nearest ancestor (or self) that owns a device id — telemetry
// is stored on that asset. In the single-device model, machines/units have no
// telemetry of their own; their data lives on the root device owner.
export function deviceOwnerOf(assetId: string, assets: Asset[]): Asset | null {
  const byId = new Map(assets.map((a) => [a.id, a]));
  let cur: Asset | null = byId.get(assetId) ?? null;
  while (cur && !cur.identifier) cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null;
  return cur;
}

// Resolve the telemetry tags that belong to `assetId`. If it's the device owner,
// that's all its metrics; otherwise it's the owner's metrics whose key contains
// this asset's name (e.g. machine "Creel Machine" → "…Creel Machine.powerKW").
export async function resolveTags(assetId: string, assets: Asset[]): Promise<{ ownerId: string | null; tags: string[] }> {
  const owner = deviceOwnerOf(assetId, assets);
  if (!owner) return { ownerId: null, tags: [] };
  const metrics: string[] = await fetch(`/api/telemetry/${owner.id}/metrics`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const list = Array.isArray(metrics) ? metrics : [];
  if (owner.id === assetId) return { ownerId: owner.id, tags: list };
  const self = assets.find((a) => a.id === assetId);
  const needle = (self?.name ?? "").toLowerCase();
  const filtered = needle ? list.filter((m) => m.toLowerCase().includes(needle)) : list;
  return { ownerId: owner.id, tags: filtered.length ? filtered : list };
}
