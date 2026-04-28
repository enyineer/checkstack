import type { AnomalyDirection } from "../schema";

export interface Thresholds {
  lowerTrigger?: number;
  upperTrigger?: number;
}

export function computeThresholds(
  mean: number,
  stdDev: number,
  direction: AnomalyDirection,
  sensitivity: number = 1
): Thresholds {
  const margin = 3 * stdDev * sensitivity;

  switch (direction) {
    case "higher-is-better": {
      return {
        lowerTrigger: mean - margin,
        // No upper trigger, values can go as high as they want
      };
    }
    case "lower-is-better": {
      return {
        upperTrigger: mean + margin,
        // No lower trigger, getting faster/better is not an anomaly
      };
    }
    case "deviation": {
      return {
        lowerTrigger: mean - margin,
        upperTrigger: mean + margin,
      };
    }
    default: {
      return {};
    }
  }
}

export function isAnomalous(
  value: number,
  thresholds: Thresholds
): boolean {
  if (thresholds.lowerTrigger !== undefined && value < thresholds.lowerTrigger) {
    return true;
  }
  if (thresholds.upperTrigger !== undefined && value > thresholds.upperTrigger) {
    return true;
  }
  return false;
}
