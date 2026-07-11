import { describe, expect, it } from "bun:test";
import { needsBootstrap } from "./ensure-deps.ts";

describe("needsBootstrap", () => {
  it("installs when node_modules is absent (fresh clone)", () => {
    expect(needsBootstrap({ exists: () => false })).toBe(true);
  });

  it("is a no-op when node_modules is present", () => {
    expect(needsBootstrap({ exists: (p) => p === "node_modules" })).toBe(false);
  });
});
