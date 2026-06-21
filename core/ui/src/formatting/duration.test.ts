import { describe, expect, test } from "bun:test";

import { formatDuration } from "./duration";

describe("formatDuration", () => {
  test("formats zero as 0s", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  test("formats sub-second durations in milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(1)).toBe("1ms");
  });

  test("formats seconds", () => {
    expect(formatDuration(30_000)).toBe("30s");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(90_000)).toBe("1m 30s");
  });

  test("formats hours and minutes", () => {
    // 2h 5m = 7_500_000 ms
    expect(formatDuration(7_500_000)).toBe("2h 5m");
  });

  test("shows at most the two most-significant units", () => {
    // 1d 2h 3m 4s -> only "1d 2h"
    const ms = 1 * 86_400_000 + 2 * 3_600_000 + 3 * 60_000 + 4 * 1000;
    expect(formatDuration(ms)).toBe("1d 2h");
  });

  test("omits zero-valued leading/intermediate units appropriately", () => {
    // exactly 2 hours -> "2h"
    expect(formatDuration(2 * 3_600_000)).toBe("2h");
  });

  test("formats long durations spanning days", () => {
    expect(formatDuration(3 * 86_400_000)).toBe("3d");
  });

  test("keeps the sign for negative durations", () => {
    expect(formatDuration(-30_000)).toBe("-30s");
    expect(formatDuration(-500)).toBe("-500ms");
  });

  test("rounds fractional milliseconds for sub-second values", () => {
    expect(formatDuration(499.6)).toBe("500ms");
  });

  test("returns empty string for non-finite input", () => {
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("");
  });
});
