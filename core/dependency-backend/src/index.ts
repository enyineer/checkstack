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
import { createRouter } from "./router";
import { CatalogApi } from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { catalogHooks } from "@checkstack/catalog-backend";

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
      afterPluginsReady: async ({ database, logger, onHook }) => {
        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new DependencyService(typedDb);

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

        logger.debug("✅ Dependency Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { dependencyHooks } from "./hooks";
