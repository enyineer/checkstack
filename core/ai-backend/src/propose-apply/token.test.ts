import { describe, expect, test } from "bun:test";
import {
  formatProposalToken,
  generateProposalNonce,
  nonceMatches,
  parseProposalToken,
} from "./token";

describe("proposal token codec", () => {
  test("format -> parse round-trips id and nonce", () => {
    const rowId = "11111111-2222-3333-4444-555555555555";
    const nonce = generateProposalNonce();
    const token = formatProposalToken({ rowId, nonce });
    expect(token.startsWith("propose:")).toBe(true);
    const parsed = parseProposalToken(token);
    expect(parsed).toEqual({ rowId, nonce });
  });

  test("nonce is 64 hex chars (32 random bytes)", () => {
    const nonce = generateProposalNonce();
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects a token without the propose: prefix", () => {
    expect(parseProposalToken("apply:abc.def")).toBeUndefined();
  });

  test("rejects a token with no separator", () => {
    expect(parseProposalToken("propose:abcdef")).toBeUndefined();
  });

  test("rejects a token with an empty id", () => {
    expect(parseProposalToken("propose:.abc")).toBeUndefined();
  });

  test("splits on the FIRST dot so a hex nonce is preserved whole", () => {
    // Defensive: nonces are hex (no dots), but parsing must not lose data even
    // if a future id format contained a dot in the nonce position.
    const parsed = parseProposalToken("propose:row1.aa.bb");
    expect(parsed).toEqual({ rowId: "row1", nonce: "aa.bb" });
  });

  test("nonceMatches is true for equal nonces, false otherwise", () => {
    const nonce = generateProposalNonce();
    expect(nonceMatches({ candidate: nonce, stored: nonce })).toBe(true);
    expect(nonceMatches({ candidate: "deadbeef", stored: nonce })).toBe(false);
  });

  test("nonceMatches returns false on length mismatch without throwing", () => {
    expect(nonceMatches({ candidate: "ab", stored: "abcd" })).toBe(false);
  });
});
