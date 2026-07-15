import { describe, it, expect } from "bun:test";
import type { SeriesCumulativePoint, SeriesWindowAggregate } from "../storage";
import {
  sumCumulativeIncrease,
  computeCounterRate,
  buildMetricWindowResult,
} from "./window";

// The complete-minute window math + seconds-since-last helper are covered by
// @checkstack/healthcheck-common's own health-window.test.ts; this file only
// exercises the metric-specific folds + result assembly over them.
const MINUTE = 60_000;

describe("sumCumulativeIncrease (reset detection)", () => {
  const p = (
    seriesId: string,
    minute: number,
    last: number,
  ): SeriesCumulativePoint => ({
    seriesId,
    bucketStart: new Date(minute * MINUTE),
    last,
    lastTs: new Date(minute * MINUTE),
  });

  it("differences successive cumulative values within a series", () => {
    // 100 -> 130 -> 175 => +30 +45 = 75
    expect(
      sumCumulativeIncrease([p("a", 0, 100), p("a", 1, 130), p("a", 2, 175)]),
    ).toBe(75);
  });

  it("treats a DECREASE as a reset (post-reset value is the increment)", () => {
    // 100 -> 130 -> [reset] 20 -> 50 => +30, +20 (reset), +30 = 80
    expect(
      sumCumulativeIncrease([
        p("a", 0, 100),
        p("a", 1, 130),
        p("a", 2, 20),
        p("a", 3, 50),
      ]),
    ).toBe(80);
  });

  it("never leaks increase across series boundaries", () => {
    // series a: 10 -> 40 (+30); series b: 100 -> 105 (+5) => 35, NOT 30+(100-40)+5
    expect(
      sumCumulativeIncrease([
        p("a", 0, 10),
        p("a", 1, 40),
        p("b", 0, 100),
        p("b", 1, 105),
      ]),
    ).toBe(35);
  });

  it("reports 0 for a single point (no interval to measure)", () => {
    expect(sumCumulativeIncrease([p("a", 0, 500)])).toBe(0);
  });
});

const emptyAggregate: SeriesWindowAggregate = {
  sampleCount: 0,
  sum: 0,
  min: null,
  max: null,
  last: null,
  lastTs: null,
  deltaSum: 0,
  seriesCount: 0,
};

describe("computeCounterRate", () => {
  it("is 0/0 for a gauge (rate/increase are counters-only)", () => {
    const r = computeCounterRate({
      metricType: "gauge",
      counterKind: null,
      aggregate: { ...emptyAggregate, deltaSum: 999 },
      cumulativePoints: [],
      windowMinutes: 1,
    });
    expect(r).toEqual({ ratePerSecond: 0, increase: 0 });
  });

  it("uses deltaSum for a DELTA counter", () => {
    const r = computeCounterRate({
      metricType: "counter",
      counterKind: "delta",
      aggregate: { ...emptyAggregate, deltaSum: 120 },
      cumulativePoints: [],
      windowMinutes: 2, // 120s
    });
    expect(r.increase).toBe(120);
    expect(r.ratePerSecond).toBe(1); // 120 / 120s
  });

  it("uses reset-aware cumulative diff for a CUMULATIVE counter", () => {
    const r = computeCounterRate({
      metricType: "counter",
      counterKind: "cumulative",
      aggregate: emptyAggregate,
      cumulativePoints: [
        { seriesId: "a", bucketStart: new Date(0), last: 100, lastTs: new Date(0) },
        { seriesId: "a", bucketStart: new Date(MINUTE), last: 160, lastTs: new Date(MINUTE) },
      ],
      windowMinutes: 1, // 60s
    });
    expect(r.increase).toBe(60);
    expect(r.ratePerSecond).toBe(1); // 60 / 60s
  });
});

describe("buildMetricWindowResult", () => {
  const now = new Date("2026-01-01T10:00:00.000Z");
  const created = new Date("2026-01-01T00:00:00Z");

  it("folds multi-series aggregates (min-of-min, max-of-max, weighted avg, last)", () => {
    const aggregate: SeriesWindowAggregate = {
      sampleCount: 4,
      sum: 100,
      min: 5,
      max: 40,
      last: 22,
      lastTs: new Date("2026-01-01T09:59:50Z"),
      deltaSum: 0,
      seriesCount: 2,
    };
    const result = buildMetricWindowResult({
      aggregate,
      metricType: "gauge",
      counterKind: null,
      cumulativePoints: [],
      windowMinutes: 5,
      now,
      lastSampleAt: new Date("2026-01-01T09:59:50Z"),
      streamCreatedAt: created,
    });
    expect(result.avgValue).toBe(25); // 100 / 4
    expect(result.minValue).toBe(5);
    expect(result.maxValue).toBe(40);
    expect(result.lastValue).toBe(22);
    expect(result.sampleCount).toBe(4);
    expect(result.seriesCount).toBe(2);
    expect(result.ratePerSecond).toBe(0); // gauge
    expect(result.secondsSinceLastSample).toBe(10);
  });

  it("zeroes value fields for an empty window and counts staleness from creation", () => {
    const result = buildMetricWindowResult({
      aggregate: emptyAggregate,
      metricType: "counter",
      counterKind: "cumulative",
      cumulativePoints: [],
      windowMinutes: 1,
      now,
      lastSampleAt: null,
      streamCreatedAt: created,
    });
    expect(result.lastValue).toBe(0);
    expect(result.avgValue).toBe(0);
    expect(result.minValue).toBe(0);
    expect(result.maxValue).toBe(0);
    expect(result.increase).toBe(0);
    expect(result.secondsSinceLastSample).toBe(10 * 3600);
  });
});
