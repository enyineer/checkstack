import React, { useRef, useEffect } from "react";

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
 * Optimization: Uses useRef and requestAnimationFrame to avoid React re-renders
 * during animation frames.
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
  const currentValueRef = useRef<number | undefined>(value);
  const animationRef = useRef<number>();
  const startTimeRef = useRef<number>();

  useEffect(() => {
    // Handle undefined value (N/A)
    if (value === undefined) {
      if (elementRef.current) elementRef.current.textContent = "N/A";
      currentValueRef.current = undefined;
      return;
    }

    const targetValue = value;
    const startValue = currentValueRef.current;

    // Initial render or transition from N/A
    if (startValue === undefined) {
      currentValueRef.current = targetValue;
      if (elementRef.current) elementRef.current.textContent = targetValue.toFixed(decimals);
      return;
    }

    // No change in value
    if (startValue === targetValue) {
      // Ensure formatting is correct (e.g. if decimals prop changed)
      if (elementRef.current) elementRef.current.textContent = targetValue.toFixed(decimals);
      return;
    }

    // Cancel any ongoing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    startTimeRef.current = undefined;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      const current = startValue + (targetValue - startValue) * eased;
      currentValueRef.current = current;

      if (elementRef.current) {
        elementRef.current.textContent = current.toFixed(decimals);
      }

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Ensure final value is set exactly to target to avoid floating point errors
        currentValueRef.current = targetValue;
        if (elementRef.current) {
          elementRef.current.textContent = targetValue.toFixed(decimals);
        }
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
      <span ref={elementRef}>
        {/* Initial render content if hydration is needed, though useEffect will override immediately */}
        {value === undefined ? "N/A" : value.toFixed(decimals)}
      </span>
      {value !== undefined && suffix && <span className={suffixClassName}>{suffix}</span>}
    </span>
  );
}
