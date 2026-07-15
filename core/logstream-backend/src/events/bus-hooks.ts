import { createHook } from "@checkstack/backend-api";

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
  /**
   * `upserted` after a create; `removed` after a delete; `hidden-changed`
   * after a hide/unhide toggle (the `hidden` field carries the new state).
   */
  action: "upserted" | "removed" | "hidden-changed";
  /** New hidden state; only meaningful for `action: "hidden-changed"`. */
  hidden?: boolean;
}

export const logstreamPatternsChangedHook =
  createHook<LogstreamPatternsChangedPayload>("logstream.patterns.changed");
