import React from "react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

/**
 * Built-in skeleton shapes. Each maps to a sensible default footprint so a
 * loading placeholder matches the real content's size (no layout shift on
 * resolve). Pass `className` to fine-tune any variant.
 *
 * - `text`  : a single line of text.
 * - `card`  : a rounded card-sized block (matches a default Card footprint).
 * - `row`   : a table/list row, height driven by the `--d-row` density token.
 * - `chart` : a chart-sized block, height driven by the `--d-spark-h`-aware
 *             chart area (defaults to a 12rem plot).
 */
export type SkeletonVariant = "text" | "card" | "row" | "chart";

const VARIANT_CLASS: Record<SkeletonVariant, string> = {
  text: "h-4 w-full rounded",
  card: "h-32 w-full rounded-[var(--d-card-r)]",
  row: "h-[var(--d-row)] w-full rounded-md",
  chart: "h-48 w-full rounded-[var(--d-card-r)]",
};

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Built-in shape preset. Omit to get the bare `bg-muted` block and size it
   * yourself via `className` (the original behaviour).
   */
  variant?: SkeletonVariant;
  /**
   * Override / extend the sizing & shape. Applied after the variant classes,
   * so it always wins.
   */
  className?: string;
}

/**
 * Skeleton - a pulsing placeholder block for loading states.
 *
 * Honours {@link usePerformance}: when `isLowPower` is true the pulse
 * animation is dropped, leaving a static `bg-muted` block so low-power
 * devices aren't forced through an infinite animation loop.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant, ...props }, ref) => {
    const { isLowPower } = usePerformance();

    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn(
          "rounded-md bg-muted",
          variant && VARIANT_CLASS[variant],
          !isLowPower && "animate-pulse",
          className,
        )}
        {...props}
      />
    );
  },
);

Skeleton.displayName = "Skeleton";

interface SkeletonTableRowsProps {
  /** Number of placeholder rows to render. */
  rows?: number;
  className?: string;
}

/**
 * SkeletonTableRows - a stack of `row`-variant skeletons for a loading table /
 * list. Uses the `--d-gap` density token between rows so the placeholder
 * rhythm matches the real list in both densities.
 */
export const SkeletonTableRows: React.FC<SkeletonTableRowsProps> = ({
  rows = 5,
  className,
}) => (
  <div
    className={cn("flex flex-col gap-[var(--d-gap)]", className)}
    aria-hidden="true"
  >
    {Array.from({ length: rows }).map((_, index) => (
      <Skeleton key={index} variant="row" />
    ))}
  </div>
);
