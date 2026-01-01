import {
  setupHealthCheckWorker,
  bootstrapHealthChecks,
} from "./queue-executor";
import * as schema from "./schema";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { permissionList } from "@checkmate/healthcheck-common";
import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { createHealthCheckRouter } from "./router";

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
      },
      // Phase 2: Register router and setup worker
      init: async ({
        logger,
        database,
        healthCheckRegistry,
        rpc,
        queueManager,
      }) => {
        logger.debug("🏥 Initializing Health Check Backend...");

        // Setup queue-based health check worker
        await setupHealthCheckWorker({
          db: database as unknown as NodePgDatabase<typeof schema>,
          registry: healthCheckRegistry,
          logger,
          queueManager,
        });

        const healthCheckRouter = createHealthCheckRouter(
          database as NodePgDatabase<typeof schema>
        );
        rpc.registerRouter("healthcheck-backend", healthCheckRouter);

        logger.debug("✅ Health Check Backend initialized.");
      },
      // Phase 3: Bootstrap health checks after all plugins are ready
      afterPluginsReady: async ({ database, queueManager, logger }) => {
        // Bootstrap all enabled health checks
        await bootstrapHealthChecks({
          db: database as unknown as NodePgDatabase<typeof schema>,
          queueManager,
          logger,
        });
      },
    });
  },
});
