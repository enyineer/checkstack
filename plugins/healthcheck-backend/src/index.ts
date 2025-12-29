import { Scheduler } from "./scheduler";
import * as schema from "./schema";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { permissionList } from "@checkmate/healthcheck-common";
import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { router } from "./router";

export default createBackendPlugin({
  pluginId: "healthcheck-backend",
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        database: coreServices.database,
        healthCheckRegistry: coreServices.healthCheckRegistry,
        router: coreServices.rpc,
        fetch: coreServices.fetch,
      },
      init: async ({
        logger,
        database,
        healthCheckRegistry,
        router: rpc,
        fetch,
      }) => {
        logger.info("🏥 Initializing Health Check Backend...");

        const scheduler = new Scheduler(
          database as unknown as NodePgDatabase<typeof schema>,
          healthCheckRegistry,
          logger,
          fetch
        );

        scheduler.start();

        rpc.registerRouter("healthcheck", router);
      },
    });
  },
});
