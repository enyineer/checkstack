import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  permissionList,
  pluginMetadata,
  incidentContract,
} from "@checkmate/incident-common";
import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { IncidentService } from "./service";
import { createRouter } from "./router";
import { CatalogApi } from "@checkmate/catalog-common";
import { catalogHooks } from "@checkmate/catalog-backend";

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
        logger.debug("🔧 Initializing Incident Backend...");

        const catalogClient = rpcClient.forPlugin(CatalogApi);

        const service = new IncidentService(
          database as NodePgDatabase<typeof schema>
        );
        const router = createRouter(
          service,
          signalService,
          catalogClient,
          logger
        );
        rpc.registerRouter(router, incidentContract);

        logger.debug("✅ Incident Backend initialized.");
      },
      // Phase 3: Subscribe to catalog events for cleanup
      afterPluginsReady: async ({ database, logger, onHook }) => {
        const typedDb = database as NodePgDatabase<typeof schema>;
        const service = new IncidentService(typedDb);

        // Subscribe to catalog system deletion to clean up associations
        onHook(
          catalogHooks.systemDeleted,
          async (payload) => {
            logger.debug(
              `Cleaning up incident associations for deleted system: ${payload.systemId}`
            );
            await service.removeSystemAssociations(payload.systemId);
          },
          { mode: "work-queue", workerGroup: "incident-system-cleanup" }
        );

        logger.debug("✅ Incident Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { incidentHooks } from "./hooks";
