/**
 * Intra-plugin constants for the health integration.
 *
 * The run-queue contract (HEALTH_CHECK_QUEUE, HealthCheckJobPayload) and the
 * fast-path debounce + jobId builder now live in `@checkstack/healthcheck-common`
 * (`run-queue.ts`), shared by the queue owner and every enqueuing plugin. Import
 * them from there; only the plugin-specific ids below stay local.
 */

/** Fully-qualified id of the logstream strategy (pluginId.strategyId). */
export const LOGSTREAM_QUALIFIED_STRATEGY_ID = "logstream.logstream";

/** The plugin's own maintenance queue (silence + retention + rollup jobs). */
export const LOGSTREAM_MAINTENANCE_QUEUE = "logstream-maintenance";

/**
 * jobId prefix for this plugin's fast-path runs, passed to the shared
 * `fastPathJobId({ prefix, ... })`. Keeps the resulting ids byte-identical to
 * the old local `logstream-fast:...` form, so in-flight BullMQ dedupe is
 * unaffected across the extraction.
 */
export const LOGSTREAM_FAST_PATH_PREFIX = "logstream-fast";
