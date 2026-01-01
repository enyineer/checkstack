import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { permissionList } from "@checkmate/maintenance-common";
import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { MaintenanceService } from "./service";
import { createRouter } from "./router";

export default createBackendPlugin({
  pluginId: "maintenance-backend",
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
      },
      init: async ({ logger, database, rpc }) => {
        logger.debug("🔧 Initializing Maintenance Backend...");

        const service = new MaintenanceService(
          database as NodePgDatabase<typeof schema>
        );
        const router = createRouter(service);
        rpc.registerRouter("maintenance-backend", router);

        logger.debug("✅ Maintenance Backend initialized.");
      },
    });
  },
});
