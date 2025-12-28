import { Hono } from "hono";
import { HealthCheckService } from "./service";
import { Scheduler } from "./scheduler";
import * as schema from "./schema";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  CreateHealthCheckConfigurationSchema,
  UpdateHealthCheckConfigurationSchema,
  AssociateHealthCheckSchema,
  permissionList,
  permissions,
} from "@checkmate/healthcheck-common";
import { zValidator } from "@hono/zod-validator";
import { createBackendPlugin, coreServices, z } from "@checkmate/backend-api";

export default createBackendPlugin({
  pluginId: "healthcheck-backend",
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        database: coreServices.database,
        healthCheckRegistry: coreServices.healthCheckRegistry,
        router: coreServices.httpRouter,
        check: coreServices.permissionCheck,
        fetch: coreServices.fetch,
        tokenVerification: coreServices.tokenVerification,
      },
      init: async ({
        logger,
        database,
        healthCheckRegistry,
        router,
        check,
        fetch,
        tokenVerification,
      }) => {
        logger.info("🏥 Initializing Health Check Backend...");

        const service = new HealthCheckService(
          database as unknown as NodePgDatabase<typeof schema>
        );
        const scheduler = new Scheduler(
          database as unknown as NodePgDatabase<typeof schema>,
          healthCheckRegistry,
          logger,
          fetch,
          tokenVerification
        );

        scheduler.start();

        const apiRouter = new Hono();

        // Strategies
        apiRouter.get(
          "/strategies",
          check(permissions.healthCheckRead.id),
          (c) => {
            try {
              const strategies = healthCheckRegistry
                .getStrategies()
                .map((s) => ({
                  id: s.id,
                  displayName: s.displayName,
                  description: s.description,
                  configSchema: z.toJSONSchema(s.configSchema),
                }));
              return c.json(strategies);
            } catch (error) {
              console.error("Error fetching strategies:", error);
              return c.json({ error: String(error) }, 500);
            }
          }
        );

        // Configurations CRUD
        apiRouter.get(
          "/configurations",
          check(permissions.healthCheckRead.id),
          async (c) => {
            const configs = await service.getConfigurations();
            return c.json(configs);
          }
        );

        apiRouter.post(
          "/configurations",
          check(permissions.healthCheckManage.id),
          zValidator("json", CreateHealthCheckConfigurationSchema),
          async (c) => {
            const data = c.req.valid("json");
            const config = await service.createConfiguration(data);
            return c.json(config, 201);
          }
        );

        apiRouter.put(
          "/configurations/:id",
          check(permissions.healthCheckManage.id),
          zValidator("json", UpdateHealthCheckConfigurationSchema),
          async (c) => {
            const id = c.req.param("id");
            const data = c.req.valid("json");
            const config = await service.updateConfiguration(id, data);
            if (!config) return c.json({ error: "Not found" }, 404);
            return c.json(config);
          }
        );

        apiRouter.delete(
          "/configurations/:id",
          check(permissions.healthCheckManage.id),
          async (c) => {
            const id = c.req.param("id");
            await service.deleteConfiguration(id);
            // eslint-disable-next-line unicorn/no-null
            return c.body(null, 204);
          }
        );

        // System Associations
        apiRouter.get(
          "/systems/:systemId/checks",
          check(permissions.healthCheckRead.id),
          async (c) => {
            const systemId = c.req.param("systemId");
            const configs = await service.getSystemConfigurations(systemId);
            return c.json(configs);
          }
        );

        apiRouter.post(
          "/systems/:systemId/checks",
          check(permissions.healthCheckManage.id), // Managing associations is like managing configurations
          zValidator("json", AssociateHealthCheckSchema),
          async (c) => {
            const systemId = c.req.param("systemId");
            const { configurationId, enabled } = c.req.valid("json");
            await service.associateSystem(systemId, configurationId, enabled);
            // eslint-disable-next-line unicorn/no-null
            return c.body(null, 201);
          }
        );

        apiRouter.delete(
          "/systems/:systemId/checks/:configId",
          check(permissions.healthCheckManage.id),
          async (c) => {
            const systemId = c.req.param("systemId");
            const configId = c.req.param("configId");
            await service.disassociateSystem(systemId, configId);
            // eslint-disable-next-line unicorn/no-null
            return c.body(null, 204);
          }
        );

        apiRouter.get(
          "/history",
          check(permissions.healthCheckRead.id),
          async (c) => {
            const systemId = c.req.query("systemId");
            const configurationId = c.req.query("configurationId");
            const limit = c.req.query("limit")
              ? Number.parseInt(c.req.query("limit")!, 10)
              : undefined;

            const history = await service.getHistory({
              systemId,
              configurationId,
              limit,
            });
            return c.json(history);
          }
        );

        router.route("/", apiRouter);
      },
    });
  },
});
