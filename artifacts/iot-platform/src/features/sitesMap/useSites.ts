import { useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSites, getListSitesQueryKey, useListAlarms, getListAlarmsQueryKey, useListAssets, getListAssetsQueryKey,
  createAssetAttribute, updateAttribute, listAssetAttributes, getListAssetAttributesQueryKey, type Site,
} from "@workspace/api-client-react";
import { useCurrentUser } from "@/contexts/UserContext";
import { useWsEvents } from "@/hooks/useWsEvents";

/**
 * Sites for the map: every project the user may open (GET /api/sites, already
 * narrowed by the server), with its status worked out here from active alarms
 * and the newest data time.
 *
 * Status, most urgent first:
 * - "crit": an active critical or high alarm
 * - "warn": any other active alarm
 * - "ok":   data within the last 15 minutes
 * - "idle": no recent data, never reported, or in maintenance
 *
 * Alarms are read only with the Alarms permission; without it a site is green
 * or grey by data alone. Refreshes on WebSocket alarm/telemetry events (at most
 * every 10 s) and every 30 s.
 */
export type SiteStatus = "crit" | "warn" | "ok" | "idle";
export interface SiteAlarm { id: string; name: string; severity: string; assetName?: string; triggeredAt: string }
export interface SiteView extends Site {
  status: SiteStatus;
  alarms: SiteAlarm[];
  placed: boolean;
}

export const FRESH_MS = 15 * 60_000;
const RED = new Set(["critical", "high"]);
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
// The server's maximum: with only the newest 200, a site whose alarms are older
// than 200 others showed green (audit L-23).
const ALARM_PARAMS = { status: "active", limit: 5000 } as const;

export function useSites(onlyIds?: string[]) {
  const qc = useQueryClient();
  const { canModule } = useCurrentUser();
  const alarmsAllowed = canModule("alarms", "read");
  const assetsAllowed = canModule("assets", "read");
  const sitesQ = useListSites({ query: { refetchInterval: 30_000, queryKey: getListSitesQueryKey() } });
  const alarmsQ = useListAlarms(ALARM_PARAMS as any, { query: { enabled: alarmsAllowed, refetchInterval: 30_000, retry: false, queryKey: getListAlarmsQueryKey(ALARM_PARAMS as any) } });
  const assetsQ = useListAssets(undefined, { query: { enabled: assetsAllowed && alarmsAllowed, queryKey: getListAssetsQueryKey() } });

  const last = useRef(0);
  useWsEvents({
    alarm: () => { if (alarmsAllowed) qc.invalidateQueries({ queryKey: getListAlarmsQueryKey(ALARM_PARAMS as any) }); },
    telemetry: () => {
      const now = Date.now();
      if (now - last.current < 10_000) return;
      last.current = now;
      qc.invalidateQueries({ queryKey: getListSitesQueryKey() });
    },
  });

  const sites = useMemo<SiteView[]>(() => {
    const list = ((sitesQ.data as Site[] | undefined) ?? []).filter((s) => !onlyIds?.length || onlyIds.includes(s.projectId));
    // Asset → project, walking parent links.
    const assets = ((assetsQ.data as { id: string; parentId?: string | null }[] | undefined) ?? []);
    const parent = new Map(assets.map((a) => [a.id, a.parentId ?? null]));
    const rootOf = (id: string) => { let cur: string | null = id; for (let i = 0; cur && i < 200; i++) { const p = parent.get(cur); if (p === undefined) return null; if (!p) return cur; cur = p; } return null; };
    const byProject = new Map<string, SiteAlarm[]>();
    for (const a of ((alarmsQ.data as any[] | undefined) ?? [])) {
      if (!a?.assetId || a.status === "cleared") continue;
      const r = rootOf(a.assetId);
      if (!r) continue;
      const arr = byProject.get(r) ?? [];
      arr.push({ id: a.id, name: a.name, severity: a.severity, assetName: a.assetName, triggeredAt: a.triggeredAt });
      byProject.set(r, arr);
    }
    const now = Date.now();
    return list.map((s) => {
      const alarms = (byProject.get(s.projectId) ?? []).sort((x, y) => (SEV_RANK[x.severity] ?? 9) - (SEV_RANK[y.severity] ?? 9));
      const fresh = !!s.lastDataAt && now - new Date(s.lastDataAt).getTime() < FRESH_MS;
      const status: SiteStatus = alarms.some((a) => RED.has(a.severity)) ? "crit" : alarms.length ? "warn" : fresh ? "ok" : "idle";
      return { ...s, alarms, status, placed: s.latitude != null && s.longitude != null };
    });
  }, [sitesQ.data, alarmsQ.data, assetsQ.data, onlyIds?.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  return { sites, loading: sitesQ.isLoading, error: sitesQ.error as Error | null, alarmsAllowed };
}

/**
 * Writes a site's location as static attributes on the project asset: updates
 * the existing Latitude / Longitude / Address attributes, or creates them. Needs
 * Asset write permission; the generated client sends the CSRF header.
 *
 * The attribute ids are looked up fresh from the server at save time, and saves
 * of one project run one after another. Relying on the ids in the cached site
 * list created a second Latitude / Longitude pair when a site was placed again
 * before that list had refetched, or saved twice in quick succession.
 */
const saving = new Map<string, Promise<unknown>>();

export function useSaveLocation() {
  const qc = useQueryClient();
  return (site: Site, lat: number, lng: number, address?: string): Promise<void> => {
    const run = async () => {
      const attrs = await listAssetAttributes(site.projectId);
      const idsOf = (name: string) => attrs.filter((a) => a.name.trim().toLowerCase() === name.toLowerCase()).map((a) => a.id);
      // Every copy is updated, so a project that already holds duplicates from
      // before this fix shows the new location whichever copy the map reads.
      const put = async (name: string, dataType: "double" | "text", value: number | string) => {
        const ids = idsOf(name);
        if (ids.length === 0) { await createAssetAttribute(site.projectId, { name, type: "static", dataType, value }); return; }
        for (const id of ids) await updateAttribute(id, { value });
      };
      await put("Latitude", "double", Math.round(lat * 1e6) / 1e6);
      await put("Longitude", "double", Math.round(lng * 1e6) / 1e6);
      if (address !== undefined && (address.trim() || idsOf("Address").length)) await put("Address", "text", address.trim());
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListSitesQueryKey() }),
        qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(site.projectId) }),
      ]);
    };
    const next = (saving.get(site.projectId) ?? Promise.resolve()).catch(() => {}).then(run);
    saving.set(site.projectId, next);
    void next.finally(() => { if (saving.get(site.projectId) === next) saving.delete(site.projectId); }).catch(() => {});
    return next;
  };
}

export const STATUS_LABEL: Record<SiteStatus, string> = {
  crit: "Critical alarm", warn: "Alarm", ok: "Reporting", idle: "No recent data",
};
export const STATUS_COLOR: Record<SiteStatus, string> = {
  crit: "#ef4444", warn: "#f59e0b", ok: "#22c55e", idle: "#94a3b8",
};
