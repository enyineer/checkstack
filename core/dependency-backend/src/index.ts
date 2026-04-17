import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  dependencyAccessRules,
  pluginMetadata,
  dependencyContract,
} from "@checkstack/dependency-common";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { DependencyService } from "./services/dependency-service";
import { WarningEvaluationService } from "./services/warning-evaluation-service";
import type { SystemStatus } from "./services/warning-evaluation-service";
import { createRouter } from "./router";
import { CatalogApi } from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { IncidentApi } from "@checkstack/incident-common";
import { catalogHooks } from "@checkstack/catalog-backend";
import { healthCheckHooks } from "@checkstack/healthcheck-backend";
import { evaluateAndNotifyDownstream } from "./notifications";

// =============================================================================
// Plugin Definition
// =============================================================================

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(dependencyAccessRules);

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
      },
      init: async ({ logger, database, rpc, rpcClient, signalService }) => {
        logger.debug("🔧 Initializing Dependency Backend...");

        const catalogClient = rpcClient.forPlugin(CatalogApi);
        const healthCheckClient = rpcClient.forPlugin(HealthCheckApi);

        const service = new DependencyService(
          database as SafeDatabase<typeof schema>,
        );
        const warningService = new WarningEvaluationService();

        const router = createRouter({
          service,
          warningService,
          signalService,
          catalogClient,
          healthCheckClient,
          logger,
        });
        rpc.registerRouter(router, dependencyContract);

        logger.debug("✅ Dependency Backend initialized.");
      },
      afterPluginsReady: async ({
        database,
        rpcClient,
        logger,
        onHook,
        signalService,
      }) => {
        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new DependencyService(typedDb);
        const warningService = new WarningEvaluationService();

        const catalogClient = rpcClient.forPlugin(CatalogApi);
        const healthCheckClient = rpcClient.forPlugin(HealthCheckApi);
        const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
        const incidentClient = rpcClient.forPlugin(IncidentApi);

        /**
         * Build system statuses for warning evaluation.
         * This mirrors the fetchSystemStatuses function in the router.
         */
        async function fetchSystemStatuses(
          systemIds: string[],
        ): Promise<Map<string, SystemStatus>> {
          const statuses = new Map<string, SystemStatus>();
          const { systems } = await catalogClient.getSystems();
          const systemMap = new Map(systems.map((s) => [s.id, s]));

          try {
            const { statuses: healthStatuses } =
              await healthCheckClient.getBulkSystemHealthStatus({ systemIds });

            for (const systemId of systemIds) {
              const system = systemMap.get(systemId);
              if (!system) continue;

              const healthStatus = healthStatuses[systemId];
              if (healthStatus) {
                let overallStatus: "operational" | "degraded" | "down" =
                  "operational";
                if (healthStatus.status === "unhealthy") {
                  overallStatus = "down";
                } else if (healthStatus.status === "degraded") {
                  overallStatus = "degraded";
                }

                statuses.set(systemId, {
                  systemId,
                  systemName: system.name,
                  status: overallStatus,
                  healthCheckStatuses: healthStatus.checkStatuses.map((cs) => ({
                    healthCheckId: cs.configurationId,
                    status: cs.status,
                  })),
                });
              } else {
                statuses.set(systemId, {
                  systemId,
                  systemName: system.name,
                  status: "operational",
                });
              }
            }
          } catch {
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

        // Subscribe to catalog system deletion to clean up dependencies
        onHook(
          catalogHooks.systemDeleted,
          async (payload) => {
            logger.debug(
              `Cleaning up dependencies for deleted system: ${payload.systemId}`,
            );
            await service.removeSystemDependencies(payload.systemId);
          },
          { mode: "work-queue", workerGroup: "dependency-system-cleanup" },
        );

        // Subscribe to health check state changes to notify downstream dependents
        onHook(
          healthCheckHooks.systemDegraded,
          async (payload) => {
            logger.debug(
              `Upstream ${payload.systemId} degraded (${payload.previousStatus} → ${payload.newStatus}), evaluating downstream dependencies`,
            );
            await evaluateAndNotifyDownstream({
              changedSystemId: payload.systemId,
              db: typedDb,
              dependencyService: service,
              warningService,
              fetchSystemStatuses,
              catalogClient,
              maintenanceClient,
              incidentClient,
              signalService,
              logger,
            });
          },
          {
            mode: "work-queue",
            workerGroup: "dependency-notification-evaluator",
          },
        );

        onHook(
          healthCheckHooks.systemHealthy,
          async (payload) => {
            logger.debug(
              `Upstream ${payload.systemId} recovered, evaluating downstream dependencies`,
            );
            await evaluateAndNotifyDownstream({
              changedSystemId: payload.systemId,
              db: typedDb,
              dependencyService: service,
              warningService,
              fetchSystemStatuses,
              catalogClient,
              maintenanceClient,
              incidentClient,
              signalService,
              logger,
            });
          },
          {
            mode: "work-queue",
            workerGroup: "dependency-notification-recovery",
          },
        );

        logger.debug("✅ Dependency Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { dependencyHooks } from "./hooks";
