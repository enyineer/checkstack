/**
 * Dependency triggers + actions registered with the Automation Platform.
 *
 * Triggers expose the existing `dependencyHooks` as automation entry
 * points (`dependency.created`, `dependency.updated`, `dependency.deleted`).
 * Actions wrap `DependencyService.createDependency` / `deleteDependency`
 * so operators can build / remove edges from automation flows.
 *
 * The plan also mentions a `dependency.impact_propagated` trigger.
 * That event isn't emitted today — propagation runs synchronously
 * inside `evaluateAndNotifyDownstream`. Adding a hook there is a
 * separate change because it requires deciding what payload to pass
 * (which downstream systems were re-evaluated, what their new status
 * is, whether to deduplicate). Tracked as a follow-up in the plan;
 * not included in this chunk.
 *
 * Mutation actions emit their hook themselves (via the `emitHook`
 * factory dep) so downstream automations / caches react the same way
 * they do when the mutation comes in via RPC.
 */
import { z } from "zod";
import { Versioned, type Hook } from "@checkstack/backend-api";
import type {
  ActionDefinition,
  TriggerDefinition,
} from "@checkstack/automation-backend";
import { makeEntityDrivenTriggerSetup } from "@checkstack/automation-backend";
import { extractErrorMessage } from "@checkstack/common";
import {
  DerivedStateSchema,
  ImpactTypeSchema,
} from "@checkstack/dependency-common";

import type { EntityHandle } from "@checkstack/automation-backend";
import { dependencyHooks } from "./hooks";
import type { DependencyService } from "./services/dependency-service";
import {
  mirrorDependencyEdge,
  removeDependencyEdge,
  type DependencyEdgeState,
} from "./dependency-entity";

// ─── Payload schemas — match the hook payloads exactly ─────────────────

const dependencyCreatedPayloadSchema = z.object({
  dependencyId: z.string(),
  sourceSystemId: z.string(),
  targetSystemId: z.string(),
  impactType: ImpactTypeSchema,
});

const dependencyUpdatedPayloadSchema = z.object({
  dependencyId: z.string(),
  sourceSystemId: z.string(),
  targetSystemId: z.string(),
  impactType: ImpactTypeSchema,
});

const dependencyDeletedPayloadSchema = z.object({
  dependencyId: z.string(),
  sourceSystemId: z.string(),
  targetSystemId: z.string(),
});

const dependencyImpactPropagatedPayloadSchema = z.object({
  sourceSystemId: z.string(),
  affectedSystems: z.array(
    z.object({
      systemId: z.string(),
      previousState: DerivedStateSchema.nullable(),
      newState: DerivedStateSchema.nullable(),
    }),
  ),
  timestamp: z.string(),
});

// ─── Triggers ──────────────────────────────────────────────────────────

// These three triggers are ENTITY-DRIVEN (§10.5): the `dependency-edge`
// entity's change deriver fires `dependency.created/.updated/.deleted` via
// Stage-1 routing, so they no longer subscribe to a hook. A no-op `setup`
// keeps them in the editor's trigger catalog without re-introducing a hook.
export const dependencyCreatedTrigger: TriggerDefinition<
  z.infer<typeof dependencyCreatedPayloadSchema>
> = {
  id: "created",
  displayName: "Dependency Created",
  description: "Fires when a new dependency edge is added between two systems",
  category: "Dependencies",
  icon: "Network",
  payloadSchema: dependencyCreatedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof dependencyCreatedPayloadSchema>
  >(),
  contextKey: (p) => p.dependencyId,
};

export const dependencyUpdatedTrigger: TriggerDefinition<
  z.infer<typeof dependencyUpdatedPayloadSchema>
> = {
  id: "updated",
  displayName: "Dependency Updated",
  description: "Fires when an existing dependency's impact-type or label changes",
  category: "Dependencies",
  icon: "Network",
  payloadSchema: dependencyUpdatedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof dependencyUpdatedPayloadSchema>
  >(),
  contextKey: (p) => p.dependencyId,
};

export const dependencyDeletedTrigger: TriggerDefinition<
  z.infer<typeof dependencyDeletedPayloadSchema>
> = {
  id: "deleted",
  displayName: "Dependency Deleted",
  description: "Fires when a dependency edge is removed",
  category: "Dependencies",
  icon: "Network",
  payloadSchema: dependencyDeletedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof dependencyDeletedPayloadSchema>
  >(),
  contextKey: (p) => p.dependencyId,
};

export const dependencyImpactPropagatedTrigger: TriggerDefinition<
  z.infer<typeof dependencyImpactPropagatedPayloadSchema>
> = {
  id: "impact_propagated",
  displayName: "Dependency Impact Propagated",
  description:
    "Fires once per upstream health change with the list of downstream systems whose derived state actually moved",
  category: "Dependencies",
  icon: "Network",
  payloadSchema: dependencyImpactPropagatedPayloadSchema,
  hook: dependencyHooks.impactPropagated,
  contextKey: (p) => p.sourceSystemId,
};

export const dependencyTriggers: TriggerDefinition<unknown>[] = [
  dependencyCreatedTrigger as TriggerDefinition<unknown>,
  dependencyUpdatedTrigger as TriggerDefinition<unknown>,
  dependencyDeletedTrigger as TriggerDefinition<unknown>,
  dependencyImpactPropagatedTrigger as TriggerDefinition<unknown>,
];

// ─── Action configs ────────────────────────────────────────────────────

const impactTypeSchema = ImpactTypeSchema.describe(
  "How the target is affected when the source is affected — `critical` propagates the upstream's status (degraded → degraded, down → down), `degraded` always pulls the downstream to degraded, `informational` warns only.",
);

const dependencyCreateConfigSchema = z.object({
  sourceSystemId: z.string().min(1).describe("Source (upstream) system id"),
  targetSystemId: z.string().min(1).describe("Target (downstream) system id"),
  impactType: impactTypeSchema,
  transitive: z.boolean().optional().default(false),
  label: z.string().optional(),
});

export type DependencyCreateConfig = z.infer<
  typeof dependencyCreateConfigSchema
>;

const dependencyRemoveConfigSchema = z.object({
  dependencyId: z.string().min(1).describe("Id of the dependency to remove"),
});

export type DependencyRemoveConfig = z.infer<
  typeof dependencyRemoveConfigSchema
>;

// ─── Artifact type ─────────────────────────────────────────────────────

const dependencyArtifactSchema = z.object({
  dependencyId: z.string(),
  sourceSystemId: z.string(),
  targetSystemId: z.string(),
  impactType: ImpactTypeSchema,
});

export type DependencyArtifact = z.infer<typeof dependencyArtifactSchema>;

export const dependencyArtifactType = {
  id: "edge",
  displayName: "Dependency Edge",
  description: "Source → target edge produced or removed by an automation",
  schema: dependencyArtifactSchema,
} as const;

// ─── Actions ───────────────────────────────────────────────────────────

export interface DependencyActionDeps {
  service: DependencyService;
  emitHook: <T>(hook: Hook<T>, payload: T) => Promise<void>;
  /** Resolver for the reactive `dependency-edge` entity (§10.5). */
  getDependencyEntity?: () => EntityHandle<DependencyEdgeState> | undefined;
}

export function createDependencyActions(
  deps: DependencyActionDeps,
): ActionDefinition<unknown, unknown>[] {
  const createAction: ActionDefinition<
    DependencyCreateConfig,
    DependencyArtifact
  > = {
    id: "create",
    displayName: "Create Dependency",
    description: "Add a dependency edge between two systems",
    category: "Dependencies",
    icon: "Network",
    config: new Versioned({
      version: 1,
      schema: dependencyCreateConfigSchema,
    }),
    produces: "dependency.edge",
    execute: async ({ config, logger }) => {
      try {
        const created = await deps.service.createDependency({
          sourceSystemId: config.sourceSystemId,
          targetSystemId: config.targetSystemId,
          impactType: config.impactType,
          transitive: config.transitive,
          label: config.label,
          healthCheckRules: [],
        });
        // Mirror into the reactive `dependency-edge` entity (§10.5); the
        // deriver fires `dependency.created` from this change.
        await mirrorDependencyEdge({
          handle: deps.getDependencyEntity?.(),
          dependencyId: created.id,
          sourceSystemId: created.sourceSystemId,
          targetSystemId: created.targetSystemId,
          impactType: created.impactType,
          transitive: created.transitive,
        });
        logger.info(`Automation created dependency ${created.id}`);
        return {
          success: true,
          externalId: created.id,
          artifact: {
            dependencyId: created.id,
            sourceSystemId: created.sourceSystemId,
            targetSystemId: created.targetSystemId,
            impactType: created.impactType,
          },
        };
      } catch (error) {
        // Both duplicate-edge and cycle detection throw — surface the
        // user-facing message so the run-detail UI shows the reason.
        return { success: false, error: extractErrorMessage(error) };
      }
    },
  };

  const removeAction: ActionDefinition<
    DependencyRemoveConfig,
    DependencyArtifact
  > = {
    id: "remove",
    displayName: "Remove Dependency",
    description: "Delete a dependency edge by id",
    category: "Dependencies",
    icon: "Network",
    config: new Versioned({
      version: 1,
      schema: dependencyRemoveConfigSchema,
    }),
    produces: "dependency.edge",
    execute: async ({ config, logger }) => {
      const existing = await deps.service.getDependencyById(config.dependencyId);
      if (!existing) {
        return {
          success: false,
          error: `Dependency not found: ${config.dependencyId}`,
        };
      }
      const removed = await deps.service.deleteDependency(config.dependencyId);
      if (!removed) {
        return {
          success: false,
          error: `Dependency ${config.dependencyId} disappeared mid-delete`,
        };
      }
      // Tombstone the reactive `dependency-edge` entity (§10.5); the
      // deriver fires `dependency.deleted` from this change.
      await removeDependencyEdge({
        handle: deps.getDependencyEntity?.(),
        dependencyId: existing.id,
      });
      logger.info(`Automation removed dependency ${existing.id}`);
      return {
        success: true,
        externalId: existing.id,
        artifact: {
          dependencyId: existing.id,
          sourceSystemId: existing.sourceSystemId,
          targetSystemId: existing.targetSystemId,
          impactType: existing.impactType,
        },
      };
    },
  };

  return [
    createAction as ActionDefinition<unknown, unknown>,
    removeAction as ActionDefinition<unknown, unknown>,
  ];
}
