import { createBackendPlugin } from "@checkmate/backend-api";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { coreServices } from "@checkmate/backend-api";
import * as schema from "./schema";
import { EntityService } from "./services/entity-service";
import { OperationService } from "./services/operation-service";
import { permissionList } from "./permissions";

export let db: NodePgDatabase<typeof schema> | undefined;

export default createBackendPlugin({
  pluginId: "catalog-backend",
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      schema,
      deps: {
        router: coreServices.httpRouter,
        logger: coreServices.logger,
        check: coreServices.permissionCheck,
      },
      init: async ({ database, router, logger, check }) => {
        logger.info("Initializing Catalog Backend...");

        const entityService = new EntityService(database);
        const operationService = new OperationService(database);

        // Entities
        router.get("/entities", check("entity.read"), async (c) => {
          const systems = await entityService.getSystems();
          const groups = await entityService.getGroups();
          return c.json({ systems, groups });
        });

        router.post("/entities/systems", check("entity.create"), async (c) => {
          const body = await c.req.json();
          // Validation omitted for brevity, in real app use zod validator
          const system = await entityService.createSystem(body);
          return c.json(system);
        });

        router.post("/entities/groups", check("entity.create"), async (c) => {
          const body = await c.req.json();
          const group = await entityService.createGroup(body);
          return c.json(group);
        });

        // Views
        router.get("/views", check("entity.read"), async (c) => {
          const views = await entityService.getViews();
          return c.json(views);
        });

        router.post("/views", check("entity.create"), async (c) => {
          const body = await c.req.json();
          const view = await entityService.createView(body);
          return c.json(view);
        });

        // Incidents
        router.get("/incidents", check("incident.manage"), async (c) => {
          const incidents = await operationService.getIncidents();
          return c.json(incidents);
        });

        router.post("/incidents", check("incident.manage"), async (c) => {
          const body = await c.req.json();
          const incident = await operationService.createIncident(body);
          return c.json(incident);
        });

        logger.info("✅ Catalog Backend initialized.");
      },
    });
  },
});
