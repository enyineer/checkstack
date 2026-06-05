import { z } from "zod";
import {
  CHECKSTACK_API_VERSION,
  entityRefSchema,
  type EntityKindDefinition,
  type EntityKindRegistry,
  type ReconcileContext,
} from "@checkstack/gitops-common";
import {
  DependencyExclusionModeSchema,
  BurnRateThresholdsSchema,
  SloWindowDaysSchema,
} from "@checkstack/slo-common";
import type { SloService } from "./service";

interface SloGitOpsKindsDeps {
  /** Lazy accessor — populated during init(), invoked at reconcile time. */
  getService: () => SloService;
}

// ─── SLO Spec Schema ───────────────────────────────────────────────────────

/**
 * GitOps spec for `kind: SLO`.
 *
 * An SLO targets a specific system (required) and may optionally narrow to a
 * single healthcheck on that system. When `healthcheckRef` is omitted the SLO
 * covers the system's aggregate availability across all of its healthchecks.
 */
const sloSpecSchema = z.object({
  systemRef: entityRefSchema,
  healthcheckRef: entityRefSchema.optional(),
  target: z.number().min(0).max(100),
  windowDays: SloWindowDaysSchema,
  dependencyExclusion: DependencyExclusionModeSchema.optional(),
  excludedDependencyRefs: z.array(entityRefSchema).optional(),
  burnRateThresholds: BurnRateThresholdsSchema.optional(),
});

type SloSpec = z.infer<typeof sloSpecSchema>;

// ─── Kind builder ───────────────────────────────────────────────────────────

const resolveRequiredRef = async ({
  context,
  ref,
  refKindLabel,
}: {
  context: ReconcileContext;
  ref: { kind: string; name: string };
  refKindLabel: string;
}): Promise<string> => {
  const id = await context.resolveEntityRef({
    kind: ref.kind,
    entityName: ref.name,
  });
  if (!id) {
    throw new Error(
      `Cannot resolve ${refKindLabel} ref "${ref.name}" (kind: ${ref.kind}) — ensure the entity exists`,
    );
  }
  return id;
};

export function buildSloKind(
  deps: SloGitOpsKindsDeps,
): EntityKindDefinition<SloSpec> {
  return {
    apiVersion: CHECKSTACK_API_VERSION,
    kind: "SLO",
    specSchema: sloSpecSchema,

    reconcile: async ({
      entity,
      existingEntityId,
      context,
    }: {
      entity: {
        metadata: { name: string; title?: string; description?: string };
        spec: SloSpec;
      };
      existingEntityId?: string;
      context: ReconcileContext;
    }) => {
      const { spec } = entity;
      const service = deps.getService();

      const systemId = await resolveRequiredRef({
        context,
        ref: spec.systemRef,
        refKindLabel: "system",
      });

      let healthCheckConfigurationId: string | undefined;
      if (spec.healthcheckRef) {
        healthCheckConfigurationId = await resolveRequiredRef({
          context,
          ref: spec.healthcheckRef,
          refKindLabel: "healthcheck",
        });
      }

      const excludedDependencyIds = spec.excludedDependencyRefs
        ? await Promise.all(
            spec.excludedDependencyRefs.map((ref) =>
              resolveRequiredRef({
                context,
                ref,
                refKindLabel: "excluded dependency",
              }),
            ),
          )
        : [];

      if (existingEntityId && !existingEntityId.startsWith("pending-")) {
        await service.updateObjective({
          input: {
            id: existingEntityId,
            target: spec.target,
            windowDays: spec.windowDays,
            dependencyExclusion: spec.dependencyExclusion,
            excludedDependencyIds,
            burnRateThresholds: spec.burnRateThresholds,
          },
        });
        context.logger.info(
          `GitOps: updated SLO "${entity.metadata.name}" (id: ${existingEntityId})`,
        );
        return { entityId: existingEntityId };
      }

      const created = await service.createObjective({
        input: {
          systemId,
          healthCheckConfigurationId,
          target: spec.target,
          windowDays: spec.windowDays,
          dependencyExclusion: spec.dependencyExclusion ?? "strict",
          excludedDependencyIds,
          burnRateThresholds: spec.burnRateThresholds ?? {
            warningPercent: 50,
            criticalPercent: 80,
            fastBurnMultiplier: 5,
          },
        },
      });
      context.logger.info(
        `GitOps: created SLO "${entity.metadata.name}" (id: ${created.id})`,
      );
      return { entityId: created.id };
    },

    delete: async ({
      entityId,
      context,
    }: {
      entityName: string;
      entityId?: string;
      context: ReconcileContext;
    }) => {
      if (!entityId) return;
      await deps.getService().deleteObjective({ id: entityId });
      context.logger.info(`GitOps: deleted SLO (id: ${entityId})`);
    },
  };
}

export function registerSloGitOpsKinds({
  kindRegistry,
  ...deps
}: SloGitOpsKindsDeps & {
  kindRegistry: EntityKindRegistry;
}): void {
  kindRegistry.registerKind(buildSloKind(deps));
}
