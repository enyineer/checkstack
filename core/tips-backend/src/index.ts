import {
  createBackendPlugin,
  coreServices,
} from "@checkstack/backend-api";
import { pluginMetadata, tipsContract } from "@checkstack/tips-common";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { createTipsRouter } from "./router";
import { authHooks } from "@checkstack/auth-backend";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerInit({
      schema,
      deps: {
        database: coreServices.database,
        rpc: coreServices.rpc,
        logger: coreServices.logger,
      },
      init: async ({ database, rpc }) => {
        const router = createTipsRouter(database);
        rpc.registerRouter(router, tipsContract);
      },
      afterPluginsReady: async ({ database, logger, onHook }) => {
        // Clean up dismissal records when a user is deleted, so a recycled
        // user_id never inherits another user's dismissed tips.
        onHook(
          authHooks.userDeleted,
          async ({ userId }) => {
            logger.debug(
              `Cleaning up tip dismissals for deleted user: ${userId}`,
            );
            await database
              .delete(schema.userTipDismissal)
              .where(eq(schema.userTipDismissal.userId, userId));
            logger.debug(`Cleaned up tip dismissals for user: ${userId}`);
          },
          { mode: "work-queue", workerGroup: "user-cleanup" },
        );

        logger.debug("✅ Tips Backend afterPluginsReady complete.");
      },
    });
  },
});
