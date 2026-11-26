/**
 * Data Management operations: legal holds, alert conditions, the pruning window,
 * partitions, ingest rejection naming, settings defaults and access rules.
 * Pure logic only; no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { heldFraction, holdOverlaps, type HoldLike } from "../services/holds";
import { conditionsFor, type StorageFacts } from "../services/system-alerts";
import { insideWindow, parseSettings, DataSettingsUpdate } from "../lib/data-settings";
import { parseBound, partitionName } from "../services/partitions";
import { ingestRouteName } from "../services/ingest-rejections";
import { estimatePrune, type PairDays } from "../routes/system";
import { ruleAllows } from "../middleware/authorize";
import { resolveAccess } from "../lib/rbac";

const DAY = 86_400_000;
const NOW = new Date("2026-11-14T12:00:00Z");

test("holds: overlap and held fraction (merged, capped at 1)", () => {
  const h: HoldLike = { assetId: "A", metric: null, fromTs: new Date("2026-10-01T00:00:00Z"), toTs: new Date("2026-10-02T00:00:00Z") };
  assert.equal(holdOverlaps(h, { assetId: "A", metric: "temp", from: new Date("2026-10-01T12:00:00Z"), to: new Date("2026-10-05T00:00:00Z") }), true);
  assert.equal(holdOverlaps(h, { assetId: "B", metric: "temp", from: new Date("2026-10-01T12:00:00Z"), to: new Date("2026-10-05T00:00:00Z") }), false);
  assert.equal(holdOverlaps(h, { assetId: "A", metric: null, from: new Date("2026-10-03T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z") }), false);
  const start = new Date("2026-10-01T00:00:00Z").getTime();
  assert.equal(heldFraction([h], { assetId: "A", metric: "x" }, start, start + 2 * DAY), 0.5);
  assert.equal(heldFraction([h, h], { assetId: "A", metric: "x" }, start, start + DAY), 1);
  assert.equal(heldFraction([h], { assetId: "B", metric: "x" }, start, start + DAY), 0);
});

test("estimatePrune leaves held readings out", () => {
  const today = Date.UTC(2026, 10, 14);
  const pair: PairDays = { assetId: "A", metric: "t", first: new Date(today - 99 * DAY), last: NOW,
    days: Array.from({ length: 100 }, (_, i) => ({ day: new Date(today - i * DAY), rows: 1000, stored: 1000 })) };
  const policies = [{ id: "g", assetId: null, metric: null, retentionDays: 30 }];
  const free = estimatePrune([pair], policies, NOW, null);
  const hold: HoldLike = { assetId: "A", metric: null, fromTs: new Date(today - 60 * DAY), toTs: new Date(today - 50 * DAY) };
  const held = estimatePrune([pair], policies, NOW, null, [hold]);
  assert.equal(free.rows - held.rows, 10_000, "ten held days are kept");
});

test("pruning window, including one that crosses midnight", () => {
  const tz = "UTC";
  const w = { enabled: true, start: "01:00", end: "05:00" };
  assert.equal(insideWindow(new Date("2026-11-14T02:00:00Z"), w, tz), true);
  assert.equal(insideWindow(new Date("2026-11-14T06:00:00Z"), w, tz), false);
  const night = { enabled: true, start: "22:00", end: "04:00" };
  assert.equal(insideWindow(new Date("2026-11-14T23:30:00Z"), night, tz), true);
  assert.equal(insideWindow(new Date("2026-11-14T03:59:00Z"), night, tz), true);
  assert.equal(insideWindow(new Date("2026-11-14T12:00:00Z"), night, tz), false);
  assert.equal(insideWindow(new Date("2026-11-14T12:00:00Z"), { ...w, enabled: false }, tz), true);
});

test("settings: defaults, and an update rejects unknown fields", () => {
  const s = parseSettings(undefined);
  assert.equal(s.alerts.diskFreePctBelow, 15);
  assert.equal(s.approval.enabled, false);
  assert.equal(s.archive.enabled, false);
  assert.equal(s.tiers.m15Days, 365);
  assert.equal(parseSettings({ alerts: { diskFreePctBelow: 500 } }).alerts.diskFreePctBelow, 15, "invalid stored value falls back to defaults");
  assert.equal(DataSettingsUpdate.safeParse({ bogus: 1 }).success, false);
  assert.equal(DataSettingsUpdate.safeParse({ approval: { enabled: true } }).success, true);
});

function facts(over: Partial<StorageFacts> = {}): StorageFacts {
  return { disk: { freeBytes: 50e9, totalBytes: 100e9, daysUntilFull: null }, rollups: { enabled: true, watermark: new Date(NOW.getTime() - 3_600_000) }, lastRun: null, perAsset: [], ...over };
}
const okExtra: Parameters<typeof conditionsFor>[2] = { lastBackup: { status: "ok", startedAt: new Date(NOW.getTime() - 3_600_000) }, lastGoodBackup: new Date(NOW.getTime() - 3_600_000), rejectionsLastHour: 0, archiveError: null, now: NOW };

test("alert conditions: quiet when all is well", () => {
  assert.deepEqual(conditionsFor(parseSettings({}), facts(), okExtra), []);
});

test("alert conditions: disk, backups, summaries, rejections, quiet assets", () => {
  const s = parseSettings({});
  const keys = (f: StorageFacts, e = okExtra) => conditionsFor(s, f, e).map((c) => c.key).sort();
  assert.deepEqual(keys(facts({ disk: { freeBytes: 5e9, totalBytes: 100e9, daysUntilFull: 10 } })), ["disk_full_soon", "disk_low"]);
  assert.deepEqual(keys(facts(), { ...okExtra, lastBackup: null, lastGoodBackup: null }), ["backup_missing"]);
  assert.deepEqual(keys(facts(), { ...okExtra, lastBackup: { status: "failed", startedAt: NOW }, lastGoodBackup: new Date(NOW.getTime() - 50 * 3_600_000) }), ["backup_failed", "backup_stale"]);
  assert.deepEqual(keys(facts({ rollups: { enabled: true, watermark: new Date(NOW.getTime() - 10 * 3_600_000) } })), ["summaries_behind"]);
  assert.deepEqual(keys(facts(), { ...okExtra, rejectionsLastHour: 101 }), ["ingest_rejections"]);
  assert.deepEqual(keys(facts({ perAsset: [{ assetName: "Pump", newest: new Date(NOW.getTime() - 2 * 3_600_000) }, { assetName: "Old", newest: new Date(NOW.getTime() - 30 * DAY) }] })), ["assets_quiet"]);
  assert.deepEqual(keys(facts({ lastRun: { error: "telemetry: skipped, a run was already in progress", startedAt: NOW } })), [], "a skipped run is not a failure");
  assert.deepEqual(keys(facts({ lastRun: { error: "telemetry: boom", startedAt: NOW } })), ["pruning_failed"]);
  const off = parseSettings({ alerts: { diskFreePctBelow: 0, daysUntilFullBelow: 0, backupMaxAgeHours: 0 } });
  assert.deepEqual(conditionsFor(off, facts({ disk: { freeBytes: 1, totalBytes: 100e9, daysUntilFull: 1 } }), { ...okExtra, lastBackup: null, lastGoodBackup: null }), [], "0 switches a check off");
});

test("partitions: bounds and names", () => {
  const b = parseBound("FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00')");
  assert.equal(b.from?.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(b.to?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(parseBound("DEFAULT").isDefault, true);
  assert.equal(partitionName(new Date("2026-08-15T00:00:00Z")), "p2026_08");
});

test("ingest rejections never store tokens or client ids from the path", () => {
  assert.equal(ingestRouteName("/ingest/e/3f9a8c7d6e5b4a3f2e1d/payload"), "payload");
  assert.equal(ingestRouteName("/ingest/k/abc123/batch"), "batch");
  assert.equal(ingestRouteName("/ingest/e/SECRET_TOKEN_123"), "other");
});

test("access: viewers read health; deleting, restoring, approving and raw SQL need manage_assets", () => {
  const viewer = resolveAccess("viewer", { modules: { reports: true } });
  assert.equal(ruleAllows(viewer, "GET", "/system/data-health"), true);
  assert.equal(ruleAllows(viewer, "GET", "/system/backups"), true);
  assert.equal(ruleAllows(viewer, "GET", "/system/db-health"), false);
  assert.equal(ruleAllows(viewer, "POST", "/system/changes/range-delete"), false);
  assert.equal(ruleAllows(viewer, "POST", "/system/changes/0a1b/approve"), false);
  assert.equal(ruleAllows(viewer, "POST", "/system/archives/0a1b/restore"), false);
  assert.equal(ruleAllows(viewer, "GET", "/system/archives/0a1b/download"), false);
  assert.equal(ruleAllows(viewer, "PUT", "/system/data-settings"), false);
  assert.equal(ruleAllows(viewer, "POST", "/system/holds"), false);
});

test("access: Live Twin and AI Advisor are their own modules, defaults keep today's access", () => {
  // Defaults copy Visualization / Data Explorer; delete comes with edit as before.
  const eng = resolveAccess("engineer", {});
  assert.deepEqual(eng.modules.live_twin, { r: true, w: true, d: true });
  assert.equal(eng.modules.ai_advisor, true);
  const viewer = resolveAccess("viewer", {});
  assert.deepEqual(viewer.modules.live_twin, { r: true, w: false, d: false });
  assert.equal(viewer.modules.ai_advisor, false);
  assert.equal(ruleAllows(viewer, "GET", "/plant-twins"), true);
  assert.equal(ruleAllows(viewer, "POST", "/plant-twins"), false);
  assert.equal(ruleAllows(viewer, "POST", "/ai/chat"), false);

  // Switched off per user.
  const noTwin = resolveAccess("engineer", { modules: { live_twin: false, ai_advisor: false } });
  assert.equal(ruleAllows(noTwin, "GET", "/plant-twins"), false);
  assert.equal(ruleAllows(noTwin, "POST", "/ai/chat"), false);
  assert.equal(ruleAllows(noTwin, "GET", "/viz-nodes"), ruleAllows(eng, "GET", "/viz-nodes"), "Visualization is not affected");

  // Granted per user to a role that lacks it.
  const op = resolveAccess("operator", { modules: { ai_advisor: true, live_twin: { r: true, w: true, d: false } } });
  assert.equal(ruleAllows(op, "POST", "/ai/chat"), true);
  assert.equal(ruleAllows(op, "PUT", "/plant-twins/pt-1"), true);
  assert.equal(ruleAllows(op, "DELETE", "/plant-twins/pt-1"), false, "delete is its own circle");

  // An older override of the source module still applies until the new one is set.
  const legacy = resolveAccess("engineer", { modules: { explorer: false, visualization: { r: true, w: true, d: false } } });
  assert.equal(legacy.modules.ai_advisor, false);
  assert.deepEqual(legacy.modules.live_twin, { r: true, w: true, d: true });
});

test("access: Data Management is its own module, split from Reports without changing anyone's access", () => {
  // Defaults copy Reports, except Operator and Viewer (audit 23 Nov 2026, L-3).
  const engineer = resolveAccess("engineer", {});
  assert.equal(engineer.modules.data_management, true);
  assert.equal(ruleAllows(engineer, "GET", "/system/data-health"), true);
  assert.equal(resolveAccess("viewer", {}).modules.data_management, false);

  // Switched off per user: the data pages close, reports keep working.
  const noDm = resolveAccess("engineer", { modules: { data_management: false } });
  assert.equal(ruleAllows(noDm, "GET", "/system/storage"), false);
  assert.equal(ruleAllows(noDm, "GET", "/system/holds"), false);
  assert.equal(ruleAllows(noDm, "POST", "/system/retention/run"), false);
  assert.equal(ruleAllows(noDm, "GET", "/system/aggregate"), true, "report and chart data stay on Reports");

  // Reports off, Data Management on.
  const dmOnly = resolveAccess("engineer", { modules: { reports: false, data_management: true } });
  assert.equal(ruleAllows(dmOnly, "GET", "/system/data-health"), true);
  assert.equal(ruleAllows(dmOnly, "GET", "/system/aggregate"), false);

  // An older Reports override still applies until Data Management is set.
  const legacyOff = resolveAccess("engineer", { modules: { reports: false } });
  assert.equal(legacyOff.modules.data_management, false);
  assert.equal(ruleAllows(legacyOff, "GET", "/system/data-health"), false);
  const legacyOn = resolveAccess("viewer", { modules: { reports: true } });
  assert.equal(legacyOn.modules.data_management, true);
});
