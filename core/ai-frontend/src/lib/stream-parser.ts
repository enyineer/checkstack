/**
 * DOM-free parser for the AI-SDK UI message SSE stream (Phase 4 chat).
 *
 * The backend streams the Vercel-AI-SDK UI message stream as Server-Sent
 * Events: lines of `data: <json>` separated by blank lines. This module turns a
 * byte stream into incremental, typed chat events WITHOUT touching the DOM, so
 * the streaming logic is unit-testable under `bun test` (which CI runs from the
 * repo root WITHOUT happy-dom). React components consume these events; they are
 * never tested via render.
 */

/** One changed field in a before -> after diff (mirrors ai-common AiFieldDiff). */
export interface FieldDiff {
  path: string;
  before: unknown;
  after: unknown;
}

/** A confirm card emitted when a mutate/destructive tool was proposed. */
export interface ConfirmCard {
  toolName: string;
  effect: "mutate" | "destructive";
  summary: string;
  token: string;
  payload: unknown;
  /** Optional before -> after diff for an update proposal. */
  diff?: FieldDiff[];
  expiresAt: string;
}

/**
 * An "applied" card emitted when a mutate tool AUTO-APPLIED (auto mode): the
 * change already took effect, so it is read-only. Surfaced so the operator
 * ALWAYS sees what changed/created, even when no confirmation was required.
 */
export interface AppliedCard {
  toolName: string;
  summary: string;
  /** Optional before -> after diff for an auto-applied update. */
  diff?: FieldDiff[];
  /** The applied result (e.g. the created/updated object), for display. */
  result: unknown;
}

/**
 * Incremental events surfaced to the chat UI. Tool events carry the SDK's
 * `toolCallId` so the reducer can correlate a tool call with its later result /
 * error / confirm-card chunk and render them as one ordered, in-place part.
 */
export type ChatStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string }
  | { type: "tool-result"; toolCallId: string }
  | { type: "tool-error"; toolCallId: string; toolName?: string; message: string }
  | { type: "confirm-card"; toolCallId: string; card: ConfirmCard }
  | { type: "applied-card"; toolCallId: string; card: AppliedCard }
  | { type: "error"; message: string }
  | { type: "done" };

/** True when the value is a record (object), narrowing `unknown` safely. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Narrow a parsed JSON value into a FieldDiff[] if it has the shape. */
function asFieldDiff(value: unknown): FieldDiff[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const diffs: FieldDiff[] = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.path === "string") {
      diffs.push({ path: entry.path, before: entry.before, after: entry.after });
    }
  }
  return diffs.length > 0 ? diffs : undefined;
}

/** Narrow a parsed JSON object into a ConfirmCard if it has the shape. */
export function asConfirmCard(value: unknown): ConfirmCard | undefined {
  if (!isRecord(value)) return undefined;
  if (value.__confirm !== true) return undefined;
  const { toolName, effect, summary, token, payload, expiresAt } = value;
  if (
    typeof toolName !== "string" ||
    (effect !== "mutate" && effect !== "destructive") ||
    typeof summary !== "string" ||
    typeof token !== "string" ||
    typeof expiresAt !== "string"
  ) {
    return undefined;
  }
  return {
    toolName,
    effect,
    summary,
    token,
    payload,
    diff: asFieldDiff(value.diff),
    expiresAt,
  };
}

/** Narrow a parsed JSON object into an AppliedCard (auto-applied result). */
export function asAppliedCard(value: unknown): AppliedCard | undefined {
  if (!isRecord(value)) return undefined;
  if (value.__applied !== true) return undefined;
  const { toolName, summary, result } = value;
  if (typeof toolName !== "string" || typeof summary !== "string") {
    return undefined;
  }
  return { toolName, summary, result, diff: asFieldDiff(value.diff) };
}

/** Read a chunk's `toolCallId` (empty string when absent — defensive). */
function asToolCallId(chunk: Record<string, unknown>): string {
  return typeof chunk.toolCallId === "string" ? chunk.toolCallId : "";
}

/** Read a chunk's `errorText`, falling back to a generic message. */
function asErrorText(chunk: Record<string, unknown>, fallback: string): string {
  return typeof chunk.errorText === "string" ? chunk.errorText : fallback;
}

/**
 * Map a single decoded AI-SDK UI-message-stream chunk to a chat event.
 *
 * The AI SDK chunk shapes used here (v6 UI message stream):
 *  - `{ type: "text-delta", delta }` / `{ type: "text", text }` -> text
 *  - `{ type: "tool-input-start" | "tool-input-available", toolCallId, toolName }`
 *    -> a tool was called (de-duplicated by id in the reducer).
 *  - `{ type: "tool-output-available", toolCallId, output }` -> a tool result; a
 *    confirm-card return value is detected via `asConfirmCard`, otherwise it is a
 *    plain read result that just marks the tool call done.
 *  - `{ type: "tool-output-error", toolCallId, errorText }` -> a tool's `execute`
 *    THREW. Without this branch a failing read tool (e.g. `listCapabilities`)
 *    produced a silent EMPTY bubble: the SDK never routes a tool error through
 *    the stream's `onError` (that is for stream/provider failures), so it would
 *    be dropped entirely.
 *  - `{ type: "tool-input-error", toolCallId, toolName, errorText }` -> the model
 *    produced invalid tool arguments; surfaced the same way.
 *  - `{ type: "error", errorText }` -> a stream/provider error.
 * Unknown chunk types yield `undefined` (ignored).
 */
export function chunkToEvent(chunk: unknown): ChatStreamEvent | undefined {
  if (!isRecord(chunk)) return undefined;
  const type = chunk.type;

  if (type === "text-delta" && typeof chunk.delta === "string") {
    return { type: "text-delta", delta: chunk.delta };
  }
  if (type === "text" && typeof chunk.text === "string") {
    return { type: "text-delta", delta: chunk.text };
  }
  if (
    (type === "tool-input-available" ||
      type === "tool-input-start" ||
      type === "tool-call") &&
    typeof chunk.toolName === "string"
  ) {
    return {
      type: "tool-call",
      toolCallId: asToolCallId(chunk),
      toolName: chunk.toolName,
    };
  }
  // The model produced invalid tool arguments (input never became available).
  if (type === "tool-input-error") {
    return {
      type: "tool-error",
      toolCallId: asToolCallId(chunk),
      toolName: typeof chunk.toolName === "string" ? chunk.toolName : undefined,
      message: asErrorText(chunk, "Invalid tool input"),
    };
  }
  // Tool result chunks: a confirm card, otherwise a plain read result.
  if (
    type === "tool-output-available" ||
    type === "tool-result" ||
    type === "tool-output"
  ) {
    const output =
      "output" in chunk ? chunk.output : "result" in chunk ? chunk.result : undefined;
    const card = asConfirmCard(output);
    if (card) {
      return { type: "confirm-card", toolCallId: asToolCallId(chunk), card };
    }
    const applied = asAppliedCard(output);
    if (applied) {
      return { type: "applied-card", toolCallId: asToolCallId(chunk), card: applied };
    }
    return { type: "tool-result", toolCallId: asToolCallId(chunk) };
  }
  // A tool's `execute` threw (e.g. an authz/read failure inside the tool).
  if (type === "tool-output-error") {
    return {
      type: "tool-error",
      toolCallId: asToolCallId(chunk),
      message: asErrorText(chunk, "Tool failed"),
    };
  }
  if (type === "error") {
    const message =
      typeof chunk.errorText === "string"
        ? chunk.errorText
        : typeof chunk.error === "string"
          ? chunk.error
          : "Stream error";
    return { type: "error", message };
  }
  return undefined;
}

/**
 * Split a buffer of SSE text into complete `data:` JSON payloads, returning the
 * parsed payloads plus the unconsumed remainder (an incomplete trailing event).
 * SSE events are separated by a blank line; each event has one or more
 * `data: ...` lines. The `[DONE]` sentinel is surfaced as `done`.
 */
export function parseSseBuffer(buffer: string): {
  payloads: Array<unknown | "[DONE]">;
  rest: string;
} {
  const payloads: Array<unknown | "[DONE]"> = [];
  // Events end at a blank line (\n\n). Keep the trailing partial event in `rest`.
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const event of parts) {
    for (const line of event.split("\n")) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trim();
      if (data === "[DONE]") {
        payloads.push("[DONE]");
        continue;
      }
      if (!data) continue;
      try {
        payloads.push(JSON.parse(data));
      } catch {
        // Ignore malformed JSON lines (defensive).
      }
    }
  }
  return { payloads, rest };
}

/**
 * Consume a ReadableStream of SSE bytes, yielding {@link ChatStreamEvent}s. Pure
 * w.r.t. the DOM — it only needs a `ReadableStream<Uint8Array>` (as returned by
 * `fetch().body`) and `TextDecoder`, both available in node/bun and the browser.
 */
export async function* readChatStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { payloads, rest } = parseSseBuffer(buffer);
      buffer = rest;
      for (const payload of payloads) {
        if (payload === "[DONE]") {
          yield { type: "done" };
          continue;
        }
        const event = chunkToEvent(payload);
        if (event) yield event;
      }
    }
    // Flush any trailing complete event left in the buffer.
    const { payloads } = parseSseBuffer(buffer + "\n\n");
    for (const payload of payloads) {
      if (payload === "[DONE]") {
        yield { type: "done" };
        continue;
      }
      const event = chunkToEvent(payload);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}
