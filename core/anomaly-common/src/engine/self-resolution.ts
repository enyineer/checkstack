/**
 * Self-resolution and suppression heuristics.
 *
 * PART A (auto-resolve): a confirmed anomaly must clear once the metric settles
 * at a *new* stable level, even while that level is still anomalous against the
 * stale baseline. The classic case is "broken then fixed at a clearly different
 * value": the new value IS the new normal, but the relative resolver keeps
 * comparing against the old mean and never fires until the slow hourly baseline
 * analyzer drags the mean across. These pure helpers give both the spike
 * detector and the drift evaluator a baseline-independent escape hatch.
 *
 * PART B (suppression): an operator can silence a known anomaly. It auto-clears
 * ("changes again") once the observed value moves outside a relative band around
 * the value it was suppressed at.
 */

/**
 * Number of consecutive healthy samples that must sit inside the tight band
 * before a confirmed spike anomaly self-resolves.
 *
 * Chosen as 5: deliberately stricter than the typical confirmation window
 * (~3 runs) so a brief cluster of similar values can't masquerade as a new
 * stable regime, while still resolving within a handful of check cycles rather
 * than the hours-to-days the baseline analyzer would take.
 */
export const STABLE_RESOLUTION_RUN_COUNT = 5;

/**
 * Maximum relative spread, (max − min) / max(|mean|, ε), the recent-sample
 * window may have to count as "settled". 0.10 == within 10% of each other.
 *
 * Tight enough that genuinely volatile metrics never qualify, loose enough to
 * absorb normal jitter around a new operating point.
 */
export const STABLE_RESOLUTION_RELATIVE_BAND = 0.1;

/**
 * Number of consecutive baseline-analyzer runs a confirmed *drift* anomaly must
 * show a flat (relative) slope before it self-resolves. The analyzer runs
 * hourly, so 2 runs ≈ the metric has held its new level for ~2h, which is the
 * same confidence shape as the drift confirmation threshold.
 */
export const STABLE_DRIFT_RESOLUTION_RUN_COUNT = 2;

/**
 * Relative band for "the suppressed metric changed again". When the observed
 * value moves more than 25% away from the value it was suppressed at (relative
 * to that value), the suppression auto-clears. Chosen wider than the
 * self-resolution band: suppression is a deliberate operator action, so we only
 * undo it on a clearly material move, not on routine jitter.
 */
export const SUPPRESSION_REACTIVATION_DELTA = 0.25;

/**
 * Returns true when the supplied rolling window of recent healthy samples has
 * both (a) reached the required length and (b) settled inside the tight
 * relative band — i.e. the metric has found a new stable level.
 */
export function hasSettledAtNewLevel(samples: number[]): boolean {
  if (samples.length < STABLE_RESOLUTION_RUN_COUNT) return false;

  const window = samples.slice(-STABLE_RESOLUTION_RUN_COUNT);
  const min = Math.min(...window);
  const max = Math.max(...window);
  const mean = window.reduce((sum, v) => sum + v, 0) / window.length;
  const denominator = Math.max(Math.abs(mean), Number.EPSILON);

  return (max - min) / denominator <= STABLE_RESOLUTION_RELATIVE_BAND;
}

/**
 * Append a sample to a rolling window, keeping at most
 * {@link STABLE_RESOLUTION_RUN_COUNT} most-recent entries (oldest-first).
 */
export function appendRecentSample(
  existing: number[] | undefined,
  value: number,
): number[] {
  const next = [...(existing ?? []), value];
  return next.slice(-STABLE_RESOLUTION_RUN_COUNT);
}

/**
 * Returns true when the projected drift change is flat relative to the current
 * mean — the trend has stopped walking and the metric is holding its new level.
 */
export function isDriftFlatRelative({
  projectedChange,
  mean,
}: {
  projectedChange: number;
  mean: number;
}): boolean {
  const denominator = Math.max(Math.abs(mean), Number.EPSILON);
  return Math.abs(projectedChange) / denominator <= STABLE_RESOLUTION_RELATIVE_BAND;
}

/**
 * Returns true when an observed value has moved outside the relative band
 * around the value an anomaly was suppressed at — i.e. it "changed again" and
 * suppression should auto-clear.
 */
export function hasChangedSinceSuppression({
  observedValue,
  suppressedValue,
}: {
  observedValue: number;
  suppressedValue: number;
}): boolean {
  const denominator = Math.max(Math.abs(suppressedValue), Number.EPSILON);
  return (
    Math.abs(observedValue - suppressedValue) / denominator >
    SUPPRESSION_REACTIVATION_DELTA
  );
}
