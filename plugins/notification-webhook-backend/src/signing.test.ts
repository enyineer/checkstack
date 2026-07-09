import { describe, it, expect } from "bun:test";
import { createHmac } from "node:crypto";
import {
  buildSignatureHeaders,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "./signing";

describe("buildSignatureHeaders", () => {
  it("returns no headers when no secret is configured", () => {
    const headers = buildSignatureHeaders({
      rawBody: "{}",
      timestampSeconds: 100,
    });
    expect(headers).toEqual({});
  });

  it("signs <timestamp>.<body> with HMAC-SHA256 and prefixes sha256=", () => {
    const secret = "shhh";
    const rawBody = '{"version":1}';
    const timestampSeconds = 1_700_000_000;

    const headers = buildSignatureHeaders({ secret, rawBody, timestampSeconds });

    const expected = createHmac("sha256", secret)
      .update(`${timestampSeconds}.${rawBody}`)
      .digest("hex");

    expect(headers[SIGNATURE_HEADER]).toBe(`sha256=${expected}`);
    expect(headers[TIMESTAMP_HEADER]).toBe(String(timestampSeconds));
  });

  it("produces different signatures for different bodies", () => {
    const a = buildSignatureHeaders({
      secret: "k",
      rawBody: "a",
      timestampSeconds: 1,
    });
    const b = buildSignatureHeaders({
      secret: "k",
      rawBody: "b",
      timestampSeconds: 1,
    });
    expect(a[SIGNATURE_HEADER]).not.toBe(b[SIGNATURE_HEADER]);
  });
});
