/**
 * Pure, DOM-free helpers for the "New chat" sidebar action (Fix 1).
 *
 * Clicking "New chat" should NOT spawn a fresh empty conversation every time:
 * if the conversation currently open is itself an empty, untitled draft, the
 * click should just reuse it (and keep it highlighted) instead of creating
 * another "Untitled chat" row. These helpers encode that decision so it is
 * unit-testable under `bun test` without rendering the component.
 */

/** The minimal conversation shape the new-chat decision needs. */
export interface NewChatConversation {
  id: string;
  title: string | null;
}

/** The minimal message shape the new-chat decision needs. */
export interface NewChatMessage {
  text: string;
}

/**
 * True when a conversation is an empty, untitled draft: no (non-blank) title and
 * no messages. Such a conversation is indistinguishable from a brand-new one, so
 * "New chat" can reuse it rather than create a duplicate.
 */
export function isEmptyUntitledChat({
  conversation,
  messages,
}: {
  conversation: NewChatConversation | undefined;
  messages: ReadonlyArray<NewChatMessage>;
}): boolean {
  if (!conversation) return false;
  const hasTitle = (conversation.title ?? "").trim().length > 0;
  const hasMessages = messages.some((m) => m.text.trim().length > 0);
  return !hasTitle && !hasMessages;
}

/**
 * Decide what "New chat" should do given the currently-open conversation and its
 * messages:
 *  - `{ kind: "reuse", conversationId }` when the open chat is already an empty
 *    untitled draft (avoid spawning a duplicate),
 *  - `{ kind: "create" }` otherwise (create a fresh conversation).
 */
export type NewChatAction =
  | { kind: "reuse"; conversationId: string }
  | { kind: "create" };

export function decideNewChatAction({
  current,
  messages,
}: {
  current: NewChatConversation | undefined;
  messages: ReadonlyArray<NewChatMessage>;
}): NewChatAction {
  if (current && isEmptyUntitledChat({ conversation: current, messages })) {
    return { kind: "reuse", conversationId: current.id };
  }
  return { kind: "create" };
}
