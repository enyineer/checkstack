import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  cacheAccessRules,
  pluginMetadata,
  cacheContract,
} from "@checkstack/cache-common";
import { createCacheRouter } from "./router";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(cacheAccessRules);

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        config: coreServices.config,
      },
      init: async ({ logger, rpc, config }) => {
        logger.debug("📦 Initializing Cache Settings Backend...");

        const cacheRouter = createCacheRouter(config);
        rpc.registerRouter(cacheRouter, cacheContract);
      },
    });
  },
});
