import React, { useCallback, useRef, useState } from "react";
import { usePerformance } from "../PerformanceProvider";
import {
  bandIndexAtX,
  nearestIndexByFraction,
  pointIndexAtX,
} from "./chart-math";

export interface UseBandHoverResult {
  /** Index of the hovered band/point, or null when the cursor is outside. */
  hoverIndex: number | null;
  /** Ref for the element the hook measures (the chart's plot wrapper). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Spread onto the plot wrapper. The wrapper must be `position: relative`. */
  containerProps: {
    onMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
    onMouseLeave: () => void;
  };
  /**
   * Ready-to-use style for an absolutely-positioned tooltip wrapper: `left` at
   * the hovered band's center (as a percentage of the full container width,
   * inset-aware). Pair with `-translate-x-1/2` and a `top-*` of your choosing.
   */
  tooltipStyle: React.CSSProperties;
  /** Fade transition classes, empty on low-power devices. */
  tooltipClassName: string;
}

/**
 * Cursor hit-testing for banded charts. Tracks which of `count` equal bands
 * (mode "band", stacked bars) or evenly-spaced points (mode "point", line
 * charts) the cursor is over, and where a tooltip should sit.
 *
 * When `positions` is given (each point's ACTUAL horizontal position as a
 * fraction of the full container width, null for unhoverable gaps), it takes
 * precedence over both modes: the nearest real position wins and the tooltip
 * anchors to it - the only correct behavior for unevenly spaced series (e.g.
 * time buckets with data gaps).
 *
 * `insetLeftFraction` / `insetRightFraction` carve axis gutters out of the
 * measured width (e.g. a 44/720 left gutter on `TimeSeriesChart`); they apply
 * to the band/point modes only - `positions` are already container-relative.
 */
export function useBandHover({
  count,
  mode = "band",
  positions,
  insetLeftFraction = 0,
  insetRightFraction = 0,
}: {
  count: number;
  mode?: "band" | "point";
  positions?: ReadonlyArray<number | null>;
  insetLeftFraction?: number;
  insetRightFraction?: number;
}): UseBandHoverResult {
  const { isLowPower } = usePerformance();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const onMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;

      if (positions !== undefined) {
        const fraction = (event.clientX - rect.left) / rect.width;
        if (fraction < 0 || fraction > 1) {
          setHoverIndex(null);
          return;
        }
        setHoverIndex(nearestIndexByFraction({ fraction, positions }));
        return;
      }

      const plotLeft = rect.width * insetLeftFraction;
      const plotWidth = rect.width * (1 - insetLeftFraction - insetRightFraction);
      const x = event.clientX - rect.left - plotLeft;
      const index =
        mode === "point"
          ? pointIndexAtX({ x, width: plotWidth, count })
          : bandIndexAtX({ x, width: plotWidth, count });
      setHoverIndex(index);
    },
    [count, mode, positions, insetLeftFraction, insetRightFraction],
  );

  const onMouseLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  // Tooltip anchor: the hovered point's actual position when known, else the
  // center of the hovered band / the evenly-spaced point.
  let centerFraction = 0;
  if (hoverIndex !== null) {
    if (positions !== undefined) {
      centerFraction = positions[hoverIndex] ?? 0;
    } else if (count > 0) {
      const plotFraction =
        mode === "point"
          ? count === 1
            ? 0.5
            : hoverIndex / (count - 1)
          : (hoverIndex + 0.5) / count;
      centerFraction =
        insetLeftFraction +
        plotFraction * (1 - insetLeftFraction - insetRightFraction);
    }
  }

  return {
    hoverIndex,
    containerRef,
    containerProps: { onMouseMove, onMouseLeave },
    tooltipStyle: { left: `${(centerFraction * 100).toFixed(2)}%` },
    tooltipClassName: isLowPower ? "" : "transition-opacity duration-100",
  };
}
