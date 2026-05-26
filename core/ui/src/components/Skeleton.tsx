import React from "react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Override the default sizing / shape. The component already renders a
   * muted background; pass dimensions via classes like `h-4 w-32 rounded`.
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
  ({ className, ...props }, ref) => {
    const { isLowPower } = usePerformance();

    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn(
          "rounded-md bg-muted",
          !isLowPower && "animate-pulse",
          className,
        )}
        {...props}
      />
    );
  },
);

Skeleton.displayName = "Skeleton";
