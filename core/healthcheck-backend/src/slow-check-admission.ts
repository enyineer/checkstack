/**
 * The slow-check bulkhead + adaptive-timeout DECISION for one run of a
 * `(configId, systemId, environmentId)` slice. Pure except for the lane
 * admission side effect (a semaphore acquire), so it is directly unit-testable
 * without the executor's DB/queue machinery. The executor supplies the slice's
 * recent runs (read from durable `health_check_runs`) and acts on the verdict:
 * a `defer` records nothing this tick, a `run` uses the (possibly shrunk)
 * `effectiveTimeoutMs` and releases `laneKey` when set.
 */
import type { SlowCheckRuntime } from "./slow-check-config";
import {
  classifySlowCheck,
  ENV_LESS_KEY,
  type RecentRun,
} from "./slow-check-classifier";
import { adaptiveTimeout } from "./adaptive-timeout";

export type SlowCheckDecision =
  | {
      kind: "run";
      /** Timeout to probe with (shrunk toward the healthy baseline when suspect). */
      effectiveTimeoutMs: number;
      /** Set when a suspect run was admitted to the lane; release it after the run. */
      laneKey?: string;
    }
  | {
      kind: "defer";
      /** `lane_full` (pod at capacity) or `in_flight` (prior run of this slice). */
      reason: "lane_full" | "in_flight";
    };

/**
 * Build the lane single-flight key for a slice. Keyed on `(config, system, env)`
 * so distinct envs of one system get independent slots and a slice can never be
 * in flight against itself.
 */
export function slowCheckLaneKey(props: {
  configId: string;
  systemId: string;
  environmentId: string | null;
}): string {
  const { configId, systemId, environmentId } = props;
  return `${configId}:${systemId}:${environmentId ?? ENV_LESS_KEY}`;
}

/**
 * Decide whether to run this slice and with what timeout. A non-suspect slice
 * always runs at the full timeout with no lane involvement. A suspect slice is
 * admitted to the capped, pod-local lane (returning `laneKey` to release after
 * the run) and probed with an adaptive timeout, OR deferred when the lane is
 * full / a prior run of the same slice is still in flight.
 */
export function evaluateSlowCheckAdmission(props: {
  runtime: SlowCheckRuntime;
  recentRuns: RecentRun[];
  configId: string;
  systemId: string;
  environmentId: string | null;
  executionTimeoutMs: number;
}): SlowCheckDecision {
  const {
    runtime,
    recentRuns,
    configId,
    systemId,
    environmentId,
    executionTimeoutMs,
  } = props;

  const { perEnv } = classifySlowCheck({
    runs: recentRuns,
    params: {
      ...runtime.classifierParams,
      configuredTimeoutMs: executionTimeoutMs,
    },
  });
  const classification = perEnv.get(environmentId ?? ENV_LESS_KEY);

  if (!classification?.suspect) {
    return { kind: "run", effectiveTimeoutMs: executionTimeoutMs };
  }

  const laneKey = slowCheckLaneKey({ configId, systemId, environmentId });
  const admission = runtime.lane.tryAdmit(laneKey);
  if (!admission.admitted) {
    return { kind: "defer", reason: admission.reason };
  }

  return {
    kind: "run",
    laneKey,
    effectiveTimeoutMs: adaptiveTimeout({
      configuredMs: executionTimeoutMs,
      healthyBaselineMs: classification.healthyBaselineMs,
      isSuspect: true,
      isRecoveryProbe: classification.isRecoveryProbe,
      safetyFactor: runtime.safetyFactor,
      absoluteFloorMs: runtime.absoluteFloorMs,
    }),
  };
}
