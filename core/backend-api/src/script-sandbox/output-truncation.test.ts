import { describe, expect, it } from "bun:test";
import { truncateCapturedOutput } from "./output-truncation";

describe("truncateCapturedOutput", () => {
  it("passes through unchanged when no cap is set", () => {
    const r = truncateCapturedOutput({
      stdout: "a".repeat(100),
      stderr: "b".repeat(100),
      maxOutputBytes: undefined,
    });
    expect(r.truncated).toBe(false);
    expect(r.stdout.length).toBe(100);
    expect(r.stderr.length).toBe(100);
  });

  it("passes through unchanged when under the cap", () => {
    const r = truncateCapturedOutput({
      stdout: "hello",
      stderr: "world",
      maxOutputBytes: 100,
    });
    expect(r.truncated).toBe(false);
    expect(r.stdout).toBe("hello");
    expect(r.stderr).toBe("world");
  });

  it("trims and flags when combined output exceeds the cap", () => {
    const r = truncateCapturedOutput({
      stdout: "a".repeat(80),
      stderr: "b".repeat(80),
      maxOutputBytes: 100,
    });
    expect(r.truncated).toBe(true);
    const total = Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr);
    expect(total).toBeLessThanOrEqual(100);
    // stdout is preserved first.
    expect(r.stdout.length).toBe(80);
    expect(r.stderr.length).toBe(20);
  });

  it("does not split a multi-byte code point", () => {
    // Each emoji is 4 UTF-8 bytes.
    const r = truncateCapturedOutput({
      stdout: "😀😀😀😀😀", // 20 bytes
      stderr: "",
      maxOutputBytes: 10, // fits 2 full emoji (8 bytes)
    });
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(10);
    // No replacement char / partial byte: re-encoding must be lossless.
    expect(Buffer.byteLength(r.stdout) % 4).toBe(0);
  });
});
