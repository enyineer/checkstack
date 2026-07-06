import { implement, ORPCError } from "@orpc/server";
import {
  dependencyContract,
  DEPENDENCY_CHANGED,
  DEPENDENCY_WARNINGS_CHANGED,
} from "@checkstack/dependency-common";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type Logger,
  type RpcContext,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { DependencyService } from "./services/dependency-service";
import { buildSystemStatuses } from "./services/fetch-system-statuses";
import type {
  WarningEvaluationService,
  SystemStatus,
} from "./services/warning-evaluation-service";
import type { InferClient } from "@checkstack/common";
import { extractErrorMessage } from "@checkstack/common";
import { CatalogApi } from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import type { EntityHandle } from "@checkstack/automation-backend";
import {
  removeDependencyEdge,
  toDependencyEdgeState,
  writeDependencyEdge,
  type DependencyEdgeState,
} from "./dependency-entity";

export function createRouter({
  service,
  warningService,
  signalService,
  catalogClient,
  healthCheckClient,
  logger,
  getDependencyEntity,
}: {
  service: DependencyService;
  warningService: WarningEvaluationService;
  signalService: SignalService;
  catalogClient: InferClient<typeof CatalogApi>;
  healthCheckClient: InferClient<typeof HealthCheckApi>;
  logger: Logger;
  /** Resolver for the reactive `dependency-edge` entity (§10.5). */
  getDependencyEntity?: () => EntityHandle<DependencyEdgeState> | undefined;
}) {
  /**
   * Fetch system statuses (incl. per-environment slices) for warning
   * evaluation. Delegates to the shared builder so the router and the
   * notification sidecar produce identical data.
   */
  async function fetchSystemStatuses(
    systemIds: string[],
  ): Promise<Map<string, SystemStatus>> {
    return buildSystemStatuses({
      systemIds,
      catalogClient,
      healthCheckClient,
      logger,
    });
  }

  const os = implement(dependencyContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    getDependencies: os.getDependencies.handler(async ({ input }) => {
      const deps = await service.getDependencies({
        systemId: input.systemId,
        direction: input.direction,
      });
      return { dependencies: deps };
    }),

    getAllDependencies: os.getAllDependencies.handler(async () => {
      return { dependencies: await service.getAllDependencies() };
    }),

    getWarnings: os.getWarnings.handler(async ({ input }) => {
      const allDeps = await service.getAllDependencies();

      // Collect all system IDs that need status evaluation
      const allSystemIds = new Set<string>(input.systemIds);
      for (const dep of allDeps) {
        allSystemIds.add(dep.sourceSystemId);
        allSystemIds.add(dep.targetSystemId);
      }

      const statuses = await fetchSystemStatuses([...allSystemIds]);
      const warningMap = warningService.evaluateWarnings({
        systemIds: input.systemIds,
        allDependencies: allDeps,
        systemStatuses: statuses,
      });

      // Convert map to record for API output
      const warnings: Record<string, NonNullable<ReturnType<typeof warningMap.get>>> = {};
      for (const systemId of input.systemIds) {
        const warning = warningMap.get(systemId);
        if (warning) {
          warnings[systemId] = warning;
        }
      }

      return { warnings };
    }),

    getWarningsForSystem: os.getWarningsForSystem.handler(
      async ({ input }) => {
        const allDeps = await service.getAllDependencies();

        const allSystemIds = new Set<string>([input.systemId]);
        for (const dep of allDeps) {
          allSystemIds.add(dep.sourceSystemId);
          allSystemIds.add(dep.targetSystemId);
        }

        const statuses = await fetchSystemStatuses([...allSystemIds]);
        const warningMap = warningService.evaluateWarnings({
          systemIds: [input.systemId],
          allDependencies: allDeps,
          systemStatuses: statuses,
        });

         
        return warningMap.get(input.systemId) ?? null;
      },
    ),

    createDependency: os.createDependency.handler(
      async ({ input }) => {
        try {
          // Drive the create through the reactive `dependency-edge` entity
          // (§10.5): `apply` performs the REAL `dependencies` write (the
          // plugin's own db/tx, including cycle/duplicate validation that may
          // throw) and returns the new reactive state; the deriver fires
          // `dependency.created` from the resulting change. The id is
          // generated up front so the handle is keyed on it and the create's
          // `prev` snapshot reads the not-yet-existing row as absent. A
          // throwing `apply` means no transition is appended and nothing is
          // emitted (the create never happened).
          const dependencyId = crypto.randomUUID();
          let result!: Awaited<ReturnType<typeof service.createDependency>>;
          await writeDependencyEdge({
            handle: getDependencyEntity?.(),
            dependencyId,
            apply: async () => {
              result = await service.createDependency(input, dependencyId);
              return toDependencyEdgeState(result);
            },
          });

          // Broadcast signal
          await signalService.broadcast(DEPENDENCY_CHANGED, {
            dependencyId: result.id,
            sourceSystemId: result.sourceSystemId,
            targetSystemId: result.targetSystemId,
            action: "created",
          });

          // Notify affected systems about warning changes
          await signalService.broadcast(DEPENDENCY_WARNINGS_CHANGED, {
            affectedSystemIds: [result.sourceSystemId],
          });

          return result;
        } catch (error) {
          const message = extractErrorMessage(error);
          if (
            message.includes("circular chain") ||
            message.includes("already exists")
          ) {
            throw new ORPCError("BAD_REQUEST", { message });
          }
          throw error;
        }
      },
    ),

    updateDependency: os.updateDependency.handler(
      async ({ input }) => {
        // Probe existence first so a missing dependency still surfaces as
        // NOT_FOUND without driving an entity write.
        const exists = await service.getDependencyById(input.id);
        if (!exists) {
          throw new ORPCError("NOT_FOUND", {
            message: "Dependency not found",
          });
        }

        // Drive the update through the reactive `dependency-edge` entity
        // (§10.5); the REAL update runs INSIDE `apply`, so `prev` is
        // snapshotted before the write and the deriver fires
        // `dependency.updated` from the resulting change.
        let result!: NonNullable<
          Awaited<ReturnType<typeof service.updateDependency>>
        >;
        await writeDependencyEdge({
          handle: getDependencyEntity?.(),
          dependencyId: input.id,
          apply: async () => {
            const updated = await service.updateDependency(input);
            if (!updated) {
              throw new ORPCError("NOT_FOUND", {
                message: "Dependency not found",
              });
            }
            result = updated;
            return toDependencyEdgeState(result);
          },
        });

        await signalService.broadcast(DEPENDENCY_CHANGED, {
          dependencyId: result.id,
          sourceSystemId: result.sourceSystemId,
          targetSystemId: result.targetSystemId,
          action: "updated",
        });

        await signalService.broadcast(DEPENDENCY_WARNINGS_CHANGED, {
          affectedSystemIds: [result.sourceSystemId],
        });

        return result;
      },
    ),

    deleteDependency: os.deleteDependency.handler(
      async ({ input }) => {
        const existing = await service.getDependencyById(input.id);

        // Drive the delete through the reactive `dependency-edge` entity
        // tombstone (§10.5). The REAL delete runs INSIDE `apply`, so `prev`
        // is snapshotted before it and the deriver fires `dependency.deleted`
        // from the tombstone. `success` tracks whether the row was actually
        // deleted.
        let success = false;
        await removeDependencyEdge({
          handle: getDependencyEntity?.(),
          dependencyId: input.id,
          apply: async () => {
            success = await service.deleteDependency(input.id);
          },
        });

        if (success && existing) {
          await signalService.broadcast(DEPENDENCY_CHANGED, {
            dependencyId: input.id,
            sourceSystemId: existing.sourceSystemId,
            targetSystemId: existing.targetSystemId,
            action: "deleted",
          });

          await signalService.broadcast(DEPENDENCY_WARNINGS_CHANGED, {
            affectedSystemIds: [existing.sourceSystemId],
          });
        }

        return { success };
      },
    ),

    getNodePositions: os.getNodePositions.handler(async ({ context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;
      if (!userId) {
        return { positions: [] };
      }
      return { positions: await service.getNodePositions(userId) };
    }),

    saveNodePositions: os.saveNodePositions.handler(
      async ({ input, context }) => {
        const userId =
          context.user && "id" in context.user ? context.user.id : undefined;
        if (!userId) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "User ID required to save positions",
          });
        }
        await service.saveNodePositions({
          userId,
          positions: input.positions,
        });
        return { success: true };
      },
    ),
  });
}
