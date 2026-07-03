import React, { useMemo } from "react";
import { cn } from "../../utils";
import { summarizeCategories, type CategoryCell } from "./chart-math";

export interface CategoryRibbonProps {
  /**
   * Cells oldest-first (left -> right), one per bucket/run, each carrying the
   * categorical value observed there (e.g. a text metric like "primary").
   */
  cells: ReadonlyArray<CategoryCell>;
  /**
   * The category rendered as "expected" (primary tone). When omitted, the
   * dominant category is used, so changes stand out automatically.
   */
  highlightCategory?: string;
  /** Bar height in px. Defaults to 16. */
  height?: number;
  /** Gap between cells in px. Defaults to 1. */
  gap?: number;
  /** Accessible label. Falls back to a generated dominance summary. */
  ariaLabel?: string;
  className?: string;
}

const BAR_W = 4;
const RADIUS = 1.5;

/**
 * Categorical history ribbon: the `UptimeRibbon` treatment for text metrics.
 * Cells matching the highlight (or dominant) category render in the primary
 * tone; anything else renders in the warn tone so a changed value is instantly
 * visible without implying "down". Each cell exposes a `<title>` with the
 * actual value, and the whole ribbon carries a dominance summary, so state is
 * never conveyed by hue alone.
 */
export const CategoryRibbon: React.FC<CategoryRibbonProps> = ({
  cells,
  highlightCategory,
  height = 16,
  gap = 1,
  ariaLabel,
  className,
}) => {
  const summary = useMemo(() => summarizeCategories({ cells }), [cells]);
  const expected = highlightCategory ?? summary.dominant ?? undefined;
  const count = Math.max(1, cells.length);
  const viewW = count * BAR_W + (count - 1) * gap;

  const changedCount =
    expected === undefined
      ? 0
      : summary.total - (summary.counts[expected] ?? 0);
  const description =
    ariaLabel ??
    (expected === undefined
      ? "Category history: no data."
      : `Category history: "${expected}" in ${summary.counts[expected] ?? 0} of ${summary.total} periods` +
        (changedCount > 0 ? `, ${changedCount} differing.` : "."));

  if (cells.length === 0) {
    return (
      <div
        role="img"
        aria-label={description}
        className={cn(
          "flex items-center justify-center rounded-[var(--d-card-r)] bg-[hsl(var(--surface-inset))] text-sm text-muted-foreground",
          className,
        )}
        style={{ height: Math.max(height, 40) }}
      >
        No data
      </div>
    );
  }

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
      {cells.map((cell, i) => {
        const matches = expected !== undefined && cell.category === expected;
        return (
          <rect
            key={cell.id}
            x={i * (BAR_W + gap)}
            y={0}
            width={BAR_W}
            height={height}
            rx={RADIUS}
            fill={matches ? "hsl(var(--primary))" : "hsl(var(--status-warn))"}
            fillOpacity={matches ? 0.85 : 1}
          >
            <title>
              {cell.label ? `${cell.label}: ${cell.category}` : cell.category}
            </title>
          </rect>
        );
      })}
    </svg>
  );
};
