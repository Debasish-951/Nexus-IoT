import { z } from "zod";
import * as v from "../lib/validation";

/**
 * Request schemas for the routes the generated OpenAPI client does not cover.
 *
 * These are hand-written because the endpoints they describe are not in
 * `lib/api-spec/src/openapi.yaml` — exports, system aggregation, the security
 * feed, the visualization tree. Anything that IS in the spec keeps using the
 * generated schema from `@workspace/api-zod`; the middleware adds strictness and
 * the primitives add constraints without either file being hand-edited.
 *
 * Every query schema gives its optional fields explicit bounds. Before this,
 * `?limit=abc` reached `Number()` and produced NaN, which Postgres rejected as a
 * malformed LIMIT — a 500 from the database rather than a 400 from the boundary,
 * for what is simply a bad request.
 */

/** `?format=csv` — anything else, including absent, means JSON. */
export const formatEnum = z.enum(["json", "csv"]).optional();

/** Shared list-window controls. */
export const paginationQuery = {
  limit: v.boundedInt(1, 500, 100).optional(),
  offset: v.boundedInt(0, 1_000_000, 0).optional(),
};

/** Shared time window. */
export const rangeQuery = {
  from: v.timestamp().optional(),
  to: v.timestamp().optional(),
};

// ── Exports ──────────────────────────────────────────────────────────────────

export const ExportQuery = z.object({ format: formatEnum });

export const TelemetryExportQuery = z.object({
  assetId: v.uuid().optional(),
  metric: v.text(200).optional(),
  ...rangeQuery,
  limit: v.boundedInt(1, 5000, 500).optional(),
  format: formatEnum,
});

export const AlarmExportQuery = z.object({
  // Enumerated rather than free text: these are compared against a column whose
  // values are a closed set, so anything outside it can only ever return
  // nothing — better to say so than to run the query.
  status: z.enum(["active", "acknowledged", "cleared"]).optional(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
  format: formatEnum,
});

export const AlarmHistoryExportQuery = z.object({
  assetId: v.uuid().optional(),
  ...rangeQuery,
  limit: v.boundedInt(1, 5000, 200).optional(),
  format: formatEnum,
});

// ── System ───────────────────────────────────────────────────────────────────

/**
 * Bucket sizes, as an enum.
 *
 * Previously a free string looked up in an object with `?? 3600` as the
 * fallback. `?bucket=constructor` does not miss that lookup — it returns a value
 * off the prototype chain, which then failed the `??` guard and was interpolated
 * into the SQL text, producing a 500 from a malformed query. An enum removes the
 * whole class: an unlisted value never reaches the lookup.
 */
export const bucketEnum = z.enum(["1m", "5m", "15m", "30m", "1h", "6h", "12h", "1d", "1w"]);

export const AggregateQuery = z.object({
  assetId: v.uuid().optional(),
  metric: v.text(200).optional(),
  bucket: bucketEnum.default("1h"),
  ...rangeQuery,
  limit: v.boundedInt(1, 10_000, 1000).optional(),
});

export const RetentionBody = z.object({
  name: v.name(),
  // A policy may be scoped to one asset and/or one metric; null means "all".
  assetId: v.uuid().nullable().optional(),
  metric: v.text(200).nullable().optional(),
  // Upper bound is ten years. Unbounded here would mean a policy that never
  // prunes, which is indistinguishable from having no policy but looks like one.
  retentionDays: v.boundedInt(1, 3650),
  enabled: z.boolean().optional(),
});

export const UpdateRetentionBody = RetentionBody.partial();

// ── Activity log / security feed ─────────────────────────────────────────────

export const ActivityLogQuery = z.object({
  ...paginationQuery,
  category: v.text(64).optional(),
  actorName: v.text(200).optional(),
});

export const SecurityEventsQuery = z.object({
  ...paginationQuery,
  eventType: v.text(64).optional(),
  outcome: z.enum(["success", "failure"]).optional(),
  userId: v.uuid().optional(),
  username: v.text(320).optional(),
  days: v.boundedInt(1, 365).optional(),
});

// ── Visualization tree ───────────────────────────────────────────────────────

/**
 * Widget arrays are intentionally `unknown`.
 *
 * A dashboard widget's config is open-ended by design — new widget types add
 * keys, and pinning a schema here would mean a frontend release could not ship
 * without a matching backend release. The structural limits in `validate()`
 * still apply, so open-ended does not mean unbounded: depth, key count, string
 * length and prototype-polluting keys are all still enforced.
 */
const widgetArray = z.array(z.unknown()).max(500, "a dashboard may hold at most 500 widgets");

export const CreateVizNodeBody = z.object({
  id: v.nodeId().optional(),
  name: v.name(),
  parentId: v.nodeId().nullable().optional(),
  widgets: widgetArray.optional(),
});

export const UpdateVizNodeBody = z.object({
  name: v.name().optional(),
  parentId: v.nodeId().nullable().optional(),
  widgets: widgetArray.optional(),
});

export const VizNodeParams = z.object({ id: v.nodeId() });

/** The shape a single imported node must satisfy. Applied per node, not to the batch. */
export const ImportVizNode = z.object({
  id: v.nodeId(),
  name: v.name(),
  parentId: v.nodeId().nullable().optional(),
  widgets: widgetArray.optional(),
});

/**
 * Import validates the ENVELOPE strictly and each node individually.
 *
 * Deliberately not `z.array(ImportVizNode)`, which would fail the whole batch on
 * one bad node. This endpoint exists to migrate dashboards out of browser
 * storage — data written by older versions of this app, whose id and name rules
 * were looser than today's. All-or-nothing there means one legacy node nobody
 * remembers creating silently blocks every dashboard from migrating, and the
 * user sees only that saving failed.
 *
 * So the handler validates node by node, imports what is valid, and reports what
 * was not. Rejecting the batch is the right call for a normal write; for a
 * one-way migration it destroys the thing it was meant to protect.
 */
export const ImportVizNodesBody = z.object({
  nodes: z.array(z.unknown()).max(2000, "at most 2000 nodes may be imported at once"),
});

// ── Destinations ─────────────────────────────────────────────────────────────

/**
 * Note `endpoint` is only checked for SYNTAX here. Whether the host is one the
 * server may call is a separate decision made by lib/outbound-url.ts at both
 * save and send time — see the SSRF guard.
 */
export const CreateDestinationBody = z.object({
  name: v.name(),
  description: v.description().nullable().optional(),
  endpoint: v.httpUrl(),
  authType: z.enum(["bearer", "hmac", "apikey", "basic", "none"]).default("bearer"),
  token: v.text(1024).nullable().optional(),
  secretKey: v.text(1024).nullable().optional(),
  apiKeyHeader: v.text(128).default("X-API-Key"),
  basicUser: v.text(256).nullable().optional(),
  basicPass: v.text(256).nullable().optional(),
  eventTypes: v.boundedArray(v.text(64), 32).default(["alarm"]),
  enabled: z.boolean().default(true),
});

export const UpdateDestinationBody = CreateDestinationBody.partial();

export const IdParams = z.object({ id: v.uuid() });

// ── Dashboard / broker history ───────────────────────────────────────────────

export const DashboardQuery = z.object({
  limit: v.boundedInt(1, 100, 20).optional(),
});

export const BrokerHistoryQuery = z.object({
  ...paginationQuery,
});

// ── Home dashboard (the banded overview) ─────────────────────────────────────
//
// Every window is bounded rather than free. `days=100000` on a trend query is a
// sequential scan of the whole history table dressed up as a request, so the
// ceiling is part of the contract and not a matter of hoping nobody tries.

/**
 * How long telemetry may be absent before an asset counts as "stale".
 *
 * Assets do not declare an expected reporting interval anywhere in the schema,
 * so this cannot be derived — it is a caller-supplied threshold with a sane
 * default rather than a guess dressed up as a measurement.
 */
const staleMinutes = () => v.boundedInt(1, 10_080, 60).optional();

export const AttentionQuery = z.object({
  staleMinutes: staleMinutes(),
  /** Days ahead to treat an API key expiry as worth surfacing. */
  keyExpiryDays: v.boundedInt(1, 365, 14).optional(),
  limit: v.boundedInt(1, 100, 25).optional(),
});

export const HealthIndexQuery = z.object({
  staleMinutes: staleMinutes(),
  /** Window for the downtime component of the score. */
  days: v.boundedInt(1, 90, 7).optional(),
});

export const AlarmTrendQuery = z.object({
  days: v.boundedInt(1, 90, 30).optional(),
  /** Rows in the worst-performers table. */
  topAssets: v.boundedInt(1, 20, 5).optional(),
});

export const IngestSeriesQuery = z.object({
  hours: v.boundedInt(1, 48, 6).optional(),
  /** Devices shown in the connectivity matrix, busiest first. */
  devices: v.boundedInt(1, 40, 8).optional(),
});

export const LiveMetricsQuery = z.object({
  limit: v.boundedInt(1, 12, 6).optional(),
  /** Points per sparkline. */
  points: v.boundedInt(2, 200, 40).optional(),
});
