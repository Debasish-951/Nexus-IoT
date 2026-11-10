/**
 * Regression tests for the P2 data-layer findings of the November 2026 audit.
 *
 * Pure logic only: no database is needed (the test script sets a placeholder
 * DATABASE_URL so modules that import the pool can load; nothing connects).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toNum, isBlankReading, assignAttributeValues } from "../routes/ingest";
import { planRetention, planItemCovers, effectiveRetentionDays, policyLevel, type RetentionPolicyLike } from "../routes/system";
import { parseClamdReply, cleanClamdReply } from "../lib/upload/scanner";
import { keepNewest } from "../lib/telemetry-aggregate";
import { InflightGate, mqttClientIdFor } from "../services/mqtt";
import { statusBucketSeconds, densifyMinutes, currentPerMinute } from "../routes/dashboard";
import { startOfZoneDay, startOfZoneHour, zoneDateKey, zoneOffsetMs } from "../lib/plant-time";
import { CreateDestinationBody } from "../schemas/common";

test("FUN-10: blank and non-finite readings are not numbers", () => {
  assert.equal(toNum(""), null);
  assert.equal(toNum("   "), null);
  assert.equal(toNum(null), null);
  assert.equal(toNum(undefined), null);
  assert.equal(toNum(NaN), null);
  assert.equal(toNum(Infinity), null);
  assert.equal(toNum("abc"), null);
  assert.equal(toNum({}), null);
  assert.equal(toNum("1e999"), null, "overflow to Infinity is refused");
  assert.equal(toNum(0), 0);
  assert.equal(toNum("0"), 0);
  assert.equal(toNum(" 12.5 "), 12.5);
  assert.equal(toNum(-3), -3);
  assert.equal(toNum(true), 1);
  assert.equal(toNum(false), 0);
});

test("FUN-10: blank readings are flagged for quality 'bad'", () => {
  assert.equal(isBlankReading(""), true);
  assert.equal(isBlankReading("  "), true);
  assert.equal(isBlankReading(null), true);
  assert.equal(isBlankReading(0), false);
  assert.equal(isBlankReading("Running"), false);
  assert.equal(isBlankReading(false), false);
});

test("PERF-01: in-memory attribute matching keeps the old last-match-wins order", () => {
  const attrs = [
    { id: "a", tagName: "dev1.Temp", sourceMetric: null },
    { id: "b", tagName: "temp", sourceMetric: null },
    { id: "c", tagName: null, sourceMetric: "Pressure" },
    { id: "d", tagName: "pressure", sourceMetric: null },
    { id: "e", tagName: "dev1.sensor_serial", sourceMetric: null },
    { id: "f", tagName: "other", sourceMetric: null },
  ];
  const out = assignAttributeValues(attrs, "dev1", { temp: 21.5, pressure: "" }, "SN-1");
  assert.equal(out.get("a"), 21.5, "full deviceId.metric tag, case-insensitive");
  assert.equal(out.get("b"), 21.5, "bare tag");
  assert.equal(out.get("c"), "", "sourceMetric remap");
  assert.equal(out.get("d"), "");
  assert.equal(out.get("e"), "SN-1");
  assert.equal(out.has("f"), false);
});

test("DB-06: the most specific retention policy wins", () => {
  const policies: RetentionPolicyLike[] = [
    { id: "g", assetId: null, metric: null, retentionDays: 30 },
    { id: "a", assetId: "A", metric: null, retentionDays: 365 },
    { id: "m", assetId: null, metric: "temp", retentionDays: 90 },
    { id: "am", assetId: "A", metric: "temp", retentionDays: 7 },
    { id: "g2", assetId: null, metric: null, retentionDays: 60 },
    { id: "off", assetId: "B", metric: null, retentionDays: 1, enabled: false },
  ];
  assert.equal(effectiveRetentionDays({ assetId: "A", metric: "temp" }, policies), 7);
  assert.equal(effectiveRetentionDays({ assetId: "A", metric: "kw" }, policies), 365, "asset beats global");
  assert.equal(effectiveRetentionDays({ assetId: "B", metric: "temp" }, policies), 90, "metric beats global; disabled ignored");
  assert.equal(effectiveRetentionDays({ assetId: "B", metric: "kw" }, policies), 60, "duplicate globals: longer wins");
  assert.equal(effectiveRetentionDays({ assetId: "X", metric: "y" }, []), null);
  assert.equal(policyLevel({ assetId: "A", metric: "m" }), 3);

  // Every row is touched by exactly the plan item whose retention is the effective one.
  const plan = planRetention(policies);
  assert.equal(plan.length, 4, "duplicate scopes merge; disabled dropped");
  for (const assetId of ["A", "B", "C"]) {
    for (const metric of ["temp", "kw"]) {
      const covering = plan.filter((p) => planItemCovers(p, { assetId, metric }));
      assert.equal(covering.length, 1, `${assetId}/${metric} covered once`);
      assert.equal(covering[0].retentionDays, effectiveRetentionDays({ assetId, metric }, policies), `${assetId}/${metric}`);
    }
  }
});

test("DB-06: a global 30-day policy leaves an asset with a 365-day policy alone", () => {
  const plan = planRetention([
    { id: "g", assetId: null, metric: null, retentionDays: 30 },
    { id: "a", assetId: "A", metric: null, retentionDays: 365 },
  ]);
  const global = plan.find((p) => p.assetId === null)!;
  assert.equal(planItemCovers(global, { assetId: "A", metric: "temp" }), false);
  assert.equal(planItemCovers(global, { assetId: "B", metric: "temp" }), true);
});

test("OPS-04: clamd replies are read after stripping the NUL terminator", () => {
  assert.deepEqual(parseClamdReply("stream: OK\0"), { status: "clean" });
  assert.deepEqual(parseClamdReply("stream: OK\n\0"), { status: "clean" });
  assert.deepEqual(parseClamdReply("stream: Eicar-Test-Signature FOUND\0"), { status: "infected", signature: "Eicar-Test-Signature" });
  assert.deepEqual(parseClamdReply("INSTREAM size limit exceeded. ERROR\0"), { status: "error" });
  assert.equal(cleanClamdReply("PONG\0"), "PONG");
});

test("DB-05: aggregation keeps the newest buckets and reports truncation", () => {
  const newestFirst = [5, 4, 3, 2, 1];
  assert.deepEqual(keepNewest(newestFirst, 3), { rows: [3, 4, 5], truncated: true });
  assert.deepEqual(keepNewest([2, 1], 3), { rows: [1, 2], truncated: false });
});

test("DB-05: current rate is 0 when the newest minute is stale", () => {
  const now = new Date("2026-11-10T10:30:30Z");
  const from = new Date("2026-11-10T10:25:00Z");
  const fresh = densifyMinutes([{ minute: new Date("2026-11-10T10:29:00Z"), count: 7 }], from, now);
  assert.equal(fresh.length, 6, "every minute present");
  assert.equal(fresh.find((p) => p.minute === "2026-11-10T10:27:00.000Z")?.count, 0);
  assert.equal(currentPerMinute(fresh, now), 7);
  const stale = densifyMinutes([{ minute: new Date("2026-11-10T10:26:00Z"), count: 9 }], from, now);
  assert.equal(currentPerMinute(stale, now), 0);
});

test("DB-05: plant time zone day and hour boundaries", () => {
  const t = new Date("2026-11-10T20:00:00Z"); // 01:30 on 11 Nov in Kolkata
  assert.equal(zoneDateKey(t, "Asia/Kolkata"), "2026-11-11");
  assert.equal(zoneDateKey(t, "UTC"), "2026-11-10");
  assert.equal(startOfZoneDay(t, 0, "Asia/Kolkata").toISOString(), "2026-11-10T18:30:00.000Z");
  assert.equal(startOfZoneDay(t, 1, "Asia/Kolkata").toISOString(), "2026-11-09T18:30:00.000Z");
  assert.equal(startOfZoneDay(t, 0, "UTC").toISOString(), "2026-11-10T00:00:00.000Z");
  assert.equal(startOfZoneHour(new Date("2026-11-10T20:10:00Z"), "Asia/Kolkata").toISOString(), "2026-11-10T19:30:00.000Z");
  assert.equal(zoneOffsetMs(t, "Asia/Kolkata"), 5.5 * 3600_000);
  // Across a DST change: New York's 2 Nov 2026 midnight is UTC-5, after the change.
  assert.equal(startOfZoneDay(new Date("2026-11-02T12:00:00Z"), 0, "America/New_York").toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(startOfZoneDay(new Date("2026-11-02T12:00:00Z"), 1, "America/New_York").toISOString(), "2026-11-01T04:00:00.000Z");
});

test("PERF-02: health-index status sampling is bounded for long windows", () => {
  assert.equal(statusBucketSeconds(7), 300);
  assert.equal(statusBucketSeconds(1), 300);
  const s90 = statusBucketSeconds(90);
  assert.ok((90 * 86_400) / s90 <= 2016, `90 days at ${s90}s`);
  assert.equal(s90 % 300, 0);
});

test("PERF-01 / FUN-14: MQTT in-flight gate bounds concurrency and holds back delivery", async () => {
  const gate = new InflightGate(2);
  const resolvers: (() => void)[] = [];
  const task = () => new Promise<void>((r) => { resolvers.push(r); });
  let accepted = 0;
  const next = () => { accepted++; };
  gate.run(task, next); // 1 in flight, room for another
  assert.equal(accepted, 1);
  gate.run(task, next); // 2 in flight: delivery held
  assert.equal(accepted, 1);
  assert.equal(gate.active, 2);
  resolvers[0]();
  await new Promise((r) => setImmediate(r));
  assert.equal(accepted, 2, "a finished message releases the next delivery");
  assert.equal(gate.active, 1);
  resolvers[1]();
  await new Promise((r) => setImmediate(r));
  assert.equal(gate.active, 0);
});

test("FUN-14: MQTT client id is stable per broker", () => {
  const id = "0123abcd-0000-0000-0000-000000000000";
  assert.equal(mqttClientIdFor({ id, mqttClientId: null }), "iot-platform-0123abcd");
  assert.equal(mqttClientIdFor({ id, mqttClientId: "  gw-7 " }), "gw-7");
});

test("FUN-13: destination auth type accepts api_key and legacy apikey, not hmac", () => {
  const base = { name: "Hook", endpoint: "https://hooks.example.com/x" };
  assert.equal(CreateDestinationBody.parse({ ...base, authType: "api_key" }).authType, "api_key");
  assert.equal(CreateDestinationBody.parse({ ...base, authType: "apikey" }).authType, "api_key");
  assert.equal(CreateDestinationBody.parse(base).authType, "bearer");
  assert.equal(CreateDestinationBody.safeParse({ ...base, authType: "hmac" }).success, false);
});
