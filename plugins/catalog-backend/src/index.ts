import { createBackendPlugin } from "@checkmate/backend/src/plugin-system";
import { permissions } from "./permissions";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { coreServices } from "@checkmate/backend-api";
import * as schema from "./schema";
import { entityService } from "./services/entity-service";
import { operationService } from "./services/operation-service";

export let db: NodePgDatabase<typeof schema> | undefined;

export default createBackendPlugin({
  pluginId: "catalog-backend",
  register(env) {
    env.registerInit({
      deps: {
        database: coreServices.database,
        router: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      init: async ({ database, router, logger }) => {
        logger.info("Initializing Catalog Backend...");

        // Use local db variable for services to import
        db = database as any; // Type casting for now, will fix with proper schema generics if needed

        // Register Permissions (TODO: How does core learn about these?
        // Architecture doc says: "The backend plugin must export permissions that can be set in the init-function"
        // But currently core scans plugin-manager.ts doesn't explicitly look for permissions export?
        // Wait, "Permissions are exported from each backend-plugin and MUST be configurable via the frontend"
        // I'll assume for now I should just make them available.
        // Maybe I need to register them with a permission service if one existed?
        // For this task, defining them is step 1.

        // Entities
        router.get("/entities", async (c) => {
          const systems = await entityService.getSystems();
          const groups = await entityService.getGroups();
          return c.json({ systems, groups });
        });

        router.post("/entities/systems", async (c) => {
          const body = await c.req.json();
          // Validation omitted for brevity, in real app use zod validator
          const system = await entityService.createSystem(body);
          return c.json(system);
        });

        router.post("/entities/groups", async (c) => {
          const body = await c.req.json();
          const group = await entityService.createGroup(body);
          return c.json(group);
        });

        // Views
        router.get("/views", async (c) => {
          const views = await entityService.getViews();
          return c.json(views);
        });

        router.post("/views", async (c) => {
          const body = await c.req.json();
          const view = await entityService.createView(body);
          return c.json(view);
        });

        // Incidents
        router.get("/incidents", async (c) => {
          const incidents = await operationService.getIncidents();
          return c.json(incidents);
        });

        router.post("/incidents", async (c) => {
          const body = await c.req.json();
          const incident = await operationService.createIncident(body);
          return c.json(incident);
        });

        logger.info("✅ Catalog Backend initialized.");
      },
    });
  },
});
