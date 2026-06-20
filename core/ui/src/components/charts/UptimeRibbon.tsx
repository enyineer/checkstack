import React, { useMemo } from "react";
import { cn } from "../../utils";
import { summarizeRibbon, type RibbonCell, type RibbonStatus } from "./chart-math";

const statusFill: Record<RibbonStatus, string> = {
  ok: "hsl(var(--status-ok))",
  warn: "hsl(var(--status-warn))",
  down: "hsl(var(--status-down))",
  unknown: "hsl(var(--status-unknown))",
};

const statusWord: Record<RibbonStatus, string> = {
  ok: "operational",
  warn: "degraded",
  down: "down",
  unknown: "no data",
};

export interface UptimeRibbonProps {
  /**
   * Cells oldest-first (left -> right), one per day or per run. Each carries a
   * `status` from the colorblind-safe triad plus `unknown`.
   */
  cells: ReadonlyArray<RibbonCell>;
  /** Bar height in px. Defaults to 36. */
  height?: number;
  /** Gap between bars in px. Defaults to 1. */
  gap?: number;
  /** Accessible label. Falls back to an uptime summary. */
  ariaLabel?: string;
  className?: string;
}

const BAR_W = 4;
const RADIUS = 1.5;

/**
 * Per-day / per-run uptime track: a row of green / amber / red segments
 * (a small-multiple). The whole ribbon carries an accessible uptime summary,
 * and each segment exposes a `<title>` (status + label) so the state is never
 * conveyed by hue alone. Token-driven, light/dark.
 *
 * Drawn from `reviews/design/expressive` (90-day uptime ribbon) +
 * `reviews/design/calm-premium` (per-system uptime track).
 */
export const UptimeRibbon: React.FC<UptimeRibbonProps> = ({
  cells,
  height = 36,
  gap = 1,
  ariaLabel,
  className,
}) => {
  const summary = useMemo(() => summarizeRibbon({ cells }), [cells]);
  const count = Math.max(1, cells.length);
  const viewW = count * BAR_W + (count - 1) * gap;
  const top = 0;

  const description =
    ariaLabel ??
    `Uptime ribbon: ${(summary.uptimeFraction * 100).toFixed(2)}% uptime over ` +
      `${summary.total} periods (${summary.ok} operational, ${summary.warn} degraded, ` +
      `${summary.down} down${summary.unknown ? `, ${summary.unknown} no data` : ""}).`;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${Math.max(viewW, BAR_W)} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={description}
      className={cn("block", className)}
    >
      {cells.map((cell, i) => (
        <rect
          key={cell.id}
          x={i * (BAR_W + gap)}
          y={top}
          width={BAR_W}
          height={height}
          rx={RADIUS}
          fill={statusFill[cell.status]}
        >
          <title>
            {cell.label
              ? `${cell.label}: ${statusWord[cell.status]}`
              : statusWord[cell.status]}
          </title>
        </rect>
      ))}
    </svg>
  );
};
