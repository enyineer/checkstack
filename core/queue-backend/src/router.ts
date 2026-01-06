import {
  toJsonSchema,
  ConfigService,
  RpcContext,
  autoAuthMiddleware,
} from "@checkmate-monitor/backend-api";
import { queueContract } from "@checkmate-monitor/queue-common";
import { implement, ORPCError } from "@orpc/server";

const os = implement(queueContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export const createQueueRouter = (configService: ConfigService) => {
  return os.router({
    getPlugins: os.getPlugins.handler(async ({ context }) => {
      const plugins = context.queuePluginRegistry.getPlugins().map((p) => ({
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        configVersion: p.configVersion,
        configSchema: toJsonSchema(p.configSchema),
      }));
      return plugins;
    }),

    getConfiguration: os.getConfiguration.handler(async ({ context }) => {
      const activePluginId = context.queueManager.getActivePlugin();
      const plugin = context.queuePluginRegistry.getPlugin(activePluginId);

      if (!plugin) {
        throw new Error("Active queue plugin not found");
      }

      // Get redacted config from ConfigService using plugin's schema
      const config = await configService.getRedacted(
        activePluginId,
        plugin.configSchema,
        plugin.configVersion
      );

      return {
        pluginId: activePluginId,
        config: config || {},
      };
    }),

    updateConfiguration: os.updateConfiguration.handler(
      async ({ input, context }) => {
        const { pluginId, config } = input;
        try {
          await context.queueManager.setActiveBackend(pluginId, config);
        } catch (error) {
          if (error instanceof Error) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error.message,
            });
          }
          throw error;
        }
        context.logger.info(
          `Queue configuration updated to plugin: ${pluginId}`
        );
        return {
          pluginId,
          config,
        };
      }
    ),
  });
};
