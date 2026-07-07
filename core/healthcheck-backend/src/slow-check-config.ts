/**
 * Runtime configuration for the slow-check bulkhead + adaptive timeout, resolved
 * once at worker startup from environment variables. When disabled (the kill
 * switch, or an invalid capacity), the executor skips the classification read
 * and the whole feature is inert - health checks run exactly as before.
 *
 * The bulkhead lane is pod-local infrastructure (like the queue's own
 * concurrency semaphore): total suspect concurrency across the cluster is
 * `capacity x pods`, scaling the same way queue concurrency already does.
 */
import { SuspectLane } from "./suspect-lane";
import {
  DEFAULT_CONSECUTIVE_FAILURES,
  DEFAULT_RECOVERY_PROBE_EVERY,
  DEFAULT_SLOW_FRACTION,
  type SlowCheckParams,
} from "./slow-check-classifier";
import {
  DEFAULT_TIMEOUT_ABSOLUTE_FLOOR_MS,
  DEFAULT_TIMEOUT_SAFETY_FACTOR,
} from "./adaptive-timeout";

export interface SlowCheckRuntime {
  /** Pod-local admission control for suspect (slot-hogging) env-runs. */
  lane: SuspectLane;
  /** How many recent runs (per config+system, across envs) to classify over. */
  recentRunsLimit: number;
  /** Classifier tuning (consecutive-failure count, slow fraction, probe cadence). */
  classifierParams: Omit<SlowCheckParams, "configuredTimeoutMs">;
  /** Adaptive-timeout multiplier on the healthy-latency baseline. */
  safetyFactor: number;
  /** Adaptive-timeout absolute lower bound (ms). */
  absoluteFloorMs: number;
}

export const DEFAULT_SLOW_LANE_CAPACITY = 3;
export const DEFAULT_RECENT_RUNS_LIMIT = 20;

function numberFrom(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isDisabled(raw: string | undefined): boolean {
  return raw === "0" || raw?.toLowerCase() === "false";
}

/**
 * Resolve the slow-check runtime from env vars. Returns `null` when the feature
 * is disabled (kill switch, or a non-positive capacity), which the executor
 * treats as "run exactly as before".
 */
export function resolveSlowCheckRuntime(
  env: Record<string, string | undefined>,
): SlowCheckRuntime | null {
  if (isDisabled(env.CHECKSTACK_HEALTHCHECK_SLOW_LANE_ENABLED)) return null;

  const capacity = Math.floor(
    numberFrom(env.CHECKSTACK_HEALTHCHECK_SLOW_LANE_CAPACITY, DEFAULT_SLOW_LANE_CAPACITY),
  );
  if (!Number.isInteger(capacity) || capacity < 1) return null;

  return {
    lane: new SuspectLane(capacity),
    recentRunsLimit: Math.max(
      1,
      Math.floor(
        numberFrom(env.CHECKSTACK_HEALTHCHECK_SLOW_RECENT_RUNS, DEFAULT_RECENT_RUNS_LIMIT),
      ),
    ),
    classifierParams: {
      consecutiveFailures: Math.max(
        1,
        Math.floor(
          numberFrom(
            env.CHECKSTACK_HEALTHCHECK_SLOW_CONSECUTIVE_FAILURES,
            DEFAULT_CONSECUTIVE_FAILURES,
          ),
        ),
      ),
      slowFraction: numberFrom(env.CHECKSTACK_HEALTHCHECK_SLOW_FRACTION, DEFAULT_SLOW_FRACTION),
      recoveryProbeEvery: Math.max(
        1,
        Math.floor(
          numberFrom(
            env.CHECKSTACK_HEALTHCHECK_SLOW_RECOVERY_PROBE_EVERY,
            DEFAULT_RECOVERY_PROBE_EVERY,
          ),
        ),
      ),
    },
    safetyFactor: numberFrom(
      env.CHECKSTACK_HEALTHCHECK_SLOW_SAFETY_FACTOR,
      DEFAULT_TIMEOUT_SAFETY_FACTOR,
    ),
    absoluteFloorMs: numberFrom(
      env.CHECKSTACK_HEALTHCHECK_SLOW_FLOOR_MS,
      DEFAULT_TIMEOUT_ABSOLUTE_FLOOR_MS,
    ),
  };
}
