import { describe, it, expect } from "bun:test";
import { combineWindowAggregates } from "./buckets";
import type { SeriesWindowAggregate } from "./buckets";

function agg(overrides: Partial<SeriesWindowAggregate>): SeriesWindowAggregate {
  return {
    sampleCount: 0,
    sum: 0,
    min: null,
    max: null,
    last: null,
    lastTs: null,
    deltaSum: 0,
    seriesCount: 0,
    ...overrides,
  };
}

describe("combineWindowAggregates", () => {
  it("sums additive fields and folds extrema across tiers", () => {
    const coarse = agg({
      sampleCount: 10,
      sum: 100,
      min: 2,
      max: 50,
      deltaSum: 7,
      last: 40,
      lastTs: new Date("2026-06-01T10:00:00.000Z"),
      seriesCount: 3,
    });
    const fine = agg({
      sampleCount: 5,
      sum: 40,
      min: 1,
      max: 30,
      deltaSum: 3,
      last: 12,
      lastTs: new Date("2026-06-01T11:30:00.000Z"),
      seriesCount: 2,
    });
    const combined = combineWindowAggregates({
      parts: [coarse, fine],
      seriesCount: 3, // distinct union supplied by the caller
    });
    expect(combined.sampleCount).toBe(15);
    expect(combined.sum).toBe(140);
    expect(combined.deltaSum).toBe(10);
    expect(combined.min).toBe(1);
    expect(combined.max).toBe(50);
    // last = the sample with the latest lastTs (the fine tier here).
    expect(combined.last).toBe(12);
    expect(combined.seriesCount).toBe(3);
  });

  it("keeps the coarse-tier last when it has the newer sample", () => {
    const coarse = agg({
      last: 99,
      lastTs: new Date("2026-06-01T11:59:00.000Z"),
      sampleCount: 1,
    });
    const fine = agg({
      last: 5,
      lastTs: new Date("2026-06-01T11:00:00.000Z"),
      sampleCount: 1,
    });
    const combined = combineWindowAggregates({ parts: [coarse, fine], seriesCount: 1 });
    expect(combined.last).toBe(99);
  });

  it("treats null extrema as absent when only one tier has samples", () => {
    const coarse = agg({ min: null, max: null, last: null, lastTs: null });
    const fine = agg({ sampleCount: 2, sum: 6, min: 3, max: 3, last: 3, lastTs: new Date() });
    const combined = combineWindowAggregates({ parts: [coarse, fine], seriesCount: 1 });
    expect(combined.min).toBe(3);
    expect(combined.max).toBe(3);
    expect(combined.last).toBe(3);
  });
});
