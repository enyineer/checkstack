import {
  os,
  authedProcedure,
  permissionMiddleware,
  zod,
} from "@checkmate/backend-api";
import {
  permissions,
  UpdateQueueConfigurationSchema,
} from "@checkmate/queue-common";

const queueRead = permissionMiddleware(permissions.queueRead.id);
const queueManage = permissionMiddleware(permissions.queueManage.id);

export const createQueueRouter = () => {
  return os.router({
    getPlugins: authedProcedure.use(queueRead).handler(async ({ context }) => {
      const plugins = context.queuePluginRegistry.getPlugins().map((p) => ({
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        configVersion: p.configVersion,
        configSchema: zod.toJSONSchema(p.configSchema),
      }));
      return plugins;
    }),

    getConfiguration: authedProcedure
      .use(queueRead)
      .handler(async ({ context }) => {
        const activePluginId = context.queueFactory.getActivePlugin();
        const plugin = context.queuePluginRegistry.getPlugin(activePluginId);

        if (!plugin) {
          throw new Error("Active queue plugin not found");
        }

        return {
          pluginId: activePluginId,
          config: {}, // TODO: Store and retrieve actual config
        };
      }),

    updateConfiguration: authedProcedure
      .use(queueManage)
      .input(UpdateQueueConfigurationSchema)
      .handler(async ({ input, context }) => {
        const { pluginId, config } = input;
        await context.queueFactory.setActivePlugin(pluginId, config);
        context.logger.info(
          `Queue configuration updated to plugin: ${pluginId}`
        );
        return {
          pluginId,
          config,
        };
      }),
  });
};
