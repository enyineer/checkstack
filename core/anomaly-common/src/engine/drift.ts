import type { AnomalyDirection } from "../schema";

export interface DriftDetectionInput {
  /** Linear regression slope across the chronologically-ordered baseline window. */
  slope: number;
  /** Population standard deviation of the same window. */
  stdDev: number;
  /** Number of samples in the window. */
  sampleCount: number;
  /** Schema-declared direction for the field. */
  direction: AnomalyDirection;
  /** Sensitivity multiplier (matches the spike-detection slider). */
  sensitivity: number;
  /** Sigma multiplier on the drift trigger band. Default 2 in callers. */
  threshold: number;
}

export interface DriftDetectionResult {
  drifting: boolean;
  /** slope × sampleCount — the projected change over the baseline window. */
  projectedChange: number;
  /** projectedChange / stdDev — how many σ the trend has shifted the baseline. */
  deviationSigmas: number;
  /** Which side of the baseline the drift is moving toward. */
  driftDirection: "above" | "below";
}

/**
 * Pure drift detection.
 *
 * Triggers when |slope × sampleCount| > threshold × σ × sensitivity, i.e. when
 * the regression projects the metric to walk by more than `threshold` standard
 * deviations across the baseline window. Filtered by direction:
 *   - lower-is-better: only positive slope (worsening)
 *   - higher-is-better: only negative slope (worsening)
 *   - deviation: either
 *   - dominance: never (categorical fields don't drift continuously)
 *
 * Returns deviationSigmas = ∞ when stdDev is 0 and slope is non-zero, since any
 * movement on a previously-constant metric is by definition outside the noise.
 */
export function detectDrift({
  slope,
  stdDev,
  sampleCount,
  direction,
  sensitivity,
  threshold,
}: DriftDetectionInput): DriftDetectionResult {
  const projectedChange = slope * sampleCount;
  const driftDirection: "above" | "below" = slope >= 0 ? "above" : "below";

  const deviationSigmas =
    stdDev === 0
      ? slope === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.abs(projectedChange) / stdDev;

  if (sampleCount === 0 || slope === 0) {
    return { drifting: false, projectedChange, deviationSigmas, driftDirection };
  }

  if (direction === "dominance") {
    return { drifting: false, projectedChange, deviationSigmas, driftDirection };
  }

  if (direction === "lower-is-better" && slope < 0) {
    return { drifting: false, projectedChange, deviationSigmas, driftDirection };
  }

  if (direction === "higher-is-better" && slope > 0) {
    return { drifting: false, projectedChange, deviationSigmas, driftDirection };
  }

  const triggerBand = threshold * stdDev * sensitivity;
  const drifting = Math.abs(projectedChange) > triggerBand;

  return { drifting, projectedChange, deviationSigmas, driftDirection };
}
