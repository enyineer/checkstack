import { describe, it, expect } from "bun:test";
import type { MetricBucketPoint } from "@checkstack/metricstream-common";
import {
  resolveGrain,
  rollupBoundary,
  partitionWindowAtBoundary,
  foldMetricPointsByHour,
  mergeMetricPoints,
  MINUTE_TIER_MAX_MS,
} from "./buckets-merge";

const HOUR = 3_600_000;

describe("resolveGrain", () => {
  it("honours an explicit grain", () => {
    const from = new Date(0);
    const to = new Date(10 * HOUR);
    expect(resolveGrain({ from, to, explicit: "minute" })).toBe("minute");
  });

  it("picks minute for a narrow window and hour for a wide one", () => {
    const from = new Date(0);
    expect(
      resolveGrain({ from, to: new Date(MINUTE_TIER_MAX_MS) }),
    ).toBe("minute");
    expect(
      resolveGrain({ from, to: new Date(MINUTE_TIER_MAX_MS + 1) }),
    ).toBe("hour");
  });
});

describe("partitionWindowAtBoundary", () => {
  const boundary = new Date(10 * HOUR);

  it("splits a window straddling the boundary into coarse + fine", () => {
    const { coarse, fine } = partitionWindowAtBoundary({
      from: new Date(5 * HOUR),
      to: new Date(15 * HOUR),
      boundary,
    });
    expect(coarse).toEqual({ from: new Date(5 * HOUR), to: boundary });
    expect(fine).toEqual({ from: boundary, to: new Date(15 * HOUR) });
  });

  it("returns only coarse for a fully-old window", () => {
    const { coarse, fine } = partitionWindowAtBoundary({
      from: new Date(0),
      to: new Date(5 * HOUR),
      boundary,
    });
    expect(coarse).toBeDefined();
    expect(fine).toBeUndefined();
  });

  it("returns only fine for a fully-recent window", () => {
    const { coarse, fine } = partitionWindowAtBoundary({
      from: new Date(11 * HOUR),
      to: new Date(15 * HOUR),
      boundary,
    });
    expect(coarse).toBeUndefined();
    expect(fine).toBeDefined();
  });
});

describe("rollupBoundary", () => {
  it("subtracts the minute retention from now", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    expect(
      rollupBoundary({ now, minuteRetentionHours: 24 }).toISOString(),
    ).toBe("2026-01-01T00:00:00.000Z");
  });
});

const point = (bucketMs: number, over: Partial<MetricBucketPoint> = {}): MetricBucketPoint => ({
  bucketStart: new Date(bucketMs),
  count: 1,
  sum: 10,
  min: 10,
  max: 10,
  last: 10,
  lastTs: new Date(bucketMs),
  deltaSum: 0,
  ...over,
});

describe("foldMetricPointsByHour", () => {
  it("folds minute points into hour buckets with correct fold rules", () => {
    const folded = foldMetricPointsByHour([
      point(0, { count: 2, sum: 20, min: 5, max: 15, last: 15, lastTs: new Date(0) }),
      point(60_000, { count: 3, sum: 33, min: 3, max: 20, last: 11, lastTs: new Date(60_000) }),
    ]);
    expect(folded).toHaveLength(1);
    const [p] = folded;
    expect(p.count).toBe(5);
    expect(p.sum).toBe(53);
    expect(p.min).toBe(3);
    expect(p.max).toBe(20);
    // last = the sample with the greatest lastTs (minute 1 -> 11).
    expect(p.last).toBe(11);
  });
});

describe("mergeMetricPoints", () => {
  it("folds identical bucketStarts across two tiers and sorts", () => {
    const merged = mergeMetricPoints(
      [point(HOUR, { count: 1, sum: 10 })],
      [point(HOUR, { count: 4, sum: 40 }), point(2 * HOUR, { count: 1, sum: 5 })],
    );
    expect(merged.map((p) => p.bucketStart.getTime())).toEqual([HOUR, 2 * HOUR]);
    expect(merged[0].count).toBe(5);
    expect(merged[0].sum).toBe(50);
  });
});
