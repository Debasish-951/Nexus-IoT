import { apiFetch } from "@/lib/auth-api";
import { describeApiError, formatApiError } from "@/lib/validation";
import type { SceneDoc } from "./engine/types";

/**
 * Server storage for 3D plant twins (routes/plant_twins.ts in the API).
 * Every call goes through apiFetch so writes carry the CSRF header.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface PlantTwinSummary { id: string; name: string; kind?: "plant" | "machine" | "process" | "asset" | "folder"; projectId: string | null; machines: number; parentId?: string | null; forType?: string | null; updatedAt: string; canEdit: boolean }
export interface PlantTwin extends PlantTwinSummary { scene: Partial<SceneDoc> }
export interface PlantValue { assetId: string; metric: string; value: number | null; ts: string }

async function ok<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(formatApiError(await describeApiError(res)));
  return res.status === 204 ? (undefined as T) : res.json();
}

export const listPlantTwins = () => apiFetch(`${BASE}/api/plant-twins`).then((r) => ok<PlantTwinSummary[]>(r));
export const getPlantTwin = (id: string) => apiFetch(`${BASE}/api/plant-twins/${encodeURIComponent(id)}`).then((r) => ok<PlantTwin>(r));
export const createPlantTwin = (body: { id: string; name: string; projectId: string | null; scene: SceneDoc | Record<string, unknown> }) =>
  apiFetch(`${BASE}/api/plant-twins`, { method: "POST", body: JSON.stringify(body) }).then((r) => ok<PlantTwin>(r));
export const updatePlantTwin = (id: string, body: { name?: string; scene?: SceneDoc; parentId?: string | null }) =>
  apiFetch(`${BASE}/api/plant-twins/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }).then((r) => ok<PlantTwin>(r));
export const deletePlantTwin = (id: string) =>
  apiFetch(`${BASE}/api/plant-twins/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => ok<void>(r));
export const fetchPlantValues = (pairs: { assetId: string; metric: string }[]) =>
  apiFetch(`${BASE}/api/plant-twins/values`, { method: "POST", body: JSON.stringify({ pairs }) }).then((r) => ok<PlantValue[]>(r));
/** Every metric an asset has reported, for linking readings. */
export const fetchAssetMetrics = (assetId: string) =>
  apiFetch(`${BASE}/api/telemetry/${encodeURIComponent(assetId)}/metrics`).then((r) => (r.ok ? r.json() : [])).then((x) => (Array.isArray(x) ? (x as string[]) : []));
