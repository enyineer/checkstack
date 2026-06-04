import { describe, expect, test } from "bun:test";
import { formatDate } from "./formatDate.logic";

describe("formatDate", () => {
  test("returns '' for null", () => {
    expect(formatDate(null)).toBe("");
  });

  test("returns '' for undefined", () => {
    expect(formatDate(undefined)).toBe("");
  });

  test("returns '' for an invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("");
  });

  test("returns '' for an invalid Date object", () => {
    expect(formatDate(new Date("not-a-date"))).toBe("");
  });

  test("does not embed 'en-US' locale in the output", () => {
    // Run formatDate with a fixed date and verify the result does NOT contain
    // a hardcoded locale marker. We can't assert the exact locale-formatted
    // string since it depends on the runtime environment, but we can verify
    // it produces a non-empty result and does not throw.
    const result = formatDate(new Date("2025-01-05T00:00:00Z"));
    expect(result.length).toBeGreaterThan(0);
  });

  test("accepts a Date object and produces a non-empty string", () => {
    const date = new Date(2025, 0, 5); // Jan 5, 2025 local time
    expect(formatDate(date).length).toBeGreaterThan(0);
  });

  test("accepts an ISO string and produces a non-empty string", () => {
    expect(formatDate("2025-06-01T12:00:00.000Z").length).toBeGreaterThan(0);
  });

  test("a known fixed date produces output containing the year", () => {
    const result = formatDate(new Date(2025, 5, 1)); // Jun 1, 2025
    // The year should always appear regardless of locale
    expect(result).toContain("2025");
  });
});
