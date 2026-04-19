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
