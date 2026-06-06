import { useState, useEffect, useRef } from "react";

/**
 * Hook that animates a number from its previous value to the new value.
 * Creates a smooth "rolling numbers" effect.
 *
 * @param targetValue - The value to animate towards (undefined for N/A)
 * @param duration - Animation duration in milliseconds (default: 500ms)
 * @param decimals - Number of decimal places to display (default: 2)
 */
export function useAnimatedNumber(
  targetValue: number | undefined,
  duration = 500,
  decimals = 2,
): string {
  const [displayValue, setDisplayValue] = useState(targetValue);
  const animationRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number | undefined>(undefined);
  const startValueRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (targetValue === undefined) {
      setDisplayValue(undefined);
      return;
    }

    // If this is the first value, just set it immediately
    if (startValueRef.current === undefined) {
      startValueRef.current = targetValue;
      setDisplayValue(targetValue);
      return;
    }

    const startValue = startValueRef.current;

    // If target is the same, no animation needed
    if (startValue === targetValue) {
      return;
    }

    // Cancel any existing animation
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

      const current = startValue + (targetValue - startValue) * eased;
      setDisplayValue(current);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Animation complete - update the start value for next animation
        startValueRef.current = targetValue;
        startTimeRef.current = undefined;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [targetValue, duration]);

  if (displayValue === undefined) {
    return "N/A";
  }

  return displayValue.toFixed(decimals);
}
