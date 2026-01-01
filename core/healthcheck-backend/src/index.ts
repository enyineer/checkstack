import {
  setupHealthCheckWorker,
  bootstrapHealthChecks,
} from "./queue-executor";
import * as schema from "./schema";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { permissionList } from "@checkmate/healthcheck-common";
import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { createHealthCheckRouter } from "./router";
import { HealthCheckService } from "./service";
import { catalogHooks } from "@checkmate/catalog-backend";

export default createBackendPlugin({
  pluginId: "healthcheck-backend",
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        healthCheckRegistry: coreServices.healthCheckRegistry,
        rpc: coreServices.rpc,
        queueManager: coreServices.queueManager,
        signalService: coreServices.signalService,
      },
      // Phase 2: Register router and setup worker
      init: async ({
        logger,
        database,
        healthCheckRegistry,
        rpc,
        queueManager,
        signalService,
      }) => {
        logger.debug("🏥 Initializing Health Check Backend...");

        // Setup queue-based health check worker
        await setupHealthCheckWorker({
          db: database as unknown as NodePgDatabase<typeof schema>,
          registry: healthCheckRegistry,
          logger,
          queueManager,
          signalService,
        });

        const healthCheckRouter = createHealthCheckRouter(
          database as NodePgDatabase<typeof schema>
        );
        rpc.registerRouter(healthCheckRouter);

        logger.debug("✅ Health Check Backend initialized.");
      },
      // Phase 3: Bootstrap health checks and subscribe to catalog events
      afterPluginsReady: async ({ database, queueManager, logger, onHook }) => {
        const typedDb = database as unknown as NodePgDatabase<typeof schema>;

        // Bootstrap all enabled health checks
        await bootstrapHealthChecks({
          db: typedDb,
          queueManager,
          logger,
        });

        // Subscribe to catalog system deletion to clean up associations
        const service = new HealthCheckService(typedDb);
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
