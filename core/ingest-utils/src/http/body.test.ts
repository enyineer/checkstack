import { describe, it, expect } from "bun:test";
import { gzipSync } from "node:zlib";
import { readCappedBody, BodyTooLargeError } from "./body";

function request(body: Uint8Array, headers: Record<string, string>): Request {
  return new Request("http://localhost/ingest", {
    method: "POST",
    // Copy into a fresh ArrayBuffer-backed view for the DOM `BodyInit` type.
    body: new Uint8Array(body),
    headers,
  });
}

describe("readCappedBody", () => {
  it("returns the raw body when not gzipped", async () => {
    const bytes = new TextEncoder().encode('{"a":1}');
    const out = await readCappedBody({ request: request(bytes, {}) });
    expect(new TextDecoder().decode(out)).toBe('{"a":1}');
  });

  it("decompresses a gzip body", async () => {
    const original = '{"message":"hi"}';
    const gz = new Uint8Array(gzipSync(Buffer.from(original)));
    const out = await readCappedBody({
      request: request(gz, { "content-encoding": "gzip" }),
    });
    expect(new TextDecoder().decode(out)).toBe(original);
  });

  it("rejects an oversize compressed body with 413", async () => {
    const big = new Uint8Array(2000);
    await expect(
      readCappedBody({ request: request(big, {}), maxCompressedBytes: 1000 }),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("rejects a gzip bomb that exceeds the inflated cap", async () => {
    // 1 MB of zeros compresses tiny but inflates past a small cap.
    const gz = new Uint8Array(gzipSync(Buffer.alloc(1024 * 1024)));
    await expect(
      readCappedBody({
        request: request(gz, { "content-encoding": "gzip" }),
        maxInflatedBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("surfaces a genuine malformed-gzip body as a non-size error (=> 400, not 413)", async () => {
    // Bytes that claim gzip encoding but are not valid gzip: the async inflate
    // rejects with a data error, NOT a size RangeError, so it must NOT be
    // reported as BodyTooLargeError (the handler maps that to 400).
    const notGzip = new TextEncoder().encode("this is definitely not gzip");
    const promise = readCappedBody({
      request: request(notGzip, { "content-encoding": "gzip" }),
    });
    await expect(promise).rejects.toThrow();
    await expect(promise).rejects.not.toBeInstanceOf(BodyTooLargeError);
  });

  it("fast-rejects via Content-Length before buffering the body", async () => {
    // A declared oversize Content-Length is refused up front. Use a small body
    // but a large declared length so the header path (not the byte path) trips.
    const small = new TextEncoder().encode("x");
    const req = new Request("http://localhost/ingest", {
      method: "POST",
      body: new Uint8Array(small),
      headers: { "content-length": String(5000) },
    });
    await expect(
      readCappedBody({ request: req, maxCompressedBytes: 1000 }),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
