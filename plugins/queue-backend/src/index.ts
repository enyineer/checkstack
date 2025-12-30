import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { permissionList } from "@checkmate/queue-common";
import { createQueueRouter } from "./router";

export default createBackendPlugin({
  pluginId: "queue-backend",
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
      },
      init: async ({ logger, rpc }) => {
        logger.debug("📋 Initializing Queue Settings Backend...");

        // 4. Register oRPC router
        const queueRouter = createQueueRouter();
        rpc.registerRouter("queue-backend", queueRouter);
      },
    });
  },
});
