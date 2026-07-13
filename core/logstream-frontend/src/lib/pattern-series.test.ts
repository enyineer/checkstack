import { describe, it, expect } from "bun:test";
import type { PatternBucketPoint } from "@checkstack/logstream-common";
import { toPatternSeries, patternGrainSpanMs } from "./pattern-series";

const point = (
  bucketStart: string,
  count: number,
  patternId = "p1",
): PatternBucketPoint => ({
  bucketStart: new Date(bucketStart),
  patternId,
  count,
});

const at = (iso: string) => new Date(iso).getTime();

describe("toPatternSeries", () => {
  it("zero-fills every bucket of the window around the focal pattern's points", () => {
    const series = toPatternSeries({
      points: [
        point("2026-07-12T10:02:00Z", 5),
        point("2026-07-12T10:00:00Z", 2),
      ],
      patternId: "p1",
      grain: "minute",
      from: new Date("2026-07-12T09:59:00Z"),
      to: new Date("2026-07-12T10:03:00Z"),
    });

    expect(series).toEqual([
      { x: at("2026-07-12T09:59:00Z"), y: 0 },
      { x: at("2026-07-12T10:00:00Z"), y: 2 },
      { x: at("2026-07-12T10:01:00Z"), y: 0 },
      { x: at("2026-07-12T10:02:00Z"), y: 5 },
      { x: at("2026-07-12T10:03:00Z"), y: 0 },
    ]);
  });

  it("a single occurrence bucket still yields a multi-point series (polyline visibility regression)", () => {
    // REGRESSION: TimeSeriesChart renders polylines only, so a window whose
    // matches collapse into one bucket drew NOTHING (axis with no line).
    const series = toPatternSeries({
      points: [point("2026-07-12T10:00:00Z", 9)],
      patternId: "p1",
      grain: "hour",
      from: new Date("2026-07-11T10:30:00Z"),
      to: new Date("2026-07-12T10:30:00Z"),
    });

    expect(series.length).toBe(25); // 24h window at hour grain, inclusive
    expect(series.filter((p) => (p.y ?? 0) > 0)).toEqual([
      { x: at("2026-07-12T10:00:00Z"), y: 9 },
    ]);
    // Oldest-first and contiguous.
    expect(series[0]?.x).toBe(at("2026-07-11T10:00:00Z"));
    expect(series.at(-1)?.x).toBe(at("2026-07-12T10:00:00Z"));
  });

  it("keeps only the focal pattern's points, dropping other patterns", () => {
    const series = toPatternSeries({
      points: [
        point("2026-07-12T10:00:00Z", 2, "p1"),
        point("2026-07-12T10:00:00Z", 4, "p2"),
      ],
      patternId: "p1",
      grain: "minute",
      from: new Date("2026-07-12T10:00:00Z"),
      to: new Date("2026-07-12T10:01:00Z"),
    });

    expect(series).toEqual([
      { x: at("2026-07-12T10:00:00Z"), y: 2 },
      { x: at("2026-07-12T10:01:00Z"), y: 0 },
    ]);
  });

  it("returns all-zero buckets when nothing matches (caller shows the empty state)", () => {
    const series = toPatternSeries({
      points: [point("2026-07-12T10:00:00Z", 3, "other")],
      patternId: "p1",
      grain: "minute",
      from: new Date("2026-07-12T10:00:00Z"),
      to: new Date("2026-07-12T10:02:00Z"),
    });
    expect(series.every((p) => p.y === 0)).toBe(true);
    expect(series.length).toBe(3);
  });

  it("falls back to sparse points beyond the fill cap", () => {
    // A pathological window (minute grain over 30 days = 43k buckets) must not
    // build a huge array; sparse sorted points come back instead.
    const series = toPatternSeries({
      points: [
        point("2026-07-12T10:01:00Z", 3),
        point("2026-07-12T10:00:00Z", 1),
      ],
      patternId: "p1",
      grain: "minute",
      from: new Date("2026-06-12T00:00:00Z"),
      to: new Date("2026-07-12T10:30:00Z"),
    });
    expect(series).toEqual([
      { x: at("2026-07-12T10:00:00Z"), y: 1 },
      { x: at("2026-07-12T10:01:00Z"), y: 3 },
    ]);
  });
});

describe("patternGrainSpanMs", () => {
  it("returns the bucket width per grain", () => {
    expect(patternGrainSpanMs("minute")).toBe(60_000);
    expect(patternGrainSpanMs("hour")).toBe(3_600_000);
  });
});
