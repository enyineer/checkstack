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
 * Optimized to use direct DOM manipulation via requestAnimationFrame to avoid React re-renders.
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
  const spanRef = useRef<HTMLSpanElement>(null);
  const startValueRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number | undefined>(undefined);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const span = spanRef.current;
    if (!span) return;

    if (value === undefined) {
      span.textContent = "N/A";
      startValueRef.current = undefined;
      // Clean up any ongoing animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
      return;
    }

    // Initialize immediately if first value
    if (startValueRef.current === undefined) {
      span.textContent = value.toFixed(decimals);
      startValueRef.current = value;
      return;
    }

    const startValue = startValueRef.current;
    if (startValue === value) return;

    // Start animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    // Reset start time for new animation
    startTimeRef.current = undefined;

    // Capture the current visual value to ensure smooth transition if interrupted
    // We try to parse the current text content. If it fails (e.g. empty or non-numeric), fallback to startValue
    const currentText = span.textContent;
    let actualStart = startValue;

    if (currentText) {
      // Handle potential N/A or other non-numeric content
      const parsed = Number.parseFloat(currentText);
      if (!Number.isNaN(parsed)) {
        actualStart = parsed;
      }
    }

    const animate = (timestamp: number) => {
      if (startTimeRef.current === undefined) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = actualStart + (value - actualStart) * eased;

      span.textContent = current.toFixed(decimals);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        startValueRef.current = value;
        animationRef.current = undefined;
        // Ensure final value is exact
        span.textContent = value.toFixed(decimals);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration, decimals]);

  return (
    <span className={`tabular-nums ${className}`}>
      <span ref={spanRef} />
      {value !== undefined && suffix && <span className={suffixClassName}>{suffix}</span>}
    </span>
  );
}
