import { createHook } from "@checkstack/backend-api";

/**
 * Cross-pod token lifecycle notification, emitted by the API area after a token
 * mutation commits and consumed (broadcast mode) by every pod's ingest area.
 *
 * WHY THIS EXISTS: the shared-cache invalidation the API performs reaches every
 * pod's HTTP auth verdict cache immediately (the verdict cache IS the shared
 * cache), but it cannot reach the per-pod NEGATIVE (unknown-token) cache. A
 * token MINTED moments after its hash was probed could otherwise be rejected for
 * up to the negative TTL on that pod. Unlike logstream, metricstream has NO
 * long-lived connection (HTTP push only), so there is no per-connection positive
 * verdict to evict - the `revoked`/`stream_deleted` paths are served by the
 * shared-cache delete alone, and only `minted` needs this event (to clear the
 * negative cache). The hook is defined uniformly so the seam is symmetric.
 *
 * Both emitter and consumers live in this plugin, so the hook stays
 * backend-internal. Delivery is at-least-once and asynchronous; the TTLs on the
 * pod-local negative cache remain the backstop if the bus is delayed or down.
 */
export interface MetricstreamTokensInvalidatedPayload {
  streamId: string;
  /**
   * Why the tokens changed. `revoked` / `stream_deleted` mean the tokens must
   * STOP authenticating (handled by the shared-cache delete). `minted` means a
   * NEW token exists - clear the per-pod negative caches so it authenticates
   * immediately.
   */
  reason: "revoked" | "stream_deleted" | "minted";
  tokenIds: string[];
  /** sha256 hex hashes, matching the ingest auth cache keys. */
  tokenHashes: string[];
}

export const metricstreamTokensInvalidatedHook =
  createHook<MetricstreamTokensInvalidatedPayload>(
    "metricstream.tokens.invalidated",
  );
