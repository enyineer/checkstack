import { useEffect, useRef, useState } from "react";

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
 * Optimized to use direct DOM manipulation for performance, avoiding React re-renders during animation.
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
  const previousValueRef = useRef<number | undefined>(value);
  const animationRef = useRef<number>();
  const startTimeRef = useRef<number>();

  // Store the initial value and decimals to render purely for the first paint (SSR/hydration).
  // We strictly use useState to lock the VDOM content for this span to the initial render state.
  // This ensures React sees no differences in the virtual DOM for the number text on updates,
  // preventing it from overwriting our direct DOM manipulations during animation.
  const [initialValue] = useState(value);
  const [initialDecimals] = useState(decimals);

  useEffect(() => {
    // Reset animation start time for new effect run (e.g. interrupted animation)
    startTimeRef.current = undefined;

    // Handle undefined case
    if (value === undefined) {
      if (numberRef.current) {
        numberRef.current.textContent = "N/A";
      }
      previousValueRef.current = undefined;
      return;
    }

    let startValue = previousValueRef.current;

    // Attempt to read current value from DOM to ensure smooth transition if interrupted
    if (numberRef.current) {
      const currentText = numberRef.current.textContent;
      if (currentText && currentText !== "N/A") {
        const parsed = parseFloat(currentText);
        if (!isNaN(parsed)) {
          startValue = parsed;
        }
      }
    }

    // Initial mount case or fallback
    if (startValue === undefined) {
      previousValueRef.current = value;
      if (numberRef.current) {
        numberRef.current.textContent = value.toFixed(decimals);
      }
      return;
    }

    // If target is same as current (or very close), just set it
    // Note: Comparing float equality is generally risky, but here we want exact match if formatted
    if (startValue === value) {
       // Ensure content is correct even if updated without value change (e.g. decimals changed)
      if (numberRef.current) {
        const formatted = value.toFixed(decimals);
        if (numberRef.current.textContent !== formatted) {
           numberRef.current.textContent = formatted;
        }
      }
      return;
    }

    // Cancel existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      // Calculate current value
      // Note: startValue is captured from the closure (so it's constant for this animation)
      const current = startValue! + (value - startValue!) * eased;

      if (numberRef.current) {
        numberRef.current.textContent = current.toFixed(decimals);
      }

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        previousValueRef.current = value;
        startTimeRef.current = undefined;
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
      <span ref={numberRef}>
        {initialValue === undefined ? "N/A" : initialValue.toFixed(initialDecimals)}
      </span>
      {value !== undefined && suffix && <span className={suffixClassName}>{suffix}</span>}
    </span>
  );
}
