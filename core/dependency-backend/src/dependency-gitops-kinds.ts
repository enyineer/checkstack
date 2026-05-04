import { z } from "zod";
import {
  CHECKSTACK_API_VERSION,
  type EntityKindExtensionDefinition,
  type EntityKindRegistry,
  type ReconcileContext,
} from "@checkstack/gitops-common";
import { ImpactTypeSchema } from "@checkstack/dependency-common";
import type { DependencyService } from "./services/dependency-service";

interface DependencyGitOpsKindsDeps {
  /** Lazy accessor — populated during init(), invoked at reconcile time. */
  getService: () => DependencyService;
}

// ─── System.dependencies extension ──────────────────────────────────────────
//
// Declares upstream dependencies for a System. GitOps is the source of truth:
// the reconciler diffs the YAML-declared edges against the persisted ones for
// this system and applies create/update/delete to converge.
//
// `targetRef` references another System by name; `kind` is constrained to the
// literal "System" so the relationship is self-documenting.

const systemRefSchema = z
  .object({
    kind: z.literal("System"),
    name: z.string().min(1),
  })
  .describe("Reference to the upstream System this system depends on.");

const dependencyEntrySchema = z.object({
  targetRef: systemRefSchema,
  impactType: ImpactTypeSchema.optional().default("degraded"),
  transitive: z.boolean().optional().default(false),
  label: z.string().optional(),
});

const systemDependenciesExtensionSchema = z
  .array(dependencyEntrySchema)
  .optional();

type SystemDependenciesExtension = z.infer<
  typeof systemDependenciesExtensionSchema
>;

const edgeKey = (sourceId: string, targetId: string) =>
  `${sourceId}->${targetId}`;

export function buildSystemDependenciesExtension(
  deps: DependencyGitOpsKindsDeps,
): EntityKindExtensionDefinition<SystemDependenciesExtension> {
  return {
    apiVersion: CHECKSTACK_API_VERSION,
    kind: "System",
    namespace: "dependencies",
    specSchema: systemDependenciesExtensionSchema,

    reconcile: async ({
      extensionSpec,
      entityId,
      context,
    }: {
      extensionSpec: SystemDependenciesExtension;
      entityId: string;
      context: ReconcileContext;
    }) => {
      const service = deps.getService();
      const sourceSystemId = entityId;
      const desired = extensionSpec ?? [];

      // Resolve all target refs up-front so a single bad ref aborts the diff
      // before we mutate anything.
      const resolved: Array<{
        targetSystemId: string;
        impactType: "informational" | "degraded" | "critical";
        transitive: boolean;
        label: string | null;
      }> = [];
      for (const entry of desired) {
        const targetSystemId = await context.resolveEntityRef({
          kind: entry.targetRef.kind,
          entityName: entry.targetRef.name,
        });
        if (!targetSystemId) {
          throw new Error(
            `Cannot resolve System ref "${entry.targetRef.name}" — ensure the upstream system exists`,
          );
        }
        if (targetSystemId === sourceSystemId) {
          throw new Error(
            `Dependency target "${entry.targetRef.name}" resolves to the same system as the source — a system cannot depend on itself`,
          );
        }
        resolved.push({
          targetSystemId,
          impactType: entry.impactType,
          transitive: entry.transitive,
          label: entry.label ?? null,
        });
      }

      // Existing edges where this system is the source (upstream deps).
      const existing = await service.getDependencies({
        systemId: sourceSystemId,
        direction: "upstream",
      });

      const existingByTarget = new Map(
        existing.map((dep) => [edgeKey(dep.sourceSystemId, dep.targetSystemId), dep]),
      );
      const desiredKeys = new Set(
        resolved.map((r) => edgeKey(sourceSystemId, r.targetSystemId)),
      );

      // Remove edges that are no longer declared.
      for (const [key, dep] of existingByTarget) {
        if (!desiredKeys.has(key)) {
          await service.deleteDependency(dep.id);
          context.logger.info(
            `GitOps: removed dependency ${dep.sourceSystemId} → ${dep.targetSystemId}`,
          );
        }
      }

      // Add or update declared edges.
      for (const entry of resolved) {
        const key = edgeKey(sourceSystemId, entry.targetSystemId);
        const current = existingByTarget.get(key);
        if (!current) {
          await service.createDependency({
            sourceSystemId,
            targetSystemId: entry.targetSystemId,
            impactType: entry.impactType,
            transitive: entry.transitive,
            label: entry.label ?? undefined,
            healthCheckRules: [],
          });
          context.logger.info(
            `GitOps: created dependency ${sourceSystemId} → ${entry.targetSystemId} (${entry.impactType})`,
          );
          continue;
        }

        const needsUpdate =
          current.impactType !== entry.impactType ||
          current.transitive !== entry.transitive ||
          (current.label ?? null) !== entry.label;
        if (needsUpdate) {
          await service.updateDependency({
            id: current.id,
            systemId: sourceSystemId,
            impactType: entry.impactType,
            transitive: entry.transitive,
            label: entry.label,
          });
          context.logger.info(
            `GitOps: updated dependency ${sourceSystemId} → ${entry.targetSystemId}`,
          );
        }
      }
    },
  };
}

export function registerDependencyGitOpsKinds({
  kindRegistry,
  ...deps
}: DependencyGitOpsKindsDeps & {
  kindRegistry: EntityKindRegistry;
}): void {
  kindRegistry.registerKindExtension(buildSystemDependenciesExtension(deps));
}
