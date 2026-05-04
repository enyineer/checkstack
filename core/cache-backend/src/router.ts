import {
  toJsonSchema,
  ConfigService,
  RpcContext,
  autoAuthMiddleware,
} from "@checkstack/backend-api";
import { cacheContract } from "@checkstack/cache-common";
import { implement, ORPCError } from "@orpc/server";
import { extractErrorMessage } from "@checkstack/common";

const os = implement(cacheContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export const createCacheRouter = (configService: ConfigService) => {
  return os.router({
    getPlugins: os.getPlugins.handler(async ({ context }) => {
      const plugins = context.cachePluginRegistry.getPlugins().map((p) => ({
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        configVersion: p.configVersion,
        configSchema: toJsonSchema(p.configSchema),
      }));
      return plugins;
    }),

    getConfiguration: os.getConfiguration.handler(async ({ context }) => {
      const activePluginId = context.cacheManager.getActivePlugin();
      const plugin = context.cachePluginRegistry.getPlugin(activePluginId);

      if (!plugin) {
        throw new Error("Active cache plugin not found");
      }

      // Get redacted config from ConfigService using plugin's schema
      const config = await configService.getRedacted(
        activePluginId,
        plugin.configSchema,
        plugin.configVersion,
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
          await context.cacheManager.setActiveBackend(pluginId, config);
        } catch (error) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: extractErrorMessage(error),
          });
        }
        context.logger.info(
          `Cache configuration updated to plugin: ${pluginId}`,
        );
        return {
          pluginId,
          config,
        };
      },
    ),

    getRuntimeStats: os.getRuntimeStats.handler(async ({ context }) => {
      const pluginId = context.cacheManager.getActivePlugin();
      const provider = context.cacheManager.getProvider();
      const stats = provider.getStats
        ? await provider.getStats()
        : {
            keyCount: null,
            sizeBytes: null,
            hits: null,
            misses: null,
            scope: "instance" as const,
          };
      return { pluginId, ...stats };
    }),

    listEntries: os.listEntries.handler(async ({ input, context }) => {
      const provider = context.cacheManager.getProvider();
      if (!provider.listEntries) {
        return { supported: false, items: [], total: 0, hasMore: false };
      }
      const result = await provider.listEntries(input);
      return {
        supported: true,
        items: result.items,
        total: result.total,
        hasMore: result.hasMore,
      };
    }),
  });
};
