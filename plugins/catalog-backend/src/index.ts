import { createBackendPlugin } from "@checkmate/backend-api";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { coreServices } from "@checkmate/backend-api";
import { permissionList } from "@checkmate/catalog-common";
import { createCatalogRouter } from "./router";

// Database schema is still needed for types in creating the router
import * as schema from "./schema";

export let db: NodePgDatabase<typeof schema> | undefined;

export default createBackendPlugin({
  pluginId: "catalog-backend",
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
      },
      init: async ({ database, rpc, logger }) => {
        logger.debug("Initializing Catalog Backend...");

        // 4. Register oRPC router
        const catalogRouter = createCatalogRouter(
          database as NodePgDatabase<typeof schema>
        );
        rpc.registerRouter("catalog-backend", catalogRouter);

        logger.debug("✅ Catalog Backend initialized.");
      },
    });
  },
});
