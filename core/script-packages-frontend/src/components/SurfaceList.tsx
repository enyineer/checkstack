import React from "react";
import { cn } from "@checkstack/ui";

/**
 * A premium elevated list surface: one rounded gradient container with a soft
 * border and low-contrast dividers, so a set of rows reads as a single
 * cohesive surface rather than bare divider lines. Rows are supplied as
 * children and should use `SurfaceListRow` for consistent hover + density.
 */
export const SurfaceList: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => (
  <ul
    className={cn(
      "divide-y divide-border/60 overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface",
      className,
    )}
  >
    {children}
  </ul>
);

/**
 * A single row inside a `SurfaceList`: density-token padding, a refined hover
 * affordance, and a comfortable leading/trailing rhythm.
 */
export const SurfaceListRow: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => (
  <li
    className={cn(
      "flex items-center justify-between gap-3 px-[var(--d-pad)] py-2.5 transition-colors hover:bg-surface-inset",
      className,
    )}
  >
    {children}
  </li>
);
