import { createBackendPlugin, coreServices, type SafeDatabase } from "@checkstack/backend-api";
import {
  aiToolProjectionExtensionPoint,
  systemSignalsExtensionPoint,
  createSystemAccessResolver,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import { createAnomalySignalsContributor } from "./system-signals";
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
  pluginMetadata,
} from "@checkstack/anomaly-common";
import { specToRegistration } from "@checkstack/notification-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import {
  registerAnomalyGitOpsKinds,
  registerAnomalyGitOpsDocumentation,
} from "./anomaly-gitops-kinds";

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

    // ─── GitOps Entity Kind Registration ─────────────────────────────
    // Mutable ref populated during init(); the reconciler closure pulls
    // the service via the lazy accessor at sync time.
    let gitopsService: AnomalyService | undefined;
    // Expose anomaly's own read-only AI projection so ai-backend never has
    // to import @checkstack/anomaly-common. The projection re-uses the
    // existing getAnomalies contract procedure (read-only, access-gated).
    env.getExtensionPoint(aiToolProjectionExtensionPoint).expose({
      procedure: anomalyContract.getAnomalies,
      sourcePluginMetadata: pluginMetadata,
      procedureKey: "getAnomalies",
      name: "anomaly.list",
      description:
        "List detected anomalies (statistical spikes / drift). Read-only. " +
        "All filters are OPTIONAL - call with no arguments to list every " +
        "anomaly, or narrow with: systemId (a system UUID from the catalog " +
        "tool, never a system name), state (one of: suspicious, anomaly, " +
        "recovered), kind (one of: spike, drift), suppression (one of: " +
        "active, suppressed, all). Each result includes the anomaly's id and " +
        "systemId. There is no per-anomaly 'explain' call - read the returned " +
        "rows directly.",
      effect: "read",
      execute: deferredProjectionExecute,
    });

    const kindRegistry = env.getExtensionPoint(entityKindExtensionPoint);
    registerAnomalyGitOpsKinds({
      kindRegistry,
      getService: () => {
        if (!gitopsService)
          throw new Error("AnomalyService not initialized");
        return gitopsService;
      },
    });

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

        // Created before the analyzer job so the drift evaluator can drop the
        // cached anomaly lists on every row write, the same way the inline
        // spike detector does.
        const cacheForRouter = createAnomalyRouterCache({ cacheManager, logger });
        routerCache = cacheForRouter;

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
          routerCache: cacheForRouter,
        });

        const service = new AnomalyService(typedDb);
        gitopsService = service;

        // Contribute anomaly problem state to the dashboard `system.issues`
        // aggregator. The contributor gates the originating principal on
        // anomaly's own read rule and reads globally from shared Postgres - see
        // createAnomalySignalsContributor.
        env
          .getExtensionPoint(systemSignalsExtensionPoint)
          .contribute(
            createAnomalySignalsContributor({
              service,
              resolver: createSystemAccessResolver(rpcClient),
            }),
          );

        const router = createRouter(service, logger, cacheForRouter);
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

        // GitOps spec-schema docs need the collector registry to be
        // populated so we can enumerate per-collector result fields and
        // register conditional variants under `anomaly.fieldOverrides`.
        registerAnomalyGitOpsDocumentation({
          kindRegistry,
          collectorRegistry,
        });

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
