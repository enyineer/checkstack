import { describe, expect, it } from "bun:test";
import { formatDuration } from "./run-duration";

describe("formatDuration", () => {
  it("returns the placeholder when the run has not finished", () => {
    expect(formatDuration("2026-01-01T00:00:00Z", null)).toBe("—");
    expect(formatDuration("2026-01-01T00:00:00Z", undefined)).toBe("—");
  });

  it("reports sub-second durations in milliseconds", () => {
    expect(
      formatDuration("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.450Z"),
    ).toBe("450ms");
  });

  it("reports sub-minute durations as single-decimal seconds", () => {
    expect(
      formatDuration("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:12.300Z"),
    ).toBe("12.3s");
  });

  it("reports longer durations as rounded whole minutes", () => {
    expect(
      formatDuration("2026-01-01T00:00:00.000Z", "2026-01-01T00:02:30.000Z"),
    ).toBe("3m");
  });

  it("accepts Date instances as well as strings", () => {
    expect(
      formatDuration(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-01T00:00:05.000Z"),
      ),
    ).toBe("5.0s");
  });
});
