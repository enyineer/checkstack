import { createBackendPlugin, coreServices, type SafeDatabase } from "@checkstack/backend-api";
import { healthCheckHooks } from "@checkstack/healthcheck-backend";
import { setupBaselineAnalyzerJob } from "./jobs/baseline-analyzer";
import { processCheckCompleted } from "./detector";
import * as schema from "./schema";
import { CatalogApi } from "@checkstack/catalog-common";
import { AnomalyService } from "./service";
import { createRouter } from "./router";
import { anomalyContract, anomalyAccessRules } from "@checkstack/anomaly-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";

import { definePluginMetadata } from "@checkstack/common";

export const plugin = createBackendPlugin({
  metadata: definePluginMetadata({
    pluginId: "anomaly",
  }),
  register(env) {
    env.registerAccessRules(anomalyAccessRules);

    env.registerInit({
      schema,
      deps: {
        db: coreServices.database,
        logger: coreServices.logger,
        queueManager: coreServices.queueManager,
        cacheManager: coreServices.cacheManager, // Pre-req
        rpcClient: coreServices.rpcClient,
        rpc: coreServices.rpc,
      },
      init: async ({ db, logger, queueManager, cacheManager, rpc, rpcClient }) => {
        logger.debug("Initializing Anomaly Detection Backend...");

        const cache = cacheManager.getProvider(); // Scoped cache for anomaly detection
        const typedDb = db as SafeDatabase<typeof schema>;
        const healthCheckClient = rpcClient.forPlugin(HealthCheckApi);

        await setupBaselineAnalyzerJob({
          db: typedDb,
          cache,
          logger,
          queueManager,
          healthCheckClient,
        });

        const service = new AnomalyService(typedDb);
        const router = createRouter(service, logger);
        rpc.registerRouter(router, anomalyContract);

        logger.debug("Anomaly Detection Backend initialized.");
      },
      afterPluginsReady: async ({ onHook, db, logger, cacheManager, rpcClient }) => {
        const cache = cacheManager.getProvider();
        const typedDb = db as SafeDatabase<typeof schema>;
        const catalogClient = rpcClient.forPlugin(CatalogApi);

        onHook(healthCheckHooks.checkCompleted, async (payload) => {
          await processCheckCompleted({
            ...payload,
            db: typedDb,
            cache,
            logger,
            catalogClient,
          });
        });
      },
    });
  },
});
