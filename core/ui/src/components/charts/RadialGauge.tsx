import React, { useId, useMemo } from "react";
import { cn } from "../../utils";
import { usePerformance } from "../PerformanceProvider";
import { clampFraction, semicircleGauge } from "./chart-math";

/** Tone of the supporting caption beneath the number. */
export type GaugeCaptionTone = "ok" | "warn" | "down" | "muted";

const captionToneClass: Record<GaugeCaptionTone, string> = {
  ok: "text-[hsl(var(--status-ok))]",
  warn: "text-[hsl(var(--status-warn))]",
  down: "text-[hsl(var(--status-down))]",
  muted: "text-muted-foreground",
};

export interface RadialGaugeProps {
  /**
   * Fraction filled, 0..1 (clamped). The arc is a *confirmation* of the number,
   * never the primary readout (gauges are easy to misread).
   */
  value: number;
  /** The large primary readout, e.g. "99.94%". This is what the eye lands on. */
  displayValue: string;
  /** Small caption under the number, e.g. "Above target 99.9%". */
  caption?: string;
  /** Tone of the caption text. Defaults to `muted`. */
  captionTone?: GaugeCaptionTone;
  /**
   * Optional target marker, 0..1, drawn as a tick on the arc (e.g. an SLO
   * target at 0.999).
   */
  target?: number;
  /**
   * `hero` uses the full aurora gradient + (perf-gated) glow as the single
   * focal moment per page. `quiet` is a flat single-tone arc for non-hero
   * placements (cards, list rows).
   */
  variant?: "hero" | "quiet";
  /** Width in px. Defaults to 240. */
  width?: number;
  /** Accessible label. Falls back to `${displayValue} ${caption}`. */
  ariaLabel?: string;
  className?: string;
}

const STROKE = 18;

/**
 * Signature semicircular confidence gauge. The large NUMBER is the primary
 * readout; the arc only confirms it. The `hero` variant fills the arc with the
 * teal -> violet -> magenta aurora gradient (+ a soft glow, gated behind
 * `usePerformance().isLowPower` and reduced-motion); the `quiet` variant is a
 * flat primary-tone arc for non-hero spots.
 *
 * Drawn from `reviews/design/expressive` (Aurora Signal hero gauge): number-led
 * readout, gradient value arc, SLO target tick.
 */
export const RadialGauge: React.FC<RadialGaugeProps> = ({
  value,
  displayValue,
  caption,
  captionTone = "muted",
  target,
  variant = "hero",
  width = 240,
  ariaLabel,
  className,
}) => {
  const gradientId = useId();
  const { isLowPower } = usePerformance();
  const height = Math.round(width * 0.62);

  const arc = useMemo(
    () => semicircleGauge({ width, height, strokeWidth: STROKE, fraction: value }),
    [width, height, value],
  );

  const isHero = variant === "hero";
  // Glow is the single ambient effect and is dropped on low-power / reduced-motion.
  const useGlow = isHero && !isLowPower;
  const valueStroke = isHero ? `url(#gauge-${gradientId})` : "hsl(var(--primary))";

  // Target tick: place a short radial mark at the target fraction along the arc.
  const targetTick = useMemo(() => {
    if (target === undefined) return null;
    const t = clampFraction(target);
    // angle sweeps 180deg (PI) -> 0 as fraction goes 0 -> 1, measured from +x.
    const angle = Math.PI * (1 - t);
    const cx = width / 2;
    const cy = height;
    const r = Math.min(width / 2, height) - STROKE / 2;
    const inner = r - STROKE / 2;
    const outer = r + STROKE / 2;
    return {
      x1: cx + inner * Math.cos(angle),
      y1: cy - inner * Math.sin(angle),
      x2: cx + outer * Math.cos(angle),
      y2: cy - outer * Math.sin(angle),
    };
  }, [target, width, height]);

  // Center the readout on the OPTICAL center of the arc's inner void, not its
  // geometric midpoint: the void is a semicircle opening downward, and a
  // semicircular area's centroid sits 4r/3π ≈ 0.42·r above its flat side —
  // the halfway point reads visually high. Paired with
  // `dominantBaseline="central"` the glyphs center exactly there.
  const innerRadius = Math.min(width / 2, height) - STROKE;
  const numberY = height - innerRadius * (4 / (3 * Math.PI));

  const label =
    ariaLabel ?? `${displayValue}${caption ? `, ${caption}` : ""}`;

  return (
    <div
      className={cn("inline-flex flex-col items-center", className)}
      role="img"
      aria-label={label}
    >
      <svg
        width={width}
        height={height + 6}
        viewBox={`0 0 ${width} ${height + 6}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`gauge-${gradientId}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--aurora-1))" />
            <stop offset="55%" stopColor="hsl(var(--aurora-2))" />
            <stop offset="100%" stopColor="hsl(var(--aurora-3))" />
          </linearGradient>
          {useGlow && (
            <filter
              id={`gauge-glow-${gradientId}`}
              x="-40%"
              y="-40%"
              width="180%"
              height="180%"
            >
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>

        {/* track */}
        <path
          d={arc.trackPath}
          fill="none"
          stroke="hsl(var(--surface-inset))"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* value arc */}
        <path
          d={arc.trackPath}
          fill="none"
          stroke={valueStroke}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={arc.arcLength}
          strokeDashoffset={arc.dashOffset}
          filter={useGlow ? `url(#gauge-glow-${gradientId})` : undefined}
        />
        {/* target tick */}
        {targetTick && (
          <line
            x1={targetTick.x1}
            y1={targetTick.y1}
            x2={targetTick.x2}
            y2={targetTick.y2}
            stroke="hsl(var(--foreground))"
            strokeWidth={2}
          />
        )}
        {/* primary readout: the NUMBER */}
        <text
          x={arc.centerX}
          y={numberY}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.round(width * 0.16)}
          fontWeight={800}
          fill="hsl(var(--foreground))"
          style={{ letterSpacing: "-0.02em" }}
        >
          {displayValue}
        </text>
      </svg>
      {caption && (
        <span
          className={cn(
            "mt-[-6px] text-center text-xs font-semibold tracking-wide",
            captionToneClass[captionTone],
          )}
        >
          {caption}
        </span>
      )}
    </div>
  );
};
