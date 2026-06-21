import { describe, it, expect } from "bun:test";
import { opaqueBearerToken } from "./bearer-token";

/** Build a Request carrying the given Authorization header (or none). */
function requestWithAuth(value?: string): Request {
  return new Request("https://example.test/resource", {
    headers: value === undefined ? {} : { authorization: value },
  });
}

describe("opaqueBearerToken", () => {
  it("returns the token after 'Bearer '", () => {
    expect(opaqueBearerToken(requestWithAuth("Bearer abc.def.ghi"))).toBe(
      "abc.def.ghi",
    );
  });

  it("returns undefined when there is no Authorization header", () => {
    expect(opaqueBearerToken(requestWithAuth())).toBeUndefined();
  });

  it("returns undefined for a non-Bearer scheme", () => {
    expect(opaqueBearerToken(requestWithAuth("Basic dXNlcjpwYXNz"))).toBeUndefined();
  });

  it("excludes ck_ API keys (they have their own auth branch)", () => {
    expect(
      opaqueBearerToken(requestWithAuth("Bearer ck_live_secret")),
    ).toBeUndefined();
  });

  it("reads the header case-insensitively via Headers", () => {
    // Headers.get is case-insensitive, so an Authorization-cased header works.
    const req = new Request("https://example.test/resource", {
      headers: { Authorization: "Bearer token-123" },
    });
    expect(opaqueBearerToken(req)).toBe("token-123");
  });

  it("is exact about the 'Bearer ' prefix (no token without the space)", () => {
    // "Bearertoken" does not start with "Bearer " (note the required space).
    expect(opaqueBearerToken(requestWithAuth("Bearertoken"))).toBeUndefined();
  });

  it("returns undefined for a bare 'Bearer ' header", () => {
    // The Headers API trims the trailing space, so the stored value is the bare
    // "Bearer", which does not start with the required "Bearer " prefix.
    expect(opaqueBearerToken(requestWithAuth("Bearer "))).toBeUndefined();
  });

  it("does not strip a ck_ substring that is not the token prefix", () => {
    // The exclusion is anchored at the start: a token merely containing "ck_"
    // is still a valid opaque bearer.
    expect(
      opaqueBearerToken(requestWithAuth("Bearer not_ck_prefixed")),
    ).toBe("not_ck_prefixed");
  });
});
