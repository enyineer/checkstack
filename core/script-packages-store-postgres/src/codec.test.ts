import { describe, expect, test } from "bun:test";
import { encodeBlob, decodeBlob } from "./codec";

describe("blob codec", () => {
  test("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect([...decodeBlob(encodeBlob(bytes))]).toEqual([...bytes]);
  });

  test("round-trips an empty buffer", () => {
    expect(decodeBlob(encodeBlob(new Uint8Array())).length).toBe(0);
  });

  test("round-trips a larger random payload", () => {
    const bytes = new Uint8Array(4096);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
    const decoded = decodeBlob(encodeBlob(bytes));
    expect(decoded.length).toBe(bytes.length);
    expect([...decoded]).toEqual([...bytes]);
  });

  // Regression: a store `put` may receive a raw ArrayBuffer from an S3/HTTP
  // transport. `encodeBlob` must normalize it (not wrap the whole buffer) so
  // the round-trip is byte-identical to the equivalent Uint8Array.
  test("encodes a raw ArrayBuffer identically to its Uint8Array view", () => {
    const u8 = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    const ab = u8.buffer.slice(0);
    expect(ab).toBeInstanceOf(ArrayBuffer);
    expect(encodeBlob(ab)).toBe(encodeBlob(u8));
    expect([...decodeBlob(encodeBlob(ab))]).toEqual([...u8]);
  });
});
