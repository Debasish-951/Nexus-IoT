/**
 * Regression tests for the P2 security findings of the November 2026 audit.
 *
 * Same runner and setup as audit-fixes.test.ts: Node's built-in test runner, no
 * database (the script sets a placeholder DATABASE_URL; nothing connects).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllowlistEntry, normaliseAllowlist, ipAllowed } from "../middleware/apiKeyAuth";
import { ruleAllows } from "../middleware/authorize";
import { resolveAccess } from "../lib/rbac";
import { originAllowed } from "../lib/ws-broadcast";
import { toolNamesFor, MAX_QUESTION_CHARS } from "../routes/ai";

test("SEC-19: an exact allowlist address no longer admits addresses it is a prefix of", () => {
  assert.equal(ipAllowed("10.0.0.1", ["10.0.0.1"]), true);
  assert.equal(ipAllowed("10.0.0.10", ["10.0.0.1"]), false);
  assert.equal(ipAllowed("10.0.0.199", ["10.0.0.1"]), false);
});

test("SEC-19: CIDR blocks match by network, for IPv4, IPv6 and IPv4-mapped IPv6", () => {
  assert.equal(ipAllowed("203.0.113.77", ["203.0.113.0/24"]), true);
  assert.equal(ipAllowed("203.0.114.1", ["203.0.113.0/24"]), false);
  assert.equal(ipAllowed("::ffff:203.0.113.5", ["203.0.113.0/24"]), true);
  assert.equal(ipAllowed("2001:db8::42", ["2001:db8::/32"]), true);
  assert.equal(ipAllowed("2001:db9::1", ["2001:db8::/32"]), false);
});

test("SEC-19: empty, malformed and catch-all entries are rejected and match nothing", () => {
  for (const bad of ["", "   ", "10.0.0.", "not-an-ip", "10.0.0.0/33", "10.0.0.0/0", "::/0", "1.2.3.4/x", "1.2.3.4/8/8", 42, null]) {
    assert.equal(parseAllowlistEntry(bad), null, String(bad));
  }
  // A stored legacy entry that does not parse fails closed instead of admitting everyone.
  assert.equal(ipAllowed("10.0.0.5", [""]), false);
  assert.equal(ipAllowed("10.0.0.5", ["10.0.0."]), false);
  assert.equal(ipAllowed("unknown", ["10.0.0.0/8"]), false);
});

test("SEC-19: allowlists are validated on save", () => {
  assert.deepEqual(normaliseAllowlist([" 10.0.0.1 ", "10.0.0.0/8", "10.0.0.1"]), { ok: true, entries: ["10.0.0.1", "10.0.0.0/8"] });
  assert.deepEqual(normaliseAllowlist(["10.0.0.1", ""]), { ok: false, invalid: [""] });
  assert.deepEqual(normaliseAllowlist(undefined), { ok: true, entries: [] });
});

test("SEC-15: a module override does not lift the role's permission verb", () => {
  // The audit's own repro: a Viewer granted Reports may read reports, not run retention.
  const viewer = resolveAccess("viewer", { modules: { reports: true } });
  assert.equal(ruleAllows(viewer, "GET", "/system/storage"), true);
  assert.equal(ruleAllows(viewer, "POST", "/system/retention/run"), false);

  // Turning on User Management or API Clients for an Operator used to give full administration.
  const operator = resolveAccess("operator", { modules: { users: true, api_clients: true } });
  assert.equal(ruleAllows(operator, "POST", "/users"), false);
  assert.equal(ruleAllows(operator, "DELETE", "/users/abc"), false);
  assert.equal(ruleAllows(operator, "DELETE", "/api-clients/abc"), false);
  assert.equal(ruleAllows(operator, "POST", "/api-clients/abc/rotate-secret"), false);
});

test("SEC-15: a module override still removes access, and role defaults are unchanged", () => {
  const engineer = resolveAccess("engineer", null);
  assert.equal(ruleAllows(engineer, "POST", "/assets"), true);
  assert.equal(ruleAllows(engineer, "DELETE", "/brokers/abc"), true);

  const restricted = resolveAccess("engineer", { modules: { assets: { r: true, w: false, d: false } } });
  assert.equal(ruleAllows(restricted, "GET", "/assets"), true);
  assert.equal(ruleAllows(restricted, "POST", "/assets"), false);
});

test("SEC-15: a granular override set by an administrator is still authoritative", () => {
  // Access Control lets an admin give an Operator asset editing; that must keep working.
  const operator = resolveAccess("operator", { modules: { assets: { r: true, w: true, d: false } } });
  assert.equal(ruleAllows(operator, "POST", "/assets"), true);
  assert.equal(ruleAllows(operator, "DELETE", "/assets/abc"), false);
});

test("SEC-18: legacy dashboard writes have no rule and are denied", () => {
  const admin = resolveAccess("admin", null);
  assert.equal(ruleAllows(admin, "GET", "/viz-dashboards"), true);
  for (const [method, path] of [["POST", "/viz-dashboards"], ["PUT", "/viz-dashboards/x"], ["DELETE", "/viz-dashboards/x"]] as const) {
    assert.equal(ruleAllows(admin, method, path), false, `${method} ${path}`);
  }
});

test("SEC-27: WebSocket origins are checked against CORS_ORIGINS, the public URL and the Host", () => {
  const cors = ["https://iot.example.com"];
  assert.equal(originAllowed(undefined, "iot.example.com", cors), true);
  assert.equal(originAllowed("https://iot.example.com", "127.0.0.1:8080", cors), true);
  assert.equal(originAllowed("https://plant.example.com", "x", cors, "https://plant.example.com/"), true);
  assert.equal(originAllowed("https://iot.example.com", "iot.example.com", []), true);
  assert.equal(originAllowed("https://evil.example.net", "iot.example.com", cors), false);
  assert.equal(originAllowed("null", "iot.example.com", cors), false);
});

test("SEC-17: AI tools are offered only for modules the caller can read", () => {
  const noAlarms = toolNamesFor(resolveAccess("engineer", { modules: { alarms: false } }));
  assert.ok(noAlarms.includes("query_telemetry"));
  for (const t of ["get_alarms", "get_alarm_history", "asset_health"]) assert.ok(!noAlarms.includes(t), t);

  const noExplorer = toolNamesFor(resolveAccess("engineer", { modules: { explorer: false } }));
  assert.ok(!noExplorer.includes("query_telemetry"));

  assert.equal(MAX_QUESTION_CHARS, 2000);
});
