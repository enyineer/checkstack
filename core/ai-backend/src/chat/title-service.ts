import { generateText, type LanguageModel } from "ai";
import { deriveHeuristicTitle, sanitizeGeneratedTitle } from "./title.logic";
import type { AiConversationStore } from "./conversation-store";

/**
 * Prompt for the cheap title-generation call. Kept terse so the model returns a
 * bare title (no quotes/markdown); `sanitizeGeneratedTitle` defends against any
 * decoration regardless.
 */
const TITLE_SYSTEM_PROMPT =
  "You generate a short title for a chat conversation. Reply with a concise " +
  "title of at most 6 words that summarizes the user's first message. Do not " +
  "use quotes, markdown, or trailing punctuation. Reply with the title only.";

/**
 * The model call used to produce a raw title. Defaults to the AI SDK's
 * `generateText` against the turn's already-built language model; injectable so
 * the title logic is unit-testable WITHOUT constructing a provider mock (the
 * `LanguageModelV3` result shape is verbose and version-coupled).
 */
export type TitleTextGenerator = (args: {
  model: LanguageModel;
  firstMessage: string;
}) => Promise<string>;

/** Default generator: a cheap `generateText` call reusing the turn's model. */
const defaultGenerateTitleText: TitleTextGenerator = async ({
  model,
  firstMessage,
}) => {
  const { text } = await generateText({
    model,
    system: TITLE_SYSTEM_PROMPT,
    prompt: firstMessage,
  });
  return text;
};

/**
 * Resolve the title for a new conversation from its first user message.
 *
 * Tries a cheap `generateText` call (reusing the turn's resolved connection +
 * model) and sanitizes the reply. On ANY model/sanitize failure it falls back to
 * a deterministic heuristic derived from the message. Returns an empty string
 * only when even the heuristic is empty (caller then leaves the title unset).
 *
 * This function NEVER throws: it is invoked fire-and-forget from the streamed
 * turn, so a title failure must not surface to the chat response.
 */
export async function generateConversationTitle({
  model,
  firstMessage,
  generate = defaultGenerateTitleText,
}: {
  /** The already-built language model used for the turn (provider-agnostic). */
  model: LanguageModel;
  /** The user's first message in the conversation. */
  firstMessage: string;
  /** Override the model call (tests inject a fake; defaults to generateText). */
  generate?: TitleTextGenerator;
}): Promise<string> {
  const heuristic = deriveHeuristicTitle(firstMessage);
  try {
    const text = await generate({ model, firstMessage });
    const sanitized = sanitizeGeneratedTitle(text);
    return sanitized || heuristic;
  } catch {
    // Fail closed to the heuristic: a title is a nicety, never worth a throw.
    return heuristic;
  }
}

/**
 * Generate and PERSIST a title for a still-untitled conversation from its first
 * user message. Designed to run fire-and-forget from the streamed turn: it never
 * throws, and skips the persist when the resolved title is empty (so the sidebar
 * keeps "Untitled chat" rather than storing a blank). Extracted from the chat
 * service so the persist path is unit-testable with a mocked model + store.
 */
export async function applyAutoTitle({
  conversations,
  model,
  conversationId,
  userId,
  firstMessage,
  generate,
}: {
  conversations: AiConversationStore;
  model: LanguageModel;
  conversationId: string;
  userId: string;
  firstMessage: string;
  /** Override the model call (tests inject a fake; defaults to generateText). */
  generate?: TitleTextGenerator;
}): Promise<void> {
  try {
    const title = await generateConversationTitle({
      model,
      firstMessage,
      generate,
    });
    if (!title) return;
    await conversations.updateConversation({
      id: conversationId,
      userId,
      title,
    });
  } catch {
    // Best-effort; the conversation simply stays untitled on failure.
  }
}
