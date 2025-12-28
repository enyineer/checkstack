import { createBackendPlugin } from "@checkmate/backend-api";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { coreServices } from "@checkmate/backend-api";
import * as schema from "./schema";
import { EntityService } from "./services/entity-service";
import { OperationService } from "./services/operation-service";
import { permissionList, permissions } from "@checkmate/catalog-common";

import {
  insertGroupSchema,
  insertIncidentSchema,
  insertSystemSchema,
  insertViewSchema,
} from "./services/types";

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
        validate: coreServices.validation,
      },
      init: async ({ database, router, logger, check, validate }) => {
        logger.info("Initializing Catalog Backend...");

        const entityService = new EntityService(database);
        const operationService = new OperationService(database);

        // Entities
        router.get(
          "/entities",
          check(permissions.catalogRead.id),
          async (c) => {
            const systems = await entityService.getSystems();
            const groups = await entityService.getGroups();
            return c.json({ systems, groups });
          }
        );

        router.post(
          "/entities/systems",
          check(permissions.catalogManage.id),
          validate(insertSystemSchema),
          async (c) => {
            const body = await c.req.json();
            const system = await entityService.createSystem(body);
            return c.json(system);
          }
        );

        router.put(
          "/entities/systems/:id",
          check(permissions.catalogManage.id),
          validate(insertSystemSchema.partial()),
          async (c) => {
            const id = c.req.param("id");
            const body = await c.req.json();
            const system = await entityService.updateSystem(id, body);
            return c.json(system);
          }
        );

        router.delete(
          "/entities/systems/:id",
          check(permissions.catalogManage.id),
          async (c) => {
            const id = c.req.param("id");
            await entityService.deleteSystem(id);
            return c.json({ success: true });
          }
        );

        router.post(
          "/entities/groups",
          check(permissions.catalogManage.id),
          validate(insertGroupSchema),
          async (c) => {
            const body = await c.req.json();
            const group = await entityService.createGroup(body);
            return c.json(group);
          }
        );

        router.put(
          "/entities/groups/:id",
          check(permissions.catalogManage.id),
          validate(insertGroupSchema.partial()),
          async (c) => {
            const id = c.req.param("id");
            const body = await c.req.json();
            const group = await entityService.updateGroup(id, body);
            return c.json(group);
          }
        );

        router.delete(
          "/entities/groups/:id",
          check(permissions.catalogManage.id),
          async (c) => {
            const id = c.req.param("id");
            await entityService.deleteGroup(id);
            return c.json({ success: true });
          }
        );

        router.post(
          "/entities/groups/:id/systems",
          check(permissions.catalogManage.id),
          async (c) => {
            const groupId = c.req.param("id");
            const body = await c.req.json();
            await entityService.addSystemToGroup({
              groupId,
              systemId: body.systemId,
            });
            return c.json({ success: true });
          }
        );

        router.delete(
          "/entities/groups/:id/systems/:systemId",
          check(permissions.catalogManage.id),
          async (c) => {
            const groupId = c.req.param("id");
            const systemId = c.req.param("systemId");
            await entityService.removeSystemFromGroup({ groupId, systemId });
            return c.json({ success: true });
          }
        );

        // Views
        router.get("/views", check(permissions.catalogRead.id), async (c) => {
          const views = await entityService.getViews();
          return c.json(views);
        });

        router.post(
          "/views",
          check(permissions.catalogManage.id),
          validate(insertViewSchema),
          async (c) => {
            const body = await c.req.json();
            const view = await entityService.createView(body);
            return c.json(view);
          }
        );

        // Incidents
        router.get(
          "/incidents",
          check(permissions.catalogRead.id),
          async (c) => {
            const incidents = await operationService.getIncidents();
            return c.json(incidents);
          }
        );

        router.post(
          "/incidents",
          check(permissions.catalogManage.id),
          validate(insertIncidentSchema),
          async (c) => {
            const body = await c.req.json();
            const incident = await operationService.createIncident(body);
            return c.json(incident);
          }
        );

        logger.info("✅ Catalog Backend initialized.");
      },
    });
  },
});
