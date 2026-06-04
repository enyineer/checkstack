import { describe, expect, test } from "bun:test";
import {
  appendUserMessage,
  startAssistantMessage,
  applyStreamEvent,
  finishAssistantMessage,
  type AssistantPart,
  type ChatMessage,
} from "./chat-state";

/** Narrow the assistant message's parts to a given kind for terse assertions. */
function partsOf(msgs: ChatMessage[]): AssistantPart[] {
  return msgs[0].parts;
}

describe("chat-state reducer (DOM-free)", () => {
  test("appendUserMessage adds a non-streaming user message", () => {
    const msgs = appendUserMessage({ messages: [], id: "u1", text: "hi" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: "user", text: "hi", streaming: false });
  });

  test("text deltas accumulate into a single trailing text part", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = applyStreamEvent({ messages: msgs, event: { type: "text-delta", delta: "Hel" } });
    msgs = applyStreamEvent({ messages: msgs, event: { type: "text-delta", delta: "lo" } });
    expect(partsOf(msgs)).toEqual([{ kind: "text", text: "Hello" }]);
    expect(msgs[0].streaming).toBe(true);
  });

  test("tool-call events are de-duplicated by call id", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    const event = {
      type: "tool-call",
      toolCallId: "c1",
      toolName: "incident.list",
    } as const;
    msgs = applyStreamEvent({ messages: msgs, event });
    msgs = applyStreamEvent({ messages: msgs, event });
    expect(partsOf(msgs)).toEqual([
      { kind: "tool", toolCallId: "c1", toolName: "incident.list", status: "running" },
    ]);
  });

  test("a tool result marks its tool part done", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = applyStreamEvent({
      messages: msgs,
      event: { type: "tool-call", toolCallId: "c1", toolName: "listCapabilities" },
    });
    msgs = applyStreamEvent({
      messages: msgs,
      event: { type: "tool-result", toolCallId: "c1" },
    });
    expect(partsOf(msgs)).toEqual([
      { kind: "tool", toolCallId: "c1", toolName: "listCapabilities", status: "done" },
    ]);
  });

  test("a tool error marks its tool part errored with the message", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = applyStreamEvent({
      messages: msgs,
      event: { type: "tool-call", toolCallId: "c1", toolName: "listCapabilities" },
    });
    msgs = applyStreamEvent({
      messages: msgs,
      event: { type: "tool-error", toolCallId: "c1", message: "boom" },
    });
    expect(partsOf(msgs)).toEqual([
      {
        kind: "tool",
        toolCallId: "c1",
        toolName: "listCapabilities",
        status: "error",
        errorText: "boom",
      },
    ]);
  });

  test("a tool error with no prior tool-call still surfaces an errored part", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = applyStreamEvent({
      messages: msgs,
      event: {
        type: "tool-error",
        toolCallId: "c1",
        toolName: "listCapabilities",
        message: "bad input",
      },
    });
    expect(partsOf(msgs)).toEqual([
      {
        kind: "tool",
        toolCallId: "c1",
        toolName: "listCapabilities",
        status: "error",
        errorText: "bad input",
      },
    ]);
  });

  test("text and tool calls interleave in chronological order", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = applyStreamEvent({ messages: msgs, event: { type: "text-delta", delta: "Checking. " } });
    msgs = applyStreamEvent({
      messages: msgs,
      event: { type: "tool-call", toolCallId: "c1", toolName: "listCapabilities" },
    });
    msgs = applyStreamEvent({
      messages: msgs,
      event: { type: "tool-result", toolCallId: "c1" },
    });
    msgs = applyStreamEvent({ messages: msgs, event: { type: "text-delta", delta: "Done." } });
    expect(partsOf(msgs).map((p) => p.kind)).toEqual(["text", "tool", "text"]);
    const [first, , third] = partsOf(msgs);
    expect(first).toEqual({ kind: "text", text: "Checking. " });
    expect(third).toEqual({ kind: "text", text: "Done." });
  });

  test("a confirm card replaces its proposing tool part in place", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = applyStreamEvent({
      messages: msgs,
      event: { type: "tool-call", toolCallId: "c9", toolName: "automation.propose" },
    });
    msgs = applyStreamEvent({
      messages: msgs,
      event: {
        type: "confirm-card",
        toolCallId: "c9",
        card: {
          toolName: "automation.propose",
          effect: "mutate",
          summary: "s",
          token: "propose:1.2",
          payload: {},
          expiresAt: "2026-06-01T00:10:00Z",
        },
      },
    });
    expect(partsOf(msgs)).toHaveLength(1);
    const part = partsOf(msgs)[0];
    expect(part.kind).toBe("confirm");
    if (part.kind === "confirm") {
      expect(part.card.token).toBe("propose:1.2");
    }
  });

  test("an auto-applied result replaces its tool part with an applied card", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = applyStreamEvent({
      messages: msgs,
      event: { type: "tool-call", toolCallId: "c5", toolName: "healthcheck.update" },
    });
    msgs = applyStreamEvent({
      messages: msgs,
      event: {
        type: "applied-card",
        toolCallId: "c5",
        card: {
          toolName: "healthcheck.update",
          summary: "Updated X",
          result: { id: "hc1" },
          diff: [{ path: "intervalSeconds", before: 60, after: 30 }],
        },
      },
    });
    expect(partsOf(msgs)).toHaveLength(1);
    const part = partsOf(msgs)[0];
    expect(part.kind).toBe("applied");
    if (part.kind === "applied") {
      expect(part.card.diff).toHaveLength(1);
    }
  });

  test("done marks the assistant message non-streaming", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = applyStreamEvent({ messages: msgs, event: { type: "done" } });
    expect(msgs[0].streaming).toBe(false);
  });

  test("an error event appends an error text part and stops streaming", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = applyStreamEvent({ messages: msgs, event: { type: "error", message: "boom" } });
    const part = partsOf(msgs)[0];
    expect(part).toEqual({ kind: "text", text: "Error: boom" });
    expect(msgs[0].streaming).toBe(false);
  });

  test("events never mutate a trailing user message", () => {
    const base: ChatMessage[] = appendUserMessage({ messages: [], id: "u1", text: "hi" });
    const after = applyStreamEvent({ messages: base, event: { type: "text-delta", delta: "x" } });
    expect(after).toBe(base);
  });

  test("a no-op event returns the same array reference", () => {
    const msgs = startAssistantMessage({ messages: [], id: "a1" });
    // tool-result for an unknown call id changes nothing.
    const after = applyStreamEvent({
      messages: msgs,
      event: { type: "tool-result", toolCallId: "missing" },
    });
    expect(after).toBe(msgs);
  });

  test("finishAssistantMessage is idempotent on a finished message", () => {
    let msgs = startAssistantMessage({ messages: [], id: "a1" });
    msgs = finishAssistantMessage({ messages: msgs });
    const again = finishAssistantMessage({ messages: msgs });
    expect(again).toBe(msgs);
  });
});
