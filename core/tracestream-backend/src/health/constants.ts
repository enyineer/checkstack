/** Intra-plugin constants for the tracestream maintenance jobs. */

/** The plugin's own maintenance queue (decision + rollup + sweep + cleanup). */
export const TRACESTREAM_MAINTENANCE_QUEUE = "tracestream-maintenance";

/** How many undecided traces to decide per page (per stream, per tick). */
export const DECISION_BATCH = 500;

/** How many unretained traces to hot-sweep spans for per batch. */
export const SWEEP_BATCH = 1000;

/** A stream is "silent" after this long with no received spans. */
export const SILENCE_THRESHOLD_MS = 15 * 60 * 1000;

// ============================================================================
// HEALTH-CHECK INTEGRATION (strategy + fast-path)
// ============================================================================
//
// The run-queue contract (HEALTH_CHECK_QUEUE, HealthCheckJobPayload) and the
// fast-path debounce + jobId builder now live in `@checkstack/healthcheck-common`
// (`run-queue.ts`), shared by the queue owner and every enqueuing plugin. Import
// them from there; only the plugin-specific ids below stay local.

/** Fully-qualified id of the tracestream strategy (pluginId.strategyId). */
export const TRACESTREAM_QUALIFIED_STRATEGY_ID = "tracestream.tracestream";

/**
 * jobId prefix for this plugin's fast-path runs, passed to the shared
 * `fastPathJobId({ prefix, ... })`. Keeps the resulting ids byte-identical to
 * the old local `tracestream-fast:...` form, so in-flight BullMQ dedupe is
 * unaffected across the extraction.
 */
export const TRACESTREAM_FAST_PATH_PREFIX = "tracestream-fast";
