/**
 * Cross-plugin + intra-plugin constants for the health integration.
 *
 * `HEALTH_CHECK_QUEUE` and `LogStreamRunJobPayload` MIRROR healthcheck-backend's
 * queue contract (`core/healthcheck-backend/src/queue-executor.ts`). They are
 * re-declared here on purpose: the queue is a single GLOBAL BullMQ queue (the
 * QueueManager does NOT namespace by plugin), so logstream can enqueue a one-off
 * run onto it directly - but importing healthcheck-BACKEND would violate the
 * domain->domain dependency rule. Re-declaring the small shared shape keeps the
 * direction legal. If healthcheck ever changes the queue name or payload, this
 * must change in lock-step (guarded by the fast-path integration test).
 */

/** The shared health-check run queue (healthcheck-backend consumes it). */
export const HEALTH_CHECK_QUEUE = "health-checks";

/** One-off run payload, mirroring healthcheck's `HealthCheckJobPayload`. */
export interface LogStreamRunJobPayload {
  configId: string;
  systemId: string;
  /** null runs the env-less slice - the stream metrics are env-independent. */
  environmentId: string | null;
}

/** Fully-qualified id of the logstream strategy (pluginId.strategyId). */
export const LOGSTREAM_QUALIFIED_STRATEGY_ID = "logstream.logstream";

/** The plugin's own maintenance queue (silence + retention + rollup jobs). */
export const LOGSTREAM_MAINTENANCE_QUEUE = "logstream-maintenance";

/** Debounce bucket width for the fast-path (ms): <=1 evaluation per 15s. */
export const FAST_PATH_DEBOUNCE_MS = 15_000;

/**
 * Deterministic dedupe job id for a fast-path evaluation. Every flush inside
 * the same 15s bucket produces the SAME id for a given assignment SLICE, so
 * BullMQ collapses them to one enqueued run. `environmentId` is part of the id
 * so per-environment jobs in the same bucket do NOT wrongly dedupe onto each
 * other; a `null` env (env-less slice) maps to the `_` marker.
 */
export function fastPathJobId({
  configId,
  systemId,
  environmentId,
  nowMs,
}: {
  configId: string;
  systemId: string;
  environmentId: string | null;
  nowMs: number;
}): string {
  const bucket = Math.floor(nowMs / FAST_PATH_DEBOUNCE_MS);
  const env = environmentId ?? "_";
  return `logstream-fast:${configId}:${systemId}:${env}:${bucket}`;
}
