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
        fetch: coreServices.fetch,
        queueFactory: coreServices.queueFactory,
      },
      init: async ({
        logger,
        database,
        healthCheckRegistry,
        rpc,
        fetch,
        queueFactory,
      }) => {
        logger.debug("🏥 Initializing Health Check Backend...");

        // Setup queue-based health check worker
        await setupHealthCheckWorker({
          db: database as unknown as NodePgDatabase<typeof schema>,
          registry: healthCheckRegistry,
          logger,
          fetch,
          queueFactory,
        });

        // Bootstrap all enabled health checks
        await bootstrapHealthChecks({
          db: database as unknown as NodePgDatabase<typeof schema>,
          queueFactory,
          logger,
        });

        const healthCheckRouter = createHealthCheckRouter(
          database as NodePgDatabase<typeof schema>
        );
        rpc.registerRouter("healthcheck-backend", healthCheckRouter);

        logger.debug("✅ Health Check Backend initialized.");
      },
    });
  },
});
