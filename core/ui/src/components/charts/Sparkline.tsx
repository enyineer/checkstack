import React, { useMemo } from "react";
import { cn } from "../../utils";
import {
  extentOf,
  padRange,
  projectSeries,
  toPolylineSegments,
  type Range,
  type SeriesPoint,
} from "./chart-math";

/** Token tone for the sparkline stroke. */
export type SparklineTone = "primary" | "ok" | "warn" | "down" | "muted";

const toneStroke: Record<SparklineTone, string> = {
  primary: "hsl(var(--primary))",
  ok: "hsl(var(--status-ok))",
  warn: "hsl(var(--status-warn))",
  down: "hsl(var(--status-down))",
  muted: "hsl(var(--muted-foreground))",
};

export interface SparklineProps {
  /**
   * Y values, oldest first. Nulls draw a gap. Accepts a bare number array for
   * the common case, or `SeriesPoint`s when x spacing is uneven.
   */
  values: ReadonlyArray<number | null> | ReadonlyArray<SeriesPoint>;
  /**
   * Optional FIXED y-domain shared across a row of small-multiples, so two
   * sparklines are directly comparable. When omitted, each sparkline
   * auto-scales to its own extent (and is NOT comparable across cells).
   */
  domain?: Range;
  /** Token tone of the line. Defaults to `primary`. */
  tone?: SparklineTone;
  /** Width in px. Defaults to 96 (word-sized). */
  width?: number;
  /** Height in px. Defaults to the `--d-spark-h` density token. */
  height?: number;
  /** Stroke width in px. Defaults to 1.6. */
  strokeWidth?: number;
  /** Accessible label. Required so the trend isn't conveyed by color alone. */
  ariaLabel: string;
  className?: string;
}

function normalize(
  values: SparklineProps["values"],
): ReadonlyArray<SeriesPoint> {
  if (values.length === 0) return [];
  const first = values[0];
  if (typeof first === "number" || first === null) {
    return (values as ReadonlyArray<number | null>).map((y, i) => ({ x: i, y }));
  }
  return values as ReadonlyArray<SeriesPoint>;
}

/**
 * Word-sized, fixed-scale line sparkline - an upgrade of the per-run status
 * square. Pass a shared `domain` to make a column of sparklines a true
 * small-multiple (same y-scale => comparable heights). Token-driven; the trend
 * is mirrored in `ariaLabel` so it's never conveyed by color alone.
 *
 * Honest straight segments (no spline), drawn from the `calm-premium` and
 * `pro-console` KPI-rail / per-system sparklines.
 */
export const Sparkline: React.FC<SparklineProps> = ({
  values,
  domain,
  tone = "primary",
  width = 96,
  height,
  strokeWidth = 1.6,
  ariaLabel,
  className,
}) => {
  const points = useMemo(() => normalize(values), [values]);

  const segments = useMemo(() => {
    if (points.length === 0) return [];
    const last = points.at(-1);
    if (last === undefined) return [];
    const xDomain: Range = {
      min: points[0].x,
      max: last.x,
    };
    const yRaw = domain ?? extentOf({ series: [points] });
    if (yRaw === null) return [];
    const yDomain = domain ?? padRange({ range: yRaw, fraction: 0.15 });
    const box = { left: 1, top: 1, width: width - 2, height: 100 - 2 };
    const projected = projectSeries({ points, xDomain, yDomain, box });
    return toPolylineSegments({ projected });
  }, [points, domain, width]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} 100`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className={cn("inline-block align-middle", className)}
      style={height === undefined ? { height: "var(--d-spark-h)" } : undefined}
    >
      {segments.map((p, i) => (
        <polyline
          key={i}
          points={p}
          fill="none"
          stroke={toneStroke[tone]}
          strokeWidth={(strokeWidth * 100) / Math.max(1, height ?? 28)}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
};
