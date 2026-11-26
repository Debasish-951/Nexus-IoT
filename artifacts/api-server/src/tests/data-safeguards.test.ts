/**
 * Audit 23 Nov 2026, package B: Data Management safeguards, asset delete,
 * archives, partitions, late readings and pruning. Pure logic plus a few
 * calls that fail fast against the placeholder DATABASE_URL; no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { ruleAllows, assertRuleLevels } from "../middleware/authorize";
import { resolveAccess, ROLE_PERMISSIONS } from "../lib/rbac";
import { parseSettings } from "../lib/data-settings";
import { splitGuardedSettings, rangeNeedsApproval, RANGE_COUNT_CAP } from "../routes/data_ops";
import { retentionTickAction, runOperationalPruning, RETENTION_TICK_MS } from "../routes/system";
import { assetScopedHoldConflict } from "../services/holds";
import { lateDeltasFor, summaryNumber, TIERS, LATE_WINDOW_MS } from "../services/rollups";
import { verifyArchiveFile } from "../services/archive";
import { conditionsFor, notify, type StorageFacts } from "../services/system-alerts";

const HOUR = 3_600_000;

// ── H-2 ───────────────────────────────────────────────────────────────────────

test("H-2: an Engineer cannot approve, release holds, change settings or delete policies", () => {
  const eng = resolveAccess("engineer", {});
  const dev = resolveAccess("developer", {});
  for (const access of [eng, dev]) {
    assert.equal(ruleAllows(access, "POST", "/system/changes/0a1b/approve"), false);
    assert.equal(ruleAllows(access, "POST", "/system/holds/0a1b/release"), false);
    assert.equal(ruleAllows(access, "PUT", "/system/data-settings"), false);
    assert.equal(ruleAllows(access, "DELETE", "/system/retention/0a1b"), false);
    // Reject reaches the route, which allows only the requester's own withdrawal.
    assert.equal(ruleAllows(access, "POST", "/system/changes/0a1b/reject"), true);
    // Their everyday Data Management work is unchanged.
    assert.equal(ruleAllows(access, "POST", "/system/changes/range-delete"), true);
    assert.equal(ruleAllows(access, "POST", "/system/holds"), true);
    assert.equal(ruleAllows(access, "PUT", "/system/retention/0a1b"), true);
  }
  for (const role of ["admin", "company_admin", "super_admin"] as const) {
    const a = resolveAccess(role, {});
    assert.equal(ruleAllows(a, "POST", "/system/changes/0a1b/approve"), true, role);
    assert.equal(ruleAllows(a, "POST", "/system/holds/0a1b/release"), true, role);
    assert.equal(ruleAllows(a, "PUT", "/system/data-settings"), true, role);
    assert.equal(ruleAllows(a, "DELETE", "/system/retention/0a1b"), true, role);
  }
  for (const role of ["project_manager", "team_lead", "developer", "engineer", "operator", "viewer"] as const) {
    assert.equal(ROLE_PERMISSIONS[role].includes("approve_data_changes" as never), false, role);
  }
});

test("H-2: a write or delete level on a simple module is refused at start-up", () => {
  assert.throws(() => assertRuleLevels([{ path: "/x", module: "data_management", level: "delete" }]), /simple module "data_management"/);
  assert.throws(() => assertRuleLevels([{ path: "/x", anyModule: ["explorer", "visualization"], level: "write" }]), /simple module "explorer"/);
  assert.doesNotThrow(() => assertRuleLevels([{ path: "/x", module: "assets", level: "delete" }]), "granular modules keep levels");
  assert.doesNotThrow(() => assertRuleLevels([{ path: "/x", module: "alarms", level: "read" }]));
});

test("H-2: with approval on, weakening the safeguards waits; other settings apply at once", () => {
  const on = parseSettings({ approval: { enabled: true, thresholdRows: 1000 }, archive: { enabled: true }, tiers: { m15Days: 365, hourDays: null } });
  const r = splitGuardedSettings(on, {
    approval: { enabled: false, thresholdRows: 5000 }, alerts: { diskFreePctBelow: 20 }, archive: { enabled: false }, tiers: { m15Days: 30, hourDays: 100 },
  }, 1825);
  assert.deepEqual(r.guarded, { approval: { enabled: false, thresholdRows: 5000 }, archive: { enabled: false }, tiers: { m15Days: 30, hourDays: 100 } });
  assert.deepEqual(r.rest, { alerts: { diskFreePctBelow: 20 } });

  // Strengthening, or values sent back unchanged, are not held up.
  const same = splitGuardedSettings(on, { approval: { enabled: true, thresholdRows: 10 }, tiers: { m15Days: 400, hourDays: 0 } }, 1825);
  assert.equal(same.guarded, null);

  // With approval off there is no second person to ask (the route still needs approve_data_changes).
  const off = splitGuardedSettings(parseSettings({}), { approval: { enabled: false } }, 1825);
  assert.equal(off.guarded, null);
});

test("H-2 / L-24: a removal too large to count exactly waits for approval (fails closed)", () => {
  const s = parseSettings({ approval: { enabled: true, thresholdRows: 1_000_000_000 } });
  assert.equal(rangeNeedsApproval(s, { rows: RANGE_COUNT_CAP, capped: true }), true);
  assert.equal(rangeNeedsApproval(s, { rows: 10, capped: false }), false);
  assert.equal(rangeNeedsApproval(parseSettings({}), { rows: RANGE_COUNT_CAP, capped: true }), false, "approval off");
});

// ── H-3 ───────────────────────────────────────────────────────────────────────

test("H-3: a hold on any asset of the subtree blocks the delete", () => {
  const holds = [
    { name: "Incident 7", assetId: "pump-2", metric: null, fromTs: null, toTs: null },
    { name: "Global", assetId: null, metric: "temp", fromTs: null, toTs: null },
  ];
  assert.equal(assetScopedHoldConflict(holds, ["plant", "pump-1", "pump-2"]), "Incident 7");
  assert.equal(assetScopedHoldConflict(holds, ["plant", "pump-1"]), null, "unscoped holds are checked against the data");
});

// ── H-4 ───────────────────────────────────────────────────────────────────────

test("H-4: a missing archive file is a 410 and a changed one a 422, without throwing an unhandled stream error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nexus-archive-"));
  await assert.rejects(verifyArchiveFile(path.join(dir, "gone.jsonl.gz"), "abc"), (e: { status?: number; code?: string }) => e.status === 410 && e.code === "archive_file_missing");
  const file = path.join(dir, "day.jsonl.gz");
  await writeFile(file, "original bytes");
  const sha = createHash("sha256").update("original bytes").digest("hex");
  await verifyArchiveFile(file, sha);
  await writeFile(file, "tampered bytes");
  await assert.rejects(verifyArchiveFile(file, sha), (e: { status?: number; code?: string }) => e.status === 422 && e.code === "archive_checksum_mismatch");
});

// ── H-5 ───────────────────────────────────────────────────────────────────────

test("H-5: a failed partition create or drop raises a system alert", () => {
  const facts: StorageFacts = { disk: null, rollups: { enabled: false, watermark: null }, lastRun: null, perAsset: [] };
  const extra = { lastBackup: null, lastGoodBackup: null, rejectionsLastHour: 0, archiveError: null, now: new Date() };
  const s = parseSettings({ alerts: { backupMaxAgeHours: 0 } });
  assert.equal(conditionsFor(s, facts, extra).some((c) => c.key === "partitions_failed"), false);
  const c = conditionsFor(s, facts, { ...extra, partitionError: "Could not drop partition p2025_01: permission denied" });
  assert.equal(c.find((x) => x.key === "partitions_failed")?.severity, "high");
});

// ── M-8 ───────────────────────────────────────────────────────────────────────

test("M-8: the alert webhook refuses private targets", async () => {
  const r = await notify("http://127.0.0.1:9/hook", "raised", { key: "k", severity: "high", title: "t", message: "m" });
  assert.match(r ?? "", /^failed \(Refusing to call 127\.0\.0\.1/);
  const meta = await notify("http://169.254.169.254/latest/meta-data", "raised", { key: "k", severity: "high", title: "t", message: "m" });
  assert.match(meta ?? "", /Refusing/);
});

// ── M-16 ──────────────────────────────────────────────────────────────────────

test("M-16: readings older than the recount window become per-bucket totals for both levels", () => {
  const wm = Date.UTC(2026, 10, 20, 12);
  const watermarks = new Map(TIERS.map((t) => [t.stateKey, wm]));
  const late = new Date(wm - LATE_WINDOW_MS - 3 * HOUR + 20 * 60_000); // before the recount window
  const recent = new Date(wm - HOUR); // inside the window: the job recounts it
  const d = lateDeltasFor([
    { assetId: "A", metric: "t", value: 10, timestamp: late },
    { assetId: "A", metric: "t", value: 14, timestamp: new Date(late.getTime() + 60_000) },
    { assetId: "A", metric: "t", value: "n/a", timestamp: late },
    { assetId: "A", metric: "t", value: 99, timestamp: recent },
  ], watermarks);
  const hour = d.find((x) => x.tier.key === "hour")!;
  const m15 = d.find((x) => x.tier.key === "m15")!;
  for (const x of [hour, m15]) {
    assert.equal(x.rows, 3);
    assert.equal(x.n, 2);
    assert.equal(x.sum, 24);
    assert.equal(x.min, 10);
    assert.equal(x.max, 14);
  }
  assert.equal(hour.bucket % HOUR, 0);
  assert.equal(d.length, 2, "the recent reading is left to the normal recount");
  assert.equal(lateDeltasFor([{ assetId: "A", metric: "t", value: 1, timestamp: late }], new Map()).length, 0, "nothing before the watermarks are known");
  // Same numeric rule as the SQL: JSON numbers without exponent.
  assert.equal(summaryNumber(12.5), 12.5);
  assert.equal(summaryNumber("12.5"), null);
  assert.equal(summaryNumber(1e21), null);
});

// ── M-20 ──────────────────────────────────────────────────────────────────────

test("M-20: a failing table does not stop operational pruning; every failure is reported", async () => {
  // The placeholder database refuses every connection, so each table fails on its own.
  const r = await runOperationalPruning();
  assert.equal(r.skipped, undefined);
  assert.ok((r.errors?.length ?? 0) >= 4, `errors: ${JSON.stringify(r.errors)}`);
  for (const key of ["alarms", "alarmHistory", "brokerEvents", "authTokens"]) {
    assert.ok(r.errors!.some((e) => e.startsWith(`${key}:`)), key);
  }
});

// ── L-20 (18 Nov FN-9) ────────────────────────────────────────────────────────

test("L-20 / FN-9: a pruning window shorter than an hour still gets a telemetry run", () => {
  const t0 = Date.UTC(2026, 10, 20, 0);
  assert.equal(retentionTickAction(t0, 0, 0, false, false), "full", "first tick after start");
  assert.equal(retentionTickAction(t0 + 20 * 60_000, t0, t0, true, true), "none", "telemetry pruned 20 minutes ago");
  // Last full run happened outside a 30-minute window; the window opens 20 minutes later.
  assert.equal(retentionTickAction(t0 + 20 * 60_000, t0, t0 - 5 * HOUR, true, true), "telemetry");
  assert.equal(retentionTickAction(t0 + 20 * 60_000, t0, t0 - 5 * HOUR, false, true), "none", "window closed");
  assert.equal(retentionTickAction(t0 + HOUR - RETENTION_TICK_MS / 2, t0, t0, false, false), "full", "about hourly");
});
