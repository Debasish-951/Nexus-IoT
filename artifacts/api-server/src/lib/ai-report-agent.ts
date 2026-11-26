/**
 * AI Reports, stage 2: the investigation (see the REQUIRED APPROACH note in
 * lib/ai-report.ts).
 *
 * The computed facts are the trusted base. The model reads them, picks the most
 * important problems and changes, investigates them in the database through the
 * AI Advisor's read-only tools (kept to the report's scope and period by the
 * caller's `runTool`), and then writes the report JSON for the reader's level.
 *
 * Bounded on every side so a report stays inside nginx's 60 s and the provider's
 * limits: at most `maxToolCalls` tool calls, `maxTurns` model turns and
 * `deadlineMs` in total, with `finalReserveMs` kept back for the final answer.
 * Any failure throws, and the route falls back to the single-call narrative and
 * then to facts only (`writeReportNarrative`). A usage limit during the
 * investigation also falls back to the (much smaller) single call; a usage limit
 * there is reported to the reader.
 *
 * No database or network here: the model and the tools are injected, so the
 * loop, its budgets and its fallbacks are unit-tested with fakes.
 */
import {
  investigationMessages, numbersIn, parseNarrative, reportMessages, unverifiedNumbers, NARRATIVE_MESSAGES,
  type ReportFacts, type ReportNarrative,
} from "./ai-report";
import { LlmRateLimitError, type LlmChatReply, type LlmMessage } from "./llm";

export interface InvestigationBudget {
  maxToolCalls: number;
  maxTurns: number;
  /** Total time for the investigation, from its start. */
  deadlineMs: number;
  /** Time kept back for the final answer when the model is still calling tools. */
  finalReserveMs: number;
}

export const INVESTIGATION_BUDGET: InvestigationBudget = { maxToolCalls: 8, maxTurns: 6, deadlineMs: 38_000, finalReserveMs: 12_000 };
/** All AI work of one report (investigation plus any fallback) ends by this, so the request stays under nginx's 60 s. */
export const REPORT_AI_DEADLINE_MS = 48_000;
/** The single-call fallback is only tried with at least this much time left. */
export const MIN_SINGLE_CALL_MS = 8_000;
/** A tool result longer than this is cut before it is sent to the model: every turn resends it, against per-minute token limits. */
const MAX_TOOL_RESULT_CHARS = 3500;

export interface InvestigationStep { tool: string; summary: string }
export type InvestigationMode = "investigated" | "single" | "none";
export interface Investigation { steps: InvestigationStep[]; toolCalls: number; durationMs: number; mode: InvestigationMode }

export interface AgentDeps {
  /** One model turn. `timeoutMs` is the time left for this call. */
  chat(messages: unknown[], opts: { tools: unknown[]; allowTools: boolean; timeoutMs: number }): Promise<LlmChatReply>;
  /** Run one tool by name, already gated by module and kept to the report's scope and period. Never throws. */
  runTool(name: string, args: unknown): Promise<unknown>;
  /** Function specs of the tools this caller may use. */
  tools: unknown[];
  now?: () => number;
}

export class InvestigationError extends Error {
  constructor(public reason: "deadline" | "unreadable" | "no_tools") { super(`report investigation stopped: ${reason}`); }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A one-line description of a tool call and what it returned, for the reader's "how this was investigated". */
export function stepSummary(name: string, args: any, result: any): string {
  const subject = [args?.metric, args?.parameter, args?.query, args?.scope, args?.status, args?.severity]
    .filter((v) => typeof v === "string" && v.trim()).map((v: string) => clip(v.trim(), 80)).join(", ");
  let outcome = "";
  if (result && typeof result === "object") {
    if (typeof result.error === "string") outcome = `no result (${clip(result.error.split(".")[0] ?? "", 80)})`;
    else if (Array.isArray(result.buckets)) outcome = `${result.buckets.length} time buckets`;
    else if (result.stats && typeof result.stats === "object") outcome = result.stats.n != null ? `${result.stats.n} readings` : "statistics";
    else if (Array.isArray(result.rowsHighestAvgFirst)) outcome = `${result.rowsHighestAvgFirst.length} machines compared`;
    else if (Array.isArray(result.matches)) outcome = `${result.matches.length} assets, ${Array.isArray(result.metricMatches) ? result.metricMatches.length : 0} metric groups`;
    else if (Array.isArray(result.rules)) outcome = `${result.rules.length} alarm rules`;
    else if (Array.isArray(result.attributes)) outcome = `${result.attributes.length} attributes`;
    else if (Array.isArray(result.changes)) outcome = `${result.changes.length} changes`;
    else if (typeof result.count === "number") outcome = `${result.count} records`;
  }
  return [subject, outcome].filter(Boolean).join(": ") || "looked up";
}

/**
 * Run the investigation. Returns the narrative, the steps and every number seen
 * in tool results (they count as verified); throws InvestigationError when it
 * cannot produce a usable narrative in time, LlmRateLimitError on a usage limit,
 * and any provider error as is.
 */
export async function investigateReport(
  facts: ReportFacts,
  deps: AgentDeps,
  budget: InvestigationBudget = INVESTIGATION_BUDGET,
): Promise<{ narrative: ReportNarrative; steps: InvestigationStep[]; toolCalls: number; toolNumbers: number[] }> {
  if (deps.tools.length === 0) throw new InvestigationError("no_tools");
  const state = { steps: [] as InvestigationStep[], toolCalls: 0 };
  try {
    return await investigate(facts, deps, budget, state);
  } catch (err) {
    // The steps taken so far stay visible to the reader even when the fallback writes the narrative.
    if (err && typeof err === "object") Object.assign(err, { steps: state.steps, toolCalls: state.toolCalls });
    throw err;
  }
}

async function investigate(
  facts: ReportFacts, deps: AgentDeps, budget: InvestigationBudget, state: { steps: InvestigationStep[]; toolCalls: number },
): Promise<{ narrative: ReportNarrative; steps: InvestigationStep[]; toolCalls: number; toolNumbers: number[] }> {
  const now = deps.now ?? Date.now;
  const deadline = now() + budget.deadlineMs;
  // Problem assets first, so the most useful ids survive the cut at 40.
  const assets = [...facts.assetHealth].sort((a, b) => Number(a.status === "ok") - Number(b.status === "ok")).map((h) => ({ id: h.assetId, name: h.assetName }));
  const messages: any[] = investigationMessages(facts, budget, assets);
  const steps = state.steps;
  const toolNumbers: number[] = [];
  let toolCalls = 0;

  for (let turn = 0; turn < budget.maxTurns; turn++) {
    const left = deadline - now();
    if (left - budget.finalReserveMs < 3000 || toolCalls >= budget.maxToolCalls) break;
    const reply = await deps.chat(messages, { tools: deps.tools, allowTools: true, timeoutMs: left - budget.finalReserveMs });
    if (reply.toolCalls.length === 0) {
      const narrative = parseNarrative(reply.content, facts.level);
      if (narrative) return { narrative, steps, toolCalls, toolNumbers };
      break; // not the JSON asked for: ask once more, without tools
    }
    messages.push({
      role: "assistant",
      content: reply.content ?? "",
      tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
    });
    // Every call gets a reply, even past the limit: the API refuses a conversation with an unanswered tool call.
    for (const call of reply.toolCalls) {
      let result: unknown;
      if (toolCalls >= budget.maxToolCalls) {
        result = { error: "Tool call limit reached. Write the report from the evidence already gathered." };
      } else {
        let args: unknown = {};
        try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { args = {}; }
        toolCalls++; state.toolCalls = toolCalls;
        result = await deps.runTool(call.name, args);
        steps.push({ tool: call.name, summary: stepSummary(call.name, args, result) });
        numbersIn(result, toolNumbers);
      }
      const text = JSON.stringify({ untrusted_data: result }) ?? "null";
      messages.push({ role: "tool", tool_call_id: call.id, content: text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… [cut]` : text });
    }
  }

  const left = deadline - now();
  if (left < 3000) throw new InvestigationError("deadline");
  const final = await deps.chat(
    [...messages, { role: "user", content: "No more tool calls. Write the report now as the JSON object asked for, from the facts and the evidence gathered." }],
    { tools: deps.tools, allowTools: false, timeoutMs: left },
  );
  const narrative = parseNarrative(final.content, facts.level);
  if (!narrative) throw new InvestigationError("unreadable");
  return { narrative, steps, toolCalls, toolNumbers };
}

export type NarrativeStatus = "ok" | "unavailable" | "failed" | "rate_limited" | "unreadable";
export interface ReportStory {
  narrative: ReportNarrative | null;
  unverified: string[];
  status: NarrativeStatus;
  narrativeError: string | null;
  investigation: Investigation;
}

const rateLimited = (err: LlmRateLimitError) =>
  `The AI service has reached its usage limit. Try again in about ${err.retryAfterSec} seconds. The figures below are complete.`;

/**
 * The narrative of a report with its fallback chain: investigation, then the
 * single call from the facts, then facts only. Never throws.
 */
export async function writeReportNarrative(
  facts: ReportFacts,
  deps: {
    configured: boolean;
    agent: AgentDeps;
    /** The single-call narrative, with the time left for it. */
    complete(messages: LlmMessage[], timeoutMs: number): Promise<string | null>;
    onError?(err: unknown, stage: "investigation" | "single"): void;
  },
  budget: InvestigationBudget = INVESTIGATION_BUDGET,
  totalMs: number = REPORT_AI_DEADLINE_MS,
): Promise<ReportStory> {
  const now = deps.agent.now ?? Date.now;
  const start = now();
  const done = (mode: InvestigationMode, steps: InvestigationStep[], toolCalls: number) =>
    ({ steps, toolCalls, durationMs: Math.max(0, now() - start), mode });
  if (!deps.configured) {
    return { narrative: null, unverified: [], status: "unavailable", narrativeError: NARRATIVE_MESSAGES.unavailable, investigation: done("none", [], 0) };
  }

  let steps: InvestigationStep[] = [];
  let toolCalls = 0;
  let limited: LlmRateLimitError | null = null;
  try {
    const r = await investigateReport(facts, deps.agent, { ...budget, deadlineMs: Math.min(budget.deadlineMs, totalMs) });
    return {
      narrative: r.narrative, unverified: unverifiedNumbers(r.narrative, facts, r.toolNumbers), status: "ok", narrativeError: null,
      investigation: done("investigated", r.steps, r.toolCalls),
    };
  } catch (err) {
    if (err && typeof err === "object" && Array.isArray((err as any).steps)) { steps = (err as any).steps; toolCalls = Number((err as any).toolCalls) || 0; }
    // A usage limit hit by the investigation's growing conversation can still
    // leave room for the much smaller single call, so that is tried next.
    if (err instanceof LlmRateLimitError) limited = err;
    else deps.onError?.(err, "investigation");
  }

  const left = totalMs - (now() - start);
  if (left < MIN_SINGLE_CALL_MS) {
    return limited
      ? { narrative: null, unverified: [], status: "rate_limited", narrativeError: rateLimited(limited), investigation: done("none", steps, toolCalls) }
      : { narrative: null, unverified: [], status: "failed", narrativeError: NARRATIVE_MESSAGES.failed, investigation: done("none", steps, toolCalls) };
  }
  try {
    const narrative = parseNarrative(await deps.complete(reportMessages(facts), left), facts.level);
    if (!narrative) return { narrative: null, unverified: [], status: "unreadable", narrativeError: NARRATIVE_MESSAGES.unreadable, investigation: done("none", steps, toolCalls) };
    return { narrative, unverified: unverifiedNumbers(narrative, facts), status: "ok", narrativeError: null, investigation: done("single", steps, toolCalls) };
  } catch (err) {
    if (err instanceof LlmRateLimitError) {
      return { narrative: null, unverified: [], status: "rate_limited", narrativeError: rateLimited(err), investigation: done("none", steps, toolCalls) };
    }
    deps.onError?.(err, "single");
    return { narrative: null, unverified: [], status: "failed", narrativeError: NARRATIVE_MESSAGES.failed, investigation: done("none", steps, toolCalls) };
  }
}
