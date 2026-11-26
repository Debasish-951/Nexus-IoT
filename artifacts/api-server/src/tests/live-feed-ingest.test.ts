/**
 * Audit 23 Nov 2026, work package D: Live Feed batching (H-8), ingest repeats and
 * limits (M-17), single "cleared" event (L-15), 400 instead of 500 (L-18) and the
 * unread MFA column (L-26). Same runner as the other suites: no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLiveSummary, LiveSummaryBody, LIVE_SUMMARY_MAX_IDS } from "../lib/live-summary";
import { idOutsideScope, scopeCacheKey } from "../lib/project-access";
import { dropRepeatedReadings, clampTelemetryLimit, TELEMETRY_MAX_LIMIT, AssetIdParam, TelemetryCsvQuery, type PrevReading } from "../routes/ingest";
import { needsSafetyNetEntry } from "../lib/audit-core";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", rel), "utf8");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

// ── H-8: batched live summary ───────────────────────────────────────────────

test("live-summary: one item per existing asset, in request order, with alarms, interval and live attributes", () => {
  const out = buildLiveSummary(
    [B, A, C, A],
    [{ id: A, ts: "2026-11-25T10:00:00Z" }, { id: B, ts: null }],
    [{ assetId: A, n: "2" }],
    [
      { assetId: A, name: "Temperature", type: "dynamic", tagName: "temp", sourceMetric: null, value: 71.5, uom: "C", decimalPlaces: 1, timestamp: new Date("2026-11-25T10:00:00Z") },
      { assetId: A, name: "Expected interval (min)", type: "static", tagName: null, sourceMetric: null, value: "10", uom: null, decimalPlaces: null, timestamp: null },
      { assetId: A, name: "Serial", type: "static", tagName: null, sourceMetric: null, value: "X1", uom: null, decimalPlaces: null, timestamp: null },
      { assetId: B, name: "Rate", type: "runtime", tagName: null, sourceMetric: null, value: 3, uom: null, decimalPlaces: null, timestamp: null },
    ],
  );
  // C does not exist; the repeated A is answered once.
  assert.deepEqual(out.map((x) => x.assetId), [B, A]);
  const a = out[1]!;
  assert.equal(a.lastSeen, "2026-11-25T10:00:00.000Z");
  assert.equal(a.activeAlarms, 2);
  assert.equal(a.expectedInterval, "10");
  assert.deepEqual(a.attributes.map((x) => x.name), ["Temperature"]);
  assert.equal(a.attributes[0]!.timestamp, "2026-11-25T10:00:00.000Z");
  const b = out[0]!;
  assert.equal(b.lastSeen, null);
  assert.equal(b.activeAlarms, 0);
  assert.equal(b.expectedInterval, null);
  assert.deepEqual(b.attributes.map((x) => x.type), ["runtime"]);
});

test("live-summary: body must be a bounded list of UUIDs", () => {
  assert.equal(LiveSummaryBody.safeParse({ ids: [A, B] }).success, true);
  assert.equal(LiveSummaryBody.safeParse({ ids: ["not-a-uuid"] }).success, false);
  assert.equal(LiveSummaryBody.safeParse({}).success, false);
  const many = Array.from({ length: LIVE_SUMMARY_MAX_IDS + 1 }, () => A);
  assert.equal(LiveSummaryBody.safeParse({ ids: many }).success, false);
});

test("live-summary: 200 assets are one request per poll, far below the per-user limit", () => {
  // The page sends at most CHUNK ids per request; the server accepts more than that.
  const page = readFileSync(join(here, "..", "..", "..", "iot-platform", "src", "features", "liveFeed", "useLiveData.ts"), "utf8");
  const chunk = Number(/const CHUNK = (\d+);/.exec(page)?.[1]);
  assert.ok(chunk >= 200 && chunk <= LIVE_SUMMARY_MAX_IDS);
  // No per-asset health / attributes polling is left.
  assert.doesNotMatch(page, /\/health`/);
  assert.doesNotMatch(page, /\/attributes`/);
  assert.match(page, /\/api\/assets\/live-summary/);
  // 30 polls (15 minutes) for 200 assets = 30 requests, versus 600 a minute allowed.
  const requestsPerMinute = Math.ceil(200 / chunk) * (60 / 30);
  assert.ok(requestsPerMinute * 15 < 600);
  // A 429 backs off and marks assets unknown instead of ageing them to offline.
  assert.match(page, /status === 429/);
  assert.match(page, /statusWhenRefreshFailed/);
});

test("live-summary: the status of an asset the page could not refresh is unknown unless recently seen", () => {
  const status = readFileSync(join(here, "..", "..", "..", "iot-platform", "src", "features", "liveFeed", "status.ts"), "utf8");
  assert.match(status, /base === "online" \? "online" : "unknown"/);
});

test("live-summary: route rule, scope check on body ids, and no audit row per poll", () => {
  assert.match(src("middleware/authorize.ts"), /path: "\/assets\/live-summary",\s+methods: \["POST"\],\s+module: "assets", level: "read"/);
  assert.equal(needsSafetyNetEntry("POST", "/api/assets/live-summary", 200, false), false);
  assert.match(src("lib/project-access.ts"), /LIVE_SUMMARY\.test\(req\.path\) && req\.method === "POST"/);
});

test("project scope: every id in the body must be inside the caller's projects", () => {
  const scope = { roots: new Set([A]), assetIds: new Set([A, B]) };
  assert.equal(idOutsideScope({ ids: [A, B] }, scope), undefined);
  assert.deepEqual(idOutsideScope({ ids: [A, C] }, scope), { id: C });
  assert.deepEqual(idOutsideScope({ ids: [A, 5] }, scope), { id: null });
  // Not a list: the route answers 400 itself.
  assert.equal(idOutsideScope({}, scope), undefined);
});

test("project scope cache: keyed by user and their project list, order-insensitive", () => {
  const k1 = scopeCacheKey("u1", { restrictProjects: true, allowedProjects: [A, B] });
  assert.equal(k1, scopeCacheKey("u1", { restrictProjects: true, allowedProjects: [B, A] }));
  assert.notEqual(k1, scopeCacheKey("u1", { restrictProjects: true, allowedProjects: [A] }));
  assert.notEqual(k1, scopeCacheKey("u2", { restrictProjects: true, allowedProjects: [A, B] }));
});

// ── M-17: repeats, limit cap ────────────────────────────────────────────────

test("ingest: a retried reading (same metric, device time and value) is not stored twice", () => {
  const ts = new Date("2026-11-25T10:00:00Z");
  const prev: Record<string, PrevReading> = {
    temp: { value: 71.5, ts, raw: 71.5 },
    state: { value: null, ts, raw: "RUN" },
    rpm: { value: 1200, ts: new Date(ts.getTime() - 1000), raw: 1200 },
  };
  const recs = [
    { metric: "temp", value: 71.5 },   // exact repeat
    { metric: "state", value: "RUN" }, // exact repeat (text)
    { metric: "rpm", value: 1200 },    // newer reading with the same value
    { metric: "flow", value: 3 },      // nothing stored yet
  ];
  assert.deepEqual(dropRepeatedReadings(recs, prev, ts, true).map((r) => r.metric), ["rpm", "flow"]);
  // Same time, different value: a correction, kept.
  assert.equal(dropRepeatedReadings([{ metric: "temp", value: 72 }], prev, ts, true).length, 1);
  // No device timestamp: server time, never a repeat.
  assert.equal(dropRepeatedReadings(recs, prev, ts, false).length, 4);
});

test("ingest: GET /telemetry/:id limit is capped", () => {
  assert.equal(clampTelemetryLimit(undefined), 100);
  assert.equal(clampTelemetryLimit(2000), 2000);
  assert.equal(clampTelemetryLimit(10_000_000), TELEMETRY_MAX_LIMIT);
  assert.equal(clampTelemetryLimit(0), 100);
  assert.equal(clampTelemetryLimit(-5), 1);
});

test("schema: indexes on assets(identifier), assets(parent_id) and alarm_history(asset_id, triggered_at)", () => {
  const assets = readFileSync(join(here, "..", "..", "..", "..", "lib", "db", "src", "schema", "assets.ts"), "utf8");
  const alarms = readFileSync(join(here, "..", "..", "..", "..", "lib", "db", "src", "schema", "alarms.ts"), "utf8");
  assert.match(assets, /index\("assets_identifier_idx"\)\.on\(table\.identifier\)/);
  assert.match(assets, /index\("assets_parent_id_idx"\)\.on\(table\.parentId\)/);
  assert.match(alarms, /index\("alarm_history_asset_triggered_idx"\)\.on\(table\.assetId, table\.triggeredAt\)/);
});

// ── L-15: one clear ─────────────────────────────────────────────────────────

test("alarms: the clear is conditional and only the winner reports it", () => {
  const ingest = src("routes/ingest.ts");
  const clear = ingest.slice(ingest.indexOf("const [closed] = await db.update(alarmsTable)"));
  assert.match(clear, /^const \[closed\] = await db\.update\(alarmsTable\)\.set\(\{ status: "cleared", clearedAt: ts \}\)\s+\.where\(and\(eq\(alarmsTable\.id, existing\.id\), inArray\(alarmsTable\.status, \["active", "acknowledged"\]\)\)\)\s+\.returning/);
  const guard = clear.indexOf("if (!closed) continue;");
  assert.ok(guard > 0 && guard < clear.indexOf('event: "cleared"'));
});

// ── L-18: 400, not 500 ──────────────────────────────────────────────────────

test("validation: malformed asset ids and dates are refused before SQL", () => {
  assert.equal(AssetIdParam.safeParse({ assetId: "abc" }).success, false);
  assert.equal(AssetIdParam.safeParse({ assetId: A }).success, true);
  assert.equal(TelemetryCsvQuery.safeParse({ from: "yesterday" }).success, false);
  assert.equal(TelemetryCsvQuery.safeParse({ from: "2026-11-01T00:00:00Z", metric: "temp" }).success, true);
  const ingest = src("routes/ingest.ts");
  for (const route of ['"/telemetry/:assetId/metrics"', '"/telemetry/:assetId/export"', '"/assets/:assetId/health"']) {
    const body = ingest.slice(ingest.indexOf(route), ingest.indexOf(route) + 300);
    assert.match(body, /AssetIdParam\.safeParse\(req\.params\)/, route);
  }
});

// ── L-26: MFA secret not read per request ───────────────────────────────────

test("principal: mfa_secret is not selected into the per-request user", () => {
  const principal = src("middleware/principal.ts");
  assert.match(principal, /const \{ mfaSecret: _mfaSecret, \.\.\.principalColumns \} = getTableColumns\(usersTable\)/);
  assert.match(principal, /db\.select\(principalColumns\)/);
});
