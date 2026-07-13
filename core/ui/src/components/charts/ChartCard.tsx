import React from "react";
import { cn } from "../../utils";
import { CardContent, CardHeader, CardTitle } from "../Card";
import { usePerformance } from "../PerformanceProvider";

/**
 * The premium chart-card chrome as a class string, for surfaces that need the
 * same skin with a custom body (e.g. a hero status banner). On low-power
 * devices the gradient and large shadow are dropped for a flat card.
 */
export function chartCardChromeClass({
  isLowPower,
}: {
  isLowPower: boolean;
}): string {
  return cn(
    "overflow-hidden rounded-[var(--d-card-r)] border",
    isLowPower
      ? "border-border bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
      : "border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
  );
}

export interface ChartCardProps {
  /** Small muted title under (or instead of) the hero value. */
  title: string;
  /** Optional large number-led readout, e.g. "99.2%" or "142ms". */
  heroValue?: string;
  /** Optional right-aligned header content (chips, actions). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Premium chart-card chrome: density-aware radius, gradient surface, and the
 * layered soft shadow used by the app's hero metric cards, with a number-led
 * header (value over muted label). On low-power devices the gradient and the
 * large shadow are dropped for a flat card.
 */
export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  heroValue,
  actions,
  children,
  className,
  contentClassName,
}) => {
  const { isLowPower } = usePerformance();
  return (
    <div className={cn(chartCardChromeClass({ isLowPower }), className)}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            {heroValue !== undefined && (
              <span className="block text-3xl font-bold leading-none tabular-nums text-foreground">
                {heroValue}
              </span>
            )}
            <CardTitle
              className={cn(
                "truncate text-xs font-normal text-muted-foreground",
                heroValue !== undefined && "mt-1",
              )}
            >
              {title}
            </CardTitle>
          </div>
          {/* min-w-0 + flex-wrap lets a wide actions cluster (e.g. a date-range
              filter with custom pickers) wrap onto its own line instead of
              overflowing the overflow-hidden card and becoming unreachable. */}
          {actions && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </div>
  );
};
