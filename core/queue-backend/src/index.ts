import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import {
  permissionList,
  pluginMetadata,
  queueContract,
} from "@checkmate/queue-common";
import { createQueueRouter } from "./router";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        config: coreServices.config,
      },
      init: async ({ logger, rpc, config }) => {
        logger.debug("📋 Initializing Queue Settings Backend...");

        // 4. Register oRPC router
        const queueRouter = createQueueRouter(config);
        rpc.registerRouter(queueRouter, queueContract);
      },
    });
  },
});
