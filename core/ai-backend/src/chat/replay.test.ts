import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { toModelMessages } from "./chat-service";

/**
 * TOOL-MESSAGE REPLAY (Phase 6) — a RESUMED multi-turn conversation must replay
 * the full prior TOOL-CALL history to the model, not just assistant text.
 *
 * `toModelMessages` reconstructs a persisted `ai_messages` row into AI-SDK
 * `ModelMessage`s. When a row carries `modelMessages` (the canonical
 * `ResponseMessage[]` the SDK produced — assistant tool-call parts + tool-result
 * parts), they are replayed VERBATIM, so the model sees the prior tool
 * interaction on the next turn. Legacy text-only rows still replay as text.
 */

/** A persisted assistant row with a full tool round-trip (what onFinish stores). */
const toolRoundTrip: Array<Record<string, unknown>> = [
  {
    role: "assistant",
    content: [
      { type: "text", text: "Let me check open incidents." },
      {
        type: "tool-call",
        toolCallId: "tc1",
        toolName: "incident.list",
        input: { status: "open" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "incident.list",
        output: { type: "json", value: { rows: [{ id: 7 }] } },
      },
    ],
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "There is 1 open incident (#7)." }],
  },
];

describe("toModelMessages: full tool-call history replay", () => {
  test("an assistant row WITH modelMessages replays the assistant + tool messages verbatim", () => {
    const replayed = toModelMessages({
      role: "assistant",
      content: { text: "There is 1 open incident (#7)." },
      modelMessages: toolRoundTrip,
    });
    // One row expands into THREE model messages (assistant, tool, assistant) —
    // the prior tool interaction is fully reconstructed for the model.
    expect(replayed).toHaveLength(3);
    expect(replayed.map((m) => m.role)).toEqual([
      "assistant",
      "tool",
      "assistant",
    ]);
    // The tool-call + tool-result parts survive (not just text).
    const assistant = replayed[0] as ModelMessage & {
      content: Array<Record<string, unknown>>;
    };
    expect(assistant.content[1]?.type).toBe("tool-call");
    expect(assistant.content[1]?.toolCallId).toBe("tc1");
    const tool = replayed[1] as ModelMessage & {
      content: Array<Record<string, unknown>>;
    };
    expect(tool.content[0]?.type).toBe("tool-result");
    expect(tool.content[0]?.toolCallId).toBe("tc1");
  });

  test("a user row replays as a plain user text message", () => {
    const replayed = toModelMessages({
      role: "user",
      content: { text: "what changed in the last hour?" },
      modelMessages: null,
    });
    expect(replayed).toEqual([
      { role: "user", content: "what changed in the last hour?" },
    ]);
  });

  test("a LEGACY assistant row (text only, no modelMessages) still replays as text", () => {
    // Rows written before the replay column existed have modelMessages = null.
    const replayed = toModelMessages({
      role: "assistant",
      content: { text: "a deploy at 14:02" },
      modelMessages: null,
    });
    expect(replayed).toEqual([
      { role: "assistant", content: "a deploy at 14:02" },
    ]);
  });

  test("a fully-malformed modelMessages array falls back to the text content", () => {
    const replayed = toModelMessages({
      role: "assistant",
      content: { text: "fallback text" },
      // entries with no/invalid role are skipped; an all-bad array falls back.
      modelMessages: [{ nonsense: true }, { role: "banana", content: [] }],
    });
    expect(replayed).toEqual([
      { role: "assistant", content: "fallback text" },
    ]);
  });

  test("a PARTIALLY-corrupt modelMessages array falls back to text (all-or-nothing, no dangling pair)", () => {
    // The first two entries are a valid assistant tool-call + tool-result pair,
    // but the third (the follow-up assistant message) is corrupt. Dropping only
    // the bad entry would keep a dangling tool-call/result the provider rejects;
    // the row must instead fall back ENTIRELY to its text representation.
    const replayed = toModelMessages({
      role: "assistant",
      content: { text: "There is 1 open incident (#7)." },
      modelMessages: [
        toolRoundTrip[0], // valid assistant tool-call
        toolRoundTrip[1], // valid tool-result for tc1
        { role: 42, content: [] }, // corrupt: role is not a string
      ],
    });
    // NOT a partial [assistant, tool] — the whole row degrades to text.
    expect(replayed).toEqual([
      { role: "assistant", content: "There is 1 open incident (#7)." },
    ]);
  });

  test("a row missing the tool-result half of a pair falls back to text, never an orphaned tool-call", () => {
    const replayed = toModelMessages({
      role: "assistant",
      content: { text: "checked incidents" },
      modelMessages: [
        toolRoundTrip[0], // assistant tool-call (tc1)
        { type: "tool-result" }, // corrupt: no role -> invalidates the row
      ],
    });
    expect(replayed).toEqual([
      { role: "assistant", content: "checked incidents" },
    ]);
  });

  test("a standalone tool row with no modelMessages is skipped (no dangling tool result)", () => {
    const replayed = toModelMessages({
      role: "tool",
      content: { text: "" },
      modelMessages: null,
    });
    expect(replayed).toEqual([]);
  });

  test("a multi-turn transcript reconstructs in order across rows", () => {
    const rows = [
      { role: "user", content: { text: "list incidents" }, modelMessages: null },
      {
        role: "assistant",
        content: { text: "1 open (#7)" },
        modelMessages: toolRoundTrip,
      },
      { role: "user", content: { text: "ack it" }, modelMessages: null },
    ];
    const all: ModelMessage[] = [];
    for (const row of rows) all.push(...toModelMessages(row));
    // user, (assistant, tool, assistant), user — the tool round-trip is inline.
    expect(all.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
  });
});
