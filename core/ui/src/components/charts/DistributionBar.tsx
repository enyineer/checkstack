import React, { useMemo } from "react";
import { cn } from "../../utils";
import { usePerformance } from "../PerformanceProvider";
import {
  DISTRIBUTION_OTHER_ID,
  layoutDistribution,
  type DistributionSlice,
  type LaidOutDistributionSlice,
} from "./chart-math";
import { ChartTooltip } from "./ChartTooltip";

/** Categorical palette cycled across slices; "Other" is always muted. */
const SLICE_FILLS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function sliceFill({ slice, index }: { slice: LaidOutDistributionSlice; index: number }): string {
  if (slice.id === DISTRIBUTION_OTHER_ID) return "hsl(var(--muted-foreground))";
  return SLICE_FILLS[index % SLICE_FILLS.length];
}

export interface DistributionBarProps {
  slices: ReadonlyArray<DistributionSlice>;
  /** Slices kept before rolling the tail into "Other". Defaults to 8. */
  maxSlices?: number;
  /** Format a slice's value for the legend/tooltip. Defaults to count + %. */
  formatValue?: (props: { value: number; fraction: number }) => string;
  /** Bar height in px. Defaults to 12. */
  height?: number;
  /** Accessible label describing what is distributed. */
  ariaLabel: string;
  className?: string;
}

const defaultFormatValue = ({
  value,
  fraction,
}: {
  value: number;
  fraction: number;
}): string => `${value} (${Math.round(fraction * 100)}%)`;

/**
 * Horizontal stacked distribution bar + legend: every segment sits on one
 * shared length scale so shares are directly comparable (unlike a pie).
 * Segments cycle the categorical chart palette; the synthetic "Other" tail is
 * always muted. Hover shows the shared `ChartTooltip`; the legend carries the
 * same values so nothing is hover-only.
 */
export const DistributionBar: React.FC<DistributionBarProps> = ({
  slices,
  maxSlices = 8,
  formatValue = defaultFormatValue,
  height = 12,
  ariaLabel,
  className,
}) => {
  const { isLowPower } = usePerformance();
  const layout = useMemo(
    () => layoutDistribution({ slices, maxSlices }),
    [slices, maxSlices],
  );

  // Hover bands are unequal here, so hit-test against slice extents directly.
  const { containerRef, containerProps, hoverIndex, tooltipStyle, tooltipClassName } =
    useSliceHover({ slices: layout.slices });

  if (layout.slices.length === 0) {
    return (
      <div
        role="img"
        aria-label={`${ariaLabel}: no data`}
        className={cn(
          "flex items-center justify-center rounded-[var(--d-card-r)] bg-[hsl(var(--surface-inset))] px-3 py-4 text-sm text-muted-foreground",
          className,
        )}
      >
        No data
      </div>
    );
  }

  const hovered = hoverIndex === null ? undefined : layout.slices[hoverIndex];

  return (
    <div className={cn("space-y-2", className)}>
      <div
        ref={containerRef}
        {...containerProps}
        className="relative"
        role="img"
        aria-label={`${ariaLabel}: ${layout.slices
          .map((s) => `${s.label} ${formatValue({ value: s.value, fraction: s.fraction })}`)
          .join(", ")}`}
      >
        <div
          className={cn(
            "flex w-full overflow-hidden rounded-full bg-[hsl(var(--surface-inset))]",
            !isLowPower && "animate-in fade-in duration-300",
          )}
          style={{ height }}
        >
          {layout.slices.map((slice, i) => (
            <div
              key={slice.id}
              style={{
                width: `${(slice.fraction * 100).toFixed(3)}%`,
                backgroundColor: sliceFill({ slice, index: i }),
                opacity: hoverIndex !== null && hoverIndex !== i ? 0.45 : 1,
              }}
              className={cn(!isLowPower && "transition-opacity duration-100")}
              title={`${slice.label}: ${formatValue({ value: slice.value, fraction: slice.fraction })}`}
            />
          ))}
        </div>
        {hovered && (
          <div
            className={cn(
              "pointer-events-none absolute z-10 -translate-x-1/2",
              tooltipClassName,
            )}
            style={{ ...tooltipStyle, top: height + 4 }}
          >
            <ChartTooltip
              rows={[
                {
                  id: hovered.id,
                  label: hovered.label,
                  value: formatValue({
                    value: hovered.value,
                    fraction: hovered.fraction,
                  }),
                },
              ]}
            />
          </div>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {layout.slices.map((slice, i) => (
          <li key={slice.id} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: sliceFill({ slice, index: i }) }}
              aria-hidden
            />
            <span className="text-muted-foreground">{slice.label}</span>
            <span className="font-medium tabular-nums">
              {formatValue({ value: slice.value, fraction: slice.fraction })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Slice-extent hover for unequal-width segments: like `useBandHover`, but each
 * "band" is a slice's `[leftFraction, leftFraction + fraction)` extent.
 */
function useSliceHover({
  slices,
}: {
  slices: ReadonlyArray<LaidOutDistributionSlice>;
}): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  containerProps: {
    onMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
    onMouseLeave: () => void;
  };
  hoverIndex: number | null;
  tooltipStyle: React.CSSProperties;
  tooltipClassName: string;
} {
  const { isLowPower } = usePerformance();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  const onMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const fraction = (event.clientX - rect.left) / rect.width;
      if (fraction < 0 || fraction > 1) {
        setHoverIndex(null);
        return;
      }
      const index = slices.findIndex(
        (s) => fraction >= s.leftFraction && fraction < s.leftFraction + s.fraction,
      );
      setHoverIndex(index === -1 ? slices.length - 1 : index);
    },
    [slices],
  );

  const onMouseLeave = React.useCallback(() => setHoverIndex(null), []);

  let centerFraction = 0;
  if (hoverIndex !== null) {
    const slice = slices[hoverIndex];
    if (slice !== undefined) {
      centerFraction = slice.leftFraction + slice.fraction / 2;
    }
  }

  return {
    containerRef,
    containerProps: { onMouseMove, onMouseLeave },
    hoverIndex,
    tooltipStyle: { left: `${(centerFraction * 100).toFixed(2)}%` },
    tooltipClassName: isLowPower ? "" : "transition-opacity duration-100",
  };
}
