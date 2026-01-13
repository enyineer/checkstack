import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  queueAccessRules,
  pluginMetadata,
  queueContract,
} from "@checkstack/queue-common";
import { createQueueRouter } from "./router";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(queueAccessRules);

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
