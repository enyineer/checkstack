import React, { useId, useMemo } from "react";
import { cn } from "../../utils";
import {
  extentOf,
  padRange,
  projectSeries,
  scaleLinear,
  toAreaPaths,
  toPolylineSegments,
  type Range,
  type SeriesPoint,
} from "./chart-math";

/** A named series rendered on the chart. */
export interface TimeSeries {
  /** Stable id, used for keys + the gradient id. */
  id: string;
  /** Human label for the accessible description + legend. */
  label: string;
  /** Points, oldest first. Nulls draw a gap (no false connecting line). */
  points: ReadonlyArray<SeriesPoint>;
}

/** An optional shaded "healthy band" welded to the y-axis. */
export interface HealthyBand {
  /** Lower bound of the band in data units. */
  from: number;
  /** Upper bound of the band in data units. */
  to: number;
}

/** A dashed horizontal reference line, e.g. an SLO target. */
export interface ReferenceLineSpec {
  /** Y value in data units. */
  value: number;
  /** Short label drawn at the right edge. */
  label?: string;
  /** Token tone of the line. Defaults to `warn`. */
  tone?: "warn" | "down" | "muted";
}

export interface TimeSeriesChartProps {
  /**
   * The focal series (p50): drawn as a filled area + solid line using the
   * aurora gradient. This is the single "eye-candy" series per the spec.
   */
  primary: TimeSeries;
  /**
   * Optional secondary series (p95): drawn as a dashed line only (no fill), so
   * the layering reads p50-area under a p95 envelope.
   */
  secondary?: TimeSeries;
  /** Optional shaded healthy band. */
  healthyBand?: HealthyBand;
  /** Optional dashed reference line (SLO target). */
  referenceLine?: ReferenceLineSpec;
  /** Format a y value for the axis ticks. Defaults to the raw number. */
  formatY?: (value: number) => string;
  /** Number of horizontal gridlines / y ticks. Defaults to 4. */
  yTicks?: number;
  /** Force the y-axis floor to zero. Defaults to true (latency-style charts). */
  zeroFloor?: boolean;
  /** Pixel height. Width is always responsive (100%). Defaults to 220. */
  height?: number;
  /** Accessible label. Falls back to a generated summary. */
  ariaLabel?: string;
  className?: string;
}

const VIEW_W = 720;
const AXIS_GUTTER = 44;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

const toneVar: Record<NonNullable<ReferenceLineSpec["tone"]>, string> = {
  warn: "var(--warning)",
  down: "var(--destructive)",
  muted: "var(--muted-foreground)",
};

/**
 * Honest time-series chart: a p50 aurora-gradient area + line layered under an
 * optional dashed p95 envelope, with low-contrast gridlines, an optional shaded
 * healthy band and a dashed SLO reference line. Token-driven, light/dark, and
 * responsive in width.
 *
 * Honesty: every series is drawn with literal straight segments between raw
 * buckets (no `monotone` spline), so a spike reads as a spike. Smoothing is
 * never applied here; aggregate-only smoothing belongs upstream in the data.
 *
 * Drawn from `reviews/design/pro-console` (p50/p95 layering, dashed SLO line,
 * low-contrast grid) + `reviews/design/calm-premium` (shaded healthy band) +
 * `reviews/design/expressive`/`adaptive-saas` (aurora gradient focal series).
 */
export const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  primary,
  secondary,
  healthyBand,
  referenceLine,
  formatY = (v) => String(Math.round(v)),
  yTicks = 4,
  zeroFloor = true,
  height = 220,
  ariaLabel,
  className,
}) => {
  const gradientId = useId();

  const geom = useMemo(() => {
    const all = [primary.points, secondary?.points].filter(
      (p): p is ReadonlyArray<SeriesPoint> => p !== undefined,
    );

    const xExtent = extentOf({
      series: all.map((pts) => pts.map((p) => ({ x: 0, y: p.x }))),
    });
    const rawY = extentOf({ series: all, includeZero: zeroFloor });
    if (xExtent === null || rawY === null) return null;

    const xDomain: Range = { min: xExtent.min, max: xExtent.max };
    // Include band + reference line in the y extent so they never clip.
    let yLo = rawY.min;
    let yHi = rawY.max;
    if (healthyBand) {
      yLo = Math.min(yLo, healthyBand.from);
      yHi = Math.max(yHi, healthyBand.to);
    }
    if (referenceLine) {
      yLo = Math.min(yLo, referenceLine.value);
      yHi = Math.max(yHi, referenceLine.value);
    }
    const yDomain = padRange({
      range: { min: yLo, max: yHi },
      clampMinToZero: zeroFloor,
    });

    const box = {
      left: AXIS_GUTTER,
      top: PAD_TOP,
      width: VIEW_W - AXIS_GUTTER,
      height: height - PAD_TOP - PAD_BOTTOM,
    };
    const baselineY = box.top + box.height;

    const primaryProjected = projectSeries({
      points: primary.points,
      xDomain,
      yDomain,
      box,
    });
    const secondaryProjected = secondary
      ? projectSeries({ points: secondary.points, xDomain, yDomain, box })
      : [];

    const yFor = (value: number) =>
      scaleLinear({
        value,
        domain: yDomain,
        range: { min: box.top + box.height, max: box.top },
      });

    const ticks = Array.from({ length: yTicks + 1 }, (_, i) => {
      const value = yDomain.min + ((yDomain.max - yDomain.min) * i) / yTicks;
      return { value, y: yFor(value) };
    });

    return {
      box,
      baselineY,
      areaPaths: toAreaPaths({ projected: primaryProjected, baselineY }),
      primarySegments: toPolylineSegments({ projected: primaryProjected }),
      secondarySegments: toPolylineSegments({ projected: secondaryProjected }),
      ticks,
      bandTop: healthyBand ? yFor(healthyBand.to) : null,
      bandBottom: healthyBand ? yFor(healthyBand.from) : null,
      refY: referenceLine ? yFor(referenceLine.value) : null,
    };
  }, [primary, secondary, healthyBand, referenceLine, height, yTicks, zeroFloor]);

  const description = useMemo(() => {
    if (ariaLabel) return ariaLabel;
    const parts = [primary.label];
    if (secondary) parts.push(secondary.label);
    if (referenceLine?.label) parts.push(`reference ${referenceLine.label}`);
    return `Time series chart of ${parts.join(", ")}`;
  }, [ariaLabel, primary.label, secondary, referenceLine]);

  if (geom === null) {
    return (
      <div
        role="img"
        aria-label={`${description}: no data`}
        className={cn(
          "flex items-center justify-center rounded-[var(--d-card-r)] bg-[hsl(var(--surface-inset))] text-sm text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        No data
      </div>
    );
  }

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={description}
      className={cn("block", className)}
    >
      <defs>
        <linearGradient id={`tsc-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--aurora-2))" stopOpacity={0.42} />
          <stop offset="55%" stopColor="hsl(var(--aurora-2))" stopOpacity={0.12} />
          <stop offset="100%" stopColor="hsl(var(--aurora-2))" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`tsc-line-${gradientId}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(var(--aurora-1))" />
          <stop offset="100%" stopColor="hsl(var(--aurora-2))" />
        </linearGradient>
      </defs>

      {/* shaded healthy band */}
      {geom.bandTop !== null && geom.bandBottom !== null && (
        <rect
          x={geom.box.left}
          y={geom.bandTop}
          width={geom.box.width}
          height={Math.max(0, geom.bandBottom - geom.bandTop)}
          fill="hsl(var(--status-ok))"
          fillOpacity={0.08}
        />
      )}

      {/* low-contrast gridlines + y tick labels */}
      <g>
        {geom.ticks.map((t) => (
          <g key={t.value}>
            <line
              x1={geom.box.left}
              y1={t.y}
              x2={geom.box.left + geom.box.width}
              y2={t.y}
              stroke="hsl(var(--grid-line))"
              strokeWidth={1}
            />
            <text
              x={geom.box.left - 6}
              y={t.y + 3}
              textAnchor="end"
              fontSize={10}
              fill="hsl(var(--muted-foreground))"
            >
              {formatY(t.value)}
            </text>
          </g>
        ))}
      </g>

      {/* dashed reference line (e.g. SLO target) */}
      {geom.refY !== null && referenceLine && (
        <g>
          <line
            x1={geom.box.left}
            y1={geom.refY}
            x2={geom.box.left + geom.box.width}
            y2={geom.refY}
            stroke={toneVar[referenceLine.tone ?? "warn"]}
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.7}
          />
          {referenceLine.label && (
            <text
              x={geom.box.left + geom.box.width}
              y={geom.refY - 4}
              textAnchor="end"
              fontSize={10}
              fill={toneVar[referenceLine.tone ?? "warn"]}
            >
              {referenceLine.label}
            </text>
          )}
        </g>
      )}

      {/* p50 area (focal, aurora gradient) */}
      {geom.areaPaths.map((d, i) => (
        <path key={`area-${i}`} d={d} fill={`url(#tsc-${gradientId})`} />
      ))}

      {/* p95 dashed envelope (no fill) */}
      {geom.secondarySegments.map((points, i) => (
        <polyline
          key={`sec-${i}`}
          points={points}
          fill="none"
          stroke="hsl(var(--aurora-3))"
          strokeWidth={2}
          strokeOpacity={0.75}
          strokeDasharray="2 4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {/* p50 solid line on top */}
      {geom.primarySegments.map((points, i) => (
        <polyline
          key={`pri-${i}`}
          points={points}
          fill="none"
          stroke={`url(#tsc-line-${gradientId})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
};
