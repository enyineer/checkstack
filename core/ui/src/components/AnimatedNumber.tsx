import { useEffect, useRef } from "react";

interface AnimatedNumberProps {
  /** The number value to display (undefined for N/A) */
  value: number | undefined;
  /** Animation duration in milliseconds (default: 500ms) */
  duration?: number;
  /** Number of decimal places (default: 2) */
  decimals?: number;
  /** Suffix to append after the number (e.g., "%", "ms") */
  suffix?: string;
  /** CSS classes for the number span */
  className?: string;
  /** CSS classes for the suffix span */
  suffixClassName?: string;
}

/**
 * Component that displays an animated number with smooth rolling effect.
 * Numbers smoothly interpolate from their previous value to the new value.
 *
 * @example
 * ```tsx
 * <AnimatedNumber
 *   value={99.95}
 *   suffix="%"
 *   className="text-2xl font-bold text-green-500"
 * />
 * ```
 */
export function AnimatedNumber({
  value,
  duration = 500,
  decimals = 2,
  suffix,
  className = "",
  suffixClassName = "",
}: AnimatedNumberProps) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const startValueRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number | undefined>(undefined);
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    if (value === undefined) {
      element.textContent = "N/A";
      startValueRef.current = undefined;
      return;
    }

    if (startValueRef.current === undefined) {
      element.textContent = value.toFixed(decimals);
      startValueRef.current = value;
      return;
    }

    const startValue = startValueRef.current;

    // No animation needed if value is the same, but update formatting
    if (startValue === value) {
      element.textContent = value.toFixed(decimals);
      return;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const animate = (timestamp: number) => {
      if (startTimeRef.current === undefined) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      const current = startValue + (value - startValue) * eased;
      element.textContent = current.toFixed(decimals);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        startValueRef.current = value;
        startTimeRef.current = undefined;
        animationFrameRef.current = undefined;
        // Ensure final value is exact
        element.textContent = value.toFixed(decimals);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [value, duration, decimals]);

  return (
    <span className={`tabular-nums ${className}`}>
      <span ref={elementRef} />
      {value !== undefined && suffix && (
        <span className={suffixClassName}>{suffix}</span>
      )}
    </span>
  );
}
