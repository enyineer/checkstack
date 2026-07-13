import { createHook } from "@checkstack/backend-api";

/**
 * Cross-pod token lifecycle notification, emitted by the API area after a
 * token mutation commits and consumed (broadcast mode) by every pod's ingest
 * area.
 *
 * WHY THIS EXISTS: the shared-cache invalidation the API already performs
 * reaches every pod's HTTP auth path immediately (the verdict cache IS the
 * shared cache), but it cannot reach state held in another pod's process
 * memory. Two such states exist:
 *
 * - a long-lived syslog connection's per-connection verdict (re-verified only
 *   every 60s) - without this event, a REVOKED token keeps ingesting on an
 *   already-open connection until that TTL expires;
 * - the per-pod negative (unknown-token) cache - without this event, a token
 *   MINTED moments after its hash was probed could be rejected for up to the
 *   negative TTL on that pod.
 *
 * Both emitter and consumers live in this plugin, so the hook contract stays
 * backend-internal. Delivery is at-least-once and asynchronous; the TTLs on
 * both pod-local caches remain as the backstop if the bus is delayed or down.
 */
export interface LogstreamTokensInvalidatedPayload {
  streamId: string;
  /**
   * Why the tokens changed. `revoked` and `stream_deleted` mean the tokens
   * must STOP authenticating (evict positive per-connection verdicts);
   * `minted` means a NEW token exists (clear negative caches so it starts
   * authenticating immediately).
   */
  reason: "revoked" | "stream_deleted" | "minted";
  tokenIds: string[];
  /** sha256 hex hashes, matching the ingest auth cache keys. */
  tokenHashes: string[];
}

export const logstreamTokensInvalidatedHook =
  createHook<LogstreamTokensInvalidatedPayload>(
    "logstream.tokens.invalidated",
  );

/**
 * Cross-pod user-pattern sync, emitted by the API area after a `createPattern` /
 * `deletePattern` commits and consumed (broadcast mode) by every pod's ingest
 * area, which calls `DrainEngine.upsertUserPattern` / `removeUserPattern` to
 * keep its in-memory tree in step.
 *
 * WHY THIS EXISTS: user patterns are protected clusters held in each pod's
 * process-local Drain tree (a throughput cache). The `log_patterns` row the API
 * writes is durable and every pod re-hydrates it on a stream's first line after
 * boot - but a pod that has ALREADY hydrated the stream would not pick up a
 * pattern authored moments later until it evicts and re-hydrates. This event
 * closes that window immediately, exactly as the tokens-invalidated hook does
 * for the per-connection auth cache.
 *
 * Both emitter and consumers live in this plugin, so the hook stays
 * backend-internal. Delivery is at-least-once and asynchronous; a pod that
 * misses it still converges on its next hydration (the durable row is the
 * source of truth).
 */
export interface LogstreamPatternsChangedPayload {
  streamId: string;
  patternId: string;
  /** The pattern's masked template (so a consumer can seed without a DB read). */
  template: string;
  /** `upserted` after a create; `removed` after a delete. */
  action: "upserted" | "removed";
}

export const logstreamPatternsChangedHook =
  createHook<LogstreamPatternsChangedPayload>("logstream.patterns.changed");
