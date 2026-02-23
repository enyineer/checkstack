import { useRef, useEffect, memo, forwardRef, useMemo } from "react";

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

// Internal component to prevent React from updating the number span during parent re-renders
const StaticSpan = memo(forwardRef<HTMLSpanElement, { initialContent: string }>(({ initialContent }, ref) => {
  return <span ref={ref}>{initialContent}</span>;
}), () => true);

StaticSpan.displayName = "StaticSpan";

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
  const numberRef = useRef<HTMLSpanElement>(null);
  const startValueRef = useRef<number | undefined>(undefined);
  const currentValueRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number | undefined>(undefined);
  const animationRef = useRef<number | undefined>(undefined);

  const isNA = value === undefined;

  // Compute initial content only once on mount
  const initialContent = useMemo(() => {
    return value === undefined ? "N/A" : value.toFixed(decimals);
  }, []);

  useEffect(() => {
    const element = numberRef.current;
    if (!element) return;

    // Handle N/A case
    if (value === undefined) {
      if (startValueRef.current !== undefined) {
        element.textContent = "N/A";
        startValueRef.current = undefined;
        currentValueRef.current = undefined;
      }
      return;
    }

    // Initial render or transition from N/A
    if (startValueRef.current === undefined) {
      startValueRef.current = value;
      currentValueRef.current = value;
      element.textContent = value.toFixed(decimals);
      return;
    }

    // If value hasn't changed, ensure formatting is correct (e.g. decimals prop changed)
    if (currentValueRef.current === value && startValueRef.current === value) {
       element.textContent = value.toFixed(decimals);
       return;
    }

    // Start animation from the current visual value (to handle interruptions smoothly)
    // If an animation was running, currentValueRef.current has the latest interpolated value.
    // If finished, it has the previous target value.
    const startValue = currentValueRef.current ?? startValueRef.current;
    startValueRef.current = startValue;

    // Reset start time for new animation
    startTimeRef.current = undefined;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      const current = startValue + (value - startValue) * eased;

      // Update refs and DOM
      currentValueRef.current = current;
      element.textContent = current.toFixed(decimals);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Animation complete
        startValueRef.current = value;
        currentValueRef.current = value;
        startTimeRef.current = undefined;
      }
    };

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration, decimals]);

  return (
    <span className={`tabular-nums ${className}`}>
      <StaticSpan ref={numberRef} initialContent={initialContent} />
      {!isNA && suffix && <span className={suffixClassName}>{suffix}</span>}
    </span>
  );
}
