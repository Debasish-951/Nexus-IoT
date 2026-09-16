import { Router, type IRouter } from "express";
import { correlationIdOf } from "../lib/errors";
import { eq, and, or, ilike, sql, desc, gte, lte, inArray } from "drizzle-orm";
import {
  db,
  assetsTable,
  telemetryTable,
  attributesTable,
  alarmsTable,
  alarmHistoryTable,
  brokersTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Config ────────────────────────────────────────────────────────────────────
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// openai/gpt-oss-120b = best free Groq model for tool use (llama-3.3-70b-versatile,
// the prior default, was deprecated by Groq and now returns model_not_found).
// Override via GROQ_MODEL env if desired (e.g. openai/gpt-oss-20b for speed).
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const MAX_TOOL_ROUNDS = 6; // safety cap on the agentic loop
const GROQ_TIMEOUT_MS = 30_000; // a stalled call must not hang the request forever
const QUERY_TELEMETRY_MAX_POINTS = 50;
// A 429 asking us to wait this long or less is retried once in place; the free
// tier's per-minute window usually frees up within a few seconds.
const MAX_RATE_LIMIT_WAIT_S = 10;

const SYSTEM_PROMPT = `You are the AI Assistant for an industrial IoT platform called Integrated Suite.
You answer questions about physical assets (machines/sensors), their telemetry (time-series readings), and alarms.

RULES:
- Answer ONLY from the data returned by the tools. Never invent numbers, asset names, or values.
- To reference an asset by name (e.g. "Pump-101", "Fan"), first call resolve_asset to get its id.
- One asset can hold many machines. Telemetry metric names are dotted paths such as
  "Unit 1.Synthetic Dyeing.Preparation.Creel Machine.temperature" (<location...>.<machine>.<parameter>).
  A machine, section or parameter name is NOT an asset. Pass it to resolve_asset anyway: it searches
  asset names AND metric names, and returns the owning assetId and the full metric names.
- Once a tool result gives you an assetId and full metric name, use them directly; do not resolve again.
- For questions about stability, noise, fluctuation, variability, spikes or trend of a parameter, call
  aggregate_telemetry for that metric. Latest values alone cannot answer these questions. Read its result this way:
  * value_changes far below n: the value is held between updates; say how often it updates
    (minutes_between_changes) instead of calling the repeats noise or stability.
  * avg_change_pct_of_range: under ~5% means gradual/smooth changes, 5-20% moderate, over ~20% erratic
    (each update jumps far).
  * stddev relative to avg is the overall spread; trend_per_hour is the drift over the window.
  * The data covers first_ts to last_ts, which can be much shorter than the selected time range: describe
    that span, not the selected range.
  * Call a trend clear only if |trend_per_hour| x hours covered is comparable to or larger than stddev;
    otherwise describe it as a slight drift or no clear trend.
  * n = 0 means no numeric data in the selected range: say so, and use dataAvailable to tell the user
    when that metric does have data.
  State the conclusion and the numbers behind it.
- Call tools to gather the data you need, then give a clear, concise answer.
- Always cite concrete numbers, units, and timestamps from the tool results.
- If the tools return no data for a question, say so plainly — do not guess.
- You are READ-ONLY. You cannot change, acknowledge, or delete anything. If asked to, explain that you can only report.
- For "needs maintenance" / "recommendations" questions, rank assets using available signals
  (active alarms, recent alarm history, data freshness/staleness, rate-of-change in metrics) and
  state clearly that this is a heuristic ranking, not a machine-learning failure prediction.
- Keep answers focused. Use short paragraphs or bullet points.`;

// ── Tool implementations (all READ-ONLY) ────────────────────────────────────────

// Matching word by word, not on the raw string, so a machine the model writes
// as "Unit 1 Synthetic Dyeing Creel Machine" still finds the dotted metric path
// "Unit 1.Synthetic Dyeing.Preparation.Creel Machine.temperature". Splitting on
// anything that is not a letter or digit also strips LIKE wildcards (% and _).
function queryWords(query: unknown): string[] {
  return String(query ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 12);
}

const RESOLVE_MAX_METRICS = 40;

async function resolveAsset(args: { query: string }) {
  const words = queryWords(args.query);
  if (words.length === 0) return { matches: [], metricMatches: [] };

  const matches = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      identifier: assetsTable.identifier,
      maintenanceMode: assetsTable.maintenanceMode,
    })
    .from(assetsTable)
    .where(and(...words.map((w) => or(ilike(assetsTable.name, `%${w}%`), ilike(assetsTable.identifier, `%${w}%`)))))
    .limit(10);

  // Words are matched against "<asset name> <metric name>" so a question that
  // mixes the two ("Textile creel temperature") still resolves.
  const metricRows = await db
    .select({ assetId: attributesTable.assetId, assetName: assetsTable.name, metric: attributesTable.name })
    .from(attributesTable)
    .innerJoin(assetsTable, eq(assetsTable.id, attributesTable.assetId))
    .where(and(
      eq(attributesTable.type, "dynamic"),
      ...words.map((w) => ilike(sql<string>`${assetsTable.name} || ' ' || ${attributesTable.name}`, `%${w}%`)),
    ))
    .limit(RESOLVE_MAX_METRICS + 1);

  const groups = new Map<string, { assetId: string; assetName: string; machine: string; metrics: string[] }>();
  for (const r of metricRows.slice(0, RESOLVE_MAX_METRICS)) {
    const [machine, leaf] = splitMetric(r.metric);
    const key = `${r.assetId} ${machine}`;
    const group = groups.get(key) ?? { assetId: r.assetId, assetName: r.assetName, machine, metrics: [] };
    group.metrics.push(leaf);
    groups.set(key, group);
  }

  return {
    matches,
    metricMatches: [...groups.values()],
    ...(metricRows.length > RESOLVE_MAX_METRICS
      ? { note: `More than ${RESOLVE_MAX_METRICS} metrics matched; add words to narrow the search.` }
      : {}),
  };
}

async function listAssets() {
  const rows = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      identifier: assetsTable.identifier,
      parentId: assetsTable.parentId,
      childCount: assetsTable.childCount,
      maintenanceMode: assetsTable.maintenanceMode,
    })
    .from(assetsTable)
    .orderBy(assetsTable.name)
    .limit(500);
  return { count: rows.length, assets: rows };
}

async function listMetrics(args: { assetId: string }) {
  const rows = await latestMetricRows(args.assetId);
  const machines: Record<string, string[]> = {};
  for (const r of rows) {
    const [machine, leaf] = splitMetric(r.metric);
    (machines[machine] ??= []).push(leaf);
  }
  return { metricCount: rows.length, machines };
}

async function latestMetricRows(assetId: string) {
  // `attributes` is the ingest pipeline's own latest-value cache (updated on every
  // write in processNormalised) and its `name` is the same string as
  // telemetry.metric — reading it here avoids a DISTINCT ON scan over the full
  // telemetry history, which is unbounded and, for a long-lived asset, painfully
  // slow (multi-minute on a multi-million-row table).
  return db
    .select({
      metric: attributesTable.name,
      value: attributesTable.value,
      quality: attributesTable.quality,
      timestamp: attributesTable.timestamp,
    })
    .from(attributesTable)
    .where(and(eq(attributesTable.assetId, assetId), eq(attributesTable.type, "dynamic")));
}

// Metric names are full dotted paths ("Unit 1.Dyeing.Machine.temperature"), so a
// flat list repeats the machine path on every row. Tool results count against
// Groq's free-tier limit of 8,000 tokens per minute, and the flat list alone cost
// ~3,400 tokens for one asset — enough to rate-limit the next question.
function splitMetric(metric: string): [machine: string, leaf: string] {
  const dot = metric.lastIndexOf(".");
  return dot === -1 ? ["", metric] : [metric.slice(0, dot), metric.slice(dot + 1)];
}

async function getLatestTelemetry(args: { assetId: string }) {
  const rows = await latestMetricRows(args.assetId);
  const machines: Record<string, Record<string, unknown>> = {};
  let from: Date | null = null;
  let to: Date | null = null;
  for (const r of rows) {
    const [machine, leaf] = splitMetric(r.metric);
    (machines[machine] ??= {})[leaf] = r.quality ? { value: r.value, quality: r.quality } : r.value;
    if (r.timestamp) {
      if (!from || r.timestamp < from) from = r.timestamp;
      if (!to || r.timestamp > to) to = r.timestamp;
    }
  }
  return {
    metricCount: rows.length,
    readingsFrom: from?.toISOString() ?? null,
    readingsTo: to?.toISOString() ?? null,
    machines,
  };
}

// The model sometimes passes a bare parameter ("energyConsumptionKWh") or a
// spaced path instead of the full dotted metric name. That matched no telemetry
// and produced a confident "no data" answer, so names are resolved here instead
// of trusting the model to rebuild them. Returns the metric name to query, or
// the candidate full names when several machines share the parameter.
async function resolveMetricName(assetId: string, metric: string): Promise<string | string[]> {
  const words = queryWords(metric);
  if (words.length === 0) return metric;

  const [exact] = await db
    .select({ name: attributesTable.name })
    .from(attributesTable)
    .where(and(eq(attributesTable.assetId, assetId), eq(attributesTable.name, metric)))
    .limit(1);
  if (exact) return metric;

  const rows = await db
    .select({ name: attributesTable.name })
    .from(attributesTable)
    .where(and(
      eq(attributesTable.assetId, assetId),
      eq(attributesTable.type, "dynamic"),
      ...words.map((w) => ilike(attributesTable.name, `%${w}%`)),
    ))
    .limit(RESOLVE_MAX_METRICS + 1);

  // Nothing in the latest-value cache: query telemetry with the name as given.
  if (rows.length === 0) return metric;
  if (rows.length === 1) return rows[0].name;

  const lower = metric.toLowerCase();
  const sameLeaf = rows.filter((r) => splitMetric(r.name)[1].toLowerCase() === lower);
  if (sameLeaf.length === 1) return sameLeaf[0].name;
  return (sameLeaf.length > 1 ? sameLeaf : rows).slice(0, RESOLVE_MAX_METRICS).map((r) => r.name);
}

function ambiguousMetric(requested: string, candidates: string[]) {
  return {
    error: `"${requested}" matches more than one metric. Call again with the full name of the one the user means.`,
    candidates,
  };
}

// The analysis window the user picked in the UI. The server applies it to every
// history tool itself, so the model cannot widen, shift or forget it.
interface ToolContext {
  from: Date;
  to: Date;
}

// When the whole history of a metric sits outside the selected range, the model
// otherwise reports "no data" as if the metric never existed.
async function metricDataSpan(assetId: string, metric: string) {
  const [row] = await db
    .select({
      first: sql<string | null>`min(${telemetryTable.timestamp})`,
      last: sql<string | null>`max(${telemetryTable.timestamp})`,
    })
    .from(telemetryTable)
    .where(and(eq(telemetryTable.assetId, assetId), eq(telemetryTable.metric, metric)));
  return { first: row?.first ?? null, last: row?.last ?? null };
}

async function queryTelemetry(args: { assetId: string; metric: string }, ctx: ToolContext) {
  const resolved = await resolveMetricName(args.assetId, args.metric);
  if (Array.isArray(resolved)) return ambiguousMetric(args.metric, resolved);
  const metric = resolved;

  // Averaged into buckets spread evenly over the range. Returning the latest N raw
  // points showed only the final minutes of a long range.
  const rows = await db.execute<{ bucket_start: string; avg: number; min: number; max: number; n: number }>(sql`
    SELECT
      MIN(timestamp) AS bucket_start,
      ROUND(AVG(v), 3)::float8 AS avg,
      MIN(v)::float8 AS min,
      MAX(v)::float8 AS max,
      COUNT(*)::int AS n
    FROM (
      SELECT timestamp, (value#>>'{}')::numeric AS v
      FROM telemetry
      WHERE asset_id = ${args.assetId}
        AND metric = ${metric}
        AND timestamp >= ${ctx.from}
        AND timestamp <= ${ctx.to}
        AND jsonb_typeof(value) = 'number'
    ) points
    GROUP BY width_bucket(
      EXTRACT(EPOCH FROM timestamp)::float8,
      ${ctx.from.getTime() / 1000}::float8,
      ${ctx.to.getTime() / 1000}::float8,
      ${QUERY_TELEMETRY_MAX_POINTS}::int
    )
    ORDER BY 1
  `);

  if (rows.rows.length > 0) {
    return {
      metric,
      columns: ["bucket_start", "avg", "min", "max", "readings"],
      buckets: rows.rows.map((r) => [r.bucket_start, r.avg, r.min, r.max, r.n]),
      dataAvailable: await metricDataSpan(args.assetId, metric),
    };
  }

  // Non-numeric metrics (status, batch ids) cannot be averaged: return the most
  // recent raw values in the range instead.
  const raw = await db
    .select({ value: telemetryTable.value, timestamp: telemetryTable.timestamp })
    .from(telemetryTable)
    .where(and(
      eq(telemetryTable.assetId, args.assetId),
      eq(telemetryTable.metric, metric),
      gte(telemetryTable.timestamp, ctx.from),
      lte(telemetryTable.timestamp, ctx.to),
    ))
    .orderBy(desc(telemetryTable.timestamp))
    .limit(QUERY_TELEMETRY_MAX_POINTS);
  return {
    metric,
    count: raw.length,
    points: raw.map((r) => [r.timestamp.toISOString(), r.value]),
    dataAvailable: await metricDataSpan(args.assetId, metric),
  };
}

async function aggregateTelemetry(args: { assetId: string; metric: string }, ctx: ToolContext) {
  const resolved = await resolveMetricName(args.assetId, args.metric);
  if (Array.isArray(resolved)) return ambiguousMetric(args.metric, resolved);
  const metric = resolved;
  // Only aggregate numeric values. Change statistics count only readings where
  // the value actually moved: ingest often stores the same value many times
  // between sensor updates (>95% repeats in practice), and averaging over those
  // zeros made an erratic signal look smooth.
  const rows = await db.execute<{
    n: number; avg: number | null; min: number | null; max: number | null; stddev: number | null;
    value_changes: number; avg_change_size: number | null; max_change_size: number | null;
    avg_change_pct_of_range: number | null; minutes_between_changes: number | null;
    trend_per_hour: number | null; first_ts: string | null; last_ts: string | null;
  }>(sql`
    WITH points AS (
      SELECT timestamp, (value#>>'{}')::numeric AS v
      FROM telemetry
      WHERE asset_id = ${args.assetId}
        AND metric = ${metric}
        AND timestamp >= ${ctx.from}
        AND timestamp <= ${ctx.to}
        AND jsonb_typeof(value) = 'number'
    ), steps AS (
      SELECT timestamp, v, ABS(v - LAG(v) OVER (ORDER BY timestamp)) AS step FROM points
    )
    SELECT
      COUNT(*)::int AS n,
      ROUND(AVG(v), 3)::float8 AS avg,
      MIN(v)::float8 AS min,
      MAX(v)::float8 AS max,
      ROUND(STDDEV_SAMP(v), 3)::float8 AS stddev,
      COUNT(*) FILTER (WHERE step > 0)::int AS value_changes,
      ROUND(AVG(step) FILTER (WHERE step > 0), 3)::float8 AS avg_change_size,
      MAX(step)::float8 AS max_change_size,
      ROUND(100 * AVG(step) FILTER (WHERE step > 0) / NULLIF(MAX(v) - MIN(v), 0), 1)::float8 AS avg_change_pct_of_range,
      ROUND((EXTRACT(EPOCH FROM MAX(timestamp) - MIN(timestamp)) / 60
             / NULLIF(COUNT(*) FILTER (WHERE step > 0), 0))::numeric, 2)::float8 AS minutes_between_changes,
      ROUND((REGR_SLOPE(v::float8, EXTRACT(EPOCH FROM timestamp)::float8) * 3600)::numeric, 4)::float8 AS trend_per_hour,
      MIN(timestamp) AS first_ts,
      MAX(timestamp) AS last_ts
    FROM steps
  `);
  return { metric, stats: rows.rows[0] ?? null, dataAvailable: await metricDataSpan(args.assetId, metric) };
}

async function assetHealth(args: { assetId: string }) {
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, args.assetId));
  if (!asset) return { error: "asset not found" };

  const [alarmCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alarmsTable)
    .where(and(eq(alarmsTable.assetId, args.assetId), eq(alarmsTable.status, "active")));

  const latest = await latestMetricRows(args.assetId);
  const lastSeenDate = latest.reduce<Date | null>((acc, r) => {
    if (!r.timestamp) return acc;
    return !acc || r.timestamp > acc ? r.timestamp : acc;
  }, null);

  const activeAlarms = alarmCount?.count ?? 0;
  const stale = lastSeenDate ? Date.now() - lastSeenDate.getTime() > 30 * 60_000 : true;
  const health = activeAlarms > 0 ? "alarm" : stale ? "stale" : "ok";

  return {
    assetId: asset.id,
    name: asset.name,
    health,
    activeAlarms,
    maintenanceMode: asset.maintenanceMode,
    lastSeen: lastSeenDate ? lastSeenDate.toISOString() : null,
    metricCount: latest.length,
  };
}

async function getAlarms(args: { status?: string; severity?: string }) {
  const conds = [];
  if (args.status) conds.push(eq(alarmsTable.status, args.status));
  else conds.push(inArray(alarmsTable.status, ["active", "acknowledged"]));
  if (args.severity) conds.push(eq(alarmsTable.severity, args.severity));

  const rows = await db
    .select({
      name: alarmsTable.name,
      assetName: alarmsTable.assetName,
      severity: alarmsTable.severity,
      status: alarmsTable.status,
      message: alarmsTable.message,
      triggeredAt: alarmsTable.triggeredAt,
    })
    .from(alarmsTable)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .orderBy(desc(alarmsTable.triggeredAt))
    .limit(100);
  return { count: rows.length, alarms: rows };
}

async function getAlarmHistory(_args: Record<string, never>, ctx: ToolContext) {
  const rows = await db
    .select({
      name: alarmHistoryTable.name,
      assetName: alarmHistoryTable.assetName,
      severity: alarmHistoryTable.severity,
      status: alarmHistoryTable.status,
      triggeredAt: alarmHistoryTable.triggeredAt,
      clearedAt: alarmHistoryTable.clearedAt,
    })
    .from(alarmHistoryTable)
    .where(and(gte(alarmHistoryTable.triggeredAt, ctx.from), lte(alarmHistoryTable.triggeredAt, ctx.to)))
    .orderBy(desc(alarmHistoryTable.triggeredAt))
    .limit(200);
  return { count: rows.length, history: rows };
}

async function fleetSummary() {
  const [assets] = await db.select({ c: sql<number>`count(*)::int` }).from(assetsTable);
  const [users] = await db.select({ c: sql<number>`count(*)::int` }).from(usersTable);
  const [connectedBrokers] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(brokersTable)
    .where(eq(brokersTable.status, "connected"));
  const bySeverity = await db
    .select({ severity: alarmsTable.severity, c: sql<number>`count(*)::int` })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"))
    .groupBy(alarmsTable.severity);
  const [recent] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(telemetryTable)
    .where(gte(telemetryTable.timestamp, new Date(Date.now() - 5 * 60_000)));

  return {
    totalAssets: assets?.c ?? 0,
    totalUsers: users?.c ?? 0,
    connectedBrokers: connectedBrokers?.c ?? 0,
    activeAlarmsBySeverity: bySeverity,
    telemetryRatePerMin: (recent?.c ?? 0) / 5,
  };
}

// ── Tool registry: executor + JSON-schema definition for the model ──────────────
type ToolFn = (args: any, ctx: ToolContext) => Promise<unknown>;

const TOOLS: Record<string, { fn: ToolFn; def: any }> = {
  resolve_asset: {
    fn: resolveAsset,
    def: {
      name: "resolve_asset",
      description: "Find assets AND telemetry metrics by name. Matches every word of the query against asset names/identifiers and against metric names (which include machine names). Returns `matches` (assets) and `metricMatches` grouped by asset and machine; the full metric name for other tools is `<machine>.<metric>`. Use this first for any asset, machine or parameter the user names.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Asset, machine or parameter name, e.g. 'Pump-101', 'Creel Machine', 'Creel Machine temperature'" } },
        required: ["query"],
      },
    },
  },
  list_assets: {
    fn: listAssets,
    def: {
      name: "list_assets",
      description: "List all assets with id, name, identifier, child count, and maintenance status.",
      parameters: { type: "object", properties: {} },
    },
  },
  list_metrics: {
    fn: listMetrics,
    def: {
      name: "list_metrics",
      description: "List the telemetry metric names for one asset, grouped by machine path. The full metric name for other tools is `<machine>.<metric>`.",
      parameters: {
        type: "object",
        properties: { assetId: { type: "string", description: "Asset UUID" } },
        required: ["assetId"],
      },
    },
  },
  get_latest_telemetry: {
    fn: getLatestTelemetry,
    def: {
      name: "get_latest_telemetry",
      description: "Get the most recent reading for each metric of an asset, grouped by machine path, with the time range the readings came from. The full metric name for other tools is `<machine>.<metric>`.",
      parameters: {
        type: "object",
        properties: { assetId: { type: "string", description: "Asset UUID" } },
        required: ["assetId"],
      },
    },
  },
  query_telemetry: {
    fn: queryTelemetry,
    def: {
      name: "query_telemetry",
      description: "Get the time series of one metric of one asset within the user's selected time range, averaged into up to 50 buckets spread evenly over the range (bucket_start, avg, min, max, readings); non-numeric metrics return the latest raw values instead. Includes dataAvailable (first/last reading of this metric ever). Prefer aggregate_telemetry for trends and comparisons.",
      parameters: {
        type: "object",
        properties: {
          assetId: { type: "string", description: "Asset UUID" },
          metric: { type: "string", description: "Full metric name as listed by list_metrics, i.e. `<machine>.<metric>`" },
        },
        required: ["assetId", "metric"],
      },
    },
  },
  aggregate_telemetry: {
    fn: aggregateTelemetry,
    def: {
      name: "aggregate_telemetry",
      description: "Get statistics for a numeric metric of one asset within the user's selected time range: n readings, avg, min, max, stddev; value_changes (readings where the value actually changed), avg_change_size and max_change_size (over those changes only), avg_change_pct_of_range, minutes_between_changes, trend_per_hour (linear drift), first/last reading times in the range, and dataAvailable (first/last reading of this metric ever). Use for trends, comparisons, and whether a signal is stable, smooth, erratic or drifting.",
      parameters: {
        type: "object",
        properties: {
          assetId: { type: "string", description: "Asset UUID" },
          metric: { type: "string", description: "Full metric name as listed by list_metrics, i.e. `<machine>.<metric>`" },
        },
        required: ["assetId", "metric"],
      },
    },
  },
  asset_health: {
    fn: assetHealth,
    def: {
      name: "asset_health",
      description: "Get a health summary for one asset: ok/alarm/stale status, active alarm count, last-seen time, maintenance mode, and how many metrics it reports. Call get_latest_telemetry for the metric values.",
      parameters: {
        type: "object",
        properties: { assetId: { type: "string", description: "Asset UUID" } },
        required: ["assetId"],
      },
    },
  },
  get_alarms: {
    fn: getAlarms,
    def: {
      name: "get_alarms",
      description: "List current alarms. Optionally filter by status (active|acknowledged|cleared) or severity (critical|high|medium|low|info). Defaults to active+acknowledged.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "active|acknowledged|cleared" },
          severity: { type: "string", description: "critical|high|medium|low|info" },
        },
      },
    },
  },
  get_alarm_history: {
    fn: getAlarmHistory,
    def: {
      name: "get_alarm_history",
      description: "List historical alarm records triggered within the user's selected time range. Use to find which assets alarm most often.",
      parameters: { type: "object", properties: {} },
    },
  },
  fleet_summary: {
    fn: fleetSummary,
    def: {
      name: "fleet_summary",
      description: "Get platform-wide counts: total assets, users, connected brokers, active alarms by severity, and telemetry ingest rate per minute.",
      parameters: { type: "object", properties: {} },
    },
  },
};

const TOOL_SPECS = Object.values(TOOLS).map((t) => ({ type: "function", function: t.def }));

// ── Groq tool-use agent loop ────────────────────────────────────────────────────
class GroqRateLimitError extends Error {
  constructor(readonly retryAfterSec: number) {
    super(`Groq rate limit reached; retry after ${retryAfterSec}s`);
  }
}

// Groq sends a `retry-after` header in seconds and also names the wait in the
// message body ("Please try again in 7.74s", or "1m2.5s" for longer waits).
function retryAfterSeconds(resp: Response, body: string): number {
  const header = Number(resp.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header;
  const m = /try again in (?:(\d+)m)?([\d.]+)(ms|s)/.exec(body);
  if (m) {
    const minutes = m[1] ? Number(m[1]) * 60 : 0;
    const rest = m[3] === "ms" ? Number(m[2]) / 1000 : Number(m[2]);
    return minutes + rest;
  }
  return 60;
}

async function callGroq(
  messages: any[],
  opts: { allowTools?: boolean; isRetry?: boolean } = {},
): Promise<any> {
  const { allowTools = true, isRetry = false } = opts;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      messages,
      tools: TOOL_SPECS,
      tool_choice: allowTools ? "auto" : "none",
    }),
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
  });

  if (resp.status === 429) {
    const text = await resp.text();
    const wait = retryAfterSeconds(resp, text);
    if (!isRetry && wait <= MAX_RATE_LIMIT_WAIT_S) {
      logger.info({ waitSeconds: wait }, "Groq rate limit reached; waiting and retrying once");
      await new Promise((resolve) => setTimeout(resolve, Math.ceil((wait + 0.5) * 1000)));
      return callGroq(messages, { allowTools, isRetry: true });
    }
    throw new GroqRateLimitError(Math.ceil(wait));
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Groq API ${resp.status}: ${text}`);
  }
  return resp.json();
}

function parseRange(range: unknown): ToolContext | string {
  const r = range as { from?: unknown; to?: unknown } | undefined;
  if (typeof r?.from !== "string" || typeof r?.to !== "string") {
    return "Select a start and end time for the analysis.";
  }
  const from = new Date(r.from);
  const to = new Date(r.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return "The start or end time is not a valid date.";
  }
  if (from >= to) return "The start time must be earlier than the end time.";
  return { from, to };
}

function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== "string" || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

router.post("/ai/chat", async (req, res): Promise<void> => {
  if (!process.env.GROQ_API_KEY) {
    res.status(503).json({
      error: "AI Assistant not configured. Set GROQ_API_KEY in your .env (free key from https://console.groq.com).",
    });
    return;
  }

  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const range = parseRange(req.body?.range);
  if (typeof range === "string") {
    res.status(400).json({ error: range, code: "invalid_time_range" });
    return;
  }
  const timeZone = validTimeZone(req.body?.timeZone);

  // Optional prior turns: [{ role: "user"|"assistant", content }]
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];

  const rangeInstructions =
    `\n\nTIME RANGE selected by the user: ${range.from.toISOString()} to ${range.to.toISOString()}` +
    (timeZone ? ` (the user's time zone is ${timeZone}; present times in it).` : ".") +
    `\n- query_telemetry, aggregate_telemetry and get_alarm_history are automatically limited to this range.` +
    `\n- asset_health, get_latest_telemetry, get_alarms and fleet_summary describe the current state, not the range; say so when you use them.` +
    `\n- When the range holds no data, say so and use dataAvailable to tell the user when data does exist.`;

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT + rangeInstructions },
    ...history
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];

  const toolTrace: { tool: string; args: unknown }[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const data = await callGroq(messages);
      const msg = data?.choices?.[0]?.message;
      if (!msg) {
        res.status(502).json({ error: "Empty response from model" });
        return;
      }

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        res.json({ answer: msg.content ?? "", steps: toolTrace, model: GROQ_MODEL });
        return;
      }

      // Append the assistant turn carrying the tool calls.
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });

      // Execute each requested tool and append the results.
      for (const call of toolCalls) {
        const name = call.function?.name;
        let args: any = {};
        try {
          args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        let result: unknown;
        const tool = name ? TOOLS[name] : undefined;
        if (!tool) {
          result = { error: `unknown tool: ${name}` };
        } else {
          try {
            result = await tool.fn(args, range);
            toolTrace.push({ tool: name, args });
          } catch (err) {
            // The model sees this string and may repeat it verbatim to the user,
            // so it must be as safe as a response body. A database error here
            // would otherwise reach the chat window through the model.
            logger.warn({ err, tool: name, correlationId: correlationIdOf(req) }, "AI tool call failed");
            result = { error: "that lookup failed" };
          }
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Loop exhausted — ask for a final answer. Tools must be forbidden here: while
    // they are offered the model tends to request one more lookup instead of
    // writing text, which left the user with only the fallback message.
    const finalData = await callGroq(
      [
        ...messages,
        {
          role: "user",
          content:
            "No more tool calls are possible. Give your best final answer now from the data already gathered, " +
            "and state plainly which parts of the question that data could not answer.",
        },
      ],
      { allowTools: false },
    );
    const finalMsg = finalData?.choices?.[0]?.message?.content ?? "I couldn't complete that within the step limit.";
    res.json({ answer: finalMsg, steps: toolTrace, model: GROQ_MODEL, truncated: true });
  } catch (err) {
    if (err instanceof GroqRateLimitError) {
      logger.warn({ retryAfterSec: err.retryAfterSec, correlationId: correlationIdOf(req) }, "AI chat rate limited");
      res.setHeader("Retry-After", String(err.retryAfterSec));
      res.status(429).json({
        error: `The assistant has reached its usage limit for the moment. Please try again in about ${err.retryAfterSec} seconds.`,
        code: "assistant_rate_limited",
        retryAfterSec: err.retryAfterSec,
        correlationId: correlationIdOf(req),
      });
      return;
    }
    // The upstream failure can name the provider host, the model, and in some
    // client libraries echo request headers back in the message. None of that
    // belongs in a response — the full error goes to the log with the id the
    // user is shown.
    logger.error({ err, correlationId: correlationIdOf(req) }, "AI chat failed");
    res.status(502).json({
      error: "The assistant is unavailable right now. Please try again shortly.",
      code: "assistant_unavailable",
      correlationId: correlationIdOf(req),
    });
  }
});

export default router;
