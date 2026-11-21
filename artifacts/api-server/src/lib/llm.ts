/**
 * The language-model provider for single-shot text generation (AI Reports).
 *
 * One small seam so the provider can be swapped later without touching the
 * report code: callers pass chat messages and get the reply text back. Today it
 * is Groq's OpenAI-compatible endpoint, configured by the same variables as the
 * AI Advisor chat (GROQ_API_KEY, GROQ_MODEL). The chat in routes/ai.ts keeps its
 * own tool-calling client and is not affected by this module.
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

/**
 * One completion. Returns the reply text (or null for an empty reply); throws
 * LlmRateLimitError on a usage limit that a short wait does not clear, and Error
 * for anything else (no key, network, timeout, provider error).
 */
export async function llmComplete(messages: LlmMessage[], opts: { json?: boolean; maxTokens?: number } = {}, isRetry = false): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("No AI provider is configured (GROQ_API_KEY).");
  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: llmModel(),
      temperature: 0.2,
      reasoning_effort: "low",
      include_reasoning: false,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (resp.status === 429) {
    const wait = retryAfter(resp);
    await resp.text().catch(() => "");
    if (!isRetry && wait <= MAX_RATE_LIMIT_WAIT_S) {
      logger.info({ waitSeconds: wait }, "AI provider rate limit reached; waiting and retrying once");
      await new Promise((r) => setTimeout(r, Math.ceil((wait + 0.5) * 1000)));
      return llmComplete(messages, opts, true);
    }
    throw new LlmRateLimitError(Math.ceil(wait));
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`AI provider ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  logger.info({ promptTokens: data?.usage?.prompt_tokens, completionTokens: data?.usage?.completion_tokens }, "AI report call token usage");
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}
