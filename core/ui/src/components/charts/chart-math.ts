/**
 * Pure geometry/scale helpers shared by the chart primitives.
 *
 * These are deliberately framework-free and side-effect-free so they can be
 * unit-tested in isolation (see `chart-math.test.ts`). The components keep all
 * SVG/DOM concerns; everything numeric lives here.
 */

/** A single point in a time series (x is a millisecond timestamp). */
export interface SeriesPoint {
  /** Millisecond epoch timestamp. */
  x: number;
  /** The value at this point (e.g. latency in ms). May be null for a gap. */
  y: number | null;
}

/** Inclusive numeric range. */
export interface Range {
  min: number;
  max: number;
}

/** Pixel rect the plot is drawn into (inside any axis gutters). */
export interface PlotBox {
  /** Left edge in viewBox units. */
  left: number;
  /** Top edge in viewBox units. */
  top: number;
  /** Plot width in viewBox units. */
  width: number;
  /** Plot height in viewBox units. */
  height: number;
}

/**
 * Compute the inclusive numeric extent of a set of series, ignoring nulls.
 * Returns `null` when there is no finite value to scale against.
 */
export function extentOf({
  series,
  includeZero = false,
}: {
  series: ReadonlyArray<ReadonlyArray<SeriesPoint>>;
  includeZero?: boolean;
}): Range | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const points of series) {
    for (const p of points) {
      if (p.y === null || !Number.isFinite(p.y)) continue;
      if (p.y < min) min = p.y;
      if (p.y > max) max = p.y;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return { min, max };
}

/**
 * Pad a range by a fraction of its span so the top/bottom lines don't kiss the
 * plot edges. A zero-span range (all equal values) is given a unit pad so it
 * still renders as a centered flat line rather than collapsing.
 */
export function padRange({
  range,
  fraction = 0.08,
  clampMinToZero = false,
}: {
  range: Range;
  fraction?: number;
  clampMinToZero?: boolean;
}): Range {
  const span = range.max - range.min;
  const pad = span === 0 ? Math.abs(range.max) || 1 : span * fraction;
  let min = range.min - pad;
  const max = range.max + pad;
  if (clampMinToZero && min < 0) min = 0;
  return { min, max };
}

/**
 * Map a data value within `domain` to a pixel position within `range`.
 * Linear; a zero-width domain maps everything to the range midpoint.
 */
export function scaleLinear({
  value,
  domain,
  range,
}: {
  value: number;
  domain: Range;
  range: Range;
}): number {
  const dSpan = domain.max - domain.min;
  if (dSpan === 0) return (range.min + range.max) / 2;
  const t = (value - domain.min) / dSpan;
  return range.min + t * (range.max - range.min);
}

/**
 * Project a time series into viewBox coordinates. Y is flipped (SVG origin is
 * top-left, so larger values sit higher / smaller `y`). Null points become
 * `null` entries so callers can break the line into segments at gaps.
 */
export function projectSeries({
  points,
  xDomain,
  yDomain,
  box,
}: {
  points: ReadonlyArray<SeriesPoint>;
  xDomain: Range;
  yDomain: Range;
  box: PlotBox;
}): Array<{ cx: number; cy: number } | null> {
  const xRange: Range = { min: box.left, max: box.left + box.width };
  // Flip Y: domain.min -> bottom of box, domain.max -> top of box.
  const yRange: Range = { min: box.top + box.height, max: box.top };
  return points.map((p) => {
    if (p.y === null || !Number.isFinite(p.y)) return null;
    return {
      cx: scaleLinear({ value: p.x, domain: xDomain, range: xRange }),
      cy: scaleLinear({ value: p.y, domain: yDomain, range: yRange }),
    };
  });
}

/**
 * Build a straight-segment (NOT smoothed) polyline `points` attribute from
 * projected coordinates, breaking the string into one entry per contiguous run
 * so gaps (nulls) don't draw a false connecting line. Each returned string is a
 * ready-to-use `points=""` value.
 *
 * Honesty rule: this never interpolates a spline. Raw buckets are connected by
 * literal straight segments so a spike reads as a spike.
 */
export function toPolylineSegments({
  projected,
}: {
  projected: ReadonlyArray<{ cx: number; cy: number } | null>;
}): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  for (const p of projected) {
    if (p === null) {
      if (current.length > 0) {
        segments.push(current.join(" "));
        current = [];
      }
      continue;
    }
    current.push(`${round(p.cx)},${round(p.cy)}`);
  }
  if (current.length > 0) segments.push(current.join(" "));
  return segments;
}

/**
 * Build a closed area path (`d` attribute) under a projected line down to the
 * baseline `y`. Only contiguous (non-null) runs are filled. Returns one `d`
 * string per run.
 */
export function toAreaPaths({
  projected,
  baselineY,
}: {
  projected: ReadonlyArray<{ cx: number; cy: number } | null>;
  baselineY: number;
}): string[] {
  const paths: string[] = [];
  let run: Array<{ cx: number; cy: number }> = [];
  const flush = () => {
    const first = run[0];
    const last = run.at(-1);
    if (first === undefined || last === undefined) return;
    const top = run.map((p) => `L${round(p.cx)},${round(p.cy)}`).join(" ");
    paths.push(
      `M${round(first.cx)},${round(baselineY)} ${top} L${round(last.cx)},${round(baselineY)} Z`,
    );
    run = [];
  };
  for (const p of projected) {
    if (p === null) {
      flush();
      continue;
    }
    run.push(p);
  }
  flush();
  return paths;
}

/** One phase of a request timing waterfall (e.g. DNS, TCP, TLS). */
export interface WaterfallPhase {
  /** Stable id (also used for keys). */
  id: string;
  /** Human label, e.g. "DNS". */
  label: string;
  /** Duration in milliseconds (>= 0). */
  durationMs: number;
}

/** A phase positioned on the shared cumulative timeline. */
export interface LaidOutPhase extends WaterfallPhase {
  /** Cumulative start offset in ms (sum of prior phase durations). */
  startMs: number;
  /** Left as a fraction [0,1] of the total. */
  leftFraction: number;
  /** Width as a fraction [0,1] of the total. */
  widthFraction: number;
  /** True when this is the single slowest phase (the bottleneck). */
  isSlowest: boolean;
}

/** Result of laying out a request waterfall. */
export interface WaterfallLayout {
  phases: LaidOutPhase[];
  totalMs: number;
  /** Id of the slowest phase, or null when there are no positive phases. */
  slowestId: string | null;
}

/**
 * Lay phases end-to-end on one SHARED length scale (fraction of the total), so
 * the longest bar is literally the bottleneck. The slowest positive phase is
 * flagged. Non-positive phases keep a zero width but still occupy their slot.
 */
export function layoutWaterfall({
  phases,
}: {
  phases: ReadonlyArray<WaterfallPhase>;
}): WaterfallLayout {
  const totalMs = phases.reduce(
    (sum, p) => sum + Math.max(0, p.durationMs),
    0,
  );
  let slowestId: string | null = null;
  let slowestDur = 0;
  for (const p of phases) {
    const d = Math.max(0, p.durationMs);
    if (d > slowestDur) {
      slowestDur = d;
      slowestId = p.id;
    }
  }
  let cursor = 0;
  const laidOut: LaidOutPhase[] = phases.map((p) => {
    const dur = Math.max(0, p.durationMs);
    const startMs = cursor;
    cursor += dur;
    return {
      ...p,
      durationMs: dur,
      startMs,
      leftFraction: totalMs === 0 ? 0 : startMs / totalMs,
      widthFraction: totalMs === 0 ? 0 : dur / totalMs,
      isSlowest: slowestDur > 0 && p.id === slowestId,
    };
  });
  return { phases: laidOut, totalMs, slowestId: slowestDur > 0 ? slowestId : null };
}

/** Discrete status used by the uptime ribbon, sparkline status mode, etc. */
export type RibbonStatus = "ok" | "warn" | "down" | "unknown";

/** One cell of an uptime ribbon (a day or a run). */
export interface RibbonCell {
  /** Stable id (also used for keys). */
  id: string;
  status: RibbonStatus;
  /** Optional human label for the tooltip / aria description. */
  label?: string;
}

/** Tally of ribbon cells by status, for the aria summary. */
export interface RibbonSummary {
  total: number;
  ok: number;
  warn: number;
  down: number;
  unknown: number;
  /** Uptime as a fraction [0,1]: ok / (total - unknown), or 1 when empty. */
  uptimeFraction: number;
}

/** Summarize ribbon cells for an accessible text alternative. */
export function summarizeRibbon({
  cells,
}: {
  cells: ReadonlyArray<RibbonCell>;
}): RibbonSummary {
  let ok = 0;
  let warn = 0;
  let down = 0;
  let unknown = 0;
  for (const c of cells) {
    switch (c.status) {
      case "ok": {
        ok += 1;
        break;
      }
      case "warn": {
        warn += 1;
        break;
      }
      case "down": {
        down += 1;
        break;
      }
      default: {
        unknown += 1;
      }
    }
  }
  const measured = cells.length - unknown;
  const uptimeFraction = measured <= 0 ? 1 : ok / measured;
  return { total: cells.length, ok, warn, down, unknown, uptimeFraction };
}

/**
 * Clamp a 0..1 fraction. Used by the gauge so a 99.99% or a buggy 120% value
 * never overdraws the arc.
 */
export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Geometry for a semicircular gauge arc spanning 180deg (left to right).
 * Returns the SVG path `d` for the full track and the `strokeDasharray` /
 * `strokeDashoffset` pair that reveals `fraction` of the arc.
 */
export interface GaugeArc {
  /** Path `d` for the 180deg track (and the value arc shares the same path). */
  trackPath: string;
  /** Total arc length, used as the dash array. */
  arcLength: number;
  /** Dash offset that reveals exactly `fraction` of the arc. */
  dashOffset: number;
  /** Center x of the arc, for placing the number. */
  centerX: number;
  /** Baseline y of the arc endpoints. */
  baselineY: number;
}

export function semicircleGauge({
  width,
  height,
  strokeWidth,
  fraction,
}: {
  width: number;
  height: number;
  strokeWidth: number;
  fraction: number;
}): GaugeArc {
  const r = Math.min(width / 2, height) - strokeWidth / 2;
  const cx = width / 2;
  const cy = height;
  const startX = cx - r;
  const endX = cx + r;
  const trackPath = `M${round(startX)} ${round(cy)} A${round(r)} ${round(r)} 0 0 1 ${round(endX)} ${round(cy)}`;
  const arcLength = Math.PI * r;
  const f = clampFraction(fraction);
  return {
    trackPath,
    arcLength,
    dashOffset: arcLength * (1 - f),
    centerX: cx,
    baselineY: cy,
  };
}

/** Round to 2 decimals to keep SVG path strings compact and stable. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
