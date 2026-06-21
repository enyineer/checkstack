import { describe, expect, it } from "bun:test";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Acme Status")).toBe("acme-status");
  });

  it("collapses runs of invalid characters into a single hyphen", () => {
    expect(slugify("Acme   //  Status!!")).toBe("acme-status");
  });

  it("strips characters outside [a-z0-9]", () => {
    expect(slugify("Café & Co. #1")).toBe("caf-co-1");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  -- Hello World -- ")).toBe("hello-world");
  });

  it("keeps an already-valid slug unchanged", () => {
    expect(slugify("acme-2026")).toBe("acme-2026");
  });

  it("returns an empty string when there is no slug-able content", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("!!!")).toBe("");
  });

  it("preserves digits", () => {
    expect(slugify("Status 123")).toBe("status-123");
  });
});
