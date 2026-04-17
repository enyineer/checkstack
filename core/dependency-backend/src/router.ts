import { implement, ORPCError } from "@orpc/server";
import {
  dependencyContract,
  DEPENDENCY_CHANGED,
  DEPENDENCY_WARNINGS_CHANGED,
} from "@checkstack/dependency-common";
import {
  autoAuthMiddleware,
  type Logger,
  type RpcContext,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { DependencyService } from "./services/dependency-service";
import type {
  WarningEvaluationService,
  SystemStatus,
} from "./services/warning-evaluation-service";
import { dependencyHooks } from "./hooks";
import type { InferClient } from "@checkstack/common";
import { CatalogApi } from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";

export function createRouter({
  service,
  warningService,
  signalService,
  catalogClient,
  healthCheckClient,
  logger,
}: {
  service: DependencyService;
  warningService: WarningEvaluationService;
  signalService: SignalService;
  catalogClient: InferClient<typeof CatalogApi>;
  healthCheckClient: InferClient<typeof HealthCheckApi>;
  logger: Logger;
}) {
  /**
   * Fetch system statuses for warning evaluation using the bulk health status API.
   * Combines catalog system names with health check status data.
   */
  async function fetchSystemStatuses(
    systemIds: string[],
  ): Promise<Map<string, SystemStatus>> {
    const statuses = new Map<string, SystemStatus>();

    // Get system names from catalog
    const { systems } = await catalogClient.getSystems();
    const systemMap = new Map(systems.map((s) => [s.id, s]));

    // Bulk-fetch health statuses for all systems
    try {
      const { statuses: healthStatuses } =
        await healthCheckClient.getBulkSystemHealthStatus({
          systemIds,
        });

      for (const systemId of systemIds) {
        const system = systemMap.get(systemId);
        if (!system) continue;

        const healthStatus = healthStatuses[systemId];

        if (healthStatus) {
          // Map from health check status to simplified system status
          let overallStatus: "operational" | "degraded" | "down" =
            "operational";
          if (healthStatus.status === "unhealthy") {
            overallStatus = "down";
          } else if (healthStatus.status === "degraded") {
            overallStatus = "degraded";
          }

          const checkStatuses = healthStatus.checkStatuses.map((cs) => ({
            healthCheckId: cs.configurationId,
            status: cs.status,
          }));

          statuses.set(systemId, {
            systemId,
            systemName: system.name,
            status: overallStatus,
            healthCheckStatuses: checkStatuses,
          });
        } else {
          statuses.set(systemId, {
            systemId,
            systemName: system.name,
            status: "operational",
          });
        }
      }
    } catch (error) {
      logger.debug(
        `Failed to bulk-fetch health statuses: ${String(error)}`,
      );
      // Fallback: default all systems to operational
      for (const systemId of systemIds) {
        const system = systemMap.get(systemId);
        if (!system) continue;
        statuses.set(systemId, {
          systemId,
          systemName: system.name,
          status: "operational",
        });
      }
    }

    return statuses;
  }

  const os = implement(dependencyContract)
    .$context<RpcContext>()
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

        // eslint-disable-next-line unicorn/no-null -- oRPC contract requires null
        return warningMap.get(input.systemId) ?? null;
      },
    ),

    createDependency: os.createDependency.handler(
      async ({ input, context }) => {
        try {
          const result = await service.createDependency(input);

          // Broadcast signal
          await signalService.broadcast(DEPENDENCY_CHANGED, {
            dependencyId: result.id,
            sourceSystemId: result.sourceSystemId,
            targetSystemId: result.targetSystemId,
            action: "created",
          });

          // Emit hook
          await context.emitHook(dependencyHooks.dependencyCreated, {
            dependencyId: result.id,
            sourceSystemId: result.sourceSystemId,
            targetSystemId: result.targetSystemId,
            impactType: result.impactType,
          });

          // Notify affected systems about warning changes
          await signalService.broadcast(DEPENDENCY_WARNINGS_CHANGED, {
            affectedSystemIds: [result.sourceSystemId],
          });

          return result;
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.includes("circular chain") ||
              error.message.includes("already exists"))
          ) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw error;
        }
      },
    ),

    updateDependency: os.updateDependency.handler(
      async ({ input, context }) => {
        const result = await service.updateDependency(input);
        if (!result) {
          throw new ORPCError("NOT_FOUND", {
            message: "Dependency not found",
          });
        }

        await signalService.broadcast(DEPENDENCY_CHANGED, {
          dependencyId: result.id,
          sourceSystemId: result.sourceSystemId,
          targetSystemId: result.targetSystemId,
          action: "updated",
        });

        await context.emitHook(dependencyHooks.dependencyUpdated, {
          dependencyId: result.id,
          sourceSystemId: result.sourceSystemId,
          targetSystemId: result.targetSystemId,
          impactType: result.impactType,
        });

        await signalService.broadcast(DEPENDENCY_WARNINGS_CHANGED, {
          affectedSystemIds: [result.sourceSystemId],
        });

        return result;
      },
    ),

    deleteDependency: os.deleteDependency.handler(
      async ({ input, context }) => {
        const existing = await service.getDependencyById(input.id);
        const success = await service.deleteDependency(input.id);

        if (success && existing) {
          await signalService.broadcast(DEPENDENCY_CHANGED, {
            dependencyId: input.id,
            sourceSystemId: existing.sourceSystemId,
            targetSystemId: existing.targetSystemId,
            action: "deleted",
          });

          await context.emitHook(dependencyHooks.dependencyDeleted, {
            dependencyId: input.id,
            sourceSystemId: existing.sourceSystemId,
            targetSystemId: existing.targetSystemId,
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
