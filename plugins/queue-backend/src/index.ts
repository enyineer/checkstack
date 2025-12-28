import { Hono } from "hono";
import { createBackendPlugin, coreServices, z } from "@checkmate/backend-api";
import {
  permissionList,
  permissions,
  UpdateQueueConfigurationSchema,
} from "@checkmate/queue-common";
import { zValidator } from "@hono/zod-validator";

export default createBackendPlugin({
  pluginId: "queue-backend",
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        queuePluginRegistry: coreServices.queuePluginRegistry,
        queueFactory: coreServices.queueFactory,
        router: coreServices.httpRouter,
        check: coreServices.permissionCheck,
      },
      init: async ({
        logger,
        queuePluginRegistry,
        queueFactory,
        router,
        check,
      }) => {
        logger.info("📋 Initializing Queue Settings Backend...");

        const apiRouter = new Hono();

        // Get available queue plugins
        apiRouter.get("/plugins", check(permissions.queueRead.id), (c) => {
          try {
            const plugins = queuePluginRegistry.getPlugins().map((p) => ({
              id: p.id,
              displayName: p.displayName,
              description: p.description,
              configVersion: p.configVersion,
              configSchema: z.toJSONSchema(p.configSchema),
            }));
            return c.json(plugins);
          } catch (error) {
            logger.error("Error fetching queue plugins:", error);
            return c.json({ error: String(error) }, 500);
          }
        });

        // Get current queue configuration
        apiRouter.get(
          "/configuration",
          check(permissions.queueRead.id),
          async (c) => {
            try {
              const activePluginId = queueFactory.getActivePlugin();
              const plugin = queuePluginRegistry.getPlugin(activePluginId);

              if (!plugin) {
                return c.json({ error: "Active queue plugin not found" }, 404);
              }

              // We don't have a way to get the current config from the factory
              // So we'll just return the plugin ID for now
              // The frontend will need to handle this
              return c.json({
                pluginId: activePluginId,
                config: {}, // TODO: Store and retrieve actual config
              });
            } catch (error) {
              logger.error("Error fetching queue configuration:", error);
              return c.json({ error: String(error) }, 500);
            }
          }
        );

        // Update queue configuration
        apiRouter.put(
          "/configuration",
          check(permissions.queueManage.id),
          zValidator("json", UpdateQueueConfigurationSchema),
          async (c) => {
            try {
              const { pluginId, config } = c.req.valid("json");

              await queueFactory.setActivePlugin(pluginId, config);

              logger.info(`Queue configuration updated to plugin: ${pluginId}`);

              return c.json({
                pluginId,
                config,
              });
            } catch (error) {
              logger.error("Error updating queue configuration:", error);
              return c.json({ error: String(error) }, 500);
            }
          }
        );

        router.route("/", apiRouter);
      },
    });
  },
});
