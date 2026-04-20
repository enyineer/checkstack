import React, { useEffect, useState, useRef } from "react";
import { usePerformance } from "./PerformanceProvider";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  formatter?: (n: number) => string;
  className?: string;
}

/**
 * AnimatedCounter - Animates a number from 0 to target value
 * Uses requestAnimationFrame for smooth 60fps animation
 */
export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  duration = 500,
  formatter = (n) => Math.round(n).toString(),
  className,
}) => {
  const [displayValue, setDisplayValue] = useState(0);
  const displayValueRef = useRef(displayValue);
  displayValueRef.current = displayValue;
  
  const { isLowPower } = usePerformance();

  useEffect(() => {
    // Skip animation if value is 0, duration is 0, or in low-power mode
    if (value === 0 || duration === 0 || isLowPower) {
      setDisplayValue(value);
      return;
    }

    const startTime = globalThis.performance.now();
    const startValue = displayValueRef.current;
    const diff = value - startValue;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for smooth deceleration
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = startValue + diff * easeOut;

      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration, isLowPower]);

  return <span className={className}>{formatter(displayValue)}</span>;
};
