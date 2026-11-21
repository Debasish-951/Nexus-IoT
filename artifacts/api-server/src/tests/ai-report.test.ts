/**
 * AI Reports: the figures are computed in code, the report level follows the
 * role, the narrative is checked per level, and a report is still produced
 * when the AI service is missing or fails.
 * Pure logic only; no database and no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_LEVEL_BY_ROLE, buildFacts, changePct, factsForModel, healthScore, narrativeTexts, parseNarrative, parseReportRequest,
  pearson, previousRange, reportLevelFor, reportMessages, unverifiedNumbers, type BucketRow, type ReportInput, type ReportNarrative,
} from "../lib/ai-report";
import { reportNarrative } from "../routes/ai";
import { LlmRateLimitError } from "../lib/llm";
import { mergeBuckets, mergeCoverage, planRead, reportBucketMs } from "../lib/report-telemetry";
import { ruleAllows } from "../middleware/authorize";
import { resolveAccess, ROLES } from "../lib/rbac";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const OUT = "00000000-0000-0000-0000-0000000000ff";
const FROM = new Date("2026-11-20T00:00:00Z");
const TO = new Date("2026-11-21T00:00:00Z");
const HOUR = 3_600_000;

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    scope: { assetId: null, name: "Demo Plant" },
    range: { from: FROM, to: TO },
    level: "manager",
    assets: [{ id: A, name: "Pump 1" }, { id: B, name: "Boiler", maintenanceMode: true, maintenanceSince: "2026-11-20T18:00:00Z" }, { id: C, name: "Spare" }],
    stats: [
      { assetId: A, metric: "temperature", n: 100, min: 60, avg: 72.4567, max: 91 },
      { assetId: A, metric: "energy_kwh", n: 24, min: 1000, avg: 1100, max: 1240 },
      { assetId: B, metric: "pressure", n: 50, min: 5, avg: 6, max: 7 },
      { assetId: OUT, metric: "secret", n: 9, min: 1, avg: 1, max: 1 },
    ],
    prevStats: [
      { assetId: A, metric: "temperature", n: 90, avg: 60 },
      { assetId: A, metric: "energy_kwh", n: 24, avg: 800, min: 760, max: 1000 },
      { assetId: B, metric: "pressure", n: 40, avg: 0 },
      { assetId: OUT, metric: "secret", n: 9, avg: 2 },
    ],
    alarms: [
      { assetId: A, assetName: "Pump 1", name: "High temperature", severity: "critical", triggeredAt: "2026-11-20T01:00:00Z", acknowledgedAt: "2026-11-20T01:10:00Z", clearedAt: "2026-11-20T02:00:00Z" },
      { assetId: A, assetName: "Pump 1", name: "High temperature", severity: "critical", triggeredAt: "2026-11-20T05:00:00Z", acknowledgedAt: "2026-11-20T05:20:00Z", clearedAt: null },
      { assetId: B, assetName: "Boiler", name: "Low pressure", severity: "medium", triggeredAt: "2026-11-20T06:00:00Z" },
      { assetId: OUT, assetName: "Other project", name: "x", severity: "high", triggeredAt: "2026-11-20T06:00:00Z" },
    ],
    prevAlarms: [
      { assetId: A, assetName: "Pump 1", name: "High temperature", severity: "high", triggeredAt: "2026-11-19T03:00:00Z", acknowledgedAt: "2026-11-19T03:30:00Z", clearedAt: "2026-11-19T05:00:00Z" },
    ],
    coverage: [{ assetId: A, hours: 24 }, { assetId: B, hours: 6 }, { assetId: OUT, hours: 24 }],
    prevCoverage: [{ assetId: A, hours: 24 }],
    lastSeen: [{ assetId: A, ts: "2026-11-20T23:50:00Z" }, { assetId: B, ts: "2026-11-20T18:00:00Z" }, { assetId: C, ts: "2026-10-01T00:00:00Z" }],
    timeZone: "UTC",
    ...over,
  };
}

test("ai reports: the report level follows the role, unknown roles get the manager report", () => {
  assert.equal(reportLevelFor("super_admin"), "executive");
  assert.equal(reportLevelFor("company_admin"), "executive");
  assert.equal(reportLevelFor("project_manager"), "executive");
  assert.equal(reportLevelFor("team_lead"), "manager");
  assert.equal(reportLevelFor("admin"), "manager");
  assert.equal(reportLevelFor("viewer"), "manager");
  assert.equal(reportLevelFor("engineer"), "engineer");
  assert.equal(reportLevelFor("developer"), "engineer");
  assert.equal(reportLevelFor("operator"), "engineer");
  assert.equal(reportLevelFor("someone_new"), "manager");
  assert.equal(reportLevelFor(null), "manager");
  for (const r of ROLES) assert.ok(r in REPORT_LEVEL_BY_ROLE, `role ${r} has a report level`);
});

test("ai reports: figures are computed from the rows, within scope only", () => {
  const f = buildFacts(input());
  assert.equal(f.level, "manager");
  assert.equal(f.kpis.assets, 3);
  assert.equal(f.kpis.assetsReporting, 2);
  assert.equal(f.kpis.inMaintenance, 1);
  assert.equal(f.kpis.metricsTracked, 3, "a metric of an asset outside the scope is left out");
  assert.equal(f.kpis.readings, 174);
  assert.equal(f.kpis.alarms, 3);
  assert.deepEqual(f.kpis.alarmsBySeverity, { critical: 2, high: 0, medium: 1, low: 0, info: 0 });
  assert.equal(f.kpis.stillOpen, 2);
  assert.equal(f.kpis.mttaMinutes, 15);
  assert.equal(f.kpis.mttrMinutes, 60);
  assert.equal(f.alarmAssets[0]!.assetName, "Pump 1");
  assert.deepEqual(f.topAlarms[0], { name: "High temperature", assetName: "Pump 1", severity: "critical", count: 2 });
  assert.ok(!JSON.stringify(f).includes("secret") && !JSON.stringify(f).includes("Other project"));
});

test("ai reports: previous period, energy, KPI cards and health score", () => {
  const f = buildFacts(input());
  const temp = f.metrics.find((m) => m.metric === "temperature")!;
  assert.equal(temp.changePct, 20.8);
  assert.equal(f.metrics.find((m) => m.metric === "pressure")!.changePct, null, "no change from a zero baseline");
  assert.equal(f.kpis.energyUsedKwh, 240, "energy used is the counter's rise");
  assert.equal(f.previousKpis.energyUsedKwh, 240);
  assert.equal(f.previousKpis.alarms, 1);
  assert.equal(f.previousKpis.mttaMinutes, 30);
  assert.equal(f.kpis.dataCoveragePct, 62.5);
  assert.equal(f.previousKpis.dataCoveragePct, 100);
  const severe = f.kpiCards.find((c) => c.key === "severe")!;
  assert.deepEqual([severe.value, severe.prev, severe.trend], [2, 1, "worse"]);
  assert.equal(f.kpiCards.find((c) => c.key === "energy")!.trend, "same");
  assert.ok(f.kpiCards.length >= 4 && f.kpiCards.length <= 6);
  // Monitored: Pump 1 (reporting) and Spare (sent data once); Boiler is in maintenance.
  assert.equal(f.healthScore.parts.availabilityPct, 50);
  // 40 x 0.5 + 30 x 0.625 + 30 / (1 + (2x3 + 1) / 2 assets / 1 day) = 20 + 18.75 + 6.67
  assert.equal(f.healthScore.score, 45);
  assert.deepEqual(previousRange({ from: FROM, to: TO }), { from: new Date("2026-11-19T00:00:00Z"), to: FROM });
  assert.equal(changePct(110, -100), 210);
});

test("ai reports: the health score formula", () => {
  const none = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  assert.equal(healthScore({ availability: 1, coverage: 1, bySeverity: none, monitored: 4, days: 1 }).score, 100);
  // 2 critical alarms on 2 assets in 1 day: burden 3, alarm part 30/4 = 7.5.
  assert.equal(healthScore({ availability: 1, coverage: 1, bySeverity: { ...none, critical: 2 }, monitored: 2, days: 1 }).score, 78);
  assert.equal(healthScore({ availability: 0.5, coverage: 0.5, bySeverity: null, monitored: 2, days: 1 }).score, 50, "without alarm access the two other parts are scaled to 100");
  assert.equal(healthScore({ availability: null, coverage: null, bySeverity: none, monitored: 0, days: 1 }).score, null);
});

test("ai reports: asset status, maintenance time and stuck sensors", () => {
  const f = buildFacts(input({ stats: [...input().stats, { assetId: A, metric: "flow", n: 30, min: 4, avg: 4, max: 4 }] }));
  const byName = Object.fromEntries(f.assetHealth.map((h) => [h.assetName, h.status]));
  assert.deepEqual(byName, { "Pump 1": "alarm", Spare: "silent", Boiler: "maintenance" });
  assert.equal(f.statusCounts.alarm, 1);
  assert.deepEqual(f.maintenance, [{ assetId: B, assetName: "Boiler", since: "2026-11-20T18:00:00.000Z", hoursInPeriod: 6 }]);
  assert.deepEqual(f.dataQuality.stuck, [{ assetName: "Pump 1", metric: "flow", value: 4, readings: 30 }]);
});

test("ai reports: repeat alarms and alarm timing", () => {
  const rows = [1, 2, 3, 13].map((h) => ({ assetId: A, assetName: "Pump 1", name: "Trip", severity: "high", triggeredAt: new Date(FROM.getTime() + h * HOUR) }));
  const more = [1.5, 2.5, 3.5].map((h) => ({ assetId: A, assetName: "Pump 1", name: "Other", severity: "low", triggeredAt: new Date(FROM.getTime() + h * HOUR) }));
  const f = buildFacts(input({ alarms: [...rows, ...more] }));
  const trip = f.repeatAlarms.find((r) => r.name === "Trip")!;
  assert.equal(trip.count, 4);
  assert.equal(trip.medianGapMinutes, 60);
  assert.equal(f.alarmTiming.byHour[1], 2);
  assert.deepEqual(f.alarmTiming.peakWindow, { startHour: 1, endHour: 4, alarms: 6, sharePct: 85.7 });
  assert.equal(f.alarmTiming.peakWeekday, null, "a weekday peak needs about a week of data");
  // The same alarms read in another time zone move by its offset.
  const ist = buildFacts(input({ alarms: rows, timeZone: "Asia/Kolkata" }));
  assert.equal(ist.alarmTiming.byHour[6], 1, "01:00 UTC is 06:30 in India");
});

test("ai reports: correlation and leading signals from time buckets", () => {
  assert.equal(pearson([1, 2, 3, 4], [2, 4, 6, 8])!.toFixed(3), "1.000");
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null, "a flat series has no correlation");
  const buckets: BucketRow[] = [];
  for (let i = 0; i < 24; i++) {
    const t = FROM.getTime() + i * HOUR;
    const temp = 60 + i + (i === 9 ? 30 : 0);
    buckets.push({ assetId: A, metric: "temperature", t, avg: temp });
    buckets.push({ assetId: A, metric: "vibration", t, avg: 2 + i * 0.1 + (i === 9 ? 3 : 0) });
    buckets.push({ assetId: A, metric: "noise", t, avg: i % 2 });
  }
  const alarm = { assetId: A, assetName: "Pump 1", name: "High vibration", severity: "high", triggeredAt: new Date(FROM.getTime() + 10 * HOUR + 5 * 60_000) };
  const f = buildFacts(input({ buckets, bucketMs: HOUR, alarms: [alarm] }));
  const c = f.correlations.find((x) => [x.metricA, x.metricB].sort().join() === "temperature,vibration")!;
  assert.ok(c && c.r >= 0.7 && c.points === 24);
  assert.ok(!f.correlations.some((x) => x.metricA === "noise" || x.metricB === "noise"));
  const s = f.leadingSignals[0]!;
  assert.equal(s.alarm, "High vibration");
  assert.equal(s.direction, "rose");
  assert.ok(["temperature", "vibration"].includes(s.metric) && s.zScore >= 2.5);
  assert.ok(f.trends.length <= 4);
});

test("ai reports: the model reads only what the level needs, without asset ids", () => {
  const exec = factsForModel(buildFacts(input({ level: "executive" })));
  assert.ok("kpiCards" in exec && "healthScore" in exec && !("metrics" in exec) && !("alarmTimeline" in exec));
  const eng = factsForModel(buildFacts(input({ level: "engineer" })));
  assert.ok("correlations" in eng && "alarmTimeline" in eng && !("healthScore" in eng));
  for (const level of ["executive", "manager", "engineer"] as const) {
    const msgs = reportMessages(buildFacts(input({ level })));
    assert.match(msgs[0]!.content, /Never invent/);
    assert.ok(!msgs[1]!.content.includes(A), `asset ids are not sent to the model (${level})`);
  }
  assert.match(reportMessages(buildFacts(input({ level: "executive" })))[0]!.content, /headline/);
  assert.match(reportMessages(buildFacts(input({ level: "engineer" })))[0]!.content, /confidence/);
});

test("ai reports: each level's narrative must be the JSON asked for", () => {
  assert.equal(parseNarrative("not json", "manager"), null);
  assert.equal(parseNarrative('{"summary": "ok"}', "manager"), null, "a summary with no problem areas or priorities is not a report");
  const exec = parseNarrative('Here: {"headline":"Stable week.","summary":"Fine.","risks":[{"title":"Pump trips","what":"x","impact":"y","cause":"z","decision":"d"},{"bad":1},"no"],"improvements":["a",3],"decisions":["Approve spares"],"outlook":"Calm."} done', "executive");
  assert.deepEqual(exec, { level: "executive", headline: "Stable week.", summary: "Fine.", risks: [{ title: "Pump trips", what: "x", impact: "y", cause: "z", decision: "d" }], improvements: ["a"], decisions: ["Approve spares"], outlook: "Calm." });
  assert.equal(parseNarrative('{"summary":"Fine.","risks":[],"decisions":["x"]}', "executive"), null, "an executive report needs a headline");
  const eng = parseNarrative('{"summary":"s","diagnoses":[{"asset":"Pump 1","observation":"hot","correlated":"","rootCause":"fouling","confidence":"certain"}],"actions":[{"action":"Clean","urgency":"soon"},{"action":"Now","urgency":"immediate"}]}', "engineer");
  assert.ok(eng && eng.level === "engineer");
  assert.equal(eng.diagnoses[0]!.confidence, "medium", "an unknown confidence is read as medium");
  assert.deepEqual(eng.actions.map((a) => a.urgency), ["this_week", "immediate"]);
  const mgr = parseNarrative('{"summary":"s","problemAreas":[{"area":"Pump 1","issue":"trips","impact":"i","cause":"c"}],"priorities":[{"action":"Inspect","owner":"maintenance engineer"}],"patterns":["night shift"],"response":"slower"}', "manager");
  assert.ok(mgr && mgr.level === "manager" && mgr.priorities[0]!.owner === "maintenance engineer");
  assert.deepEqual(narrativeTexts(eng).includes("medium"), false, "enum fields are not text");
});

test("ai reports: numbers not in the facts are flagged", () => {
  const f = buildFacts(input());
  const n: ReportNarrative = {
    level: "manager", summary: "Temperature averaged 72.46 and rose 20.8% to a 91 peak; 2 critical alarms.",
    problemAreas: [{ area: "TT-101", issue: "read 450 at 2026-11-20T05:00:00Z on 20 November.", impact: "", cause: "" }],
    response: "", patterns: [], priorities: [{ action: "Energy rose 240 kWh, about 300 more than planned.", owner: "operator" }],
  };
  assert.deepEqual(unverifiedNumbers(n, f), ["450", "300"]);
});

test("ai reports: request checks", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  assert.equal(typeof parseReportRequest({ range: { from: "x", to: "y" } }, now), "string");
  assert.equal(typeof parseReportRequest({ assetId: "1; drop", range: { from: FROM.toISOString(), to: TO.toISOString() } }, now), "string");
  assert.match(parseReportRequest({ range: { from: "2026-01-01T00:00:00Z", to: TO.toISOString() } }, now) as string, /at most 92 days/);
  const ok = parseReportRequest({ assetId: A, focus: "energy", timeZone: "Asia/Kolkata", range: { from: FROM.toISOString(), to: "2026-11-30T00:00:00Z" } }, now);
  assert.ok(typeof ok !== "string", "a focus from older links is ignored, not refused");
  assert.equal(ok.range.to.toISOString(), now.toISOString(), "a range ending in the future stops now");
  assert.equal(ok.timeZone, "Asia/Kolkata");
  const bad = parseReportRequest({ timeZone: "Mars/Base", range: { from: FROM.toISOString(), to: TO.toISOString() } }, now);
  assert.ok(typeof bad !== "string" && bad.timeZone === "UTC");
});

test("ai reports: without a usable AI answer the figures still come back with the reason", async () => {
  const f = buildFacts(input({ level: "executive" }));
  const failed = await reportNarrative(f, async () => { throw new Error("network down"); });
  assert.equal(failed.narrative, null);
  assert.equal(failed.status, "failed");
  assert.match(failed.narrativeError!, /did not answer/);
  const limited = await reportNarrative(f, async () => { throw new LlmRateLimitError(42); });
  assert.equal(limited.status, "rate_limited");
  assert.match(limited.narrativeError!, /42 seconds/);
  const garbled = await reportNarrative(f, async () => "Sorry, I cannot help.");
  assert.equal(garbled.status, "unreadable");
  const good = await reportNarrative(f, async () => '{"headline":"Stable day.","summary":"Pump 1 averaged 72.457.","risks":[],"improvements":[],"decisions":["Inspect cooler"],"outlook":""}');
  assert.equal(good.status, "ok");
  assert.equal(good.narrativeError, null);
  assert.deepEqual(good.unverified, []);
});

test("ai reports: the route needs AI Advisor", () => {
  assert.equal(ruleAllows(resolveAccess("engineer", {}), "POST", "/ai/report"), true);
  assert.equal(ruleAllows(resolveAccess("viewer", {}), "POST", "/ai/report"), false);
  assert.equal(ruleAllows(resolveAccess("viewer", { modules: { ai_advisor: true } }), "POST", "/ai/report"), true);
});

test("ai reports: a period is read from hourly summaries plus short raw spans", () => {
  const H = 3_600_000;
  const from = new Date("2026-11-14T10:20:00Z"), to = new Date("2026-11-21T10:20:00Z");
  const p = planRead({ from, to }, new Date("2026-11-21T04:00:00Z"));
  assert.deepEqual(p.rollup, { from: new Date("2026-11-14T11:00:00Z"), to: new Date("2026-11-21T04:00:00Z") });
  assert.deepEqual(p.raw, [
    { from, to: new Date("2026-11-14T11:00:00Z"), open: true },
    { from: new Date("2026-11-21T04:00:00Z"), to },
  ]);
  assert.deepEqual(planRead({ from, to }, null), { rollup: null, raw: [{ from, to }] }, "without summaries everything is raw");
  const short = { from: new Date("2026-11-21T09:10:00Z"), to: new Date("2026-11-21T10:05:00Z") };
  assert.deepEqual(planRead(short, new Date("2026-11-21T10:00:00Z")), { rollup: null, raw: [short] });
  const old = planRead({ from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-08T00:00:00Z") }, new Date("2026-11-21T04:00:00Z"));
  assert.deepEqual(old.raw, [], "a period fully before the watermark reads no raw telemetry");
  assert.equal(reportBucketMs({ from, to }), 4 * H, "7 days in whole-hour buckets, about 48 of them");
  assert.equal(reportBucketMs({ from: short.from, to: new Date(short.from.getTime() + 24 * H) }), H);
});

test("ai reports: summary and raw parts merge into the same figures as one scan", () => {
  const t0 = Date.UTC(2026, 10, 20, 0);
  const rollup = [
    { assetId: A, metric: "temperature", t: t0, n: 10, sum: 700, min: 60, max: 80 },
    { assetId: A, metric: "temperature", t: t0 + 3_600_000, n: 10, sum: 750, min: 70, max: 79 },
  ];
  const tail = [
    { assetId: A, metric: "temperature", t: t0 + 3_600_000, n: 5, sum: 450, min: 85, max: 95 },
    { assetId: A, metric: "status_text", t: t0, n: 0, sum: null, min: null, max: null },
  ];
  const { stats, buckets } = mergeBuckets([rollup, tail]);
  assert.deepEqual(stats, [{ assetId: A, metric: "temperature", n: 25, min: 60, avg: 76, max: 95 }]);
  assert.deepEqual(buckets.map((b) => [b.t - t0, b.avg]), [[0, 70], [3_600_000, 80]]);
  assert.deepEqual(mergeCoverage([[{ assetId: A, hours: 160 }], [{ assetId: A, hours: 1 }, { assetId: B, hours: 2 }]]),
    [{ assetId: A, hours: 161 }, { assetId: B, hours: 2 }]);
});
