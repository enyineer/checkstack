import type { ModelMessage } from "ai";

/**
 * Defensive normalization of the model message history before it is sent to the
 * provider. Strict OpenAI-compatible providers (notably DeepSeek) reject a
 * history that does not strictly alternate user/assistant, or that contains an
 * empty-content message, with HTTP 400 `invalid_prompt`.
 *
 * Two real corruptions this guards against:
 *  - A FAILED turn persists no assistant reply (`onFinish` never runs on error),
 *    so each retry appends another `user` row, leaving consecutive `user`
 *    messages. Without this, ONE provider hiccup would brick the whole
 *    conversation permanently (every later message also 400s).
 *  - An assistant turn that produced only a tool call (no text) can persist an
 *    empty-text row.
 *
 * Rules (pure, total - never throws):
 *  1. Drop messages whose content is an empty / whitespace-only STRING. Messages
 *     with structured content (tool-call / tool-result parts) are ALWAYS kept -
 *     they arrive as valid assistant+tool pairs from replay and dropping one
 *     half would orphan the other.
 *  2. Merge consecutive same-role STRING messages (user or assistant) into a
 *     single message joined by a blank line, so the roles alternate.
 *  3. Drop any leading non-`user` messages: a valid sequence (the system prompt
 *     is sent separately) must start with a user message. The turn always
 *     appends the new user message last, so a trailing user message is
 *     guaranteed and this can never empty the array.
 */
export function normalizeModelMessages(
  messages: ModelMessage[],
): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of messages) {
    const text = typeof message.content === "string" ? message.content : null;

    // Rule 1: drop empty/whitespace-only text rows.
    if (text !== null && text.trim() === "") continue;

    // Rule 2: merge with the previous row when both are same-role plain text.
    const last = out.at(-1);
    if (
      last !== undefined &&
      text !== null &&
      typeof last.content === "string" &&
      last.role === message.role &&
      (message.role === "user" || message.role === "assistant")
    ) {
      const merged = `${last.content}\n\n${text}`;
      out[out.length - 1] =
        message.role === "user"
          ? { role: "user", content: merged }
          : { role: "assistant", content: merged };
      continue;
    }

    out.push(message);
  }

  // Rule 3: strip any leading non-user rows (corruption / a dangling assistant).
  while (out.length > 0 && out[0].role !== "user") {
    out.shift();
  }

  return out;
}
