import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  permissionList,
  pluginMetadata,
  maintenanceContract,
} from "@checkmate-monitor/maintenance-common";
import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import { MaintenanceService } from "./service";
import { createRouter } from "./router";
import { CatalogApi } from "@checkmate-monitor/catalog-common";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
      },
      init: async ({ logger, database, rpc, rpcClient, signalService }) => {
        logger.debug("🔧 Initializing Maintenance Backend...");

        const catalogClient = rpcClient.forPlugin(CatalogApi);

        const service = new MaintenanceService(
          database as NodePgDatabase<typeof schema>
        );
        const router = createRouter(
          service,
          signalService,
          catalogClient,
          logger
        );
        rpc.registerRouter(router, maintenanceContract);

        logger.debug("✅ Maintenance Backend initialized.");
      },
    });
  },
});
