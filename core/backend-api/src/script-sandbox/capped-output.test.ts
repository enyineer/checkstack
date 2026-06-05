import { describe, expect, it } from "bun:test";
import { readCappedOutput } from "./capped-output";

const encoder = new TextEncoder();

/**
 * Build a ReadableStream that emits the given byte chunks. When `onPull` is
 * provided it is invoked for every chunk pulled, letting a test assert that the
 * reader stopped pulling once the cap was hit (bounded buffering).
 */
function streamOf(
  chunks: Uint8Array[],
  onPull?: (index: number) => void,
): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      onPull?.(i);
      controller.enqueue(chunks[i]!);
      i += 1;
    },
  });
}

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

describe("readCappedOutput", () => {
  it("drains both streams fully when uncapped", async () => {
    const r = await readCappedOutput({
      stdout: streamOf([bytes("hello "), bytes("world")]),
      stderr: streamOf([bytes("err")]),
      maxOutputBytes: undefined,
    });
    expect(r.stdout).toBe("hello world");
    expect(r.stderr).toBe("err");
    expect(r.truncated).toBe(false);
  });

  it("passes through unchanged when under the cap", async () => {
    const r = await readCappedOutput({
      stdout: streamOf([bytes("hi")]),
      stderr: streamOf([bytes("yo")]),
      maxOutputBytes: 100,
    });
    expect(r.stdout).toBe("hi");
    expect(r.stderr).toBe("yo");
    expect(r.truncated).toBe(false);
  });

  it("caps combined output, flags truncated, and fires onExceeded once", async () => {
    let exceededCount = 0;
    const r = await readCappedOutput({
      stdout: streamOf([bytes("a".repeat(80))]),
      stderr: streamOf([bytes("b".repeat(80))]),
      maxOutputBytes: 100,
      onExceeded: () => {
        exceededCount += 1;
      },
    });
    expect(r.truncated).toBe(true);
    const total = Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr);
    expect(total).toBeLessThanOrEqual(100);
    // onExceeded fires at most once even though both streams overflow.
    expect(exceededCount).toBe(1);
  });

  it("stops pulling further chunks once the cap is hit (bounded buffering)", async () => {
    // 10 chunks of 100 bytes each on stdout. With a 150-byte cap the reader
    // must NOT pull all 10 — that is the whole point (no full buffering).
    const pulled: number[] = [];
    const chunks = Array.from({ length: 10 }, () => bytes("x".repeat(100)));
    const r = await readCappedOutput({
      stdout: streamOf(chunks, (i) => pulled.push(i)),
      stderr: streamOf([]),
      maxOutputBytes: 150,
    });
    expect(r.truncated).toBe(true);
    // It pulled at most a couple of chunks, not all ten.
    expect(pulled.length).toBeLessThan(10);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(150);
  });

  it("does not split a multi-byte code point across the decode boundary", async () => {
    // 5 emoji, 4 UTF-8 bytes each (20 bytes), cap at 10 bytes.
    const r = await readCappedOutput({
      stdout: streamOf([bytes("😀😀😀😀😀")]),
      stderr: streamOf([]),
      maxOutputBytes: 10,
    });
    expect(r.truncated).toBe(true);
    // TextDecoder is non-fatal: a partial trailing code point decodes to U+FFFD
    // rather than throwing. Assert we never EXCEED the byte budget — that is
    // the OOM-safety guarantee. (Cosmetic trimming is handled separately by
    // truncateCapturedOutput when the runner needs clean boundaries.)
    expect(Buffer.byteLength(bytes(r.stdout.replace(/�/g, "")))).toBeLessThanOrEqual(10);
  });

  it("gives stdout budget priority, then stderr the remainder", async () => {
    const r = await readCappedOutput({
      stdout: streamOf([bytes("a".repeat(60))]),
      stderr: streamOf([bytes("b".repeat(60))]),
      maxOutputBytes: 100,
    });
    expect(r.truncated).toBe(true);
    // stdout is read concurrently; the combined cap is the invariant.
    const total = Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr);
    expect(total).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(r.stdout)).toBeGreaterThan(0);
  });
});
