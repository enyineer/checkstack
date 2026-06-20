import { describe, expect, test } from "bun:test";

import { formatRelativeTime } from "./relativeTime";

describe("formatRelativeTime", () => {
  test("formats a past time with an 'ago' suffix", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = formatRelativeTime(fiveMinutesAgo);
    expect(result).toContain("minutes");
    expect(result).toContain("ago");
  });

  test("formats a future time with an 'in' prefix", () => {
    const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const result = formatRelativeTime(inTwoHours);
    expect(result).toContain("in");
    expect(result).toContain("hour");
  });

  test("accepts an ISO string", () => {
    const iso = new Date(Date.now() - 60 * 1000).toISOString();
    expect(formatRelativeTime(iso)).toContain("ago");
  });

  test("accepts a numeric epoch (ms)", () => {
    const ms = Date.now() - 60 * 1000;
    expect(formatRelativeTime(ms)).toContain("ago");
  });

  test("returns empty string for absent input", () => {
    expect(formatRelativeTime(null)).toBe("");
    expect(formatRelativeTime(undefined)).toBe("");
  });

  test("returns empty string for invalid input", () => {
    expect(formatRelativeTime("not-a-date")).toBe("");
  });
});
