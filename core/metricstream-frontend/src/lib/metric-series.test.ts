import { describe, it, expect } from "bun:test";
import type { MetricBucketPoint } from "@checkstack/metricstream-common";
import {
  readBucketValue,
  toMetricSeries,
  hasMetricSamples,
} from "./metric-series";

function bucket(overrides: Partial<MetricBucketPoint>): MetricBucketPoint {
  return {
    bucketStart: new Date("2026-07-12T10:00:00Z"),
    count: 0,
    sum: 0,
    min: null,
    max: null,
    last: null,
    lastTs: null,
    deltaSum: 0,
    ...overrides,
  };
}

describe("readBucketValue", () => {
  it("avg divides sum by count, null when the bucket had no samples", () => {
    expect(readBucketValue({ point: bucket({ count: 4, sum: 20 }), field: "avg" })).toBe(5);
    expect(readBucketValue({ point: bucket({ count: 0, sum: 0 }), field: "avg" })).toBeNull();
  });

  it("min/max/last pass the stored aggregate through", () => {
    const p = bucket({ min: 1, max: 9, last: 7 });
    expect(readBucketValue({ point: p, field: "min" })).toBe(1);
    expect(readBucketValue({ point: p, field: "max" })).toBe(9);
    expect(readBucketValue({ point: p, field: "last" })).toBe(7);
  });
});

describe("toMetricSeries", () => {
  const from = new Date("2026-07-12T10:00:00Z");
  const to = new Date("2026-07-12T10:04:00Z");

  it("builds a full minute axis, null-filling gaps (never zero-filling)", () => {
    const points = [
      bucket({ bucketStart: new Date("2026-07-12T10:01:00Z"), count: 2, sum: 10 }),
      bucket({ bucketStart: new Date("2026-07-12T10:03:00Z"), count: 1, sum: 7 }),
    ];
    const series = toMetricSeries({ points, grain: "minute", from, to, field: "avg" });
    // 10:00..10:04 inclusive = 5 buckets.
    expect(series).toHaveLength(5);
    expect(series.map((p) => p.y)).toEqual([null, 5, null, 7, null]);
    // x is strictly increasing at a one-minute span.
    expect(series[1].x - series[0].x).toBe(60_000);
  });

  it("returns sparse points for a degenerate single-bucket window", () => {
    const points = [bucket({ bucketStart: from, count: 1, sum: 3 })];
    const series = toMetricSeries({
      points,
      grain: "minute",
      from,
      to: from,
      field: "avg",
    });
    expect(series).toEqual([{ x: from.getTime(), y: 3 }]);
  });
});

describe("hasMetricSamples", () => {
  it("is false when every point is a gap", () => {
    expect(hasMetricSamples([{ x: 1, y: null }, { x: 2, y: null }])).toBe(false);
  });
  it("is true once any point carries a value", () => {
    expect(hasMetricSamples([{ x: 1, y: null }, { x: 2, y: 4 }])).toBe(true);
  });
});
