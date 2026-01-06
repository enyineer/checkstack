import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import { pluginMetadata, themeContract } from "@checkmate-monitor/theme-common";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { createThemeRouter } from "./router";
import { authHooks } from "@checkmate-monitor/auth-backend";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Register initialization logic with schema
    env.registerInit({
      schema,
      deps: {
        database: coreServices.database,
        rpc: coreServices.rpc,
        logger: coreServices.logger,
      },
      init: async ({ database, rpc }) => {
        // Create and register the theme router
        const router = createThemeRouter(database);
        rpc.registerRouter(router, themeContract);
      },
      afterPluginsReady: async ({ database, logger, onHook }) => {
        const db = database;

        // Subscribe to user deletion to clean up theme preferences
        onHook(
          authHooks.userDeleted,
          async ({ userId }) => {
            logger.debug(
              `Cleaning up theme preference for deleted user: ${userId}`
            );
            await db
              .delete(schema.userThemePreference)
              .where(eq(schema.userThemePreference.userId, userId));
            logger.debug(`Cleaned up theme preference for user: ${userId}`);
          },
          { mode: "work-queue", workerGroup: "user-cleanup" }
        );

        logger.debug("✅ Theme Backend afterPluginsReady complete.");
      },
    });
  },
});
