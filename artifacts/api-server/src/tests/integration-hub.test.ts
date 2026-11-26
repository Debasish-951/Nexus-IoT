/**
 * Integration Hub: webhook signatures, event subscription matching, retry
 * schedule, legacy scope meaning, request-log path cleaning, connector parsing
 * and Modbus decoding, and the RBAC rules for the new routes. No database or
 * network is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifySignature, newSigningSecret } from "../lib/integration/signing";
import { subscribes, EVENT_TYPES } from "../lib/integration/events";
import { backoffSeconds, BACKOFF_SEC } from "../services/delivery-worker";
import { scopeAllows } from "../middleware/apiKeyAuth";
import { normalisePath, ACCESS_TOKEN_PREFIX } from "../lib/integration/client-auth";
import { toReadings, atPath, decodeRegisters, assertSelectOnly } from "../services/connectors";
import { ruleAllows } from "../middleware/authorize";
import { resolveAccess, API_SCOPE_IDS } from "../lib/rbac";
import { V1_OPENAPI } from "../lib/integration/v1-openapi";

test("signature: a receiver recomputing the HMAC accepts it; a changed body, secret or old timestamp is refused", () => {
  const secret = newSigningSecret();
  const now = 1_800_000_000;
  const body = JSON.stringify({ event: "alarm.triggered", data: { value: 81 } });
  const sig = signPayload(secret, now, body);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verifySignature(secret, now, body, sig, 300, now + 10), true);
  assert.equal(verifySignature(secret, now, body + " ", sig, 300, now), false);
  assert.equal(verifySignature("whsec_other", now, body, sig, 300, now), false);
  assert.equal(verifySignature(secret, now, body, sig, 300, now + 301), false, "replay outside the tolerance");
});

test("events: the original 'alarm' subscription still matches every alarm event; groups and * work", () => {
  assert.equal(subscribes(["alarm"], "alarm.triggered"), true);
  assert.equal(subscribes(["alarm"], "alarm.acknowledged"), true);
  assert.equal(subscribes(["alarm"], "asset.updated"), false);
  assert.equal(subscribes(["asset.maintenance"], "asset.maintenance"), true);
  assert.equal(subscribes(["asset.maintenance"], "asset.updated"), false);
  assert.equal(subscribes(["*"], "connector.error"), true);
  assert.equal(subscribes([], "alarm.cleared"), false);
  assert.ok(EVENT_TYPES.every((e) => e.id.startsWith(`${e.group}.`)));
});

test("retries: 30 s, 2 min, 10 min, 30 min, 2 h, 6 h, then stays at 6 h", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 12].map(backoffSeconds), [30, 120, 600, 1800, 7200, 21600, 21600, 21600]);
  assert.equal(BACKOFF_SEC.length, 6);
});

test("scopes: an empty list keeps its legacy full-access meaning unless API_KEY_EMPTY_SCOPES_DENY=true", () => {
  const before = process.env.API_KEY_EMPTY_SCOPES_DENY;
  try {
    delete process.env.API_KEY_EMPTY_SCOPES_DENY;
    assert.equal(scopeAllows([], "read:telemetry"), true);
    process.env.API_KEY_EMPTY_SCOPES_DENY = "true";
    assert.equal(scopeAllows([], "read:telemetry"), false);
    assert.equal(scopeAllows(["*"], "write:alarms"), true);
    assert.equal(scopeAllows(["read:alarms"], "write:alarms"), false);
  } finally {
    if (before === undefined) delete process.env.API_KEY_EMPTY_SCOPES_DENY; else process.env.API_KEY_EMPTY_SCOPES_DENY = before;
  }
  for (const s of ["write:alarms", "write:attributes", "write:maintenance", "read:alarm-rules", "read:events"]) assert.ok(API_SCOPE_IDS.includes(s), s);
});

test("request log: ids and ingest URL tokens are replaced, the query string dropped", () => {
  assert.equal(normalisePath("/ingest/e/AbCdEf0123456789AbCdEf0123456789AbCdEf01/payload?x=1"), "/ingest/e/:token/payload");
  assert.equal(normalisePath("/v1/assets/00000010-0000-0000-0000-000000000001/telemetry"), "/v1/assets/:id/telemetry");
  assert.equal(normalisePath("/ingest/k/client-123/batch"), "/ingest/k/:clientId/batch");
  assert.equal(ACCESS_TOKEN_PREFIX, "nxat_");
});

test("connectors: records found by path become readings; only values are kept", () => {
  const json = { result: { items: [
    { id: "pump-1", ts: "2026-11-25T10:00:00Z", temp: 71.5, ok: true, note: "", nested: { rpm: 1480 } },
    { id: "", temp: 1 },
    { temp: 2 },
  ] } };
  const r = toReadings(atPath(json, "result.items"), { deviceIdField: "id", timestampField: "ts", fields: ["temp", "ok", "note", "nested.rpm"] });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.deviceId, "pump-1");
  assert.equal(r[0]!.timestamp?.toISOString(), "2026-11-25T10:00:00.000Z");
  assert.deepEqual(r[0]!.metrics, { temp: 71.5, ok: true, "nested.rpm": 1480 });
  const fixed = toReadings({ a: 1, b: "x" }, { deviceId: "meter-9" });
  assert.deepEqual(fixed, [{ deviceId: "meter-9", timestamp: undefined, metrics: { a: 1, b: "x" } }]);
});

test("modbus: 16- and 32-bit registers decode with either word order", () => {
  assert.equal(decodeRegisters([0xffff], "int16"), -1);
  assert.equal(decodeRegisters([0xffff], "uint16"), 65535);
  assert.equal(decodeRegisters([0x0001, 0x0000], "uint32"), 65536);
  assert.equal(decodeRegisters([0x0000, 0x0001], "uint32", "little"), 65536);
  assert.equal(decodeRegisters([0x42f7, 0x0000], "float32"), 123.5);
  assert.equal(decodeRegisters([0x0000, 0x42f7], "float32", "little"), 123.5);
  assert.equal(decodeRegisters([0xffff, 0xfffe], "int32"), -2);
});

test("sql connector: only a single SELECT or WITH statement is accepted", () => {
  assert.doesNotThrow(() => assertSelectOnly("SELECT * FROM readings WHERE ts > $1"));
  assert.doesNotThrow(() => assertSelectOnly("with x as (select 1) select * from x;"));
  assert.throws(() => assertSelectOnly("DELETE FROM readings"));
  assert.throws(() => assertSelectOnly("SELECT 1; DROP TABLE readings"));
});

test("rbac: every new route has a rule; operators cannot manage connectors; viewers get nothing", () => {
  const admin = resolveAccess("admin", null);
  const operator = resolveAccess("operator", null);
  for (const [m, p] of [
    ["GET", "/integration/catalog"], ["GET", "/integration/clients"], ["PUT", "/integration/clients/x/access"],
    ["POST", "/integration/clients/x/rotate"], ["GET", "/integration/clients/x/usage"], ["GET", "/integration/alerts"],
    ["GET", "/integration/destinations"], ["PUT", "/integration/destinations/x/delivery"], ["POST", "/integration/destinations/x/resend-dead"],
    ["GET", "/integration/deliveries"], ["POST", "/integration/deliveries/x/resend"],
    ["GET", "/integration/connectors"], ["POST", "/integration/connectors"], ["POST", "/integration/connectors/x/run"],
  ] as const) assert.equal(ruleAllows(admin, m, p), true, `${m} ${p}`);
  assert.equal(ruleAllows(operator, "POST", "/integration/connectors"), false);
  // Public discovery and the token endpoint need no session.
  const viewer = resolveAccess("viewer", null);
  assert.equal(ruleAllows(viewer, "POST", "/oauth/token"), true);
  assert.equal(ruleAllows(viewer, "GET", "/v1/openapi.json"), true);
  assert.equal(ruleAllows(viewer, "GET", "/integration/clients"), false);
});

test("v1 spec: every documented route names its scope", () => {
  for (const [path, ops] of Object.entries(V1_OPENAPI.paths)) {
    for (const [, op] of Object.entries(ops as Record<string, Record<string, unknown>>)) {
      if (path === "/oauth/token" || path === "/v1/event-types") continue;
      assert.ok(typeof op["x-scope"] === "string", `${path} has x-scope`);
    }
  }
});
