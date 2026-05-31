import { createHook } from "@checkstack/backend-api";
import type { DerivedState } from "@checkstack/dependency-common";

/**
 * Dependency hooks for cross-plugin communication.
 * Other plugins can subscribe to these hooks to react to dependency changes.
 *
 * `impactType` and the derived-state fields carry the canonical
 * `ImpactType` / `DerivedState` enum values, so automation triggers
 * built on these hooks can offer the known values for `==` comparisons
 * in the editor.
 */
export const dependencyHooks = {
  // The `dependency.created` / `.updated` / `.deleted` hooks were removed in
  // Phase 4 (§10.5): dependency edges are now the reactive `dependency-edge`
  // entity, whose change deriver fires the matching `dependency.created` /
  // `.updated` / `.deleted` trigger events through Stage-1 routing. The
  // `impact_propagated` hook below is KEPT — it is a derived fan-out signal
  // (per-downstream deltas), not a single mutable entity field.

  /**
   * Emitted when an upstream system's state change has propagated
   * through the dependency graph and produced derived-state changes
   * on one or more downstream systems. Carries the list of affected
   * downstream systems with their previous and new derived states so
   * subscribers don't have to re-query the graph.
   *
   * Fires only when at least one downstream state actually changed —
   * upstream events that don't move any downstream's derived state
   * are silent. Emitted from `evaluateAndNotifyDownstream` once per
   * upstream event (deduplicated by `sourceSystemId`, not by
   * downstream).
   */
  impactPropagated: createHook<{
    sourceSystemId: string;
    affectedSystems: Array<{
      systemId: string;
      previousState: DerivedState | null;
      newState: DerivedState | null;
    }>;
    timestamp: string;
  }>("dependency.impact_propagated"),
} as const;
