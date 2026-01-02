import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { permissionList } from "@checkmate/notification-common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { createNotificationRouter } from "./router";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Register permissions
    env.registerPermissions(permissionList);

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        config: coreServices.config,
      },
      init: async ({ logger, database, rpc, config }) => {
        logger.debug("🔔 Initializing Notification Backend...");

        const db = database as unknown as NodePgDatabase<typeof schema>;

        // Create and register the notification router
        const router = createNotificationRouter(db, config);
        rpc.registerRouter(router);

        logger.debug("✅ Notification Backend initialized.");
      },
    });
  },
});
