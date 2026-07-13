/**
 * How often satellites send heartbeats to the core (in milliseconds).
 */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * How long the core waits before considering a satellite offline (in milliseconds).
 * Set to 3× the heartbeat interval to tolerate brief network hiccups.
 */
export const OFFLINE_THRESHOLD_MS = 45_000;

/**
 * Maximum number of health check results to buffer in-memory
 * on the satellite when the WebSocket connection is lost.
 * Oldest results are dropped when the buffer is full (FIFO ring buffer).
 */
export const RESULT_BUFFER_CAPACITY = 100;

/**
 * Base delay for reconnection backoff (in milliseconds).
 * Actual delay uses exponential backoff with jitter.
 */
export const RECONNECT_BASE_MS = 1000;

/**
 * Maximum delay between reconnection attempts (in milliseconds).
 */
export const RECONNECT_MAX_MS = 30_000;

// =============================================================================
// TELEMETRY FLOW CONTROL (satellite -> core telemetry_batch channel)
//
// These bound the ADDITIVE telemetry path (log/metric forwarding + satellite
// scraping) and are entirely separate from the health-result path, which stays
// ack-less. The agent runs a credit window (at most TELEMETRY_MAX_INFLIGHT
// unacked batches), chunks each batch under the item AND byte caps (both far
// under Bun's ~16MB frame cap), and resends by batchId until acked; the core
// dedupes per connection on batchId and enforces a per-connection byte budget.
// =============================================================================

/**
 * Maximum number of unacked telemetry batches a satellite may have in flight at
 * once (the agent's credit window). Bounds memory the agent holds for resend and
 * the concurrency the core must dedupe/route per connection.
 */
export const TELEMETRY_MAX_INFLIGHT = 4;

/** Maximum number of items a single telemetry batch may carry. */
export const TELEMETRY_BATCH_MAX_ITEMS = 2000;

/**
 * Approximate maximum serialized size (bytes) of a single telemetry batch. Kept
 * far under the ~16MB WS frame cap so a batch can never be dropped at the
 * transport layer.
 */
export const TELEMETRY_BATCH_MAX_BYTES = 1_000_000;

/**
 * Size of the per-connection batchId dedupe window the CORE keeps. A resent
 * batch whose id is still remembered is deduped and re-acked with the remembered
 * counts. The window need only cover the in-flight set plus recent history, so a
 * small multiple of {@link TELEMETRY_MAX_INFLIGHT} is ample.
 */
export const TELEMETRY_DEDUPE_WINDOW = 256;

/**
 * Per-connection telemetry ingress budget (bytes per minute) the CORE enforces
 * so a single satellite cannot starve the socket/pod. Over-budget batches get a
 * retryable ack (resend later) and a warning - never a disconnect.
 */
export const TELEMETRY_BUDGET_BYTES_PER_MIN = 64 * 1024 * 1024;

/**
 * How long the AGENT waits for a `telemetry_ack` before resending a batch by its
 * (still-inflight) batchId.
 */
export const TELEMETRY_ACK_TIMEOUT_MS = 30_000;

/**
 * How often the AGENT's telemetry sender pumps buffered items into batches while
 * connected and under the credit window.
 */
export const TELEMETRY_PUMP_INTERVAL_MS = 250;
