import { describe, expect, test } from "bun:test";
import {
  asAppliedCard,
  asConfirmCard,
  chunkToEvent,
  parseSseBuffer,
  readChatStream,
  type ChatStreamEvent,
} from "./stream-parser";

describe("asConfirmCard", () => {
  test("recognises a well-formed confirm card", () => {
    const card = asConfirmCard({
      __confirm: true,
      toolName: "automation.propose",
      effect: "mutate",
      summary: "Create automation X",
      token: "propose:abc.def",
      payload: { name: "X" },
      expiresAt: "2026-06-01T00:10:00Z",
    });
    expect(card?.toolName).toBe("automation.propose");
    expect(card?.effect).toBe("mutate");
    expect(card?.token).toBe("propose:abc.def");
  });

  test("rejects a non-card object", () => {
    expect(asConfirmCard({ rows: [] })).toBeUndefined();
    expect(asConfirmCard({ __confirm: true, toolName: 1 })).toBeUndefined();
    expect(asConfirmCard(null)).toBeUndefined();
    expect(asConfirmCard("text")).toBeUndefined();
  });

  test("parses an update card's before -> after diff", () => {
    const card = asConfirmCard({
      __confirm: true,
      toolName: "healthcheck.update",
      effect: "mutate",
      summary: "Update X",
      token: "propose:1.2",
      payload: {},
      diff: [{ path: "intervalSeconds", before: 60, after: 30 }],
      expiresAt: "2026-06-01T00:10:00Z",
    });
    expect(card?.diff).toEqual([
      { path: "intervalSeconds", before: 60, after: 30 },
    ]);
  });
});

describe("asAppliedCard", () => {
  test("recognises an auto-applied result with its diff", () => {
    const card = asAppliedCard({
      __applied: true,
      toolName: "healthcheck.update",
      summary: "Updated X",
      result: { id: "hc1" },
      diff: [{ path: "intervalSeconds", before: 60, after: 30 }],
    });
    expect(card?.toolName).toBe("healthcheck.update");
    expect(card?.diff).toHaveLength(1);
    expect(card?.result).toEqual({ id: "hc1" });
  });

  test("rejects a non-applied object", () => {
    expect(asAppliedCard({ __confirm: true })).toBeUndefined();
    expect(asAppliedCard({ __applied: true, toolName: 1 })).toBeUndefined();
    expect(asAppliedCard(null)).toBeUndefined();
  });
});

describe("chunkToEvent", () => {
  test("maps text-delta and text chunks", () => {
    expect(chunkToEvent({ type: "text-delta", delta: "Hi" })).toEqual({
      type: "text-delta",
      delta: "Hi",
    });
    expect(chunkToEvent({ type: "text", text: "Yo" })).toEqual({
      type: "text-delta",
      delta: "Yo",
    });
  });

  test("maps a start-step chunk to a step-start event", () => {
    expect(chunkToEvent({ type: "start-step" })).toEqual({ type: "step-start" });
  });

  test("maps a tool-input-available chunk to a tool-call event", () => {
    expect(
      chunkToEvent({
        type: "tool-input-available",
        toolCallId: "c1",
        toolName: "incident.list",
      }),
    ).toEqual({ type: "tool-call", toolCallId: "c1", toolName: "incident.list" });
  });

  test("maps a tool-input-start chunk to a tool-call event", () => {
    expect(
      chunkToEvent({
        type: "tool-input-start",
        toolCallId: "c2",
        toolName: "listCapabilities",
      }),
    ).toEqual({ type: "tool-call", toolCallId: "c2", toolName: "listCapabilities" });
  });

  test("maps a tool output carrying a confirm card to a confirm-card event", () => {
    const event = chunkToEvent({
      type: "tool-output-available",
      toolCallId: "c3",
      output: {
        __confirm: true,
        toolName: "automation.propose",
        effect: "mutate",
        summary: "do it",
        token: "propose:1.2",
        payload: {},
        expiresAt: "2026-06-01T00:10:00Z",
      },
    });
    expect(event).toMatchObject({ type: "confirm-card", toolCallId: "c3" });
  });

  test("a read tool output (no card) yields a tool-result event", () => {
    expect(
      chunkToEvent({
        type: "tool-output-available",
        toolCallId: "c4",
        output: { rows: [] },
      }),
    ).toEqual({ type: "tool-result", toolCallId: "c4" });
  });

  test("maps a tool output carrying an auto-applied result to an applied-card event", () => {
    const event = chunkToEvent({
      type: "tool-output-available",
      toolCallId: "c7",
      output: {
        __applied: true,
        toolName: "automation.update",
        summary: "Updated",
        result: { id: "a1" },
      },
    });
    expect(event).toMatchObject({ type: "applied-card", toolCallId: "c7" });
  });

  test("maps a tool-output-error chunk to a tool-error event", () => {
    expect(
      chunkToEvent({
        type: "tool-output-error",
        toolCallId: "c5",
        errorText: "Not allowed to read the automation capability catalog",
      }),
    ).toEqual({
      type: "tool-error",
      toolCallId: "c5",
      message: "Not allowed to read the automation capability catalog",
    });
  });

  test("maps a tool-input-error chunk to a tool-error event with the tool name", () => {
    expect(
      chunkToEvent({
        type: "tool-input-error",
        toolCallId: "c6",
        toolName: "getCapabilitySchema",
        errorText: "invalid input",
      }),
    ).toEqual({
      type: "tool-error",
      toolCallId: "c6",
      toolName: "getCapabilitySchema",
      message: "invalid input",
    });
  });

  test("maps an error chunk", () => {
    expect(chunkToEvent({ type: "error", errorText: "boom" })).toEqual({
      type: "error",
      message: "boom",
    });
  });

  test("ignores unknown chunk types", () => {
    expect(chunkToEvent({ type: "start" })).toBeUndefined();
    expect(chunkToEvent(42)).toBeUndefined();
  });
});

describe("parseSseBuffer", () => {
  test("extracts complete data payloads and keeps the partial remainder", () => {
    const buf =
      'data: {"type":"text-delta","delta":"a"}\n\n' +
      'data: {"type":"text-delta","delta":"b"}\n\n' +
      'data: {"type":"text-delta","del'; // incomplete trailing event
    const { payloads, rest } = parseSseBuffer(buf);
    expect(payloads).toHaveLength(2);
    expect(rest).toContain('"del');
  });

  test("surfaces the [DONE] sentinel", () => {
    const { payloads } = parseSseBuffer("data: [DONE]\n\n");
    expect(payloads).toEqual(["[DONE]"]);
  });
});

/** Build a ReadableStream of UTF-8 bytes from string chunks. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

describe("readChatStream (DOM-free)", () => {
  test("yields text deltas, a confirm card, then done across chunk boundaries", async () => {
    const stream = streamOf([
      'data: {"type":"text-delta","delta":"Hello "}\n\n',
      'data: {"type":"text-de', // split mid-event
      'lta","delta":"world"}\n\n',
      'data: {"type":"tool-output-available","output":{"__confirm":true,"toolName":"automation.propose","effect":"mutate","summary":"s","token":"propose:1.2","payload":{},"expiresAt":"2026-06-01T00:10:00Z"}}\n\n',
      "data: [DONE]\n\n",
    ]);

    const events: ChatStreamEvent[] = [];
    for await (const e of readChatStream(stream)) events.push(e);

    const text = events
      .filter((e): e is { type: "text-delta"; delta: string } => e.type === "text-delta")
      .map((e) => e.delta)
      .join("");
    expect(text).toBe("Hello world");
    expect(events.some((e) => e.type === "confirm-card")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });
});
