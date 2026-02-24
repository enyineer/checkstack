import { useRef, useEffect, useState } from "react";

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
 * Optimized to use direct DOM manipulation and avoid React re-renders during animation.
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

  // Track the current displayed value to allow smooth interruption
  const currentValueRef = useRef<number | undefined>(value);

  // Track the start value of the current animation
  const startValueRef = useRef<number | undefined>(value);

  // Track the start time of the current animation
  const startTimeRef = useRef<number | undefined>(undefined);

  // Track the animation frame ID to cancel if needed
  const animationFrameRef = useRef<number | undefined>(undefined);

  // Initial render value for hydration consistency
  // We use state initialized once so it doesn't change on re-renders
  const [initialRenderValue] = useState(() =>
    value === undefined ? "N/A" : value.toFixed(decimals)
  );

  useEffect(() => {
    const span = spanRef.current;
    if (!span) return;

    // Handle undefined case (N/A)
    if (value === undefined) {
      if (currentValueRef.current !== undefined) {
         // Transition to N/A
         span.textContent = "N/A";
         currentValueRef.current = undefined;
         startValueRef.current = undefined;
      }
      return;
    }

    // If we were undefined, jump to value instantly
    if (currentValueRef.current === undefined) {
      currentValueRef.current = value;
      startValueRef.current = value;
      span.textContent = value.toFixed(decimals);
      return;
    }

    // We start animating from wherever we are (currentValueRef) to value.
    const startValue = currentValueRef.current;

    // If we are already at the target, ensure text is correct and stop
    if (startValue === value) {
       span.textContent = value.toFixed(decimals);
       return;
    }

    startValueRef.current = startValue;
    startTimeRef.current = undefined; // Reset time for new animation

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const animate = (timestamp: number) => {
      if (startTimeRef.current === undefined) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);

      const current = startValue + (value - startValue) * eased;

      // Update DOM directly
      span.textContent = current.toFixed(decimals);

      // Update our tracker
      currentValueRef.current = current;

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Ensure final value is exact
        currentValueRef.current = value;
        span.textContent = value.toFixed(decimals);
        startTimeRef.current = undefined;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [value, duration, decimals]);

  const isNA = value === undefined;

  return (
    <span className={`tabular-nums ${className}`}>
      <span ref={spanRef}>{initialRenderValue}</span>
      {!isNA && suffix && <span className={suffixClassName}>{suffix}</span>}
    </span>
  );
}
