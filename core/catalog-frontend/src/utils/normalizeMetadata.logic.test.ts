import { describe, expect, test } from "bun:test";
import { normalizeMetadata } from "./normalizeMetadata.logic";

describe("normalizeMetadata", () => {
  test("returns [] for null", () => {
    expect(normalizeMetadata(null)).toEqual([]);
  });

  test("returns [] for undefined", () => {
    expect(normalizeMetadata(undefined)).toEqual([]);
  });

  test("returns [] for an empty object", () => {
    expect(normalizeMetadata({})).toEqual([]);
  });

  test("renders a string value inline", () => {
    expect(normalizeMetadata({ owner: "platform-team" })).toEqual([
      { key: "owner", displayValue: "platform-team" },
    ]);
  });

  test("renders a number value inline", () => {
    expect(normalizeMetadata({ priority: 1 })).toEqual([
      { key: "priority", displayValue: "1" },
    ]);
  });

  test("renders a boolean value inline", () => {
    expect(normalizeMetadata({ critical: true })).toEqual([
      { key: "critical", displayValue: "true" },
    ]);
  });

  test("renders null value as 'null'", () => {
    expect(normalizeMetadata({ deprecated: null })).toEqual([
      { key: "deprecated", displayValue: "null" },
    ]);
  });

  test("renders an object value as compact JSON", () => {
    const result = normalizeMetadata({ links: { docs: "https://example.com" } });
    expect(result).toEqual([
      { key: "links", displayValue: '{"docs":"https://example.com"}' },
    ]);
  });

  test("renders an array value as compact JSON", () => {
    const result = normalizeMetadata({ tags: ["backend", "api"] });
    expect(result).toEqual([
      { key: "tags", displayValue: '["backend","api"]' },
    ]);
  });

  test("handles multiple entries and preserves insertion order", () => {
    const result = normalizeMetadata({
      team: "payments",
      version: 2,
      active: false,
    });
    expect(result).toEqual([
      { key: "team", displayValue: "payments" },
      { key: "version", displayValue: "2" },
      { key: "active", displayValue: "false" },
    ]);
  });
});
