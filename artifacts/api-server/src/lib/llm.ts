/**
 * The language-model provider for AI Reports.
 *
 * One small seam so the provider can be swapped later without touching the
 * report code. Two calls:
 *
 * - `llmComplete`: one completion, reply text back (the single-call narrative);
 * - `llmChat`: one turn of a tool-using conversation (the report investigation,
 *   lib/ai-report-agent.ts): the reply text and any tool calls the model asked for.
 *
 * Today it is Groq's OpenAI-compatible endpoint, configured by the same variables
 * as the AI Advisor chat (GROQ_API_KEY, GROQ_MODEL). The chat in routes/ai.ts
 * keeps its own client and is not affected by this module.
 */
import { logger } from "./logger";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 45_000; // a report reply is longer than a chat step
const MAX_RATE_LIMIT_WAIT_S = 20;

export interface LlmMessage { role: "system" | "user" | "assistant"; content: string }

/** The provider refused for its usage limit; try again after `retryAfterSec`. */
export class LlmRateLimitError extends Error {
  constructor(public retryAfterSec: number) { super(`AI service usage limit reached; retry in ${retryAfterSec}s`); }
}

/** Whether an AI provider is configured on this server. */
export function llmConfigured(): boolean { return !!process.env.GROQ_API_KEY; }

/** The model name reported to the reader, or null without a provider. */
export function llmModel(): string | null { return llmConfigured() ? (process.env.GROQ_MODEL || "openai/gpt-oss-120b") : null; }

function retryAfter(resp: Response): number {
  const h = Number(resp.headers.get("retry-after"));
  return Number.isFinite(h) && h > 0 ? h : 30;
}

/** Waits for a usage limit per call: the investigation makes several calls a minute against per-minute token limits. */
const MAX_RATE_LIMIT_RETRIES = 2;

/**
 * POST one request to the provider. A usage limit that clears within the wait
 * allowance (and within the caller's time budget) is waited out and retried, at
 * most MAX_RATE_LIMIT_RETRIES times.
 */
async function post(body: Record<string, unknown>, timeoutMs: number, attempt = 0): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("No AI provider is configured (GROQ_API_KEY).");
  const started = Date.now();
  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: llmModel(), temperature: 0.2, reasoning_effort: "low", include_reasoning: false, ...body }),
    signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
  });
  if (resp.status === 429) {
    const wait = retryAfter(resp);
    await resp.text().catch(() => "");
    const left = timeoutMs - (Date.now() - started);
    if (attempt < MAX_RATE_LIMIT_RETRIES && wait <= MAX_RATE_LIMIT_WAIT_S && wait * 1000 + 2000 < left) {
      logger.info({ waitSeconds: wait, attempt: attempt + 1 }, "AI provider rate limit reached; waiting and retrying");
      await new Promise((r) => setTimeout(r, Math.ceil((wait + 0.5) * 1000)));
      return post(body, left - Math.ceil((wait + 0.5) * 1000), attempt + 1);
    }
    throw new LlmRateLimitError(Math.ceil(wait));
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`AI provider ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  logger.info({ promptTokens: data?.usage?.prompt_tokens, completionTokens: data?.usage?.completion_tokens }, "AI report call token usage");
  return data;
}

/**
 * One completion. Returns the reply text (or null for an empty reply); throws
 * LlmRateLimitError on a usage limit that a short wait does not clear, and Error
 * for anything else (no key, network, timeout, provider error).
 */
export async function llmComplete(
  messages: LlmMessage[],
  opts: { json?: boolean; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const data = await post({
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    messages,
  }, opts.timeoutMs ?? TIMEOUT_MS);
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}

/** A tool call the model asked for: the provider's id, the tool name and its JSON arguments. */
export interface LlmToolCall { id: string; name: string; arguments: string }
/** One model turn of a tool-using conversation. */
export interface LlmChatReply { content: string | null; toolCalls: LlmToolCall[] }

/**
 * One turn of a tool-using conversation. `messages` are OpenAI-style chat
 * messages (including assistant turns with `tool_calls` and `tool` replies);
 * `tools` are function specs. With `allowTools: false` the model must answer in
 * text (tools stay listed because the conversation already contains tool calls).
 */
export async function llmChat(
  messages: unknown[],
  opts: { tools: unknown[]; allowTools: boolean; timeoutMs: number; maxTokens?: number },
): Promise<LlmChatReply> {
  const data = await post({
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    messages,
    ...(opts.tools.length > 0 ? { tools: opts.tools, tool_choice: opts.allowTools ? "auto" : "none" } : {}),
  }, opts.timeoutMs);
  const msg = data?.choices?.[0]?.message;
  const toolCalls: LlmToolCall[] = Array.isArray(msg?.tool_calls)
    ? msg.tool_calls.map((c: any) => ({ id: String(c?.id ?? ""), name: String(c?.function?.name ?? ""), arguments: String(c?.function?.arguments ?? "") }))
    : [];
  const content = typeof msg?.content === "string" && msg.content.trim() ? msg.content : null;
  return { content, toolCalls };
}
