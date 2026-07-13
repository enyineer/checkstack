import { describe, it, expect } from "bun:test";
import { DEFAULT_LOG_STREAM_CONFIG } from "@checkstack/logstream-common";
import {
  computeRetentionCutoffs,
  rollupSeverityToHourly,
  rollupPatternToHourly,
  type SeverityBucketRow,
  type PatternBucketRow,
} from "./retention";

describe("computeRetentionCutoffs", () => {
  it("derives the three cutoffs from a stream's policy", () => {
    const now = new Date("2026-01-10T00:00:00.000Z");
    const config = {
      ...DEFAULT_LOG_STREAM_CONFIG,
      rawRetentionDays: 3,
      minuteRetentionHours: 48,
      hourlyRetentionDays: 90,
    };
    const { rawCutoff, minuteCutoff, hourlyCutoff } = computeRetentionCutoffs({
      config,
      now,
    });
    expect(rawCutoff.toISOString()).toBe("2026-01-07T00:00:00.000Z");
    expect(minuteCutoff.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(hourlyCutoff.toISOString()).toBe("2025-10-12T00:00:00.000Z");
  });
});

describe("rollupSeverityToHourly", () => {
  it("sums minute rows into their hour, keeping bands separate", () => {
    const rows: SeverityBucketRow[] = [
      { bucketStart: new Date("2026-01-01T10:00:00.000Z"), band: "error", count: 2 },
      { bucketStart: new Date("2026-01-01T10:30:00.000Z"), band: "error", count: 3 },
      { bucketStart: new Date("2026-01-01T10:45:00.000Z"), band: "warn", count: 4 },
      { bucketStart: new Date("2026-01-01T11:15:00.000Z"), band: "error", count: 1 },
    ];
    const hourly = rollupSeverityToHourly(rows);

    const at = (hour: string, band: string) =>
      hourly.find(
        (h) => h.bucketStart.toISOString() === hour && h.band === band,
      )?.count;

    expect(at("2026-01-01T10:00:00.000Z", "error")).toBe(5);
    expect(at("2026-01-01T10:00:00.000Z", "warn")).toBe(4);
    expect(at("2026-01-01T11:00:00.000Z", "error")).toBe(1);
    expect(hourly).toHaveLength(3);
  });

  it("returns nothing for an empty input", () => {
    expect(rollupSeverityToHourly([])).toEqual([]);
  });
});

describe("rollupPatternToHourly", () => {
  it("sums minute pattern rows into their hour, keeping patterns separate", () => {
    const rows: PatternBucketRow[] = [
      { bucketStart: new Date("2026-01-01T10:05:00.000Z"), patternId: "p1", count: 6 },
      { bucketStart: new Date("2026-01-01T10:55:00.000Z"), patternId: "p1", count: 4 },
      { bucketStart: new Date("2026-01-01T10:20:00.000Z"), patternId: "p2", count: 1 },
    ];
    const hourly = rollupPatternToHourly(rows);
    const p1 = hourly.find(
      (h) =>
        h.patternId === "p1" &&
        h.bucketStart.toISOString() === "2026-01-01T10:00:00.000Z",
    );
    const p2 = hourly.find((h) => h.patternId === "p2");
    expect(p1?.count).toBe(10);
    expect(p2?.count).toBe(1);
    expect(hourly).toHaveLength(2);
  });
});
