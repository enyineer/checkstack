import { createBackendPlugin, coreServices, type SafeDatabase } from "@checkstack/backend-api";
import { healthCheckHooks } from "@checkstack/healthcheck-backend";
import { setupBaselineAnalyzerJob } from "./jobs/baseline-analyzer";
import { processCheckCompleted } from "./detector";
import * as schema from "./schema";
import { CatalogApi } from "@checkstack/catalog-common";
import { NotificationApi } from "@checkstack/notification-common";
import { AnomalyService } from "./service";
import { createRouter } from "./router";
import { createAnomalyRouterCache, type AnomalyRouterCache } from "./router-cache";
import {
  anomalyContract,
  anomalyAccessRules,
  anomalySystemSubscription,
  anomalyGroupSubscription,
} from "@checkstack/anomaly-common";
import { specToRegistration } from "@checkstack/notification-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";

import { definePluginMetadata } from "@checkstack/common";

export const plugin = createBackendPlugin({
  metadata: definePluginMetadata({
    pluginId: "anomaly",
  }),
  register(env) {
    env.registerAccessRules(anomalyAccessRules);
    // Declared subscription specs feed the plugin loader's
    // dependency sorter — each spec's target.ownerPlugin becomes an
    // implicit init-order dep, so anomaly waits for catalog (the
    // owner of catalogSystemTarget / catalogGroupTarget) before its
    // own init + afterPluginsReady runs.
    env.registerSubscriptionSpecs([
      anomalySystemSubscription,
      anomalyGroupSubscription,
    ]);

    let routerCache: AnomalyRouterCache | undefined;

    env.registerInit({
      schema,
      deps: {
        db: coreServices.database,
        logger: coreServices.logger,
        queueManager: coreServices.queueManager,
        cacheManager: coreServices.cacheManager,
        rpcClient: coreServices.rpcClient,
        rpc: coreServices.rpc,
        signalService: coreServices.signalService,
        collectorRegistry: coreServices.collectorRegistry,
      },
      init: async ({ db, logger, queueManager, cacheManager, rpc, rpcClient, signalService, collectorRegistry }) => {
        logger.debug("Initializing Anomaly Detection Backend...");

        const cache = cacheManager.getProvider();
        const typedDb = db as SafeDatabase<typeof schema>;
        const healthCheckClient = rpcClient.forPlugin(HealthCheckApi);
        const catalogClient = rpcClient.forPlugin(CatalogApi);
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        await setupBaselineAnalyzerJob({
          db: typedDb,
          cache,
          logger,
          queueManager,
          healthCheckClient,
          signalService,
          catalogClient,
          notificationClient,
          collectorRegistry,
        });

        const service = new AnomalyService(typedDb);
        routerCache = createAnomalyRouterCache({ cacheManager, logger });
        const router = createRouter(service, logger, routerCache);
        rpc.registerRouter(router, anomalyContract);

        logger.debug("Anomaly Detection Backend initialized.");
      },
      afterPluginsReady: async ({ onHook, db, logger, cacheManager, rpcClient, collectorRegistry, signalService }) => {
        const cache = cacheManager.getProvider();
        const typedDb = db as SafeDatabase<typeof schema>;
        const catalogClient = rpcClient.forPlugin(CatalogApi);
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        // Register subscription specs against the platform. notification-
        // backend takes care of provisioning per-resource groups by joining
        // the spec's target type onto the resource registry catalog already
        // pushes — anomaly never needs to know about per-system or
        // per-group lifecycle.
        await Promise.all([
          notificationClient.registerSubscriptionSpec(
            specToRegistration(anomalySystemSubscription),
          ),
          notificationClient.registerSubscriptionSpec(
            specToRegistration(anomalyGroupSubscription),
          ),
        ]);

        onHook(healthCheckHooks.checkCompleted, async (payload) => {
          await processCheckCompleted({
            ...payload,
            db: typedDb,
            cache,
            routerCache,
            logger,
            catalogClient,
            notificationClient,
            signalService,
            collectorRegistry,
          });
        });
      },
    });
  },
});
