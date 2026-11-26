import { z } from "zod";
import * as v from "./validation";

/**
 * POST /assets/live-summary: what the Live Feed page needs for many assets in one
 * request. It replaced one /assets/:id/health and one /assets/:id/attributes call
 * per asset every 30 s, which exhausted the per-user API budget (600 a minute) at
 * about 150 assets, so every other screen got 429s and assets drifted to
 * "offline" while their data was arriving (audit H-8).
 *
 * The route runs three set queries (attributes `= ANY`, active alarms
 * `GROUP BY`, newest reading by `LATERAL`, as /sites does) and this pure function
 * shapes the answer, so it is tested without a database. Project scope is
 * enforced before the route runs (projectScopeGuard refuses ids outside the
 * caller's projects).
 */

/** Most ids one request may name. The page sends at most 200 per request. */
export const LIVE_SUMMARY_MAX_IDS = 500;

export const LiveSummaryBody = z.object({
  ids: z.array(v.uuid()).max(LIVE_SUMMARY_MAX_IDS, `at most ${LIVE_SUMMARY_MAX_IDS} ids per request`),
});

export interface LiveSummaryAttrRow {
  assetId: string;
  name: string;
  type: string;
  tagName: string | null;
  sourceMetric: string | null;
  value: unknown;
  uom: string | null;
  decimalPlaces: number | null;
  timestamp: Date | string | null;
}

export interface LiveSummaryAttribute {
  name: string;
  type: string;
  tagName: string | null;
  sourceMetric: string | null;
  value: unknown;
  uom: string | null;
  decimalPlaces: number | null;
  timestamp: string | null;
}

export interface LiveSummaryItem {
  assetId: string;
  /** Newest stored reading of the asset, ISO, or null when it never reported. */
  lastSeen: string | null;
  /** Alarms in status "active", as /assets/:id/health counts them. */
  activeAlarms: number;
  /** Raw value of the static attribute "Expected interval (min)", or null. */
  expectedInterval: unknown;
  /** Latest value, unit and time of each dynamic, metric and runtime attribute. */
  attributes: LiveSummaryAttribute[];
}

const LIVE_TYPES = new Set(["dynamic", "metric", "runtime"]);
/** Same name rule as the page: case, spaces and units ignored ("Expected interval (min)"). */
const isExpectedInterval = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith("expectedinterval");
const iso = (t: Date | string | null | undefined): string | null => {
  if (t == null) return null;
  const d = t instanceof Date ? t : new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * One item per requested id that exists (`lastRows` holds one row per existing
 * asset), in request order. Unknown ids are left out.
 */
export function buildLiveSummary(
  ids: string[],
  lastRows: { id: string; ts: Date | string | null }[],
  alarmRows: { assetId: string; n: number | string }[],
  attrRows: LiveSummaryAttrRow[],
): LiveSummaryItem[] {
  const last = new Map(lastRows.map((r) => [r.id, r.ts]));
  const alarms = new Map(alarmRows.map((r) => [r.assetId, Number(r.n) || 0]));
  const attrs = new Map<string, LiveSummaryAttrRow[]>();
  for (const a of attrRows) {
    const list = attrs.get(a.assetId);
    if (list) list.push(a); else attrs.set(a.assetId, [a]);
  }
  const out: LiveSummaryItem[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id) || !last.has(id)) continue;
    seen.add(id);
    const mine = attrs.get(id) ?? [];
    const interval = mine.find((a) => a.type === "static" && isExpectedInterval(a.name));
    out.push({
      assetId: id,
      lastSeen: iso(last.get(id)),
      activeAlarms: alarms.get(id) ?? 0,
      expectedInterval: interval?.value ?? null,
      attributes: mine.filter((a) => LIVE_TYPES.has(a.type)).map((a) => ({
        name: a.name, type: a.type, tagName: a.tagName, sourceMetric: a.sourceMetric,
        value: a.value, uom: a.uom, decimalPlaces: a.decimalPlaces, timestamp: iso(a.timestamp),
      })),
    });
  }
  return out;
}
