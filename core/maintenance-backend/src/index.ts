import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { permissionList } from "@checkmate/maintenance-common";
import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { MaintenanceService } from "./service";
import { createRouter } from "./router";
import { pluginMetadata } from "./plugin-metadata";
import type { CatalogClient } from "@checkmate/catalog-common";

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

        const catalogClient = rpcClient.forPlugin<CatalogClient>("catalog");

        const service = new MaintenanceService(
          database as NodePgDatabase<typeof schema>
        );
        const router = createRouter(
          service,
          signalService,
          catalogClient,
          logger
        );
        rpc.registerRouter(router);

        logger.debug("✅ Maintenance Backend initialized.");
      },
    });
  },
});
