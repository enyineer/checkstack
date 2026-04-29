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

export function isCategoricalAnomalous(
  value: string | boolean | number,
  dominantValue: string | boolean | number | undefined,
  dominantRatio: number | undefined,
  sensitivity: number = 1
): boolean {
  if (dominantValue === undefined || dominantRatio === undefined) return false;
  
  // Sensitivity scaling for categorical fields limits false positives.
  // Base required dominance is 90% stability.
  // Lower sensitivity values (e.g., 0.5) mean "tighter bounds, more alerts".
  // Therefore, we lower the required ratio so we alert even if the baseline is noisier.
  // Higher sensitivity values (e.g., 2.0) mean "looser bounds, fewer alerts".
  // Therefore, we raise the required ratio so we only alert if the baseline was extremely stable.
  const requiredRatio = Math.min(0.99, 0.9 * sensitivity);
  if (dominantRatio < requiredRatio) return false;

  return String(value) !== String(dominantValue);
}
