import { describe, it, expect } from "bun:test";
import { readCappedText } from "./read-capped-text";

/** A distinct error type to prove `makeError` is used for the thrown failure. */
class TestTransportError extends Error {}

/** A streamed response with NO content-length (forces the mid-stream check). */
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body);
}

describe("readCappedText", () => {
  it("returns the full body when under the cap", async () => {
    const text = await readCappedText({
      response: new Response("hello world"),
      maxBytes: 1024,
    });
    expect(text).toBe("hello world");
  });

  it("rejects a declared content-length over the cap before reading a byte", async () => {
    const response = new Response("x", {
      headers: { "content-length": "100" },
    });
    await expect(
      readCappedText({ response, maxBytes: 10 }),
    ).rejects.toThrow(/exceeds cap 10/);
  });

  it("rejects a streamed body that exceeds the cap mid-stream", async () => {
    // 12 bytes across three chunks, no declared length: the streamed check trips.
    const response = streamResponse(["aaaa", "bbbb", "cccc"]);
    await expect(
      readCappedText({ response, maxBytes: 8 }),
    ).rejects.toThrow(/exceeds cap 8 bytes/);
  });

  it("uses the caller's makeError for the thrown transport failure", async () => {
    const response = new Response("x", {
      headers: { "content-length": "100" },
    });
    await expect(
      readCappedText({
        response,
        maxBytes: 10,
        makeError: (message) => new TestTransportError(message),
      }),
    ).rejects.toBeInstanceOf(TestTransportError);
  });

  it("returns an empty string for a null body", async () => {
    const response = new Response(null, { status: 204 });
    expect(await readCappedText({ response, maxBytes: 10 })).toBe("");
  });
});
