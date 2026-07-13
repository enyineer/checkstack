import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  createSourceTokenKit,
  constantTimeHexEqual,
} from "./source-token-kit";

describe("createSourceTokenKit format helpers", () => {
  const kit = createSourceTokenKit({ prefix: "ckxx_" });

  it("shortId strips non-alphanumerics and truncates to 8", () => {
    expect(kit.shortId("stream_ab-cd.ef_gh")).toBe("streamab");
    expect(kit.shortId("x")).toBe("x");
  });

  it("isToken matches only the configured prefix", () => {
    expect(kit.isToken("ckxx_abc")).toBe(true);
    expect(kit.isToken("ck_abc")).toBe(false);
    expect(kit.isToken("bearer ckxx_abc")).toBe(false);
  });

  it("extractToken reads a Bearer token (case-insensitive scheme)", () => {
    expect(kit.extractToken({ authorization: "Bearer ckxx_abc123" })).toBe(
      "ckxx_abc123",
    );
    expect(kit.extractToken({ authorization: "bearer ckxx_abc" })).toBe(
      "ckxx_abc",
    );
  });

  it("extractToken reads and prefers the X-Checkstack-Token header", () => {
    expect(kit.extractToken({ checkstackToken: "ckxx_headertoken" })).toBe(
      "ckxx_headertoken",
    );
    expect(
      kit.extractToken({
        authorization: "Bearer ckxx_fromauth",
        checkstackToken: "ckxx_fromheader",
      }),
    ).toBe("ckxx_fromheader");
  });

  it("extractToken rejects tokens with a different prefix and missing values", () => {
    expect(kit.extractToken({ authorization: "Bearer ck_app_key" })).toBeNull();
    expect(kit.extractToken({})).toBeNull();
    expect(kit.extractToken({ authorization: "" })).toBeNull();
  });
});

describe("createSourceTokenKit generateToken / hashToken", () => {
  it("produces a prefixed secret with the resource hint and a hash", () => {
    const kit = createSourceTokenKit({ prefix: "ckms_" });
    const { secret, tokenHash, tokenPrefix } = kit.generateToken({
      resourceId: "stream_abcdef123456",
    });
    expect(secret.startsWith("ckms_")).toBe(true);
    expect(secret).toContain("streamab"); // shortId of the resource id
    expect(tokenHash).toBe(createHash("sha256").update(secret).digest("hex"));
    expect(tokenPrefix).toBe(secret.slice(0, 8));
    expect(tokenHash).toHaveLength(64);
  });

  it("honors a custom display prefix length", () => {
    const kit = createSourceTokenKit({ prefix: "ckms_", displayPrefixLength: 12 });
    const { secret, tokenPrefix } = kit.generateToken({ resourceId: "s" });
    expect(tokenPrefix).toBe(secret.slice(0, 12));
  });

  it("is unique across mints", () => {
    const kit = createSourceTokenKit({ prefix: "ckms_" });
    const a = kit.generateToken({ resourceId: "s" });
    const b = kit.generateToken({ resourceId: "s" });
    expect(a.secret).not.toBe(b.secret);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("hashToken is a stable sha256 hex digest", () => {
    const kit = createSourceTokenKit({ prefix: "ckms_" });
    expect(kit.hashToken("ckms_x_y")).toBe(
      createHash("sha256").update("ckms_x_y").digest("hex"),
    );
  });
});

describe("constantTimeHexEqual", () => {
  it("compares equal-length hex strings and rejects mismatched lengths", () => {
    expect(constantTimeHexEqual("abcd", "abcd")).toBe(true);
    expect(constantTimeHexEqual("abcd", "abce")).toBe(false);
    expect(constantTimeHexEqual("abcd", "abcde")).toBe(false);
  });
});
