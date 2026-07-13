import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { TOKEN_PREFIX } from "@checkstack/logstream-common";
import { generateToken, hashToken } from "./token-crypto";

describe("generateToken", () => {
  it("produces a ckls_-prefixed secret with the stream hint and a hash", () => {
    const { secret, tokenHash, tokenPrefix } = generateToken({
      streamId: "stream_abcdef123456",
    });
    expect(secret.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(secret).toContain("streamab"); // shortStreamId of the id
    expect(tokenHash).toBe(createHash("sha256").update(secret).digest("hex"));
    expect(tokenPrefix).toBe(secret.slice(0, 8));
    expect(tokenHash).toHaveLength(64);
  });

  it("is unique across mints", () => {
    const a = generateToken({ streamId: "s" });
    const b = generateToken({ streamId: "s" });
    expect(a.secret).not.toBe(b.secret);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe("hashToken", () => {
  it("is a stable sha256 hex digest", () => {
    expect(hashToken("ckls_x_y")).toBe(
      createHash("sha256").update("ckls_x_y").digest("hex"),
    );
  });
});
