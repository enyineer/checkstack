import { describe, it, expect } from "bun:test";
import type {
  StreamSeverityTotals,
  PatternVariableWindow,
} from "@checkstack/logstream-common";
import {
  computeWindowBounds,
  computeSecondsSinceLastLog,
  buildWindowMetrics,
  buildPatternOccurrence,
  buildPatternMetric,
  MIN_WINDOW_SECONDS,
} from "./window";

const zeroSeverity: StreamSeverityTotals = {
  trace: 0,
  debug: 0,
  info: 0,
  warn: 0,
  error: 0,
  fatal: 0,
};

describe("computeWindowBounds", () => {
  it("ends the complete-minute window at the last complete minute", () => {
    // 12:03:45 -> last complete minute is 12:02, so the exclusive end is 12:03.
    const now = new Date("2026-01-01T12:03:45.000Z");
    const { from, to } = computeWindowBounds({
      now,
      windowSeconds: 300,
      intervalSeconds: 60,
    });
    expect(to.toISOString()).toBe("2026-01-01T12:03:00.000Z");
    // 5 whole minutes back from 12:03 -> 11:58.
    expect(from.toISOString()).toBe("2026-01-01T11:58:00.000Z");
  });

  it("extends the read boundary through the in-progress minute", () => {
    // 12:03:45 -> the count reads must include the [12:03, 12:04) partial minute
    // so a burst at 12:03:05 is visible to an eval at 12:03:10, not deferred to
    // the next tick.
    const now = new Date("2026-01-01T12:03:45.000Z");
    const { to, readTo } = computeWindowBounds({
      now,
      windowSeconds: 300,
      intervalSeconds: 60,
    });
    expect(to.toISOString()).toBe("2026-01-01T12:03:00.000Z");
    expect(readTo.toISOString()).toBe("2026-01-01T12:04:00.000Z");
  });

  it("makes a burst at :05 visible to a read at :10 (same minute)", () => {
    // The stream floors a line at 12:03:05 into the 12:03 minute bucket. An eval
    // at 12:03:10 reads `[from, readTo)`; readTo must cover 12:03 so the bucket
    // is inside the read range.
    const burstBucket = new Date("2026-01-01T12:03:00.000Z"); // floor(12:03:05)
    const evalNow = new Date("2026-01-01T12:03:10.000Z");
    const { from, readTo } = computeWindowBounds({
      now: evalNow,
      windowSeconds: 300,
      intervalSeconds: 60,
    });
    // The burst's minute bucket falls inside the half-open read window.
    expect(burstBucket.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(burstBucket.getTime()).toBeLessThan(readTo.getTime());
  });

  it("is minute-aligned even when now is exactly on a minute boundary", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const { from, to, windowMinutes } = computeWindowBounds({
      now,
      windowSeconds: 120,
      intervalSeconds: 60,
    });
    expect(to.toISOString()).toBe("2026-01-01T12:00:00.000Z");
    expect(from.toISOString()).toBe("2026-01-01T11:58:00.000Z");
    expect(windowMinutes).toBe(2);
  });

  it("defaults the window to the check interval", () => {
    const now = new Date("2026-01-01T12:03:30.000Z");
    const { windowMinutes } = computeWindowBounds({
      now,
      windowSeconds: undefined,
      intervalSeconds: 180,
    });
    expect(windowMinutes).toBe(3);
  });

  it("clamps below one minute up to the minimum and floors to whole minutes", () => {
    const now = new Date("2026-01-01T12:03:30.000Z");
    expect(
      computeWindowBounds({ now, windowSeconds: 10, intervalSeconds: 5 })
        .windowMinutes,
    ).toBe(1);
    expect(MIN_WINDOW_SECONDS).toBe(60);
    // 200s floors to 3 minutes (180s), not 4.
    expect(
      computeWindowBounds({ now, windowSeconds: 200, intervalSeconds: 60 })
        .windowMinutes,
    ).toBe(3);
  });

  it("guards non-finite / non-positive requests", () => {
    const now = new Date("2026-01-01T12:03:30.000Z");
    expect(
      computeWindowBounds({
        now,
        windowSeconds: Number.NaN,
        intervalSeconds: 60,
      }).windowMinutes,
    ).toBe(1);
    expect(
      computeWindowBounds({ now, windowSeconds: -100, intervalSeconds: 60 })
        .windowMinutes,
    ).toBe(1);
  });
});

describe("computeSecondsSinceLastLog", () => {
  it("measures from the last received line", () => {
    const now = new Date("2026-01-01T12:00:30.000Z");
    expect(
      computeSecondsSinceLastLog({
        now,
        lastReceivedAt: new Date("2026-01-01T12:00:00.000Z"),
        streamCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toBe(30);
  });

  it("falls back to stream age when the stream never received a line", () => {
    const now = new Date("2026-01-01T01:00:00.000Z");
    expect(
      computeSecondsSinceLastLog({
        now,
        lastReceivedAt: null,
        streamCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toBe(3600);
  });

  it("clamps a future timestamp (clock skew) to 0", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    expect(
      computeSecondsSinceLastLog({
        now,
        lastReceivedAt: new Date("2026-01-01T12:00:05.000Z"),
        streamCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toBe(0);
  });
});

describe("buildWindowMetrics", () => {
  const now = new Date("2026-01-01T12:03:00.000Z");
  const streamCreatedAt = new Date("2026-01-01T00:00:00.000Z");

  it("sums bands into totalCount (trace only contributes to the total) and derives the error rate", () => {
    const severity: StreamSeverityTotals = {
      trace: 2,
      debug: 3,
      info: 10,
      warn: 4,
      error: 6,
      fatal: 1,
    };
    const result = buildWindowMetrics({
      severity,
      newPatternCount: 2,
      distinctPatternCount: 5,
      now,
      lastReceivedAt: new Date("2026-01-01T12:02:30.000Z"),
      streamCreatedAt,
      windowMinutes: 5,
    });
    expect(result.totalCount).toBe(26);
    expect(result.fatalCount).toBe(1);
    expect(result.errorCount).toBe(6);
    expect(result.warnCount).toBe(4);
    expect(result.infoCount).toBe(10);
    expect(result.debugCount).toBe(3);
    // (error + fatal) / minutes = 7 / 5 = 1.4
    expect(result.errorRatePerMinute).toBe(1.4);
    expect(result.newPatternCount).toBe(2);
    expect(result.distinctPatternCount).toBe(5);
    expect(result.secondsSinceLastLog).toBe(30);
  });

  it("returns all-zero metrics for a silent window", () => {
    const result = buildWindowMetrics({
      severity: zeroSeverity,
      newPatternCount: 0,
      distinctPatternCount: 0,
      now,
      lastReceivedAt: null,
      streamCreatedAt,
      windowMinutes: 5,
    });
    expect(result.totalCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.errorRatePerMinute).toBe(0);
    // Never-received -> seconds since creation (12:03:00 - 00:00:00 = 43380s).
    expect(result.secondsSinceLastLog).toBe(43380);
  });
});

describe("buildPatternOccurrence", () => {
  it("reports occurrences and minutes since last seen", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const result = buildPatternOccurrence({
      occurrenceCount: 12,
      now,
      lastSeenAt: new Date("2026-01-01T11:45:00.000Z"),
      streamCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.occurrenceCount).toBe(12);
    expect(result.minutesSinceLastSeen).toBe(15);
  });

  it("falls back to stream age when the pattern was never seen", () => {
    const now = new Date("2026-01-01T02:00:00.000Z");
    const result = buildPatternOccurrence({
      occurrenceCount: 0,
      now,
      lastSeenAt: null,
      streamCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.occurrenceCount).toBe(0);
    expect(result.minutesSinceLastSeen).toBe(120);
  });
});

describe("buildPatternMetric", () => {
  const w = (partial: Partial<PatternVariableWindow>): PatternVariableWindow => ({
    sampleCount: 0,
    sum: 0,
    min: null,
    max: null,
    ...partial,
  });

  it("computes the mean and carries min/max through", () => {
    const result = buildPatternMetric({
      window: w({ sampleCount: 4, sum: 120, min: 10, max: 50 }),
    });
    expect(result.avgValue).toBe(30);
    expect(result.minValue).toBe(10);
    expect(result.maxValue).toBe(50);
    expect(result.sampleCount).toBe(4);
  });

  it("rounds the mean to two decimals", () => {
    const result = buildPatternMetric({
      window: w({ sampleCount: 3, sum: 10, min: 1, max: 6 }),
    });
    expect(result.avgValue).toBe(3.33);
  });

  it("zeroes value fields (never null) for an empty window", () => {
    const result = buildPatternMetric({ window: w({}) });
    expect(result.sampleCount).toBe(0);
    expect(result.avgValue).toBe(0);
    expect(result.minValue).toBe(0);
    expect(result.maxValue).toBe(0);
  });
});
