import type { ModelMessage } from "ai";

/**
 * Provider-agnostic token ESTIMATE. The assistant talks to arbitrary
 * OpenAI-compatible endpoints (OpenAI, Azure, OpenRouter, Ollama, vLLM, ...),
 * so a model-specific tokenizer (tiktoken) would be wrong for most of them and
 * pull in a heavy dependency. Instead we use the well-worn ~4-chars-per-token
 * heuristic, which slightly OVER-counts English (conservative — we trim a bit
 * early rather than overflow the real window).
 *
 * This is intentionally a heuristic, not an exact count: it drives WHEN to
 * compact, and compaction always leaves headroom, so a small error is safe.
 */

/** Average characters per token for the heuristic. */
const CHARS_PER_TOKEN = 4;
/** Fixed per-message overhead (role tags, JSON envelope) the wire adds. */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return estimateTokensFromChars(text.length);
}

/**
 * Estimate the tokens of a single AI-SDK `ModelMessage`. The content is either a
 * string or an array of parts (text / tool-call / tool-result); we serialize
 * non-string content so tool payloads (the verbose part) are counted.
 */
export function estimateMessageTokens(message: ModelMessage): number {
  const { content } = message;
  const chars =
    typeof content === "string" ? content.length : safeJsonLength(content);
  return estimateTokensFromChars(chars) + PER_MESSAGE_OVERHEAD_TOKENS;
}

export function estimateMessagesTokens(messages: ModelMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}
