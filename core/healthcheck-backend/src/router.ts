import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  zod,
  type RpcContext,
  type HealthCheckRegistry,
} from "@checkmate-monitor/backend-api";
import { healthCheckContract } from "@checkmate-monitor/healthcheck-common";
import { HealthCheckService } from "./service";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Creates the healthcheck router using contract-based implementation.
 *
 * Auth and permissions are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.permissions.
 */
export const createHealthCheckRouter = (
  database: NodePgDatabase<typeof schema>,
  registry: HealthCheckRegistry
) => {
  // Create service instance once - shared across all handlers
  const service = new HealthCheckService(database, registry);

  // Create contract implementer with context type AND auto auth middleware
  const os = implement(healthCheckContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  return os.router({
    getStrategies: os.getStrategies.handler(async ({ context }) => {
      return context.healthCheckRegistry.getStrategies().map((s) => ({
        id: s.id,
        displayName: s.displayName,
        description: s.description,
        configSchema: zod.toJSONSchema(s.config.schema),
      }));
    }),

    getConfigurations: os.getConfigurations.handler(async () => {
      return service.getConfigurations();
    }),

    createConfiguration: os.createConfiguration.handler(async ({ input }) => {
      return service.createConfiguration(input);
    }),

    updateConfiguration: os.updateConfiguration.handler(async ({ input }) => {
      const config = await service.updateConfiguration(input.id, input.body);
      if (!config) {
        throw new ORPCError("NOT_FOUND", {
          message: "Configuration not found",
        });
      }
      return config;
    }),

    deleteConfiguration: os.deleteConfiguration.handler(async ({ input }) => {
      await service.deleteConfiguration(input);
    }),

    getSystemConfigurations: os.getSystemConfigurations.handler(
      async ({ input }) => {
        return service.getSystemConfigurations(input);
      }
    ),

    getSystemAssociations: os.getSystemAssociations.handler(
      async ({ input }) => {
        return service.getSystemAssociations(input.systemId);
      }
    ),

    associateSystem: os.associateSystem.handler(async ({ input, context }) => {
      await service.associateSystem({
        systemId: input.systemId,
        configurationId: input.body.configurationId,
        enabled: input.body.enabled,
        stateThresholds: input.body.stateThresholds,
      });

      // If enabling the health check, schedule it immediately
      if (input.body.enabled) {
        const config = await service.getConfiguration(
          input.body.configurationId
        );
        if (config) {
          const { scheduleHealthCheck } = await import("./queue-executor");
          await scheduleHealthCheck({
            queueManager: context.queueManager,
            payload: {
              configId: config.id,
              systemId: input.systemId,
            },
            intervalSeconds: config.intervalSeconds,
          });
        }
      }
    }),

    disassociateSystem: os.disassociateSystem.handler(async ({ input }) => {
      await service.disassociateSystem(input.systemId, input.configId);
    }),

    getRetentionConfig: os.getRetentionConfig.handler(async ({ input }) => {
      return service.getRetentionConfig(input.systemId, input.configurationId);
    }),

    updateRetentionConfig: os.updateRetentionConfig.handler(
      async ({ input }) => {
        await service.updateRetentionConfig(
          input.systemId,
          input.configurationId,
          input.retentionConfig
        );
      }
    ),

    getHistory: os.getHistory.handler(async ({ input }) => {
      return service.getHistory(input);
    }),

    getDetailedHistory: os.getDetailedHistory.handler(async ({ input }) => {
      return service.getDetailedHistory(input);
    }),

    getAggregatedHistory: os.getAggregatedHistory.handler(async ({ input }) => {
      return service.getAggregatedHistory(input, {
        includeAggregatedResult: false,
      });
    }),

    getDetailedAggregatedHistory: os.getDetailedAggregatedHistory.handler(
      async ({ input }) => {
        return service.getAggregatedHistory(input, {
          includeAggregatedResult: true,
        });
      }
    ),
    getSystemHealthStatus: os.getSystemHealthStatus.handler(
      async ({ input }) => {
        return service.getSystemHealthStatus(input.systemId);
      }
    ),

    getSystemHealthOverview: os.getSystemHealthOverview.handler(
      async ({ input }) => {
        return service.getSystemHealthOverview(input.systemId);
      }
    ),
  });
};

export type HealthCheckRouter = ReturnType<typeof createHealthCheckRouter>;
