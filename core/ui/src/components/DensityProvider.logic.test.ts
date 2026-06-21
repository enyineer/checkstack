import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DENSITY,
  densityClassName,
  resolveDensity,
  toggleDensity,
} from "./DensityProvider.logic";

describe("density - resolveDensity", () => {
  it("accepts a valid 'comfortable' value", () => {
    expect(resolveDensity({ value: "comfortable" })).toBe("comfortable");
  });

  it("accepts a valid 'compact' value", () => {
    expect(resolveDensity({ value: "compact" })).toBe("compact");
  });

  it("falls back to the default for null (empty localStorage)", () => {
    expect(resolveDensity({ value: null })).toBe(DEFAULT_DENSITY);
  });

  it("falls back to the default for an unknown string", () => {
    expect(resolveDensity({ value: "cozy" })).toBe(DEFAULT_DENSITY);
  });

  it("falls back to the default for non-string payloads", () => {
    expect(resolveDensity({ value: 42 })).toBe(DEFAULT_DENSITY);
    expect(resolveDensity({ value: undefined })).toBe(DEFAULT_DENSITY);
    expect(resolveDensity({ value: { density: "compact" } })).toBe(
      DEFAULT_DENSITY,
    );
  });

  it("honours an explicit fallback over the default", () => {
    expect(resolveDensity({ value: "garbage", fallback: "compact" })).toBe(
      "compact",
    );
  });

  it("defaults to comfortable", () => {
    expect(DEFAULT_DENSITY).toBe("comfortable");
  });
});

describe("density - densityClassName", () => {
  it("maps comfortable to the comfortable wrapper class", () => {
    expect(densityClassName("comfortable")).toBe("density-comfortable");
  });

  it("maps compact to the compact wrapper class", () => {
    expect(densityClassName("compact")).toBe("density-compact");
  });
});

describe("density - toggleDensity", () => {
  it("flips comfortable to compact", () => {
    expect(toggleDensity("comfortable")).toBe("compact");
  });

  it("flips compact to comfortable", () => {
    expect(toggleDensity("compact")).toBe("comfortable");
  });
});
