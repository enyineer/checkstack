import { describe, expect, test } from "bun:test";
import {
  clampFraction,
  extentOf,
  layoutWaterfall,
  padRange,
  projectSeries,
  scaleLinear,
  semicircleGauge,
  summarizeRibbon,
  toAreaPaths,
  toPolylineSegments,
  type SeriesPoint,
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
