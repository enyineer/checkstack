import {
  toJsonSchema,
  ConfigService,
  RpcContext,
  autoAuthMiddleware,
  correlationMiddleware,
} from "@checkstack/backend-api";
import {
  queueContract,
  QueueLagThresholdsSchema,
  type QueueLagThresholds,
  type LagSeverity,
} from "@checkstack/queue-common";
import { implement, ORPCError } from "@orpc/server";
import { extractErrorMessage } from "@checkstack/common";

const os = implement(queueContract)
  .$context<RpcContext>()
  .use(correlationMiddleware)
  .use(autoAuthMiddleware);

// Config key for lag thresholds
const LAG_THRESHOLDS_KEY = "queue:lag-thresholds";

// Default thresholds
const DEFAULT_THRESHOLDS: QueueLagThresholds = {
  warningThreshold: 100,
  criticalThreshold: 500,
};

/**
 * Calculate lag severity based on pending count and thresholds
 */
function calculateSeverity(
  pending: number,
  thresholds: QueueLagThresholds
): LagSeverity {
  if (pending >= thresholds.criticalThreshold) {
    return "critical";
  }
  if (pending >= thresholds.warningThreshold) {
    return "warning";
  }
  return "none";
}

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
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: extractErrorMessage(error),
          });
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

    getStats: os.getStats.handler(async ({ context }) => {
      const stats = await context.queueManager.getAggregatedStats();
      return stats;
    }),

    getLagStatus: os.getLagStatus.handler(async ({ context }) => {
      const stats = await context.queueManager.getAggregatedStats();

      // Load thresholds from config
      const thresholds =
        (await configService.get<QueueLagThresholds>(
          LAG_THRESHOLDS_KEY,
          QueueLagThresholdsSchema,
          1
        )) ?? DEFAULT_THRESHOLDS;

      const severity = calculateSeverity(stats.pending, thresholds);

      return {
        pending: stats.pending,
        severity,
        thresholds,
      };
    }),

    listJobs: os.listJobs.handler(async ({ input, context }) => {
      const result = await context.queueManager.listJobs(input);
      return {
        items: result.items.map((s) => ({
          id: s.id,
          name: s.name,
          state: s.state,
          enqueuedAt: s.enqueuedAt,
          startedAt: s.startedAt,
          finishedAt: s.finishedAt,
          attempts: s.attempts,
          failedReason: s.failedReason,
          nextRunAt: s.nextRunAt,
          recurring: s.recurring,
        })),
        total: result.total,
        hasMore: result.hasMore,
      };
    }),

    updateLagThresholds: os.updateLagThresholds.handler(
      async ({ input, context }) => {
        // Validate that warning < critical
        if (input.warningThreshold >= input.criticalThreshold) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Warning threshold must be less than critical threshold",
          });
        }

        await configService.set(
          LAG_THRESHOLDS_KEY,
          QueueLagThresholdsSchema,
          1,
          input
        );

        context.logger.info(
          `Queue lag thresholds updated: warning=${input.warningThreshold}, critical=${input.criticalThreshold}`
        );

        return input;
      }
    ),
  });
};
