import { useLayoutEffect, useState } from "react";

export interface UseMeasuredWidthResult {
  /**
   * Callback ref: attach to the element whose content width should be
   * tracked. A callback (not a ref object) so measurement re-arms when the
   * element mounts LATER than the hook - e.g. a chart that first renders its
   * "no data" branch and only mounts the plot wrapper once data arrives.
   */
  ref: (el: HTMLDivElement | null) => void;
  /** Measured width in CSS px, or null until the first measurement lands. */
  width: number | null;
}

/**
 * Tracks an element's rendered width so an SVG chart can draw its geometry in
 * REAL pixels (1 viewBox unit = 1 CSS px) instead of stretching a fixed-width
 * viewBox with `preserveAspectRatio="none"` - which distorts everything
 * non-uniformly, most visibly axis text.
 *
 * Measures synchronously before first paint (layout effect), then follows
 * container resizes via `ResizeObserver`. `width` stays `null` until a
 * positive measurement lands, so callers can defer rendering the chart until
 * its true size is known (reserve the space with a fixed-height wrapper to
 * avoid layout shift).
 */
export function useMeasuredWidth(): UseMeasuredWidthResult {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (el === null) return;
    const measure = () => {
      // Round so sub-pixel resize jitter can't churn re-renders.
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    // Non-browser environments (tests) may lack ResizeObserver; the initial
    // measurement above is still correct there.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return { ref: setEl, width };
}
