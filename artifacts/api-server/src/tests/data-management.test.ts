/**
 * Data Management: retention estimates, the summary guard on pruning, and the
 * access rules of the new endpoints. Pure logic only; no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatePrune, unboundedRowsPerDay, type PairDays, type RetentionPolicyLike } from "../routes/system";
import { rawPruneLimitFrom, LATE_WINDOW_MS, floorHour } from "../services/rollups";
import { ruleAllows } from "../middleware/authorize";
import { resolveAccess } from "../lib/rbac";

const DAY = 86_400_000;
const NOW = new Date("2026-11-14T12:00:00Z");

/** One asset+metric with `perDay` stored readings on each of the last `n` days (day 0 = today). */
function pair(assetId: string, metric: string, n: number, perDay: number): PairDays {
  const today = Date.UTC(2026, 10, 14);
  const days = Array.from({ length: n }, (_, i) => ({ day: new Date(today - i * DAY), rows: perDay, stored: perDay }));
  return { assetId, metric, first: new Date(today - (n - 1) * DAY), last: NOW, days };
}

test("estimatePrune: no policy deletes nothing", () => {
  const r = estimatePrune([pair("A", "temp", 100, 1000)], [], NOW, null);
  assert.equal(r.rows, 0);
});

test("estimatePrune: a 30-day global policy counts whole days older than the cutoff, and part of the cutoff day", () => {
  const policies: RetentionPolicyLike[] = [{ id: "g", assetId: null, metric: null, retentionDays: 30 }];
  const r = estimatePrune([pair("A", "temp", 100, 1000)], policies, NOW, null);
  // Cutoff = 14 Oct 12:00. Days 14 Oct (half) and the 69 days before it.
  assert.equal(r.rows, 69 * 1000 + 500);
  assert.equal(r.byAsset.get("A"), r.rows);
  assert.equal(r.limited, false);
});

test("estimatePrune: a day already pruned up to its first stored reading is spread from that reading on", () => {
  // Readings left on the cutoff day start at 11:00; cutoff is 12:00 that day: 1 of 13 remaining hours.
  const p = pair("A", "temp", 31, 1300);
  const cutoffDay = p.days[30];
  p.first = new Date(cutoffDay.day.getTime() + 11 * 3_600_000);
  p.days = [cutoffDay];
  const r = estimatePrune([p], [{ id: "g", assetId: null, metric: null, retentionDays: 30 }], NOW, null);
  assert.equal(r.rows, 100);
});

test("estimatePrune: the most specific policy decides, as in pruning", () => {
  const policies: RetentionPolicyLike[] = [
    { id: "g", assetId: null, metric: null, retentionDays: 30 },
    { id: "a", assetId: "A", metric: null, retentionDays: 365 },
  ];
  const r = estimatePrune([pair("A", "temp", 100, 1000), pair("B", "temp", 100, 1000)], policies, NOW, null);
  assert.equal(r.byAsset.get("A"), undefined, "asset A keeps a year");
  assert.equal(r.byAsset.get("B"), 69 * 1000 + 500);
});

test("estimatePrune: the summary guard moves the cutoff and says so", () => {
  const policies: RetentionPolicyLike[] = [{ id: "g", assetId: null, metric: null, retentionDays: 1 }];
  const limit = new Date(NOW.getTime() - 50 * DAY);
  const r = estimatePrune([pair("A", "temp", 100, 1000)], policies, NOW, limit);
  assert.equal(r.limited, true);
  assert.equal(r.rows, 49 * 1000 + 500);
});

test("unboundedRowsPerDay counts only readings no policy will delete", () => {
  const pairs = [pair("A", "temp", 20, 700), pair("B", "temp", 20, 300)];
  assert.equal(unboundedRowsPerDay(pairs, [], NOW), 1000);
  const policies: RetentionPolicyLike[] = [{ id: "a", assetId: "A", metric: null, retentionDays: 90 }];
  assert.equal(unboundedRowsPerDay(pairs, policies, NOW), 300);
});

test("pruning never deletes raw readings that are not summarised yet", () => {
  assert.equal(rawPruneLimitFrom(null).getTime(), 0, "before the first summary nothing may go");
  const wm = new Date("2026-11-14T10:00:00Z");
  assert.equal(rawPruneLimitFrom(wm).getTime(), wm.getTime() - LATE_WINDOW_MS);
  assert.equal(floorHour(new Date("2026-11-14T10:59:59Z")).toISOString(), "2026-11-14T10:00:00.000Z");
});

test("retention preview and history are readable with Reports; running stays restricted", () => {
  const viewer = resolveAccess("viewer", { modules: { reports: true } });
  assert.equal(ruleAllows(viewer, "POST", "/system/retention/preview"), true);
  assert.equal(ruleAllows(viewer, "GET", "/system/retention/runs"), true);
  assert.equal(ruleAllows(viewer, "POST", "/system/retention/run"), false);
  assert.equal(ruleAllows(viewer, "PUT", "/system/retention/preview"), false);
});
