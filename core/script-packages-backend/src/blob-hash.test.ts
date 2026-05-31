import { describe, expect, test } from "bun:test";
import { blobSha256, toUint8Array, verifyBlobSha256 } from "./blob-hash";

const bytes = new TextEncoder().encode("the real blob");
const hash = blobSha256(bytes);

describe("blobSha256 byte-type boundary", () => {
  // Regression: a real-package install reads blob bytes from a store backend
  // whose `get` can yield a raw ArrayBuffer (e.g. an S3/HTTP transport).
  // `crypto.Hash.update()` rejects a bare ArrayBuffer
  // ("Received an instance of ArrayBuffer"), failing the install with
  // status=error. The hash boundary must normalize ArrayBuffer -> Uint8Array.
  test("hashes a raw ArrayBuffer without throwing", () => {
    const u8 = new TextEncoder().encode("blob-from-an-arraybuffer-source");
    // A standalone ArrayBuffer holding exactly these bytes.
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    expect(ab).toBeInstanceOf(ArrayBuffer);
    // Must not throw, and must equal the Uint8Array digest over the same bytes.
    expect(blobSha256(ab)).toBe(blobSha256(u8));
  });

  test("a Uint8Array view hashes identically to its ArrayBuffer", () => {
    const u8 = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    const ab = u8.buffer.slice(0);
    expect(blobSha256(ab)).toBe(blobSha256(u8));
  });

  test("verifyBlobSha256 accepts an ArrayBuffer", () => {
    const u8 = new TextEncoder().encode("verify me");
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const verdict = verifyBlobSha256({
      entry: { blobSha256: blobSha256(u8) },
      bytes: ab,
    });
    expect(verdict.ok).toBe(true);
  });

  test("toUint8Array returns the same instance for a Uint8Array", () => {
    const u8 = new Uint8Array([1, 2, 3]);
    expect(toUint8Array(u8)).toBe(u8);
  });
});

describe("verifyBlobSha256", () => {
  test("ok when the hash matches", () => {
    const verdict = verifyBlobSha256({ entry: { blobSha256: hash }, bytes });
    expect(verdict.ok).toBe(true);
  });

  test("rejects tampered bytes with expected + actual hashes", () => {
    const tampered = new TextEncoder().encode("the EVIL blob");
    const verdict = verifyBlobSha256({
      entry: { blobSha256: hash },
      bytes: tampered,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.expected).toBe(hash);
      expect(verdict.actual).toBe(blobSha256(tampered));
      expect(verdict.actual).not.toBe(verdict.expected);
    }
  });

  test("backward-safe: no recorded hash skips verification", () => {
    // Entries published before blobSha256 must still seed (until re-install
    // regenerates the manifest). Any bytes pass.
    const verdict = verifyBlobSha256({ entry: {}, bytes });
    expect(verdict.ok).toBe(true);
  });
});
