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
});
