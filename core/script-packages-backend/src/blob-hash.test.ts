import { describe, expect, test } from "bun:test";
import { blobSha256, verifyBlobSha256 } from "./blob-hash";

const bytes = new TextEncoder().encode("the real blob");
const hash = blobSha256(bytes);

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
