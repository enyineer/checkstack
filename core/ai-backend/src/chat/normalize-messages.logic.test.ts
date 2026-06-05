import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { normalizeModelMessages } from "./normalize-messages.logic";

describe("normalizeModelMessages", () => {
  test("leaves a well-formed alternating history untouched", () => {
    const input: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "list incidents" },
    ];
    expect(normalizeModelMessages(input)).toEqual(input);
  });

  test("merges consecutive user messages (the failed-turn cascade)", () => {
    // A failed turn persists no assistant reply, so retries pile up `user` rows.
    const input: ModelMessage[] = [
      { role: "user", content: "first try" },
      { role: "user", content: "second try" },
      { role: "user", content: "third try" },
    ];
    expect(normalizeModelMessages(input)).toEqual([
      { role: "user", content: "first try\n\nsecond try\n\nthird try" },
    ]);
  });

  test("merges consecutive assistant messages", () => {
    const input: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "part one" },
      { role: "assistant", content: "part two" },
    ];
    expect(normalizeModelMessages(input)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "part one\n\npart two" },
    ]);
  });

  test("drops empty / whitespace-only text rows, then merges across the gap", () => {
    const input: ModelMessage[] = [
      { role: "user", content: "before" },
      { role: "assistant", content: "   " },
      { role: "user", content: "after" },
    ];
    // The blank assistant row is dropped, leaving two user rows that merge.
    expect(normalizeModelMessages(input)).toEqual([
      { role: "user", content: "before\n\nafter" },
    ]);
  });

  test("keeps structured (tool-call / tool-result) content verbatim", () => {
    const input: ModelMessage[] = [
      { role: "user", content: "run it" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "listIncidents",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "listIncidents",
            output: { type: "json", value: { count: 0 } },
          },
        ],
      },
      { role: "assistant", content: "no incidents" },
    ];
    // Structured rows are never merged or dropped (would orphan a tool pair).
    expect(normalizeModelMessages(input)).toEqual(input);
  });

  test("strips a leading non-user message (corruption guard)", () => {
    const input: ModelMessage[] = [
      { role: "assistant", content: "stray leading assistant" },
      { role: "user", content: "real start" },
    ];
    expect(normalizeModelMessages(input)).toEqual([
      { role: "user", content: "real start" },
    ]);
  });

  test("a trailing user message always survives (never empties the array)", () => {
    const input: ModelMessage[] = [
      { role: "assistant", content: "" },
      { role: "user", content: "hello" },
    ];
    const out = normalizeModelMessages(input);
    expect(out.length).toBeGreaterThan(0);
    expect(out.at(-1)).toEqual({ role: "user", content: "hello" });
  });
});
