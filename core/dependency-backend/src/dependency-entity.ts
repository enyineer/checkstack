/**
 * The reactive `dependency-edge` entity (reactive automation engine §10.5).
 *
 * Behavior-preserving MIRROR: the `dependencies` table stays authoritative;
 * the router/action mutation sites mirror the reactive subset
 * `{ sourceSystemId, targetSystemId, impactType, transitive }` into the
 * framework entity store keyed by dependency id. The change → trigger-event
 * deriver reproduces the existing `dependency.created/.updated/.deleted`
 * qualified events so automations keep firing.
 *
 * `dependency_derived_states` (the propagation cursor) and the
 * `dependency.impact_propagated` notification stay NON-reactive (§5):
 * derived per-system state is reachable via the `health` entity, and
 * impact propagation is a fan-out signal, not a single mutable field.
 */
import { z } from "zod";
import { ImpactTypeSchema } from "@checkstack/dependency-common";
import type {
  EntityChangeDeriver,
  EntityHandle,
} from "@checkstack/automation-backend";

export const DEPENDENCY_EDGE_ENTITY_KIND = "dependency-edge";

export const DependencyEdgeStateSchema = z.object({
  sourceSystemId: z.string(),
  targetSystemId: z.string(),
  impactType: ImpactTypeSchema,
  transitive: z.boolean(),
});

export type DependencyEdgeState = z.infer<typeof DependencyEdgeStateSchema>;

export const DEPENDENCY_TRIGGER_EVENTS = {
  created: "dependency.created",
  updated: "dependency.updated",
  deleted: "dependency.deleted",
} as const;

/**
 * `dependency-edge` change → trigger events. Create (`prev === null`),
 * tombstone (`next === null`), or a field update map to the matching
 * lifecycle event (the entity store suppresses no-op diffs, so an update
 * always carries a real change).
 */
export const deriveDependencyTriggerEvents: EntityChangeDeriver = (changed) => {
  if (changed.prev === null && changed.next !== null) {
    return [DEPENDENCY_TRIGGER_EVENTS.created];
  }
  if (changed.next === null) {
    return [DEPENDENCY_TRIGGER_EVENTS.deleted];
  }
  return [DEPENDENCY_TRIGGER_EVENTS.updated];
};

/** Mirror a dependency edge into the entity (fail-soft). */
export async function mirrorDependencyEdge(args: {
  handle: EntityHandle<DependencyEdgeState> | undefined;
  dependencyId: string;
  sourceSystemId: string;
  targetSystemId: string;
  impactType: DependencyEdgeState["impactType"];
  transitive: boolean;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const {
    handle,
    dependencyId,
    sourceSystemId,
    targetSystemId,
    impactType,
    transitive,
    onError,
  } = args;
  if (!handle) return;
  try {
    await handle.set(dependencyId, {
      sourceSystemId,
      targetSystemId,
      impactType,
      transitive,
    });
  } catch (error) {
    onError?.(error);
  }
}

/** Tombstone a dependency edge entity (fail-soft). */
export async function removeDependencyEdge(args: {
  handle: EntityHandle<DependencyEdgeState> | undefined;
  dependencyId: string;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { handle, dependencyId, onError } = args;
  if (!handle) return;
  try {
    await handle.remove(dependencyId);
  } catch (error) {
    onError?.(error);
  }
}
