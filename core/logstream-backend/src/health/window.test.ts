import { describe, it, expect } from "bun:test";
import type {
  StreamSeverityTotals,
  PatternVariableWindow,
} from "@checkstack/logstream-common";
import {
  buildWindowMetrics,
  buildPatternOccurrence,
  buildPatternMetric,
} from "./window";

// The complete-minute window math + seconds-since-last helper are covered by
// @checkstack/healthcheck-common's own health-window.test.ts; this file only
// exercises the log-specific build* assembly over them.
const zeroSeverity: StreamSeverityTotals = {
  trace: 0,
  debug: 0,
  info: 0,
  warn: 0,
  error: 0,
  fatal: 0,
};

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
