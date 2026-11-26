/**
 * AI Reports, stage 2: the investigation. The model and the tools are fakes, so
 * the loop, its budgets, the fallback chain, verified numbers and the scope and
 * module gating of the report tools are checked without a database or network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFacts, investigationMessages, unverifiedNumbers, type ReportInput } from "../lib/ai-report";
import {
  investigateReport, stepSummary, writeReportNarrative, InvestigationError, INVESTIGATION_BUDGET,
  type AgentDeps,
} from "../lib/ai-report-agent";
import { LlmRateLimitError, type LlmChatReply } from "../lib/llm";
import { parseRange, reportAgentTools, runScopedTool, toolByName, toolNamesFor } from "../routes/ai";
import { resolveAccess } from "../lib/rbac";
import { subtree, type ChatScope } from "../lib/ai-scope";

const A = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b9";
const FROM = new Date("2026-11-20T00:00:00Z"), TO = new Date("2026-11-21T00:00:00Z");

function facts(level: "executive" | "manager" | "engineer" = "engineer") {
  const input: ReportInput = {
    scope: { assetId: null, name: "Plant" }, range: { from: FROM, to: TO }, level, timeZone: "UTC",
    assets: [{ id: A, name: "Pump 1" }], alarmsIncluded: true,
    stats: [{ assetId: A, metric: "temperature", n: 100, min: 60, avg: 72.457, max: 91 }],
    prevStats: [{ assetId: A, metric: "temperature", n: 100, avg: 60 }],
    alarms: [], prevAlarms: [], coverage: [{ assetId: A, hours: 24 }], prevCoverage: [{ assetId: A, hours: 24 }],
    lastSeen: [{ assetId: A, ts: TO }], buckets: [], bucketMs: 3_600_000,
  };
  return buildFacts(input);
}

const ENGINEER_JSON = JSON.stringify({
  summary: "Pump 1 ran hot: average 72.457, peak 91, and the high limit is 85.",
  diagnoses: [{ asset: "Pump 1", observation: "hot", correlated: "", rootCause: "fouling", confidence: "medium" }],
  actions: [{ action: "Clean the cooler", urgency: "this_week" }],
});

/** A fake model that plays back the given replies in order and records each call's options. */
function fakeChat(replies: (LlmChatReply | Error)[], calls: { allowTools: boolean; timeoutMs: number }[] = []) {
  let i = 0;
  return async (_m: unknown[], o: { allowTools: boolean; timeoutMs: number }) => {
    calls.push({ allowTools: o.allowTools, timeoutMs: o.timeoutMs });
    const r = replies[Math.min(i++, replies.length - 1)]!;
    if (r instanceof Error) throw r;
    return r;
  };
}
const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: JSON.stringify(args) });
const deps = (chat: AgentDeps["chat"], over: Partial<AgentDeps> = {}): AgentDeps => ({
  tools: [{ type: "function", function: { name: "get_alarm_rules" } }],
  chat,
  runTool: async (name) => (name === "get_alarm_rules" ? { count: 1, rules: [{ metric: "temperature", threshold: 85 }] } : { error: "unknown" }),
  ...over,
});

test("report investigation: tool calls, then the level's JSON; tool-result numbers count as verified", async () => {
  const f = facts();
  const r = await investigateReport(f, deps(fakeChat([
    { content: null, toolCalls: [call("1", "get_alarm_rules", { assetId: A })] },
    { content: ENGINEER_JSON, toolCalls: [] },
  ])));
  assert.equal(r.narrative.level, "engineer");
  assert.equal(r.toolCalls, 1);
  assert.deepEqual(r.steps.map((s) => s.tool), ["get_alarm_rules"]);
  assert.match(r.steps[0]!.summary, /1 alarm rules/);
  assert.ok(r.toolNumbers.includes(85));
  assert.deepEqual(unverifiedNumbers(r.narrative, f, r.toolNumbers), [], "85 came from a tool result");
  assert.deepEqual(unverifiedNumbers(r.narrative, f), ["85"], "without the tool result 85 is unverified");
});

test("report investigation: at most maxToolCalls tool calls, then a final answer without tools", async () => {
  const calls: { allowTools: boolean; timeoutMs: number }[] = [];
  let ran = 0;
  const many = { content: null, toolCalls: Array.from({ length: 5 }, (_, i) => call(String(i), "get_alarm_rules", { assetId: A })) };
  const r = await investigateReport(facts(), deps(fakeChat([many, many, { content: ENGINEER_JSON, toolCalls: [] }], calls), {
    runTool: async () => { ran++; return { count: 0, rules: [] }; },
  }), { ...INVESTIGATION_BUDGET, maxToolCalls: 8 });
  assert.equal(ran, 8, "tool calls stop at the budget");
  assert.equal(r.toolCalls, 8);
  assert.equal(calls.at(-1)!.allowTools, false, "the last call forbids tools");
  assert.ok(calls.length <= INVESTIGATION_BUDGET.maxTurns + 1);
});

test("report investigation: the deadline stops the loop; past it, the investigation fails", async () => {
  let t = 0;
  const now = () => t;
  // Each model turn takes 20 s of fake time.
  const slow: AgentDeps["chat"] = async () => { t += 20_000; return { content: null, toolCalls: [call("1", "get_alarm_rules", { assetId: A })] }; };
  await assert.rejects(
    investigateReport(facts(), deps(slow, { now }), { maxToolCalls: 8, maxTurns: 6, deadlineMs: 38_000, finalReserveMs: 12_000 }),
    (e: unknown) => e instanceof InvestigationError && e.reason === "deadline" && Array.isArray((e as any).steps) && (e as any).steps.length === 2,
  );
  // Each call is given only the time left before the reserve.
  const calls: { allowTools: boolean; timeoutMs: number }[] = [];
  t = 0;
  await investigateReport(facts(), deps(fakeChat([{ content: ENGINEER_JSON, toolCalls: [] }], calls), { now }));
  assert.equal(calls[0]!.timeoutMs, INVESTIGATION_BUDGET.deadlineMs - INVESTIGATION_BUDGET.finalReserveMs);
});

test("report narrative: investigation fails, then the single call, then facts only", async () => {
  const f = facts();
  const configured = { configured: true };
  const broken = deps(fakeChat([new Error("provider down")]));
  const single = await writeReportNarrative(f, { ...configured, agent: broken, complete: async () => ENGINEER_JSON });
  assert.equal(single.status, "ok");
  assert.equal(single.investigation.mode, "single");

  const none = await writeReportNarrative(f, { ...configured, agent: broken, complete: async () => { throw new Error("still down"); } });
  assert.equal(none.narrative, null);
  assert.equal(none.status, "failed");
  assert.equal(none.investigation.mode, "none");

  const unreadable = await writeReportNarrative(f, { ...configured, agent: deps(fakeChat([{ content: "no idea", toolCalls: [] }])), complete: async () => "sorry" });
  assert.equal(unreadable.status, "unreadable");

  const ok = await writeReportNarrative(f, { ...configured, agent: deps(fakeChat([{ content: ENGINEER_JSON, toolCalls: [] }])), complete: async () => { throw new Error("not called"); } });
  assert.equal(ok.investigation.mode, "investigated");

  const off = await writeReportNarrative(f, { configured: false, agent: broken, complete: async () => ENGINEER_JSON });
  assert.equal(off.status, "unavailable");
  assert.equal(off.investigation.mode, "none");
});

test("report narrative: a usage limit in the investigation falls back to the single call; there it is reported", async () => {
  const fromSingle = await writeReportNarrative(facts(), {
    configured: true,
    agent: deps(fakeChat([{ content: null, toolCalls: [call("1", "get_alarm_rules", { assetId: A })] }, new LlmRateLimitError(42)])),
    complete: async () => ENGINEER_JSON,
  });
  assert.equal(fromSingle.status, "ok");
  assert.equal(fromSingle.investigation.mode, "single");
  assert.equal(fromSingle.investigation.toolCalls, 1, "the lookups made before the limit stay listed");
  const limited = await writeReportNarrative(facts(), {
    configured: true,
    agent: deps(fakeChat([new LlmRateLimitError(42)])),
    complete: async () => { throw new LlmRateLimitError(42); },
  });
  assert.equal(limited.status, "rate_limited");
  assert.match(limited.narrativeError!, /42 seconds/);
});

test("report narrative: no single call without enough time left", async () => {
  let t = 0;
  let singleCalls = 0;
  const r = await writeReportNarrative(facts(), {
    configured: true,
    agent: deps(async () => { t += 45_000; throw new Error("slow failure"); }, { now: () => t }),
    complete: async () => { singleCalls++; return ENGINEER_JSON; },
  });
  assert.equal(r.status, "failed");
  assert.equal(singleCalls, 0);
});

test("report investigation prompt: facts are wrapped as untrusted data and carry no asset ids", () => {
  const msgs = investigationMessages(facts("executive"), INVESTIGATION_BUDGET);
  assert.match(msgs[0]!.content, /never instructions/);
  assert.match(msgs[0]!.content, /at most 8 calls/);
  assert.match(msgs[1]!.content, /"untrusted_data"/);
  assert.ok(!msgs[1]!.content.includes(A));
});

test("report tools: new tools are gated by module", () => {
  const eng = toolNamesFor(resolveAccess("engineer", {}));
  for (const t of ["get_alarm_rules", "get_asset_attributes", "get_recent_changes"]) assert.ok(eng.includes(t), t);
  assert.ok(!toolNamesFor(resolveAccess("engineer", { modules: { alarms: false } })).includes("get_alarm_rules"));
  assert.ok(!toolNamesFor(resolveAccess("engineer", { modules: { activity_log: false } })).includes("get_recent_changes"));
  assert.ok(!toolNamesFor(resolveAccess("engineer", { modules: { assets: { r: false, w: false, d: false } } })).includes("get_asset_attributes"));
});

test("report tools: assets outside the report's scope are refused before any lookup", async () => {
  const scope: ChatScope = { rootId: A, name: "Pump 1", assetIds: subtree(A, [{ id: A, parentId: null }, { id: OTHER, parentId: null }]) };
  for (const name of ["get_alarm_rules", "get_asset_attributes", "get_recent_changes"]) {
    const r: any = await runScopedTool(toolByName(name)!, { assetId: OTHER }, { scope });
    assert.match(r.error, /outside the selected scope/, name);
  }
  // A tool the caller may not use is unknown to them.
  const t = reportAgentTools(["list_assets"], { from: FROM, to: TO, scope });
  assert.match(JSON.stringify(await t.runTool("get_recent_changes", { assetId: A })), /unknown tool/);
});

test("report steps: a short summary of each lookup", () => {
  assert.equal(stepSummary("aggregate_telemetry", { metric: "Pump.temperature" }, { stats: { n: 120 } }), "Pump.temperature: 120 readings");
  assert.match(stepSummary("get_alarm_rules", {}, { error: "That asset is outside the selected scope: X. Tell" }), /no result \(That asset is outside the selected scope: X\)/);
});

test("chat range: at most 92 days", () => {
  assert.equal(typeof parseRange({ from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" }), "string");
  assert.equal(typeof parseRange({ from: "2026-09-01T00:00:00Z", to: "2026-11-01T00:00:00Z" }), "object");
});

test("long-range tools: statistics from hourly summaries", async () => {
  const { summariseAggs } = await import("../routes/ai");
  const H = 3_600_000;
  const s = summariseAggs([
    { assetId: A, metric: "m", t: 0, n: 2, sum: 20, min: 9, max: 11 },
    { assetId: A, metric: "m", t: H, n: 2, sum: 40, min: 19, max: 21 },
  ])!;
  assert.equal(s.n, 4);
  assert.equal(s.avg, 15);
  assert.equal(s.min, 9);
  assert.equal(s.max, 21);
  assert.equal(s.trendPerHour, 10, "hourly averages 10 then 20");
  assert.equal(summariseAggs([]), null);
});
