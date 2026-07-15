import { createHook } from "@checkstack/backend-api";

/**
 * Backend event-bus hook: a REQUEST for every pod to reconcile the pod-local
 * runtime it holds for a source instance, emitted after a create/update/delete.
 * This is the BACKEND cross-pod path (distinct from the frontend-facing
 * `TELEMETRY_SOURCE_CHANGED` signal): every pod's listener manager subscribes in
 * broadcast mode and reconciles the affected source (start a newly-enabled
 * listener, stop a disabled/deleted one, restart on config change), so a socket
 * only THIS pod holds converges cluster-wide.
 *
 * NOTE: this is deliberately NOT a `defineEntity` change event - a source
 * instance is a plain CRUD row, not a reactive entity, and this hook carries a
 * reconcile REQUEST, not authoritative state. Its id therefore avoids the
 * entity-change suffix convention. Delivery is at-least-once and asynchronous; a
 * manager's own boot reconcile is the backstop if the bus is delayed.
 */
export interface TelemetrySourceReconcilePayload {
  sourceId: string;
  reason: "created" | "updated" | "deleted";
}

export const telemetrySourceReconcileHook =
  createHook<TelemetrySourceReconcilePayload>(
    "telemetry.source.reconcile-requested",
  );

/**
 * Backend event-bus hook: a push-mode instance's cached ingest verdict must be
 * reconverged across every pod. The two reasons are cache OPERATIONS, not
 * statements about a token's permanent validity:
 *
 * - "revoked" = EVICT any cached verdict for this hash (shared positive-key
 *   delete + miss-marker delete). Emitted whenever a warm verdict would now be
 *   wrong, which is BROADER than a permanent revocation: on delete, on disable,
 *   on rotate (for the OLD hash), AND on a BINDING CHANGE (the cached verdict
 *   embeds the bound streamId, so a re-bind must evict it - the token itself
 *   stays valid and simply re-resolves against the new binding on the next
 *   request). The consumer must not treat "revoked" as "this token is dead".
 * - "minted" = `clearNegative(hash)` so a freshly valid token is not shadowed by
 *   a pod's negative LRU / miss marker for its TTL. Emitted on create, on rotate
 *   (for the NEW hash), and on re-enable.
 *
 * Consumers are the plugins that OWN a push endpoint: each subscribes in
 * broadcast mode, filters on its own `sourceTypeId`s, and applies the operation
 * to its `IngestAuthenticator` caches. Delivery is at-least-once; the 60s
 * positive-cache TTL bounds the stale window if a "revoked" event is lost.
 */
export interface TelemetryPushTokenInvalidatedPayload {
  sourceTypeId: string;
  sourceId: string;
  /** sha256 hex of the affected token (never the token itself). */
  tokenHash: string;
  reason: "minted" | "revoked";
}

export const telemetryPushTokenInvalidatedHook =
  createHook<TelemetryPushTokenInvalidatedPayload>(
    "telemetry.push-token.invalidated",
  );
