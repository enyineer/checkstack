/**
 * The reactive `dependency-edge` entity (reactive automation engine §10.5).
 *
 * Model B PLUGIN-BACKED entity: the `dependencies` table is authoritative AND
 * IS the entity's current-state storage — there is NO framework `entity_state`
 * row for a dependency edge. `defineEntity({ read })` makes that plugin state
 * reactive: every reactive-state write goes through `handle.mutate`, whose
 * `apply()` performs the REAL `dependencies` write via the `DependencyService`
 * (the plugin's own db/tx) and returns the resulting reactive subset
 * `{ sourceSystemId, targetSystemId, impactType, transitive }`. The framework
 * snapshots `prev` via `read`, appends the transition log (its own db), and
 * emits `ENTITY_CHANGED`. The change → trigger-event deriver reproduces
 * `dependency.created/.updated/.deleted` so automations keep firing.
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
  EntityChangePayloadMapper,
  EntityHandle,
  EntityRead,
} from "@checkstack/automation-backend";
import {
  withEntityRemove,
  withEntityWrite,
} from "@checkstack/automation-backend";

import type { DependencyService } from "./services/dependency-service";

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
 * lifecycle event (the handle suppresses no-op diffs, so an update always
 * carries a real change).
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

/**
 * Map a `dependency-edge` change to the domain-named `trigger.payload` the
 * dependency triggers declare via `payloadSchema` (`dependencyId`,
 * `sourceSystemId`, `targetSystemId`, `impactType`). Restores the keys
 * operators read (`trigger.payload.dependencyId`, `.sourceSystemId`, …) that
 * the generic change shape omits.
 *
 * `dependencyId` is the entity id. The edge fields are read from `next`, or
 * from `prev` on a tombstone (`deleted`), so a delete trigger still carries
 * the removed edge's endpoints. `impactType` is omitted on a delete (the
 * `deleted` schema does not declare it).
 */
export const dependencyChangeToPayload: EntityChangePayloadMapper = (
  changed,
) => {
  const source = changed.next ?? changed.prev;
  const impactType = source?.["impactType"];
  return {
    dependencyId: changed.id,
    sourceSystemId: source?.["sourceSystemId"],
    targetSystemId: source?.["targetSystemId"],
    ...(impactType === undefined ? {} : { impactType }),
  };
};

/**
 * Build the PLUGIN-BACKED `read` accessor for the `dependency-edge` entity.
 * Routes straight to the service's batched authoritative read over the
 * `dependencies` table — no framework storage.
 */
export function createDependencyEntityRead(
  service: DependencyService,
): EntityRead<DependencyEdgeState> {
  return (ids) => service.getManyEntityStates(ids);
}

/**
 * Project a dependency row onto the reactive `{ sourceSystemId,
 * targetSystemId, impactType, transitive }` subset. The router/action service
 * writes return the full dependency; this is the `apply()` return for
 * `handle.mutate`.
 */
export function toDependencyEdgeState(dependency: {
  sourceSystemId: string;
  targetSystemId: string;
  impactType: DependencyEdgeState["impactType"];
  transitive: boolean;
}): DependencyEdgeState {
  return {
    sourceSystemId: dependency.sourceSystemId,
    targetSystemId: dependency.targetSystemId,
    impactType: dependency.impactType,
    transitive: dependency.transitive,
  };
}

/**
 * Drive a reactive-state `dependency-edge` write through `handle.mutate`
 * (§10.5). `apply` performs the REAL `dependencies` write via the service
 * (the plugin's own db/tx) and returns the new reactive state. The framework
 * snapshots `prev`, appends the transition log, and emits `ENTITY_CHANGED`
 * (the deriver turns that into `dependency.created/.updated`).
 *
 * When no handle is available (tests construct the router without one), the
 * write still runs — the entity reactivity is layered on top, never required
 * for the underlying write to succeed.
 */
export async function writeDependencyEdge(args: {
  handle: EntityHandle<DependencyEdgeState> | undefined;
  dependencyId: string;
  apply: () => Promise<DependencyEdgeState>;
}): Promise<void> {
  const { handle, dependencyId, apply } = args;
  await withEntityWrite({ handle, id: dependencyId, apply });
}

/**
 * Drive a dependency-edge tombstone through `handle.remove` (§10.5). `apply`
 * performs the REAL delete via the service; the framework records the
 * tombstone transition and emits a tombstone change (the deriver fires
 * `dependency.deleted`). Without a handle, the delete still runs.
 */
export async function removeDependencyEdge(args: {
  handle: EntityHandle<DependencyEdgeState> | undefined;
  dependencyId: string;
  apply: () => Promise<void>;
}): Promise<void> {
  const { handle, dependencyId, apply } = args;
  await withEntityRemove({ handle, id: dependencyId, apply });
}
