import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { permissionList, pluginMetadata } from "@checkmate/notification-common";
import { eq } from "drizzle-orm";

import * as schema from "./schema";
import { createNotificationRouter } from "./router";
import { authHooks } from "@checkmate/auth-backend";

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
        signalService: coreServices.signalService,
      },
      init: async ({ logger, database, rpc, config, signalService }) => {
        logger.debug("🔔 Initializing Notification Backend...");

        const db = database;

        // Create and register the notification router
        const router = createNotificationRouter(db, config, signalService);
        rpc.registerRouter(router);

        logger.debug("✅ Notification Backend initialized.");
      },
      afterPluginsReady: async ({ database, logger, onHook }) => {
        const db = database;

        // Subscribe to user deletion to clean up notifications and subscriptions
        onHook(
          authHooks.userDeleted,
          async ({ userId }) => {
            logger.debug(
              `Cleaning up notifications for deleted user: ${userId}`
            );
            // Delete subscriptions first (has userId reference)
            await db
              .delete(schema.notificationSubscriptions)
              .where(eq(schema.notificationSubscriptions.userId, userId));
            // Delete notifications for this user
            await db
              .delete(schema.notifications)
              .where(eq(schema.notifications.userId, userId));
            logger.debug(`Cleaned up notifications for user: ${userId}`);
          },
          { mode: "work-queue", workerGroup: "user-cleanup" }
        );

        logger.debug("✅ Notification Backend afterPluginsReady complete.");
      },
    });
  },
});
