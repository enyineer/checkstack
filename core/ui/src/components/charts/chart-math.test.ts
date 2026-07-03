import { describe, expect, test } from "bun:test";
import {
  bandIndexAtX,
  clampFraction,
  computeDelta,
  deltaSentiment,
  downsampleStacked,
  extentOf,
  layoutDistribution,
  layoutWaterfall,
  padRange,
  nearestIndexByFraction,
  pickTickFormat,
  pointIndexAtX,
  projectSeries,
  scaleLinear,
  semicircleGauge,
  stackFractions,
  summarizeCategories,
  summarizeRibbon,
  toAreaPaths,
  toPolylineSegments,
  type SeriesPoint,
  type StackedBucket,
} from "./chart-math";

describe("extentOf", () => {
  test("returns min/max ignoring nulls and non-finite", () => {
    const series: SeriesPoint[][] = [
      [
        { x: 0, y: 10 },
        { x: 1, y: null },
        { x: 2, y: 30 },
      ],
      [{ x: 0, y: 5 }],
    ];
    expect(extentOf({ series })).toEqual({ min: 5, max: 30 });
  });

  test("returns null when no finite values", () => {
    expect(extentOf({ series: [[{ x: 0, y: null }]] })).toBeNull();
    expect(extentOf({ series: [] })).toBeNull();
  });

  test("includeZero pulls the floor down to zero", () => {
    expect(
      extentOf({ series: [[{ x: 0, y: 10 }, { x: 1, y: 30 }]], includeZero: true }),
    ).toEqual({ min: 0, max: 30 });
  });
});

describe("padRange", () => {
  test("pads by fraction of span", () => {
    expect(padRange({ range: { min: 0, max: 100 }, fraction: 0.1 })).toEqual({
      min: -10,
      max: 110,
    });
  });

  test("zero span still produces a usable range", () => {
    const r = padRange({ range: { min: 50, max: 50 } });
    expect(r.min).toBeLessThan(50);
    expect(r.max).toBeGreaterThan(50);
  });

  test("clampMinToZero never goes negative", () => {
    expect(
      padRange({ range: { min: 5, max: 100 }, fraction: 0.5, clampMinToZero: true }).min,
    ).toBe(0);
  });
});

describe("scaleLinear", () => {
  test("maps domain to range linearly", () => {
    const args = { domain: { min: 0, max: 10 }, range: { min: 0, max: 100 } };
    expect(scaleLinear({ value: 0, ...args })).toBe(0);
    expect(scaleLinear({ value: 5, ...args })).toBe(50);
    expect(scaleLinear({ value: 10, ...args })).toBe(100);
  });

  test("zero-width domain maps to range midpoint", () => {
    expect(
      scaleLinear({ value: 5, domain: { min: 5, max: 5 }, range: { min: 0, max: 80 } }),
    ).toBe(40);
  });
});

describe("projectSeries", () => {
  const box = { left: 0, top: 0, width: 100, height: 100 };
  const xDomain = { min: 0, max: 10 };
  const yDomain = { min: 0, max: 100 };

  test("flips Y so larger values sit higher (smaller cy)", () => {
    const out = projectSeries({
      points: [
        { x: 0, y: 100 },
        { x: 10, y: 0 },
      ],
      xDomain,
      yDomain,
      box,
    });
    expect(out[0]).toEqual({ cx: 0, cy: 0 });
    expect(out[1]).toEqual({ cx: 100, cy: 100 });
  });

  test("null values project to null", () => {
    const out = projectSeries({
      points: [{ x: 5, y: null }],
      xDomain,
      yDomain,
      box,
    });
    expect(out[0]).toBeNull();
  });
});

describe("toPolylineSegments", () => {
  test("breaks into separate segments at gaps", () => {
    const segs = toPolylineSegments({
      projected: [
        { cx: 0, cy: 0 },
        { cx: 1, cy: 1 },
        null,
        { cx: 2, cy: 2 },
      ],
    });
    expect(segs).toEqual(["0,0 1,1", "2,2"]);
  });

  test("uses straight segments only (no extra control points injected)", () => {
    const segs = toPolylineSegments({
      projected: [
        { cx: 0, cy: 10 },
        { cx: 5, cy: 0 },
        { cx: 10, cy: 10 },
      ],
    });
    // Exactly the three raw vertices, in order: honest, not smoothed.
    expect(segs).toEqual(["0,10 5,0 10,10"]);
  });
});

describe("toAreaPaths", () => {
  test("closes each contiguous run down to the baseline", () => {
    const paths = toAreaPaths({
      projected: [
        { cx: 0, cy: 10 },
        { cx: 10, cy: 20 },
      ],
      baselineY: 100,
    });
    expect(paths).toEqual(["M0,100 L0,10 L10,20 L10,100 Z"]);
  });

  test("produces one path per run separated by a gap", () => {
    const paths = toAreaPaths({
      projected: [{ cx: 0, cy: 5 }, null, { cx: 10, cy: 5 }],
      baselineY: 50,
    });
    expect(paths.length).toBe(2);
  });
});

describe("layoutWaterfall", () => {
  test("positions phases cumulatively on a shared scale", () => {
    const { phases, totalMs, slowestId } = layoutWaterfall({
      phases: [
        { id: "dns", label: "DNS", durationMs: 12 },
        { id: "tcp", label: "TCP", durationMs: 38 },
        { id: "wait", label: "Wait", durationMs: 250 },
      ],
    });
    expect(totalMs).toBe(300);
    expect(slowestId).toBe("wait");
    expect(phases[0].startMs).toBe(0);
    expect(phases[1].startMs).toBe(12);
    expect(phases[2].startMs).toBe(50);
    expect(phases[2].widthFraction).toBeCloseTo(250 / 300, 5);
    expect(phases[2].isSlowest).toBe(true);
    expect(phases[0].isSlowest).toBe(false);
  });

  test("the slowest phase is literally the widest fraction", () => {
    const { phases } = layoutWaterfall({
      phases: [
        { id: "a", label: "A", durationMs: 10 },
        { id: "b", label: "B", durationMs: 90 },
      ],
    });
    const widest = phases.toSorted((x, y) => y.widthFraction - x.widthFraction)[0];
    expect(widest.isSlowest).toBe(true);
  });

  test("clamps negative durations to zero and tolerates an all-zero total", () => {
    const { totalMs, slowestId, phases } = layoutWaterfall({
      phases: [
        { id: "a", label: "A", durationMs: -5 },
        { id: "b", label: "B", durationMs: 0 },
      ],
    });
    expect(totalMs).toBe(0);
    expect(slowestId).toBeNull();
    expect(phases.every((p) => p.widthFraction === 0 && !p.isSlowest)).toBe(true);
  });
});

describe("summarizeRibbon", () => {
  test("tallies by status and computes uptime excluding unknown", () => {
    const s = summarizeRibbon({
      cells: [
        { id: "1", status: "ok" },
        { id: "2", status: "ok" },
        { id: "3", status: "down" },
        { id: "4", status: "unknown" },
      ],
    });
    expect(s).toEqual({
      total: 4,
      ok: 2,
      warn: 0,
      down: 1,
      unknown: 1,
      uptimeFraction: 2 / 3,
    });
  });

  test("empty / all-unknown ribbon reads as 100% uptime", () => {
    expect(summarizeRibbon({ cells: [] }).uptimeFraction).toBe(1);
    expect(
      summarizeRibbon({ cells: [{ id: "1", status: "unknown" }] }).uptimeFraction,
    ).toBe(1);
  });
});

describe("clampFraction", () => {
  test("clamps to [0,1] and rejects non-finite", () => {
    expect(clampFraction(-0.5)).toBe(0);
    expect(clampFraction(1.5)).toBe(1);
    expect(clampFraction(0.42)).toBe(0.42);
    expect(clampFraction(Number.NaN)).toBe(0);
  });
});

describe("downsampleStacked", () => {
  const bucket = (
    start: number,
    end: number,
    counts: StackedBucket["counts"],
  ): StackedBucket => ({ start, end, counts });

  test("passes buckets through when under the cap, adding totals", () => {
    const out = downsampleStacked({
      buckets: [
        bucket(0, 10, { ok: 3, down: 1 }),
        bucket(10, 20, { warn: 2 }),
      ],
      maxBars: 60,
    });
    expect(out).toEqual([
      { start: 0, end: 10, counts: { ok: 3, down: 1 }, total: 4 },
      { start: 10, end: 20, counts: { warn: 2 }, total: 2 },
    ]);
  });

  test("groups adjacent buckets, summing per-tone counts and spanning start/end", () => {
    // 4 buckets into max 2 bars => groups of 2.
    const out = downsampleStacked({
      buckets: [
        bucket(0, 10, { ok: 1 }),
        bucket(10, 20, { ok: 2, down: 1 }),
        bucket(20, 30, { warn: 4 }),
        bucket(30, 40, { ok: 1, warn: 1 }),
      ],
      maxBars: 2,
    });
    expect(out).toEqual([
      { start: 0, end: 20, counts: { ok: 3, down: 1 }, total: 4 },
      { start: 20, end: 40, counts: { ok: 1, warn: 5 }, total: 6 },
    ]);
  });

  test("uneven trailing group keeps its own span", () => {
    // 3 buckets into max 2 bars => group size ceil(3/2)=2, so groups of 2 + 1.
    const out = downsampleStacked({
      buckets: [
        bucket(0, 10, { ok: 1 }),
        bucket(10, 20, { ok: 1 }),
        bucket(20, 30, { down: 1 }),
      ],
      maxBars: 2,
    });
    expect(out.length).toBe(2);
    expect(out[1]).toEqual({ start: 20, end: 30, counts: { down: 1 }, total: 1 });
  });

  test("empty input yields empty output", () => {
    expect(downsampleStacked({ buckets: [], maxBars: 10 })).toEqual([]);
  });

  test("ignores negative and non-finite counts", () => {
    const out = downsampleStacked({
      buckets: [bucket(0, 10, { ok: -3, down: Number.NaN, warn: 2 })],
      maxBars: 10,
    });
    expect(out[0].counts).toEqual({ warn: 2 });
    expect(out[0].total).toBe(2);
  });
});

describe("stackFractions", () => {
  test("stacks tones bottom-up in the given order as cumulative fractions", () => {
    const out = stackFractions({
      counts: { ok: 3, warn: 1, down: 0, unknown: 0 },
    });
    // ok occupies [0, 0.75), warn [0.75, 1); zero-count tones are omitted.
    expect(out).toEqual([
      { tone: "ok", y0: 0, y1: 0.75 },
      { tone: "warn", y0: 0.75, y1: 1 },
    ]);
  });

  test("respects a custom order", () => {
    const out = stackFractions({
      counts: { ok: 1, down: 1 },
      order: ["down", "ok"],
    });
    expect(out[0].tone).toBe("down");
    expect(out[0].y1).toBeCloseTo(0.5, 5);
    expect(out[1].tone).toBe("ok");
  });

  test("all-zero counts yield no segments", () => {
    expect(stackFractions({ counts: { ok: 0 } })).toEqual([]);
    expect(stackFractions({ counts: {} })).toEqual([]);
  });
});

describe("pickTickFormat", () => {
  test("daily and coarser buckets show the date only", () => {
    expect(pickTickFormat({ intervalSeconds: 86_400 })).toBe("MMM d");
    expect(pickTickFormat({ intervalSeconds: 7 * 86_400 })).toBe("MMM d");
  });

  test("hourly buckets show date and time", () => {
    expect(pickTickFormat({ intervalSeconds: 3600 })).toBe("MMM d HH:mm");
  });

  test("sub-hourly buckets show time only", () => {
    expect(pickTickFormat({ intervalSeconds: 300 })).toBe("HH:mm");
  });
});

describe("bandIndexAtX", () => {
  test("maps an x position to its band index", () => {
    expect(bandIndexAtX({ x: 0, width: 100, count: 4 })).toBe(0);
    expect(bandIndexAtX({ x: 30, width: 100, count: 4 })).toBe(1);
    expect(bandIndexAtX({ x: 99, width: 100, count: 4 })).toBe(3);
  });

  test("clamps the right edge into the last band", () => {
    expect(bandIndexAtX({ x: 100, width: 100, count: 4 })).toBe(3);
  });

  test("returns null outside the plot or with no bands", () => {
    expect(bandIndexAtX({ x: -1, width: 100, count: 4 })).toBeNull();
    expect(bandIndexAtX({ x: 101, width: 100, count: 4 })).toBeNull();
    expect(bandIndexAtX({ x: 10, width: 100, count: 0 })).toBeNull();
    expect(bandIndexAtX({ x: 10, width: 0, count: 4 })).toBeNull();
  });
});

describe("pointIndexAtX", () => {
  test("snaps to the nearest point (edges are points, not bands)", () => {
    // 3 points across 100px sit at x = 0, 50, 100.
    expect(pointIndexAtX({ x: 0, width: 100, count: 3 })).toBe(0);
    expect(pointIndexAtX({ x: 24, width: 100, count: 3 })).toBe(0);
    expect(pointIndexAtX({ x: 26, width: 100, count: 3 })).toBe(1);
    expect(pointIndexAtX({ x: 100, width: 100, count: 3 })).toBe(2);
  });

  test("a single point owns the whole plot", () => {
    expect(pointIndexAtX({ x: 80, width: 100, count: 1 })).toBe(0);
  });

  test("returns null outside the plot or with no points", () => {
    expect(pointIndexAtX({ x: -1, width: 100, count: 3 })).toBeNull();
    expect(pointIndexAtX({ x: 101, width: 100, count: 3 })).toBeNull();
    expect(pointIndexAtX({ x: 50, width: 100, count: 0 })).toBeNull();
  });
});

describe("nearestIndexByFraction", () => {
  test("snaps to the nearest ACTUAL position, not an even-spacing assumption", () => {
    // Three points bunched left plus one far right (a data gap in between).
    const positions = [0.05, 0.1, 0.15, 0.95];
    expect(nearestIndexByFraction({ fraction: 0.12, positions })).toBe(1);
    // Deep inside the gap, the far-right point is still the nearest.
    expect(nearestIndexByFraction({ fraction: 0.7, positions })).toBe(3);
    expect(nearestIndexByFraction({ fraction: 0.3, positions })).toBe(2);
  });

  test("skips null gap entries", () => {
    expect(
      nearestIndexByFraction({ fraction: 0.5, positions: [0.4, null, 0.6] }),
    ).toBe(0);
    expect(
      nearestIndexByFraction({ fraction: 0.55, positions: [0.4, null, 0.6] }),
    ).toBe(2);
  });

  test("returns null when nothing is hoverable", () => {
    expect(nearestIndexByFraction({ fraction: 0.5, positions: [] })).toBeNull();
    expect(
      nearestIndexByFraction({ fraction: 0.5, positions: [null, null] }),
    ).toBeNull();
  });
});

describe("layoutDistribution", () => {
  test("sorts by value descending and computes fractions and offsets", () => {
    const { slices, total } = layoutDistribution({
      slices: [
        { id: "404", label: "404", value: 1 },
        { id: "200", label: "200", value: 3 },
      ],
    });
    expect(total).toBe(4);
    expect(slices[0]).toEqual({
      id: "200",
      label: "200",
      value: 3,
      fraction: 0.75,
      leftFraction: 0,
    });
    expect(slices[1]).toEqual({
      id: "404",
      label: "404",
      value: 1,
      fraction: 0.25,
      leftFraction: 0.75,
    });
  });

  test("rolls the long tail into an Other slice past maxSlices", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      label: `S${i}`,
      value: 10 - i,
    }));
    const { slices } = layoutDistribution({ slices: many, maxSlices: 4 });
    expect(slices.length).toBe(4);
    const other = slices.at(-1);
    expect(other?.id).toBe("__other");
    // Other = the 3 smallest values: 7 + 6 + 5 = 18.
    expect(other?.value).toBe(18);
    expect(other?.label).toBe("Other");
  });

  test("drops non-positive and non-finite values", () => {
    const { slices, total } = layoutDistribution({
      slices: [
        { id: "a", label: "A", value: 2 },
        { id: "b", label: "B", value: 0 },
        { id: "c", label: "C", value: -1 },
        { id: "d", label: "D", value: Number.NaN },
      ],
    });
    expect(slices.map((s) => s.id)).toEqual(["a"]);
    expect(total).toBe(2);
  });

  test("empty input yields an empty layout", () => {
    expect(layoutDistribution({ slices: [] })).toEqual({ slices: [], total: 0 });
  });
});

describe("summarizeCategories", () => {
  test("counts by category and finds the dominant one", () => {
    const { dominant, counts, total } = summarizeCategories({
      cells: [
        { id: "1", category: "primary" },
        { id: "2", category: "primary" },
        { id: "3", category: "replica" },
      ],
    });
    expect(dominant).toBe("primary");
    expect(counts).toEqual({ primary: 2, replica: 1 });
    expect(total).toBe(3);
  });

  test("empty cells yield null dominant", () => {
    expect(summarizeCategories({ cells: [] })).toEqual({
      dominant: null,
      counts: {},
      total: 0,
    });
  });

  test("first-seen category wins ties for stability", () => {
    const { dominant } = summarizeCategories({
      cells: [
        { id: "1", category: "b" },
        { id: "2", category: "a" },
      ],
    });
    expect(dominant).toBe("b");
  });
});

describe("computeDelta", () => {
  test("computes direction, absolute, and relative change", () => {
    expect(computeDelta({ previous: 100, current: 150 })).toEqual({
      direction: "up",
      absolute: 50,
      relative: 0.5,
    });
    expect(computeDelta({ previous: 100, current: 75 })).toEqual({
      direction: "down",
      absolute: 25,
      relative: 0.25,
    });
  });

  test("equal values are flat", () => {
    expect(computeDelta({ previous: 5, current: 5 })).toEqual({
      direction: "flat",
      absolute: 0,
      relative: 0,
    });
  });

  test("zero previous yields null relative but a real direction", () => {
    expect(computeDelta({ previous: 0, current: 3 })).toEqual({
      direction: "up",
      absolute: 3,
      relative: null,
    });
  });

  test("missing values yield null", () => {
    expect(computeDelta({ previous: null, current: 3 })).toBeNull();
    expect(computeDelta({ previous: 3, current: null })).toBeNull();
    expect(computeDelta({ previous: Number.NaN, current: 3 })).toBeNull();
  });
});

describe("deltaSentiment", () => {
  test("matches direction against goodDirection", () => {
    expect(deltaSentiment({ direction: "up", goodDirection: "up" })).toBe("good");
    expect(deltaSentiment({ direction: "down", goodDirection: "up" })).toBe("bad");
    expect(deltaSentiment({ direction: "up", goodDirection: "down" })).toBe("bad");
    expect(deltaSentiment({ direction: "down", goodDirection: "down" })).toBe(
      "good",
    );
  });

  test("flat or unknown goodness is neutral", () => {
    expect(deltaSentiment({ direction: "flat", goodDirection: "up" })).toBe(
      "neutral",
    );
    expect(deltaSentiment({ direction: "up" })).toBe("neutral");
  });
});

describe("semicircleGauge", () => {
  test("dashOffset reveals the right portion of the arc", () => {
    const g = semicircleGauge({ width: 200, height: 100, strokeWidth: 10, fraction: 0.5 });
    expect(g.dashOffset).toBeCloseTo(g.arcLength * 0.5, 5);
    expect(g.centerX).toBe(100);
  });

  test("full and empty extremes", () => {
    const full = semicircleGauge({ width: 200, height: 100, strokeWidth: 10, fraction: 1 });
    expect(full.dashOffset).toBeCloseTo(0, 5);
    const empty = semicircleGauge({ width: 200, height: 100, strokeWidth: 10, fraction: 0 });
    expect(empty.dashOffset).toBeCloseTo(empty.arcLength, 5);
  });

  test("arc path starts at the left endpoint and sweeps to the right", () => {
    const g = semicircleGauge({ width: 200, height: 100, strokeWidth: 20, fraction: 1 });
    // radius = min(100, 100) - 10 = 90; start x = 100 - 90 = 10
    expect(g.trackPath.startsWith("M10 100 A90 90 0 0 1 190 100")).toBe(true);
  });
});
