import { describe, expect, test } from "bun:test";

import { formatDate, formatDateTime, formatTime } from "./date";

describe("formatDate", () => {
  test("formats a Date object", () => {
    const result = formatDate(new Date("2025-01-05T12:00:00Z"));
    // Locale-agnostic: must contain the year and not be empty / "Invalid Date".
    expect(result).toContain("2025");
    expect(result).not.toBe("");
    expect(result).not.toContain("Invalid");
  });

  test("accepts an ISO string", () => {
    expect(formatDate("2025-01-05T12:00:00Z")).toContain("2025");
  });

  test("accepts a numeric epoch (ms)", () => {
    const ms = Date.UTC(2025, 0, 5, 12, 0, 0);
    expect(formatDate(ms)).toContain("2025");
  });

  test("returns empty string for null", () => {
    expect(formatDate(null)).toBe("");
  });

  test("returns empty string for undefined", () => {
    expect(formatDate(undefined)).toBe("");
  });

  test("returns empty string for an invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("");
  });

  test("returns empty string for NaN epoch", () => {
    expect(formatDate(Number.NaN)).toBe("");
  });
});

describe("formatDateTime", () => {
  test("includes the year and a time component", () => {
    const result = formatDateTime(new Date("2025-01-05T14:30:00Z"));
    expect(result).toContain("2025");
    // A time-of-day separator (":") should be present regardless of locale.
    expect(result).toContain(":");
  });

  test("accepts an ISO string", () => {
    expect(formatDateTime("2025-01-05T14:30:00Z")).toContain("2025");
  });

  test("accepts a numeric epoch (ms)", () => {
    expect(formatDateTime(Date.UTC(2025, 0, 5, 14, 30))).toContain("2025");
  });

  test("returns empty string for absent input", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime(undefined)).toBe("");
  });

  test("returns empty string for invalid input", () => {
    expect(formatDateTime("nope")).toBe("");
  });
});

describe("formatTime", () => {
  test("renders a 24-hour time-of-day with seconds", () => {
    const result = formatTime(new Date("2025-01-05T14:30:05Z"));
    // Three colon-separated numeric groups (HH:MM:SS), no AM/PM marker.
    expect(result).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
  });

  test("accepts an ISO string", () => {
    expect(formatTime("2025-01-05T14:30:05Z")).toMatch(
      /^\d{1,2}:\d{2}:\d{2}$/,
    );
  });

  test("accepts a numeric epoch (ms)", () => {
    expect(formatTime(Date.UTC(2025, 0, 5, 14, 30, 5))).toMatch(
      /^\d{1,2}:\d{2}:\d{2}$/,
    );
  });

  test("returns empty string for absent input", () => {
    expect(formatTime(null)).toBe("");
    expect(formatTime(undefined)).toBe("");
  });

  test("returns empty string for invalid input", () => {
    expect(formatTime("nope")).toBe("");
  });
});
