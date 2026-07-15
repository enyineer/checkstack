/**
 * The health-check RUN QUEUE contract - the one shape shared by
 * healthcheck-backend (which consumes the queue) and every OBSERVABILITY
 * strategy plugin whose ingest fast-path enqueues one-off runs onto it
 * (logstream, tracestream, ...). The queue is a single GLOBAL BullMQ queue
 * (the QueueManager does not namespace by plugin), and a domain plugin must
 * not import healthcheck-BACKEND, so the contract lives HERE in the common
 * leaf: the owner and every enqueuer import the same constants and the shape
 * can never drift.
 */

/** The shared health-check run queue (healthcheck-backend consumes it). */
export const HEALTH_CHECK_QUEUE = "health-checks";

/** One-off / scheduled run payload consumed by healthcheck-backend's executor. */
export interface HealthCheckJobPayload {
  configId: string;
  systemId: string;
  /** null runs the env-less slice. */
  environmentId: string | null;
}

/** Debounce bucket width for ingest fast-paths (ms): <=1 evaluation per 15s. */
export const FAST_PATH_DEBOUNCE_MS = 15_000;

/**
 * Deterministic dedupe job id for a fast-path evaluation. Every flush inside
 * the same 15s bucket produces the SAME id for a given assignment SLICE, so
 * BullMQ collapses them to one enqueued run. `environmentId` is part of the
 * id so per-environment jobs in the same bucket do NOT wrongly dedupe onto
 * each other; a `null` env (env-less slice) maps to the `_` marker. `prefix`
 * namespaces per enqueuing plugin (e.g. `"logstream-fast"`), keeping ids
 * from distinct fast-paths collision-free by construction.
 */
export function fastPathJobId({
  prefix,
  configId,
  systemId,
  environmentId,
  nowMs,
}: {
  prefix: string;
  configId: string;
  systemId: string;
  environmentId: string | null;
  nowMs: number;
}): string {
  const bucket = Math.floor(nowMs / FAST_PATH_DEBOUNCE_MS);
  const env = environmentId ?? "_";
  return `${prefix}:${configId}:${systemId}:${env}:${bucket}`;
}
