import {
  setupHealthCheckWorker,
  bootstrapHealthChecks,
} from "./queue-executor";
import * as schema from "./schema";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  permissionList,
  pluginMetadata,
  healthCheckContract,
} from "@checkmate-monitor/healthcheck-common";
import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import { createHealthCheckRouter } from "./router";
import { HealthCheckService } from "./service";
import { catalogHooks } from "@checkmate-monitor/catalog-backend";
import { CatalogApi } from "@checkmate-monitor/catalog-common";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        healthCheckRegistry: coreServices.healthCheckRegistry,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        queueManager: coreServices.queueManager,
        signalService: coreServices.signalService,
      },
      // Phase 2: Register router and setup worker
      init: async ({
        logger,
        database,
        healthCheckRegistry,
        rpc,
        rpcClient,
        queueManager,
        signalService,
      }) => {
        logger.debug("🏥 Initializing Health Check Backend...");

        // Create catalog client for notification delegation
        const catalogClient = rpcClient.forPlugin(CatalogApi);

        // Setup queue-based health check worker
        await setupHealthCheckWorker({
          db: database,
          registry: healthCheckRegistry,
          logger,
          queueManager,
          signalService,
          catalogClient,
        });

        const healthCheckRouter = createHealthCheckRouter(
          database as NodePgDatabase<typeof schema>,
          healthCheckRegistry
        );
        rpc.registerRouter(healthCheckRouter, healthCheckContract);

        logger.debug("✅ Health Check Backend initialized.");
      },
      // Phase 3: Bootstrap health checks and subscribe to catalog events
      afterPluginsReady: async ({
        database,
        queueManager,
        logger,
        onHook,
        healthCheckRegistry,
      }) => {
        // Bootstrap all enabled health checks
        await bootstrapHealthChecks({
          db: database,
          queueManager,
          logger,
        });

        // Subscribe to catalog system deletion to clean up associations
        const service = new HealthCheckService(database, healthCheckRegistry);
        onHook(
          catalogHooks.systemDeleted,
          async (payload) => {
            logger.debug(
              `Cleaning up health check associations for deleted system: ${payload.systemId}`
            );
            await service.removeAllSystemAssociations(payload.systemId);
          },
          { mode: "work-queue", workerGroup: "system-cleanup" }
        );

        logger.debug("✅ Health Check Backend afterPluginsReady complete.");
      },
    });
  },
});
