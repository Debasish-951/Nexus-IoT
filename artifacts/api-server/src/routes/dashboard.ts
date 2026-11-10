import { Router, type IRouter } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import {
  DashboardQuery, AttentionQuery, HealthIndexQuery,
  AlarmTrendQuery, IngestSeriesQuery, LiveMetricsQuery,
} from "../schemas/common";
import { eq, sql, desc, gte, inArray, and } from "drizzle-orm";
import {
  db, assetsTable, alarmsTable, alarmRulesTable, brokersTable,
  usersTable, telemetryTable,
} from "@workspace/db";
import { PLANT_TIME_ZONE, startOfZoneDay, startOfZoneHour, zoneDateKey } from "../lib/plant-time";

const router: IRouter = Router();

/** Open = raised and not yet cleared. Acknowledged alarms are still open. */
const OPEN_STATUSES = ["active", "acknowledged"];

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const [assetCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetsTable);

  const [activeAlarmCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"));

  // Open critical alarms only. Counting every critical alarm ever raised meant
  // the figure could only go up.
  const [criticalAlarmCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alarmsTable)
    .where(and(eq(alarmsTable.severity, "critical"), inArray(alarmsTable.status, OPEN_STATUSES)));

  const [connectedBrokers] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(brokersTable)
    .where(eq(brokersTable.status, "connected"));

  const [userCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);

  // Telemetry rate: records in last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const [recentTelemetry] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(telemetryTable)
    .where(gte(telemetryTable.timestamp, fiveMinAgo));

  const [lastTelemetry] = await db
    .select({ timestamp: telemetryTable.timestamp })
    .from(telemetryTable)
    .orderBy(desc(telemetryTable.timestamp))
    .limit(1);

  res.json({
    totalAssets: assetCount?.count ?? 0,
    activeAlarms: activeAlarmCount?.count ?? 0,
    criticalAlarms: criticalAlarmCount?.count ?? 0,
    connectedBrokers: connectedBrokers?.count ?? 0,
    totalUsers: userCount?.count ?? 0,
    telemetryRate: ((recentTelemetry?.count ?? 0) / 5),
    lastIngestionAt: lastTelemetry?.timestamp ?? null,
  });
});

router.get("/dashboard/recent-telemetry", validate({ query: DashboardQuery }), async (req, res): Promise<void> => {
  const { limit = 20 } = req.query as z.infer<typeof DashboardQuery>;

  const records = await db
    .select()
    .from(telemetryTable)
    .orderBy(desc(telemetryTable.timestamp))
    .limit(limit);

  res.json(records);
});

router.get("/dashboard/alarm-stats", async (req, res): Promise<void> => {
  const stats = await db
    .select({
      severity: alarmsTable.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"))
    .groupBy(alarmsTable.severity);

  const result = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const row of stats) {
    if (row.severity in result) {
      result[row.severity as keyof typeof result] = row.count;
    }
  }

  res.json(result);
});

// ═════════════════════════════════════════════════════════════════════════════
//  Banded home dashboard
//
//  Five read-only endpoints behind the new Home page. They are additive: the
//  three above still back the original Dashboard, which is untouched.
//
//  All five are covered by the existing `/dashboard/:metric` READ rule in
//  middleware/authorize.ts — that pattern compiles to `^/dashboard/[^/]+/?$`,
//  so single-segment additions need no new rule. Anything nested (a future
//  `/dashboard/foo/bar`) WOULD need one, and would 403 until it got one.
// ═════════════════════════════════════════════════════════════════════════════

/** Severity ordering used everywhere below. Lower sorts first. */
const SEVERITY_RANK: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

/**
 * Points deducted from an asset's health score per open alarm.
 *
 * Deliberately coarse and deliberately visible. A score whose derivation nobody
 * can explain gets ignored within a fortnight, so the whole formula is:
 *
 *   score = 100 − alarmBurden − staleness − downtime      (clamped to 0…100)
 *
 * and each term is reported alongside the score so the UI can show what cost
 * the points rather than just asserting a number.
 */
const ALARM_PENALTY: Record<string, number> = {
  critical: 25, high: 15, medium: 8, low: 3, info: 1,
};
/** Ceiling on the alarm term — twelve low alarms must not outweigh one critical. */
const MAX_ALARM_PENALTY = 60;
/** An asset that once reported and has now gone quiet. */
const STALE_PENALTY = 20;
/** An asset with a device id that has never reported at all. */
const NEVER_REPORTED_PENALTY = 15;
/** Downtime term: 2 points per hour of machine fault time, capped. */
const DOWNTIME_POINTS_PER_HOUR = 2;
const MAX_DOWNTIME_PENALTY = 20;

/**
 * Availability and downtime come from what machines report about themselves: a
 * telemetry tag named `status`, or ending in `.status`, one per machine.
 *
 * Alarms must not feed these. A rule fires because one parameter crossed a limit
 * someone chose, while the machine keeps running. Gaps in telemetry must not feed
 * them either: a stopped data feed says nothing about the machine, so a period
 * with no status reading counts as unknown and is left out of the arithmetic.
 *
 * Any state not listed here, such as Running or Idle, counts as available.
 */
const DOWN_STATES = new Set(["fault", "faulted", "error", "failed", "failure", "breakdown", "down", "tripped"]);
/** Planned stops are not downtime, and they do not count as time the machine should have run. */
const PLANNED_STATES = new Set(["maintenance", "planned maintenance", "planned_maintenance"]);
/** Each machine's state is sampled once per bucket, so cost does not grow with message rate. */
const STATUS_BUCKET_SECONDS = 300;
/** Most buckets sampled per status tag (one week of 5-minute buckets). */
const MAX_STATUS_BUCKETS = 2016;

/**
 * Bucket size for a window: 5 minutes, widened in 5-minute steps so a long
 * window still samples at most MAX_STATUS_BUCKETS times per machine. A 90-day
 * window at 5 minutes was ~26,000 index seeks per status tag.
 */
export function statusBucketSeconds(days: number): number {
  const needed = (days * 86_400) / MAX_STATUS_BUCKETS;
  return Math.max(STATUS_BUCKET_SECONDS, Math.ceil(needed / STATUS_BUCKET_SECONDS) * STATUS_BUCKET_SECONDS);
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ── Band 2: the attention queue ──────────────────────────────────────────────

/**
 * Everything that wants a human, in one ranked list.
 *
 * Four sources, deliberately merged server-side rather than stitched together in
 * the browser: the ranking is only meaningful across the whole set, and doing it
 * client-side would mean four round-trips and a sort that each caller has to
 * reimplement.
 *
 *   1. open alarms                — from `alarms`
 *   2. assets that stopped talking — from `assets` ⋈ newest `telemetry`
 *   3. device ids with no asset    — from `seen_devices` ⋈ `assets.identifier`
 *   4. API keys about to expire    — from `api_clients`
 *
 * Assets in maintenance mode are excluded from (2). Ingest already suppresses
 * alarm evaluation for them, so surfacing "it stopped reporting" for a machine
 * somebody deliberately took offline is noise that trains people to ignore the
 * queue.
 */
router.get("/dashboard/attention", validate({ query: AttentionQuery }), async (req, res): Promise<void> => {
  const { staleMinutes = 60, keyExpiryDays = 14, limit = 25 } =
    req.query as unknown as z.infer<typeof AttentionQuery>;

  const now = Date.now();
  const staleCutoff = new Date(now - staleMinutes * 60_000);
  const keyCutoff = new Date(now + keyExpiryDays * 86_400_000);

  const openAlarms = await db
    .select({
      id: alarmsTable.id, name: alarmsTable.name, assetId: alarmsTable.assetId,
      assetName: alarmsTable.assetName, severity: alarmsTable.severity,
      message: alarmsTable.message, triggeredAt: alarmsTable.triggeredAt,
      alarmClass: alarmsTable.alarmClass, ruleId: alarmsTable.ruleId,
    })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"))
    .orderBy(desc(alarmsTable.triggeredAt))
    .limit(200);

  const acknowledged = await db
    .select({
      id: alarmsTable.id, name: alarmsTable.name, assetId: alarmsTable.assetId,
      assetName: alarmsTable.assetName, severity: alarmsTable.severity,
      triggeredAt: alarmsTable.triggeredAt, acknowledgedAt: alarmsTable.acknowledgedAt,
    })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "acknowledged"))
    .orderBy(desc(alarmsTable.acknowledgedAt))
    .limit(20);

  // "Today" in the plant's time zone, not the API host's.
  const midnight = startOfZoneDay(new Date());
  const clearedToday = await db
    .select({
      id: alarmsTable.id, name: alarmsTable.name, assetName: alarmsTable.assetName,
      severity: alarmsTable.severity, triggeredAt: alarmsTable.triggeredAt,
      clearedAt: alarmsTable.clearedAt,
    })
    .from(alarmsTable)
    .where(and(eq(alarmsTable.status, "cleared"), gte(alarmsTable.clearedAt, midnight)))
    .orderBy(desc(alarmsTable.clearedAt))
    .limit(20);

  // LATERAL rather than GROUP BY: this rides idx_telemetry_asset_ts and touches
  // one row per asset. A `MAX(timestamp) … GROUP BY asset_id` over the whole
  // telemetry table is the same answer via a sequential scan, and telemetry is
  // the one table here that grows without bound.
  const stale = await db.execute<{
    id: string; name: string; identifier: string | null; last_seen: string | null;
  }>(sql`
    SELECT a.id, a.name, a.identifier, ls.ts AS last_seen
    FROM assets a
    LEFT JOIN LATERAL (
      SELECT timestamp AS ts FROM telemetry
      WHERE asset_id = a.id ORDER BY timestamp DESC LIMIT 1
    ) ls ON true
    WHERE a.identifier IS NOT NULL
      AND a.maintenance_mode = false
      AND (ls.ts IS NULL OR ls.ts < ${staleCutoff})
    ORDER BY ls.ts DESC NULLS LAST
    LIMIT 50
  `);

  // Checked against assets.identifier rather than seen_devices.matched: the flag
  // is written at ingest and can drift once an asset is created afterwards, and
  // a stale flag here would show a device as unbound forever. Exact,
  // case-sensitive comparison — the same rule ingest uses to attribute
  // telemetry, so this reports precisely what ingest is discarding.
  const unbound = await db.execute<{ device_id: string; last_seen: string; count: number }>(sql`
    SELECT d.device_id, d.last_seen, d.count
    FROM seen_devices d
    WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE a.identifier = d.device_id)
    ORDER BY d.last_seen DESC
    LIMIT 20
  `);

  // Counted separately: the list above stops at 200, and counting that list
  // capped every figure at 200.
  const activeBySeverity = await db
    .select({ severity: alarmsTable.severity, count: sql<number>`count(*)::int` })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"))
    .groupBy(alarmsTable.severity);
  const severityCount = (sev: string) => activeBySeverity.find((r) => r.severity === sev)?.count ?? 0;
  const activeAlarmTotal = activeBySeverity.reduce((sum, r) => sum + r.count, 0);

  const expiringKeys = await db.execute<{ id: string; name: string; expires_at: string }>(sql`
    SELECT id, name, expires_at
    FROM api_clients
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ${keyCutoff}
    ORDER BY expires_at ASC
    LIMIT 20
  `);

  type Item = {
    kind: "alarm" | "stale" | "unbound_device" | "api_key";
    key: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    title: string;
    detail: string;
    assetId: string | null;
    assetName: string | null;
    since: string | null;
    ageSeconds: number | null;
    action: { label: string; href: string };
    rank: number;
  };

  const items: Item[] = [];

  for (const a of openAlarms) {
    const sev = (a.severity in ALARM_PENALTY ? a.severity : "medium") as Item["severity"];
    items.push({
      kind: "alarm", key: `alarm:${a.id}`, severity: sev,
      title: `${a.name}${a.assetName ? ` — ${a.assetName}` : ""}`,
      detail: a.message ?? a.alarmClass ?? "Alarm is active",
      assetId: a.assetId, assetName: a.assetName,
      since: a.triggeredAt?.toISOString() ?? null,
      ageSeconds: a.triggeredAt ? Math.round((now - a.triggeredAt.getTime()) / 1000) : null,
      action: { label: "Acknowledge", href: "/alarms" },
      rank: SEVERITY_RANK[sev] ?? 2,
    });
  }

  for (const s of stale.rows) {
    const lastSeen = s.last_seen ? new Date(s.last_seen) : null;
    items.push({
      kind: "stale", key: `stale:${s.id}`, severity: lastSeen ? "medium" : "low",
      title: lastSeen ? `${s.name} has stopped reporting` : `${s.name} has never reported`,
      detail: lastSeen
        ? `No telemetry since ${lastSeen.toISOString()} — device ${s.identifier}`
        : `Device ${s.identifier} is configured but has never sent data`,
      assetId: s.id, assetName: s.name,
      since: lastSeen?.toISOString() ?? null,
      ageSeconds: lastSeen ? Math.round((now - lastSeen.getTime()) / 1000) : null,
      action: { label: "Investigate", href: `/assets` },
      rank: 5,
    });
  }

  for (const d of unbound.rows) {
    const seen = new Date(d.last_seen);
    items.push({
      kind: "unbound_device", key: `device:${d.device_id}`, severity: "info",
      title: `${d.device_id} is sending data with no asset bound`,
      detail: `${d.count} message${d.count === 1 ? "" : "s"} received and discarded — no asset has this device id`,
      assetId: null, assetName: null,
      since: seen.toISOString(),
      ageSeconds: Math.round((now - seen.getTime()) / 1000),
      action: { label: "Bind", href: "/assets" },
      rank: 6,
    });
  }

  for (const k of expiringKeys.rows) {
    const expires = new Date(k.expires_at);
    const expired = expires.getTime() < now;
    const days = Math.round((expires.getTime() - now) / 86_400_000);
    items.push({
      kind: "api_key", key: `key:${k.id}`, severity: expired ? "high" : "info",
      title: expired
        ? `API key ${k.name} has expired`
        : `API key ${k.name} expires in ${days} day${days === 1 ? "" : "s"}`,
      detail: expired
        ? "Any integration using it is already failing to authenticate"
        : "Rotate it before the expiry or the integration stops ingesting",
      assetId: null, assetName: null,
      since: expires.toISOString(), ageSeconds: null,
      action: { label: "Rotate", href: "/api-clients" },
      rank: expired ? 1 : 7,
    });
  }

  // Rank first, then oldest-first inside a rank: an alarm nobody has touched for
  // three hours outranks one raised a minute ago at the same severity.
  items.sort((a, b) => a.rank - b.rank || (b.ageSeconds ?? -1) - (a.ageSeconds ?? -1));

  res.json({
    items: items.slice(0, limit).map(({ rank: _rank, ...item }) => item),
    counts: {
      total: items.length - openAlarms.length + activeAlarmTotal,
      alarm: activeAlarmTotal,
      stale: stale.rows.length,
      unboundDevice: unbound.rows.length,
      apiKey: expiringKeys.rows.length,
      bySeverity: {
        critical: severityCount("critical"),
        high: severityCount("high"),
        medium: severityCount("medium"),
        low: severityCount("low"),
        info: severityCount("info"),
      },
    },
    inProgress: acknowledged.map((a) => ({
      id: a.id, name: a.name, assetId: a.assetId, assetName: a.assetName,
      severity: a.severity,
      triggeredAt: a.triggeredAt?.toISOString() ?? null,
      acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    })),
    clearedToday: clearedToday.map((a) => ({
      id: a.id, name: a.name, assetName: a.assetName, severity: a.severity,
      clearedAt: a.clearedAt?.toISOString() ?? null,
      openSeconds: a.clearedAt && a.triggeredAt
        ? Math.round((a.clearedAt.getTime() - a.triggeredAt.getTime()) / 1000)
        : null,
    })),
    staleMinutes,
  });
});

// ── Band 1: the health index ─────────────────────────────────────────────────

/**
 * A per-asset score, rolled up the hierarchy.
 *
 * There is no stored score history, so this endpoint reports NO week-on-week
 * delta. It would have to be invented, and a made-up trend arrow on a management
 * dashboard is worse than no arrow — `previous` is null until something persists
 * a daily snapshot, and the UI hides the delta when it is.
 */
router.get("/dashboard/health-index", validate({ query: HealthIndexQuery }), async (req, res): Promise<void> => {
  const { staleMinutes = 60, days = 7 } = req.query as unknown as z.infer<typeof HealthIndexQuery>;
  const bucketSeconds = statusBucketSeconds(days);
  const staleCutoff = new Date(Date.now() - staleMinutes * 60_000);
  const since = new Date(Date.now() - days * 86_400_000);

  const assets = await db
    .select({
      id: assetsTable.id, name: assetsTable.name, parentId: assetsTable.parentId,
      identifier: assetsTable.identifier, maintenanceMode: assetsTable.maintenanceMode,
    })
    .from(assetsTable);

  const alarmRows = await db
    .select({
      assetId: alarmsTable.assetId, severity: alarmsTable.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"))
    .groupBy(alarmsTable.assetId, alarmsTable.severity);

  const lastSeenRows = await db.execute<{ id: string; last_seen: string | null }>(sql`
    SELECT a.id, ls.ts AS last_seen
    FROM assets a
    LEFT JOIN LATERAL (
      SELECT timestamp AS ts FROM telemetry
      WHERE asset_id = a.id ORDER BY timestamp DESC LIMIT 1
    ) ls ON true
  `);

  // Machine state per bucket. The recursive CTE walks the distinct metrics of each
  // asset through the (asset_id, metric, timestamp) index, because a plain DISTINCT
  // or a LIKE over telemetry would scan every row in a table this large.
  const statusRows = await db.execute<{ asset_id: string; metric: string; state: string; buckets: number }>(sql`
    WITH RECURSIVE metrics AS (
      SELECT a.id AS asset_id,
             (SELECT t.metric FROM telemetry t WHERE t.asset_id = a.id ORDER BY t.metric LIMIT 1) AS metric
      FROM assets a
      UNION ALL
      SELECT m.asset_id,
             (SELECT t.metric FROM telemetry t
              WHERE t.asset_id = m.asset_id AND t.metric > m.metric ORDER BY t.metric LIMIT 1)
      FROM metrics m
      WHERE m.metric IS NOT NULL
    )
    SELECT m.asset_id, m.metric, s.state, COUNT(*)::int AS buckets
    FROM metrics m
    CROSS JOIN generate_series(
      ${since}::timestamptz,
      now() - make_interval(secs => ${bucketSeconds}::double precision),
      make_interval(secs => ${bucketSeconds}::double precision)
    ) AS bucket
    CROSS JOIN LATERAL (
      SELECT lower(t.value #>> '{}') AS state
      FROM telemetry t
      WHERE t.asset_id = m.asset_id AND t.metric = m.metric
        AND t.timestamp >= bucket
        AND t.timestamp < bucket + make_interval(secs => ${bucketSeconds}::double precision)
      ORDER BY t.timestamp DESC
      LIMIT 1
    ) s
    WHERE lower(m.metric) = 'status' OR lower(m.metric) LIKE '%.status'
    GROUP BY m.asset_id, m.metric, s.state
  `);

  const alarmPenaltyByAsset = new Map<string, number>();
  for (const row of alarmRows) {
    if (!row.assetId) continue;
    const penalty = (ALARM_PENALTY[row.severity] ?? 5) * row.count;
    alarmPenaltyByAsset.set(row.assetId, (alarmPenaltyByAsset.get(row.assetId) ?? 0) + penalty);
  }

  const lastSeenByAsset = new Map<string, Date | null>();
  for (const row of lastSeenRows.rows) {
    lastSeenByAsset.set(row.id, row.last_seen ? new Date(row.last_seen) : null);
  }

  const downtimeByAsset = new Map<string, number>();
  const machinesByAsset = new Map<string, Set<string>>();
  let reportedSeconds = 0;
  let plannedSeconds = 0;
  let downSeconds = 0;
  for (const row of statusRows.rows) {
    if (!row.state) continue;
    const seconds = row.buckets * bucketSeconds;
    reportedSeconds += seconds;
    if (PLANNED_STATES.has(row.state)) plannedSeconds += seconds;
    if (DOWN_STATES.has(row.state)) {
      downSeconds += seconds;
      downtimeByAsset.set(row.asset_id, (downtimeByAsset.get(row.asset_id) ?? 0) + seconds);
    }
    const machines = machinesByAsset.get(row.asset_id) ?? new Set<string>();
    machines.add(row.metric);
    machinesByAsset.set(row.asset_id, machines);
  }
  const machineCount = [...machinesByAsset.values()].reduce((sum, m) => sum + m.size, 0);
  const expectedSeconds = reportedSeconds - plannedSeconds;

  interface Scored {
    id: string; name: string; parentId: string | null;
    score: number;
    alarmBurden: number; staleness: number; downtime: number;
    lastSeen: string | null; maintenanceMode: boolean; hasDevice: boolean;
  }

  const scored = new Map<string, Scored>();
  for (const asset of assets) {
    const alarmBurden = Math.min(MAX_ALARM_PENALTY, alarmPenaltyByAsset.get(asset.id) ?? 0);

    // Only assets that carry a device id can be stale — a Site or a Line has no
    // telemetry of its own and would otherwise be permanently penalised for it.
    let staleness = 0;
    const lastSeen = lastSeenByAsset.get(asset.id) ?? null;
    if (asset.identifier && !asset.maintenanceMode) {
      if (!lastSeen) staleness = NEVER_REPORTED_PENALTY;
      else if (lastSeen < staleCutoff) staleness = STALE_PENALTY;
    }

    // Per machine, so an asset is not penalised for how many machines it reports.
    const downtimeSeconds = (downtimeByAsset.get(asset.id) ?? 0) / (machinesByAsset.get(asset.id)?.size ?? 1);
    const downtime = Math.min(
      MAX_DOWNTIME_PENALTY,
      (downtimeSeconds / 3600) * DOWNTIME_POINTS_PER_HOUR,
    );

    scored.set(asset.id, {
      id: asset.id, name: asset.name, parentId: asset.parentId,
      score: clampScore(100 - alarmBurden - staleness - downtime),
      alarmBurden, staleness, downtime: Math.round(downtime * 10) / 10,
      lastSeen: lastSeen?.toISOString() ?? null,
      maintenanceMode: asset.maintenanceMode,
      hasDevice: Boolean(asset.identifier),
    });
  }

  // Roll up: a branch scores the mean of every asset beneath it, itself
  // included. Children are resolved iteratively from a parent map rather than by
  // recursion, so a cycle in the hierarchy cannot produce a stack overflow.
  const childrenOf = new Map<string, string[]>();
  for (const s of scored.values()) {
    if (!s.parentId || !scored.has(s.parentId)) continue;
    const list = childrenOf.get(s.parentId) ?? [];
    list.push(s.id);
    childrenOf.set(s.parentId, list);
  }

  function subtreeIds(rootId: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;   // cycle guard
      seen.add(id);
      out.push(id);
      for (const child of childrenOf.get(id) ?? []) stack.push(child);
    }
    return out;
  }

  interface Node {
    id: string; name: string; score: number; assetCount: number;
    ownScore: number; children: Node[];
  }

  function buildNode(id: string, depth: number): Node {
    const self = scored.get(id)!;
    const ids = subtreeIds(id);
    const mean = ids.reduce((sum, x) => sum + (scored.get(x)?.score ?? 0), 0) / ids.length;
    return {
      id, name: self.name,
      score: clampScore(mean),
      assetCount: ids.length,
      ownScore: self.score,
      // Two levels is what the panel shows; deeper hierarchies stay in the
      // rollup arithmetic but are not serialised into a payload nobody renders.
      children: depth < 1
        ? (childrenOf.get(id) ?? []).map((c) => buildNode(c, depth + 1))
          .sort((a, b) => a.score - b.score)
        : [],
    };
  }

  const roots = [...scored.values()]
    .filter((s) => !s.parentId || !scored.has(s.parentId))
    .map((s) => buildNode(s.id, 0))
    .sort((a, b) => a.score - b.score);

  const all = [...scored.values()];
  const n = Math.max(all.length, 1);
  const factors = {
    alarmBurden: Math.round((all.reduce((s, a) => s + a.alarmBurden, 0) / n) * 10) / 10,
    staleness: Math.round((all.reduce((s, a) => s + a.staleness, 0) / n) * 10) / 10,
    downtime: Math.round((all.reduce((s, a) => s + a.downtime, 0) / n) * 10) / 10,
  };

  res.json({
    // Derived from the factor means rather than from the mean of the clamped
    // per-asset scores, so "100 − the three numbers shown" always equals the
    // number shown. Two ways of averaging that disagree on screen is a support
    // ticket every time.
    overall: clampScore(100 - factors.alarmBurden - factors.staleness - factors.downtime),
    previous: null,
    factors,
    availability: {
      percent: expectedSeconds > 0
        ? Math.round(((expectedSeconds - downSeconds) / expectedSeconds) * 1000) / 10
        : null,
      downtimeSeconds: downSeconds,
      machineCount,
    },
    assetCount: all.length,
    worst: all
      .filter((a) => a.score < 100)
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map((a) => ({ id: a.id, name: a.name, score: a.score })),
    tree: roots,
    window: { days, staleMinutes },
  });
});

// ── Band 4: alarm trend, MTTA/MTTR, worst performers ─────────────────────────

router.get("/dashboard/alarm-trend", validate({ query: AlarmTrendQuery }), async (req, res): Promise<void> => {
  const { days = 30, topAssets = 5 } = req.query as unknown as z.infer<typeof AlarmTrendQuery>;
  // Days are plant-zone calendar days, in the query and in the keys alike.
  const now = new Date();
  const since = startOfZoneDay(now, days);

  const buckets = await db.execute<{ day: string; severity: string; n: number }>(sql`
    SELECT to_char(date_trunc('day', triggered_at AT TIME ZONE ${PLANT_TIME_ZONE}), 'YYYY-MM-DD') AS day,
           severity, count(*)::int AS n
    FROM alarm_history
    WHERE triggered_at >= ${since}
    GROUP BY 1, 2
    ORDER BY 1
  `);

  // Densify in JS: a day with no alarms produces no row, and a chart that skips
  // those days silently compresses a quiet week into a single point.
  interface DayCounts {
    critical: number; high: number; medium: number; low: number; info: number; total: number;
  }
  const byDay = new Map<string, DayCounts>();
  for (let i = days; i >= 0; i--) {
    byDay.set(zoneDateKey(startOfZoneDay(now, i)), { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 });
  }
  for (const row of buckets.rows) {
    const key = row.day;
    const entry = byDay.get(key);
    if (!entry) continue;
    if (row.severity in SEVERITY_RANK) entry[row.severity as keyof Omit<DayCounts, "total">] += row.n;
    entry.total += row.n;
  }

  const [resolution] = (await db.execute<{ mttr_seconds: number | null; cleared: number }>(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (cleared_at - triggered_at)))::float AS mttr_seconds,
           COUNT(*)::int AS cleared
    FROM alarm_history
    WHERE triggered_at >= ${since} AND cleared_at IS NOT NULL
  `)).rows;

  // MTTA comes from `alarms`, not `alarm_history` — history rows carry no
  // acknowledgement timestamp. Cleared alarms are retained in `alarms` rather
  // than deleted, so the window is the same.
  const [ack] = (await db.execute<{ mtta_seconds: number | null; acknowledged: number }>(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (acknowledged_at - triggered_at)))::float AS mtta_seconds,
           COUNT(*)::int AS acknowledged
    FROM alarms
    WHERE triggered_at >= ${since} AND acknowledged_at IS NOT NULL
  `)).rows;

  const worst = await db.execute<{
    asset_id: string; asset_name: string; alarms: number; open_seconds: string;
  }>(sql`
    SELECT asset_id, asset_name,
           COUNT(*)::int AS alarms,
           COALESCE(SUM(EXTRACT(EPOCH FROM (
             LEAST(COALESCE(cleared_at, now()), now()) - GREATEST(triggered_at, ${since}::timestamptz)
           ))), 0)::bigint AS open_seconds
    FROM alarm_history
    WHERE triggered_at >= ${since}
    GROUP BY asset_id, asset_name
    ORDER BY alarms DESC, open_seconds DESC
    LIMIT ${topAssets}
  `);

  // Rule health. `neverFired` is the interesting one: a rule with no history in
  // the window is usually watching a metric no asset sends, which is invisible
  // otherwise — nothing errors, the rule simply never does anything.
  const [ruleHealth] = (await db.execute<{
    total: number; enabled: number; never_fired: number;
  }>(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE enabled)::int AS enabled,
           COUNT(*) FILTER (
             WHERE enabled AND NOT EXISTS (
               SELECT 1 FROM alarm_history h
               JOIN alarms al ON al.id = h.alarm_id
               WHERE al.rule_id = alarm_rules.id AND h.triggered_at >= ${since}
             )
           )::int AS never_fired
    FROM alarm_rules
  `)).rows;

  const [lastHour] = (await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM alarm_history
    WHERE triggered_at >= now() - interval '1 hour'
  `)).rows;

  const series = [...byDay.entries()].map(([date, counts]) => ({ date, ...counts }));
  const totals = series.reduce((sum, d) => sum + d.total, 0);
  const half = Math.floor(series.length / 2);
  const firstHalf = series.slice(0, half).reduce((s, d) => s + d.total, 0);
  const secondHalf = series.slice(half).reduce((s, d) => s + d.total, 0);

  res.json({
    series,
    totals,
    // A like-for-like comparison of the two halves of the requested window.
    // Honest about what it is — not "vs last month" unless days happens to be 60.
    changePct: firstHalf === 0 ? null : Math.round(((secondHalf - firstHalf) / firstHalf) * 100),
    peak: series.reduce<{ date: string; total: number } | null>(
      (best, d) => (!best || d.total > best.total ? { date: d.date, total: d.total } : best), null),
    mttaSeconds: ack?.mtta_seconds ?? null,
    mttrSeconds: resolution?.mttr_seconds ?? null,
    acknowledgedCount: ack?.acknowledged ?? 0,
    clearedCount: resolution?.cleared ?? 0,
    worstPerformers: worst.rows.map((r) => ({
      assetId: r.asset_id, assetName: r.asset_name,
      alarms: r.alarms, openSeconds: Number(r.open_seconds),
    })),
    rules: {
      total: ruleHealth?.total ?? 0,
      enabled: ruleHealth?.enabled ?? 0,
      neverFired: ruleHealth?.never_fired ?? 0,
    },
    alarmsLastHour: lastHour?.n ?? 0,
    window: { days, since: since.toISOString(), timeZone: PLANT_TIME_ZONE },
  });
});

// ── Band 4: ingest throughput and per-device connectivity ────────────────────

/**
 * Distinguishes "quiet plant" from "broken pipeline".
 *
 * `/dashboard/summary` returns a single rate, and a single number cannot tell
 * those two apart — which is exactly the confusion the original dashboard
 * created when everything read zero.
 */
router.get("/dashboard/ingest-series", validate({ query: IngestSeriesQuery }), async (req, res): Promise<void> => {
  const { hours = 6, devices = 8 } = req.query as unknown as z.infer<typeof IngestSeriesQuery>;
  const since = new Date(Date.now() - hours * 3600_000);
  const matrixSince = new Date(Date.now() - 24 * 3600_000);

  const perMinute = await db.execute<{ minute: string; n: number }>(sql`
    SELECT date_trunc('minute', timestamp) AS minute, count(*)::int AS n
    FROM telemetry
    WHERE timestamp >= ${since}
    GROUP BY 1
    ORDER BY 1
  `);

  const matrix = await db.execute<{ device_id: string; hour: string; n: number; bound: boolean }>(sql`
    SELECT t.device_id,
           -- Hours start on the plant-zone hour, which matters for half-hour zones.
           date_trunc('hour', t.timestamp AT TIME ZONE ${PLANT_TIME_ZONE}) AT TIME ZONE ${PLANT_TIME_ZONE} AS hour,
           count(*)::int AS n,
           EXISTS (SELECT 1 FROM assets a WHERE a.identifier = t.device_id) AS bound
    FROM telemetry t
    WHERE t.timestamp >= ${matrixSince} AND t.device_id IS NOT NULL
    GROUP BY 1, 2, 4
    ORDER BY 1, 2
  `);

  const totalsByDevice = new Map<string, { total: number; bound: boolean }>();
  for (const row of matrix.rows) {
    const entry = totalsByDevice.get(row.device_id) ?? { total: 0, bound: row.bound };
    entry.total += row.n;
    entry.bound = row.bound;
    totalsByDevice.set(row.device_id, entry);
  }
  const topDevices = [...totalsByDevice.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, devices);

  // Hour labels, oldest first, aligned to the hour so the client can render a
  // fixed-width grid without recomputing the axis.
  const hourStart = startOfZoneHour(matrixSince);
  const hourKeys: string[] = [];
  for (let i = 0; i <= 24; i++) hourKeys.push(new Date(hourStart.getTime() + i * 3600_000).toISOString());

  const byDeviceHour = new Map<string, number>();
  for (const row of matrix.rows) {
    const key = `${row.device_id}|${new Date(row.hour).toISOString()}`;
    byDeviceHour.set(key, (byDeviceHour.get(key) ?? 0) + row.n);
  }

  // Quality mix over the newest 1,000 readings rather than the whole window:
  // the question is "is what is arriving now trustworthy", and bounding it by
  // rows keeps the cost flat as telemetry grows (2ms against 3.7M rows).
  const quality = await db.execute<{ quality: string | null; n: number }>(sql`
    SELECT quality, count(*)::int AS n
    FROM (SELECT quality FROM telemetry ORDER BY timestamp DESC LIMIT 1000) recent
    GROUP BY quality
  `);

  const counts = perMinute.rows.map((r) => r.n);
  const [last] = await db
    .select({ timestamp: telemetryTable.timestamp })
    .from(telemetryTable)
    .orderBy(desc(telemetryTable.timestamp))
    .limit(1);

  const series = densifyMinutes(perMinute.rows.map((r) => ({ minute: new Date(r.minute), count: r.n })), since, new Date());

  res.json({
    // Every minute of the window, zeros included, so a gap shows as a gap.
    series,
    peakPerMinute: counts.length ? Math.max(...counts) : 0,
    totalPoints: counts.reduce((s, n) => s + n, 0),
    // 0 when the newest data is stale. This used to be the last minute that had
    // any data, so a pipeline that stopped an hour ago still showed its old rate.
    currentPerMinute: currentPerMinute(series, new Date()),
    lastIngestionAt: last?.timestamp?.toISOString() ?? null,
    quality: quality.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.quality ?? "unknown"] = r.n;
      return acc;
    }, {}),
    hours: hourKeys,
    devices: topDevices.map(([deviceId, meta]) => ({
      deviceId,
      bound: meta.bound,
      total: meta.total,
      buckets: hourKeys.map((h) => byDeviceHour.get(`${deviceId}|${h}`) ?? 0),
    })),
    window: { hours },
  });
});

/** One point per minute from `from` to `to`, zero where no row exists. */
export function densifyMinutes(rows: { minute: Date; count: number }[], from: Date, to: Date): { minute: string; count: number }[] {
  const byMinute = new Map(rows.map((r) => [Math.floor(r.minute.getTime() / 60_000), r.count]));
  const out: { minute: string; count: number }[] = [];
  for (let m = Math.floor(from.getTime() / 60_000); m <= Math.floor(to.getTime() / 60_000); m++) {
    out.push({ minute: new Date(m * 60_000).toISOString(), count: byMinute.get(m) ?? 0 });
  }
  return out;
}

/**
 * The newest minute's count, or 0 when that minute is stale (older than the
 * previous minute), so a stopped pipeline reads 0 rather than its last rate.
 */
export function currentPerMinute(series: { minute: string; count: number }[], now: Date): number {
  const freshFrom = (Math.floor(now.getTime() / 60_000) - 1) * 60_000;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].count === 0) continue;
    return new Date(series[i].minute).getTime() >= freshFrom ? series[i].count : 0;
  }
  return 0;
}

// ── Band 3: live metric tiles ────────────────────────────────────────────────

/**
 * The metrics worth putting on screen, with their thresholds and recent shape.
 *
 * Ordering is the point: whatever is currently in alarm comes first, then
 * metrics that have a rule watching them, then simply whatever is most active.
 * That way the tiles are useful without anybody configuring them, and a metric
 * that starts misbehaving promotes itself onto the screen.
 */
router.get("/dashboard/live-metrics", validate({ query: LiveMetricsQuery }), async (req, res): Promise<void> => {
  const { limit = 6, points = 40 } = req.query as unknown as z.infer<typeof LiveMetricsQuery>;

  const rules = await db
    .select({
      id: alarmRulesTable.id, assetId: alarmRulesTable.assetId,
      metric: alarmRulesTable.metric, operator: alarmRulesTable.operator,
      threshold: alarmRulesTable.threshold, severity: alarmRulesTable.severity,
      name: alarmRulesTable.name,
    })
    .from(alarmRulesTable)
    .where(eq(alarmRulesTable.enabled, true));

  const activeAlarms = await db
    .select({ ruleId: alarmsTable.ruleId, assetId: alarmsTable.assetId, severity: alarmsTable.severity })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"));

  // Keyed by rule AND asset: a rule can be open on one asset and normal on another.
  const alarming = new Set(activeAlarms.filter((a) => a.ruleId).map((a) => `${a.ruleId}|${a.assetId}`));

  // Candidate (asset, metric) pairs, in priority order and de-duplicated.
  interface Candidate { assetId: string; metric: string; priority: number; ruleId: string | null }
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const push = (assetId: string, metric: string, priority: number, ruleId: string | null) => {
    const key = `${assetId}|${metric}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ assetId, metric, priority, ruleId });
  };

  for (const r of rules) {
    if (!r.assetId || !r.metric) continue;
    push(r.assetId, r.metric, alarming.has(`${r.id}|${r.assetId}`) ? 0 : 1, r.id);
  }

  // Backfill from whatever is actually flowing, so the band is populated even
  // on a deployment with no rules configured yet.
  //
  // Bounded by ROWS, not by a time window. A `WHERE timestamp >= now() - 24h`
  // filter looks equivalent and is not: on a system that has been quiet for a
  // day it returns nothing and the whole band renders empty while the data sits
  // right there — verified against this database, where telemetry exists but is
  // older than a day. Reading the newest 5,000 rows costs the same whether the
  // table holds a thousand rows or a billion, because it walks idx_telemetry_ts
  // backwards and stops.
  if (candidates.length < limit) {
    const recent = await db.execute<{ asset_id: string; metric: string }>(sql`
      SELECT DISTINCT asset_id, metric FROM (
        SELECT asset_id, metric FROM telemetry
        WHERE jsonb_typeof(value) = 'number'
        ORDER BY timestamp DESC
        LIMIT 5000
      ) recent
    `);
    for (const row of recent.rows) push(row.asset_id, row.metric, 2, null);
  }

  const chosen = candidates.sort((a, b) => a.priority - b.priority).slice(0, limit);
  if (chosen.length === 0) { res.json({ tiles: [] }); return; }

  const assetIds = [...new Set(chosen.map((c) => c.assetId))];
  const assetNames = new Map(
    (await db.select({ id: assetsTable.id, name: assetsTable.name })
      .from(assetsTable).where(inArray(assetsTable.id, assetIds)))
      .map((a) => [a.id, a.name] as const),
  );

  // One query per tile — at most `limit` (12) of them, each an index seek on
  // idx_telemetry_asset_metric_ts. A single window-function query over all pairs
  // reads far more rows to return the same few hundred.
  const tiles = await Promise.all(chosen.map(async (c) => {
    const series = await db.execute<{ ts: string; v: number }>(sql`
      SELECT timestamp AS ts, (value#>>'{}')::double precision AS v
      FROM telemetry
      WHERE asset_id = ${c.assetId} AND metric = ${c.metric}
        AND jsonb_typeof(value) = 'number'
      ORDER BY timestamp DESC
      LIMIT ${points}
    `);
    const ordered = series.rows.slice().reverse();
    const values = ordered.map((r) => r.v).filter((v) => Number.isFinite(v));
    const rule = c.ruleId ? rules.find((r) => r.id === c.ruleId) ?? null : null;

    return {
      assetId: c.assetId,
      assetName: assetNames.get(c.assetId) ?? "Unknown asset",
      metric: c.metric,
      current: values.length ? values[values.length - 1] : null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      lastAt: ordered.length ? new Date(ordered[ordered.length - 1].ts).toISOString() : null,
      series: ordered.map((r) => ({ t: new Date(r.ts).toISOString(), v: r.v })),
      threshold: rule?.threshold ?? null,
      operator: rule?.operator ?? null,
      ruleName: rule?.name ?? null,
      severity: rule?.severity ?? null,
      inAlarm: c.ruleId ? alarming.has(`${c.ruleId}|${c.assetId}`) : false,
    };
  }));

  res.json({ tiles: tiles.filter((t) => t.series.length > 0) });
});

export default router;
