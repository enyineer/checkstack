/**
 * Adaptive execution timeout for slot-hogging health checks.
 *
 * A check that hangs holds its concurrency slot for the FULL configured timeout
 * (see `queue-executor.ts` — the per-env `Promise.race` frees the slot only when
 * the timeout fires). When a target is consistently timing out, we can free that
 * slot sooner by probing it with a SHORTER timeout — but only down to a value at
 * which a genuinely HEALTHY run of this same check would still succeed, or we
 * would abort even a recovering target and never let it go healthy again.
 *
 * The floor is therefore derived from the check's OWN measured healthy latency,
 * never a global constant. Four guardrails make a recovery deadlock impossible:
 *
 *   1. No baseline (no recent healthy run) => NO shrink. Without evidence of the
 *      target's healthy latency we cannot tell "hung" from "legitimately slow and
 *      about to succeed", so we keep the full configured timeout.
 *   2. The baseline is computed from SUCCESSFUL runs only (caller's job), so a
 *      timed-out run (latency ~= timeout) can never ratchet the floor downward.
 *   3. The periodic recovery probe passes `isRecoveryProbe: true` and always gets
 *      the FULL configured timeout — so a genuinely-slow-but-healthy target (e.g.
 *      a 10s computation) is always eventually re-measured at its real latency.
 *      This is the by-construction deadlock breaker.
 *   4. A single healthy run clears the suspect classification upstream, so the
 *      full timeout is restored immediately (hysteresis).
 */

/** Default multiplier applied to the healthy-latency baseline. */
export const DEFAULT_TIMEOUT_SAFETY_FACTOR = 1.5;
/** Default absolute lower bound; the timeout is never shrunk below this. */
export const DEFAULT_TIMEOUT_ABSOLUTE_FLOOR_MS = 1000;

export interface AdaptiveTimeoutInput {
  /** The user-configured execution timeout (ms). The shrink never exceeds it. */
  configuredMs: number;
  /**
   * p95 (or max) latency of this check's recent SUCCESSFUL runs, in ms.
   * `undefined` means "no healthy baseline" => guardrail 1 (never shrink).
   */
  healthyBaselineMs: number | undefined;
  /** Whether this check is classified as a consistent slot-hogging failure. */
  isSuspect: boolean;
  /** Whether this run is the periodic full-timeout recovery probe (guardrail 3). */
  isRecoveryProbe: boolean;
  /** Multiplier on the baseline. Defaults to {@link DEFAULT_TIMEOUT_SAFETY_FACTOR}. */
  safetyFactor?: number;
  /** Hard lower bound. Defaults to {@link DEFAULT_TIMEOUT_ABSOLUTE_FLOOR_MS}. */
  absoluteFloorMs?: number;
}

/**
 * Resolve the effective execution timeout for a single (env-scoped) run.
 * Returns `configuredMs` unchanged unless the check is a suspect slot-hogger
 * WITH a healthy baseline AND this is not a recovery probe.
 */
export function adaptiveTimeout(input: AdaptiveTimeoutInput): number {
  const {
    configuredMs,
    healthyBaselineMs,
    isSuspect,
    isRecoveryProbe,
    safetyFactor = DEFAULT_TIMEOUT_SAFETY_FACTOR,
    absoluteFloorMs = DEFAULT_TIMEOUT_ABSOLUTE_FLOOR_MS,
  } = input;

  // Guardrails 1 & 3, and the non-suspect fast path: use the full timeout.
  if (!isSuspect || isRecoveryProbe || healthyBaselineMs === undefined) {
    return configuredMs;
  }

  // Shrink toward the target's own healthy latency, clamped to
  // [absoluteFloor, configured]. For a 10s-healthy check this stays >= ~15s;
  // for a 200ms-healthy check it drops to the floor (~1s).
  const shrunk = Math.round(healthyBaselineMs * safetyFactor);
  return Math.min(configuredMs, Math.max(absoluteFloorMs, shrunk));
}
