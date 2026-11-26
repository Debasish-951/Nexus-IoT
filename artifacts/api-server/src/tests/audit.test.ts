/**
 * Audit log: redaction in field diffs, the hash chain, the safety-net decision,
 * sensitive-action rules, search filters and the route rules. No database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  diffFields, REDACTED, canonical, entryHash, verifyChain, needsSafetyNetEntry, describeRequest, outcomeFor,
  matchSensitive, parseAuditFilters, effectiveAuditRetention, maskUrl, type ChainRow,
} from "../lib/audit-core";
import { ruleAllows } from "../middleware/authorize";
import { resolveAccess } from "../lib/rbac";

const src = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");

test("audit: diffFields lists only changed fields and redacts secrets", () => {
  const before = { name: "Pump", password: "old", mqttPassword: "x", token: null, tags: ["a"], updatedAt: new Date(1) };
  const after = { name: "Pump 2", password: "new", mqttPassword: "x", token: "t", tags: ["a"], updatedAt: new Date(2) };
  const c = diffFields(before, after);
  assert.deepEqual(c, [
    { field: "name", from: "Pump", to: "Pump 2" },
    { field: "password", from: REDACTED, to: REDACTED },
    { field: "token", from: null, to: REDACTED },
  ]);
  assert.ok(!JSON.stringify(c).includes("new"));
});

test("audit: secrets inside objects and URLs with tokens are masked", () => {
  const c = diffFields({ config: { host: "a", secretKey: "s1" } }, { config: { host: "b", secretKey: "s2" } });
  assert.equal(c.length, 1);
  assert.ok(!JSON.stringify(c).includes("s2"));
  assert.ok(JSON.stringify(c).includes(REDACTED));
  assert.equal(maskUrl("https://user:pw@hooks.example.com/x?token=abc"), "https://hooks.example.com/x?…");
  const w = diffFields({ webhookUrl: null }, { webhookUrl: "https://h.example/a?key=zzz" });
  assert.ok(!JSON.stringify(w).includes("zzz"));
  assert.deepEqual(diffFields({ a: 1 }, { a: 1, b: 2 }, { only: ["a"] }), []);
});

function row(i: number, prev: string, over: Partial<ChainRow> = {}): ChainRow {
  const base = {
    id: `00000000-0000-0000-0000-00000000000${i}`, seq: i, action: "asset.updated", category: "asset",
    actorName: "Ann", actorRole: "engineer", actorUsername: "ann", actorUserId: "u1", targetId: "t", targetName: "Pump",
    detail: null, changes: [{ field: "name", from: "a", to: "b" }], outcome: "success", ip: "10.0.0.1", userAgent: "x",
    correlationId: "c", assetId: "t", projectId: "p", timestamp: new Date(1_700_000_000_000 + i * 1000), prevHash: prev, hash: null,
    ...over,
  } as ChainRow;
  base.hash = entryHash(prev, base);
  return base;
}

test("audit: canonical JSON is key-order independent", () => {
  assert.equal(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), canonical({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  assert.equal(canonical(new Date(0)), JSON.stringify("1970-01-01T00:00:00.000Z"));
});

test("audit: an intact chain verifies; an edit, a removal or a bad link is found", () => {
  const r1 = row(1, "");
  const r2 = row(2, r1.hash!);
  const r3 = row(3, r2.hash!);
  assert.deepEqual(verifyChain([r1, r2, r3], ""), { ok: true, lastHash: r3.hash, keyedSeen: false });
  // Batches continue from the last hash.
  assert.equal(verifyChain([r3], r2.hash!).ok, true);
  // Edited field.
  const edited = verifyChain([r1, { ...r2, detail: "changed" }, r3], "");
  assert.equal(edited.ok, false);
  assert.equal(!edited.ok && edited.broken.reason, "hash_mismatch");
  // Removed entry.
  const removed = verifyChain([r1, r3], "");
  assert.equal(!removed.ok && removed.broken.reason, "prev_mismatch");
  assert.equal(!removed.ok && removed.broken.seq, 3);
  // Wrong start (e.g. pruning checkpoint not honoured).
  assert.equal(verifyChain([r2, r3], "").ok, false);
  assert.equal(verifyChain([{ ...r1, hash: null }], "").ok, false);
  // The timestamp is hashed at millisecond precision whatever form it arrives in.
  assert.equal(entryHash("", { ...r1, timestamp: r1.timestamp }), entryHash("", { ...r1, timestamp: new Date(r1.timestamp).toISOString() }));
});

test("audit: the safety net records unaudited writes and skips the rest", () => {
  assert.equal(needsSafetyNetEntry("POST", "/api/plant-twins", 201, false), true);
  assert.equal(needsSafetyNetEntry("DELETE", "/api/viz-nodes/x", 500, false), true);
  assert.equal(needsSafetyNetEntry("PUT", "/api/assets/x", 403, false), true);
  assert.equal(needsSafetyNetEntry("POST", "/api/assets", 201, true), false, "already audited");
  assert.equal(needsSafetyNetEntry("GET", "/api/assets", 200, false), false, "reads");
  assert.equal(needsSafetyNetEntry("POST", "/api/ingest", 200, false), false, "ingest");
  assert.equal(needsSafetyNetEntry("POST", "/api/ingest/abc", 200, false), false, "ingest token url");
  assert.equal(needsSafetyNetEntry("POST", "/api/auth/login", 401, false), false, "sign-in");
  assert.equal(needsSafetyNetEntry("POST", "/api/plant-twins/values", 200, false), false, "read-only POST");
  assert.equal(needsSafetyNetEntry("POST", "/api/ai/chat", 200, false), false);
  assert.equal(needsSafetyNetEntry("POST", "/api/assets", 401, false), false, "no actor");
  assert.equal(needsSafetyNetEntry("POST", "/api/assets", 429, false), false, "rate limit");
  const d = describeRequest("/api/alarm-rules/5f0c1d2e-0000-4000-8000-000000000001/test-webhook");
  assert.deepEqual(d, { pattern: "/api/alarm-rules/:id/test-webhook", id: "5f0c1d2e-0000-4000-8000-000000000001", category: "alarm_rules" });
  assert.equal(outcomeFor(204), "success");
  assert.equal(outcomeFor(403), "denied");
  assert.equal(outcomeFor(409), "failure");
});

test("audit: sensitive actions are recognised", () => {
  assert.equal(matchSensitive({ action: "alarm_rule.deleted" }), "alarm_rule_removed");
  assert.equal(matchSensitive({ action: "alarm_rule.updated", changes: [{ field: "enabled", from: true, to: false }] }), "alarm_rule_removed");
  assert.equal(matchSensitive({ action: "alarm_rule.updated", changes: [{ field: "threshold", from: 1, to: 2 }] }), null);
  assert.equal(matchSensitive({ action: "user.updated", changes: [{ field: "role", from: "engineer", to: "admin" }] }), "admin_granted");
  assert.equal(matchSensitive({ action: "user.updated", changes: [{ field: "role", from: "super_admin", to: "admin" }] }), null, "a demotion");
  assert.equal(matchSensitive({ action: "user.invited", changes: [{ field: "role", from: null, to: "company_admin" }] }), "admin_granted");
  assert.equal(matchSensitive({ action: "user.deleted" }), "user_deleted");
  assert.equal(matchSensitive({ action: "data_change.range_deleted" }), "data_deleted");
  assert.equal(matchSensitive({ action: "retention.run", detail: "deleted 1200 readings" }), "data_deleted");
  assert.equal(matchSensitive({ action: "retention.run", detail: "deleted 0 readings" }), null);
  assert.equal(matchSensitive({ action: "api_client.secret_rotated" }), "secret_rotated");
  assert.equal(matchSensitive({ action: "audit.verify_failed", outcome: "failure" }), "audit_verify_failed");
  assert.equal(matchSensitive({ action: "user.deleted", outcome: "failure" }), null, "failed attempts do not alert");
  assert.equal(matchSensitive({ action: "asset.updated" }), null);
});

test("audit: search filters are parsed and checked", () => {
  const f = parseAuditFilters({ q: " pump ", from: "2026-11-01T00:00:00Z", to: "2026-11-02", outcome: "failure", includeSecurity: "true", actorName: "Ann" });
  assert.ok(typeof f !== "string");
  if (typeof f !== "string") {
    assert.equal(f.q, "pump");
    assert.equal(f.from?.toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(f.outcome, "failure");
    assert.equal(f.includeSecurity, true);
    assert.equal(f.actor, "Ann", "the earlier actorName parameter still works");
  }
  assert.equal(typeof parseAuditFilters({ from: "yesterday-ish" }), "string");
  assert.equal(typeof parseAuditFilters({ from: "2026-11-03", to: "2026-11-01" }), "string");
  assert.equal(typeof parseAuditFilters({ outcome: "maybe" }), "string");
  assert.deepEqual(parseAuditFilters({}), { q: undefined, from: undefined, to: undefined, actor: undefined, action: undefined, category: undefined, outcome: undefined, targetId: undefined, assetId: undefined, includeSecurity: false });
});

test("audit: retention is never under 365 days (0 keeps for ever)", () => {
  assert.equal(effectiveAuditRetention(30), 365);
  assert.equal(effectiveAuditRetention(730), 730);
  assert.equal(effectiveAuditRetention(0), 0);
});

test("audit: route rules for the new endpoints", () => {
  const admin = resolveAccess("super_admin", {});
  const viewer = resolveAccess("viewer", {});
  assert.equal(ruleAllows(admin, "GET", "/activity-log/summary"), true);
  assert.equal(ruleAllows(admin, "GET", "/activity-log/export"), true);
  assert.equal(ruleAllows(admin, "POST", "/activity-log/verify"), true, "verify is POST since L-9");
  assert.equal(ruleAllows(admin, "PUT", "/activity-log/settings"), true);
  assert.equal(ruleAllows(admin, "POST", "/activity-log/alerts/00000000-0000-0000-0000-000000000001/acknowledge"), true);
  assert.equal(ruleAllows(viewer, "POST", "/activity-log/verify"), false);
  assert.equal(ruleAllows(viewer, "PUT", "/activity-log/settings"), false);
  assert.equal(ruleAllows(viewer, "POST", "/activity-log/alerts/00000000-0000-0000-0000-000000000001/acknowledge"), false);
  assert.equal(ruleAllows(viewer, "DELETE", "/activity-log"), false, "the log cannot be deleted through the API");
});

test("audit: wiring — safety net, retention, trigger and unlogged routes", () => {
  assert.match(src("app.ts"), /stripForgedActorHeaders, auditSafetyNet, csrfGuard/);
  assert.match(src("routes/system.ts"), /pruneAuditLog\(auditDays\)/);
  assert.match(src("../../../lib/db/src/audit-guard-sql.ts"), /BEFORE UPDATE OR DELETE ON activity_logs/);
  assert.match(src("lib/audit-store.ts"), /pg_advisory_xact_lock/);
  for (const [file, action] of [["routes/alarm_rules.ts", "alarm_rule.deleted"], ["routes/alarm_rules.ts", "alarm_rule.updated"], ["routes/attributes.ts", "attribute.updated"],
    ["routes/assets.ts", "asset.updated"], ["routes/assets.ts", "asset.template_applied"], ["routes/destinations.ts", "destination.updated"], ["routes/export.ts", "export.downloaded"]] as const) {
    assert.ok(src(file).includes(`"${action}"`), `${file} records ${action}`);
  }
});
