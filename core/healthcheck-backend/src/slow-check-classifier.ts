/**
 * Classify a health check's recent runs to drive the slow-check bulkhead and the
 * adaptive timeout. Pure and derived entirely from durable `health_check_runs`
 * rows, so every pod computes the same classification (state-and-scale: no
 * pod-local classification state).
 *
 * Granularities, matching the executor's execution model (one `(configId,
 * systemId)` JOB holds one concurrency slot and runs its environments
 * SEQUENTIALLY, each with its own timeout):
 *
 * Classification is PER ENV: each env's `suspect`, `healthyBaselineMs`, and
 * `isRecoveryProbe` drive its OWN lane admission and adaptive timeout inside the
 * job's execution loop. A failing env is admitted to the capped suspect lane (or
 * skipped when the lane is full) and probed with a shrunk timeout, while a
 * healthy sibling env in the SAME job runs normally at its full timeout in its
 * own loop iteration. So one failing env is isolated without ever starving or
 * dropping a healthy sibling env - and the bulkhead engages in the common
 * mixed-stage case (only some envs down), not just when every env is down.
 */
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";

/** A recent run row, projected to the fields classification needs. */
export interface RecentRun {
  environmentId: string | null;
  status: HealthCheckStatus;
  latencyMs: number | null;
  timestamp: Date;
}

export interface SlowCheckParams {
  /** The check's configured execution timeout (ms) - the slot-hog latency ref. */
  configuredTimeoutMs: number;
  /** Consecutive slot-hog failures required to classify an env suspect. */
  consecutiveFailures?: number;
  /** Fraction of the timeout a failed run's latency must reach to count as a
   *  slot-hog (vs a fast connect-refused that frees its slot instantly). */
  slowFraction?: number;
  /** Every Nth consecutive suspect run is a full-timeout recovery probe. */
  recoveryProbeEvery?: number;
}

export interface EnvClassification {
  suspect: boolean;
  /** p95 latency (ms) of this env's recent HEALTHY runs; `undefined` if none. */
  healthyBaselineMs: number | undefined;
  /** This run should use the full configured timeout to re-measure recovery. */
  isRecoveryProbe: boolean;
}

export interface SlowCheckClassification {
  /** Per-env classification, keyed by `environmentId ?? ENV_LESS_KEY`. */
  perEnv: Map<string, EnvClassification>;
}

export const DEFAULT_CONSECUTIVE_FAILURES = 3;
export const DEFAULT_SLOW_FRACTION = 0.8;
export const DEFAULT_RECOVERY_PROBE_EVERY = 5;
/** Map key used for the env-less run (`environmentId === null`). */
export const ENV_LESS_KEY = "_";

/** p95 of a non-empty list (nearest-rank). */
function p95(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/** True when a run held its slot ~for the timeout (a slow failure), not a fast
 *  fail. Both connect-timeout and post-connect-timeout land here; a fast
 *  connection-refused (low latency) does not. */
function isSlotHogFailure(run: RecentRun, slowLatencyMs: number): boolean {
  return run.status !== "healthy" && (run.latencyMs ?? 0) >= slowLatencyMs;
}

function classifyEnv(
  runsNewestFirst: RecentRun[],
  params: Required<SlowCheckParams>,
): EnvClassification {
  const { configuredTimeoutMs, consecutiveFailures, slowFraction, recoveryProbeEvery } =
    params;
  const slowLatencyMs = configuredTimeoutMs * slowFraction;

  // Count leading consecutive slot-hog failures from the most recent run.
  let leadingSlowFailures = 0;
  for (const run of runsNewestFirst) {
    if (isSlotHogFailure(run, slowLatencyMs)) leadingSlowFailures++;
    else break;
  }

  const suspect = leadingSlowFailures >= consecutiveFailures;

  const healthyLatencies = runsNewestFirst
    .filter((r) => r.status === "healthy" && r.latencyMs !== null)
    .map((r) => r.latencyMs!);
  const healthyBaselineMs =
    healthyLatencies.length > 0 ? p95(healthyLatencies) : undefined;

  // Guardrail 3: every Nth consecutive suspect run is a full-timeout probe.
  // Uses the failure streak BEFORE this run, so the streak lengths that trip a
  // probe are recoveryProbeEvery, 2x, 3x, ...
  const isRecoveryProbe =
    suspect && leadingSlowFailures % recoveryProbeEvery === 0;

  return { suspect, healthyBaselineMs, isRecoveryProbe };
}

/**
 * Classify recent runs for one `(configId, systemId)` across all environments.
 * `runs` must be newest-first (as `ORDER BY timestamp DESC` returns them).
 */
export function classifySlowCheck(props: {
  runs: RecentRun[];
  params: SlowCheckParams;
}): SlowCheckClassification {
  const params: Required<SlowCheckParams> = {
    consecutiveFailures: DEFAULT_CONSECUTIVE_FAILURES,
    slowFraction: DEFAULT_SLOW_FRACTION,
    recoveryProbeEvery: DEFAULT_RECOVERY_PROBE_EVERY,
    ...props.params,
  };

  // Bucket by env, preserving newest-first order within each bucket.
  const byEnv = new Map<string, RecentRun[]>();
  for (const run of props.runs) {
    const key = run.environmentId ?? ENV_LESS_KEY;
    const bucket = byEnv.get(key);
    if (bucket) bucket.push(run);
    else byEnv.set(key, [run]);
  }

  const perEnv = new Map<string, EnvClassification>();
  for (const [key, envRuns] of byEnv) {
    perEnv.set(key, classifyEnv(envRuns, params));
  }

  return { perEnv };
}
