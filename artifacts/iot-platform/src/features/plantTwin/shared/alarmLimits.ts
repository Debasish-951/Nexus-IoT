import { useMemo } from "react";
import { useListAlarmRules } from "@workspace/api-client-react";
import { useCurrentUser } from "@/contexts/UserContext";

/**
 * Alarm limits taken from the real alarm rules (Event Manager), so a twin colours
 * a reading by the same thresholds that raise alarms instead of its demo limits.
 *
 * Only enabled threshold rules count. Critical and high rules give the alarm
 * (red) limit, medium, low and info rules the warning (amber) limit. `gt`/`gte`
 * rules are upper limits, `lt`/`lte` rules lower limits. Users without access to
 * alarms get no limits and the twins keep their own.
 */
export interface Limits { warn?: number; crit?: number; low?: number; lowCrit?: number }
export type LimitLookup = (assetId: string | undefined, metric: string | undefined) => Limits | undefined;

const RED = new Set(["critical", "high"]);

export function useAlarmLimits(): LimitLookup {
  const { canModule } = useCurrentUser();
  const allowed = canModule("alarms", "read");
  const q = useListAlarmRules({ query: { enabled: allowed, staleTime: 60_000, retry: false } as any });
  const map = useMemo(() => {
    const m = new Map<string, Limits>();
    for (const r of ((q.data as any[] | undefined) ?? [])) {
      if (!r?.enabled || r.alarmType !== "threshold" || !r.assetId || !r.metric || typeof r.threshold !== "number") continue;
      const k = `${r.assetId}\u0000${r.metric}`;
      const cur = m.get(k) ?? {};
      const red = RED.has(r.severity);
      if (r.operator === "gt" || r.operator === "gte") {
        if (red) cur.crit = cur.crit === undefined ? r.threshold : Math.min(cur.crit, r.threshold);
        else cur.warn = cur.warn === undefined ? r.threshold : Math.min(cur.warn, r.threshold);
      } else if (r.operator === "lt" || r.operator === "lte") {
        if (red) cur.lowCrit = cur.lowCrit === undefined ? r.threshold : Math.max(cur.lowCrit, r.threshold);
        else cur.low = cur.low === undefined ? r.threshold : Math.max(cur.low, r.threshold);
      } else continue;
      m.set(k, cur);
    }
    return m;
  }, [q.data]);
  return useMemo<LimitLookup>(() => (assetId, metric) => (assetId && metric ? map.get(`${assetId}\u0000${metric}`) : undefined), [map]);
}

/** "ok" | "warn" | "crit" for a value against limits; undefined when there are none. */
export function statusFromLimits(v: number | null | undefined, l: Limits | undefined): "ok" | "warn" | "crit" | undefined {
  if (!l || v == null || !Number.isFinite(v)) return undefined;
  if ((l.crit !== undefined && v >= l.crit) || (l.lowCrit !== undefined && v <= l.lowCrit)) return "crit";
  if ((l.warn !== undefined && v >= l.warn) || (l.low !== undefined && v <= l.low)) return "warn";
  return "ok";
}
