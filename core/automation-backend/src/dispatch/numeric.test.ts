import { describe, it, expect } from "bun:test";
import {
  extractNumericField,
  matchesThreshold,
  toNumberOrNull,
} from "./numeric";

describe("toNumberOrNull", () => {
  it("passes finite numbers", () => {
    expect(toNumberOrNull(42)).toBe(42);
    expect(toNumberOrNull(0)).toBe(0);
  });
  it("coerces numeric strings", () => {
    expect(toNumberOrNull("500")).toBe(500);
    expect(toNumberOrNull("3.14")).toBeCloseTo(3.14, 5);
  });
  it("rejects non-numeric / empty / nullish", () => {
    expect(toNumberOrNull("abc")).toBeNull();
    expect(toNumberOrNull("")).toBeNull();
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
    expect(toNumberOrNull({})).toBeNull();
    expect(toNumberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("matchesThreshold", () => {
  it("above only", () => {
    expect(matchesThreshold({ value: 600, above: 500 })).toBe(true);
    expect(matchesThreshold({ value: 500, above: 500 })).toBe(false); // strict
    expect(matchesThreshold({ value: 400, above: 500 })).toBe(false);
  });
  it("below only", () => {
    expect(matchesThreshold({ value: 50, below: 100 })).toBe(true);
    expect(matchesThreshold({ value: 100, below: 100 })).toBe(false);
    expect(matchesThreshold({ value: 150, below: 100 })).toBe(false);
  });
  it("both bounds require a band", () => {
    expect(matchesThreshold({ value: 75, above: 50, below: 100 })).toBe(true);
    expect(matchesThreshold({ value: 25, above: 50, below: 100 })).toBe(false);
    expect(matchesThreshold({ value: 125, above: 50, below: 100 })).toBe(false);
  });
  it("null value never matches; no bounds never matches", () => {
    expect(matchesThreshold({ value: null, above: 1 })).toBe(false);
    expect(matchesThreshold({ value: 5 })).toBe(false);
  });
});

describe("extractNumericField", () => {
  it("reads top-level latencyMs", () => {
    expect(extractNumericField({ latencyMs: 123 }, "latencyMs")).toBe(123);
  });
  it("reads a collector field under result (the collectors map)", () => {
    const payload = {
      result: { http: { responseTimeMs: 250 } },
    };
    expect(
      extractNumericField(payload, "collectors.http.responseTimeMs"),
    ).toBe(250);
    // the `collectors.` prefix is optional
    expect(
      extractNumericField(payload, "http.responseTimeMs"),
    ).toBe(250);
  });
  it("returns null for an absent / non-numeric path", () => {
    expect(extractNumericField({}, "latencyMs")).toBeNull();
    expect(
      extractNumericField({ result: {} }, "collectors.x.y"),
    ).toBeNull();
  });
});
