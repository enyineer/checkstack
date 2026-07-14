/** Intra-plugin constants for the tracestream maintenance jobs. */

/** The plugin's own maintenance queue (decision + rollup + sweep + cleanup). */
export const TRACESTREAM_MAINTENANCE_QUEUE = "tracestream-maintenance";

/** How many undecided traces to decide per page (per stream, per tick). */
export const DECISION_BATCH = 500;

/** How many unretained traces to hot-sweep spans for per batch. */
export const SWEEP_BATCH = 1000;

/** A stream is "silent" after this long with no received spans. */
export const SILENCE_THRESHOLD_MS = 15 * 60 * 1000;
