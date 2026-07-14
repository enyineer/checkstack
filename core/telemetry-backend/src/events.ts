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
