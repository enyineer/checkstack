import { describe, it, expect } from "bun:test";
import { isPublicPath, publicSlugFromPath } from "./public-path";

const PREFIXES = ["/statuspage/view"];

describe("isPublicPath", () => {
  it("matches a child path under a public prefix", () => {
    expect(isPublicPath("/statuspage/view/acme", PREFIXES)).toBe(true);
  });

  it("matches the prefix exactly", () => {
    expect(isPublicPath("/statuspage/view", PREFIXES)).toBe(true);
  });

  it("does not match the admin builder paths", () => {
    expect(isPublicPath("/statuspage", PREFIXES)).toBe(false);
    expect(isPublicPath("/statuspage/123", PREFIXES)).toBe(false);
  });

  it("does not match a different prefix that merely starts the same", () => {
    expect(isPublicPath("/statuspage/viewer/x", PREFIXES)).toBe(false);
  });

  it("is false when there are no prefixes", () => {
    expect(isPublicPath("/statuspage/view/acme", undefined)).toBe(false);
    expect(isPublicPath("/statuspage/view/acme", [])).toBe(false);
  });
});

describe("publicSlugFromPath", () => {
  it("extracts the slug after the matched prefix", () => {
    expect(publicSlugFromPath("/statuspage/view/acme", PREFIXES)).toBe("acme");
  });

  it("ignores any trailing path segments", () => {
    expect(publicSlugFromPath("/statuspage/view/acme/extra", PREFIXES)).toBe(
      "acme",
    );
  });

  it("url-decodes the slug", () => {
    expect(publicSlugFromPath("/statuspage/view/a%20b", PREFIXES)).toBe("a b");
  });

  it("returns undefined when no prefix matches or no slug is present", () => {
    expect(publicSlugFromPath("/statuspage/123", PREFIXES)).toBeUndefined();
    expect(publicSlugFromPath("/statuspage/view", PREFIXES)).toBeUndefined();
    expect(publicSlugFromPath("/statuspage/view/", PREFIXES)).toBeUndefined();
  });
});
