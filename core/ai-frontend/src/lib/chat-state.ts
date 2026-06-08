import type { ChatStreamEvent, ConfirmCard, AppliedCard } from "./stream-parser";

/**
 * One ordered piece of an assistant turn. The model interleaves prose and tool
 * calls ("let me check the catalog" -> call `listCapabilities` -> "here's what I
 * found" -> propose), so the turn is an ORDERED list of parts, not a single text
 * blob plus a flat tool list. Rendering parts in order preserves the visual
 * breaks between text segments and shows each tool call (and its result/error)
 * at the point in the turn where it happened.
 */
export type AssistantPart =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      status: "running" | "done" | "error";
      /** Set when `status` is "error": the tool's failure message. */
      errorText?: string;
    }
  | { kind: "confirm"; toolCallId: string; card: ConfirmCard }
  | { kind: "applied"; toolCallId: string; card: AppliedCard };

/** A rendered chat message in the UI. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** User message text (right-aligned bubble). Assistant content is in `parts`. */
  text: string;
  /** Ordered assistant content: interleaved text / tool / confirm-card parts. */
  parts: AssistantPart[];
  /** A streaming assistant message is still being appended to. */
  streaming: boolean;
  /**
   * How many agent steps (model rounds) the turn has started, counted from the
   * SDK's `start-step` events. Drives the progress heartbeat so a slow turn that
   * is still advancing is distinguishable from a stuck one. Absent on a
   * hydrated/replayed message (its live step events are gone).
   */
  stepCount?: number;
}

/** Append a user message. */
export function appendUserMessage({
  messages,
  id,
  text,
}: {
  messages: ChatMessage[];
  id: string;
  text: string;
}): ChatMessage[] {
  return [
    ...messages,
    { id, role: "user", text, parts: [], streaming: false },
  ];
}

/** Start a new streaming assistant message. */
export function startAssistantMessage({
  messages,
  id,
}: {
  messages: ChatMessage[];
  id: string;
}): ChatMessage[] {
  return [
    ...messages,
    { id, role: "assistant", text: "", parts: [], streaming: true, stepCount: 0 },
  ];
}

/** Append a text delta, merging into the trailing text part when there is one. */
function appendText(parts: AssistantPart[], delta: string): AssistantPart[] {
  if (!delta) return parts;
  const last = parts.at(-1);
  if (last && last.kind === "text") {
    return [...parts.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...parts, { kind: "text", text: delta }];
}

/** Add a tool part, de-duplicating repeat chunks for the same call id. */
function upsertTool(
  parts: AssistantPart[],
  toolCallId: string,
  toolName: string,
): AssistantPart[] {
  // The SDK emits both `tool-input-start` and `tool-input-available` for one
  // call; both map to a `tool-call` event, so de-dupe by id.
  const exists = parts.some((p) => p.kind !== "text" && p.toolCallId === toolCallId);
  if (exists) return parts;
  return [...parts, { kind: "tool", toolCallId, toolName, status: "running" }];
}

/** Mark a tool part done (its result arrived without an error). */
function markToolDone(
  parts: AssistantPart[],
  toolCallId: string,
): AssistantPart[] {
  let changed = false;
  const next = parts.map((p) => {
    if (p.kind === "tool" && p.toolCallId === toolCallId && p.status === "running") {
      changed = true;
      return { ...p, status: "done" as const };
    }
    return p;
  });
  return changed ? next : parts;
}

/** Mark a tool part errored, or add an errored tool part if none exists yet. */
function markToolError(
  parts: AssistantPart[],
  toolCallId: string,
  toolName: string | undefined,
  message: string,
): AssistantPart[] {
  const idx = parts.findIndex(
    (p) => p.kind === "tool" && p.toolCallId === toolCallId,
  );
  if (idx !== -1) {
    const next = [...parts];
    const existing = next[idx];
    if (existing.kind === "tool") {
      next[idx] = { ...existing, status: "error", errorText: message };
    }
    return next;
  }
  // A `tool-input-error` can arrive before any `tool-call` part exists.
  return [
    ...parts,
    {
      kind: "tool",
      toolCallId,
      toolName: toolName ?? "tool",
      status: "error",
      errorText: message,
    },
  ];
}

/**
 * Replace a tool part with a card (confirm or applied) in place - the mutate
 * tool's output IS the card - preserving position. Pushes a new card part if the
 * matching tool part is missing (defensive against an out-of-order stream).
 */
function toCard(
  parts: AssistantPart[],
  toolCallId: string,
  cardPart: AssistantPart,
): AssistantPart[] {
  const idx = parts.findIndex(
    (p) => p.kind === "tool" && p.toolCallId === toolCallId,
  );
  if (idx !== -1) {
    const next = [...parts];
    next[idx] = cardPart;
    return next;
  }
  return [...parts, cardPart];
}

/**
 * Fold a single stream event into the LAST (streaming assistant) message. Pure
 * and DOM-free so the streaming reducer is unit-testable. Returns the same array
 * reference when the event produces no change (so React can bail on re-render).
 */
export function applyStreamEvent({
  messages,
  event,
}: {
  messages: ChatMessage[];
  event: ChatStreamEvent;
}): ChatMessage[] {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return messages;

  let parts = last.parts;
  let streaming = last.streaming;
  let stepCount = last.stepCount;
  switch (event.type) {
    case "step-start": {
      stepCount = (stepCount ?? 0) + 1;
      break;
    }
    case "text-delta": {
      parts = appendText(parts, event.delta);
      break;
    }
    case "tool-call": {
      parts = upsertTool(parts, event.toolCallId, event.toolName);
      break;
    }
    case "tool-result": {
      parts = markToolDone(parts, event.toolCallId);
      break;
    }
    case "tool-error": {
      parts = markToolError(parts, event.toolCallId, event.toolName, event.message);
      break;
    }
    case "confirm-card": {
      parts = toCard(parts, event.toolCallId, {
        kind: "confirm",
        toolCallId: event.toolCallId,
        card: event.card,
      });
      break;
    }
    case "applied-card": {
      parts = toCard(parts, event.toolCallId, {
        kind: "applied",
        toolCallId: event.toolCallId,
        card: event.card,
      });
      break;
    }
    case "error": {
      const prefix = parts.length > 0 ? "\n\n" : "";
      parts = appendText(parts, `${prefix}Error: ${event.message}`);
      streaming = false;
      break;
    }
    case "done": {
      streaming = false;
      break;
    }
  }
  if (
    parts === last.parts &&
    streaming === last.streaming &&
    stepCount === last.stepCount
  ) {
    return messages;
  }
  return [...messages.slice(0, -1), { ...last, parts, streaming, stepCount }];
}

/** Mark the last assistant message as finished (stream ended). */
export function finishAssistantMessage({
  messages,
}: {
  messages: ChatMessage[];
}): ChatMessage[] {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant" || !last.streaming) return messages;
  return [...messages.slice(0, -1), { ...last, streaming: false }];
}
