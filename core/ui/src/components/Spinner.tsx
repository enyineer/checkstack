import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

const sizeClasses = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
} as const;

export interface SpinnerProps
  extends Omit<React.ComponentProps<typeof Loader2>, "ref"> {
  /**
   * Visual size of the spinner. Defaults to `sm` (`h-4 w-4`), the dominant
   * inline-in-button need.
   */
  size?: keyof typeof sizeClasses;
  className?: string;
}

/**
 * Spinner - a small INLINE loading indicator (e.g. next to button text or in a
 * table cell). For a centered full-block loader, use `LoadingSpinner` instead.
 *
 * The `animate-spin` class is gated INTERNALLY behind
 * `usePerformance().isLowPower`: on low-power devices the icon renders static
 * (no spin), satisfying `.claude/rules/performance.md` so call sites inherit the
 * guard without re-implementing it.
 *
 * Accessibility: decorative by default (`aria-hidden`), for the common case of
 * sitting next to visible text like "Saving...". Pass `aria-label` to announce
 * it on its own; that switches the icon to `role="status"` and drops
 * `aria-hidden`.
 */
export const Spinner: React.FC<SpinnerProps> = ({
  size = "sm",
  className,
  "aria-label": ariaLabel,
  ...props
}) => {
  const { isLowPower } = usePerformance();

  const accessibility =
    ariaLabel === undefined
      ? { "aria-hidden": true }
      : { "aria-label": ariaLabel, role: "status" as const };

  return (
    <Loader2
      className={cn(!isLowPower && "animate-spin", sizeClasses[size], className)}
      {...accessibility}
      {...props}
    />
  );
};
