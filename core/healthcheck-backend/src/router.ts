import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  zod,
  type RpcContext,
} from "@checkmate/backend-api";
import { healthCheckContract } from "@checkmate/healthcheck-common";
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
  database: NodePgDatabase<typeof schema>
) => {
  // Create service instance once - shared across all handlers
  const service = new HealthCheckService(database);

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
        configSchema: zod.toJSONSchema(s.configSchema),
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

    getHistory: os.getHistory.handler(async ({ input }) => {
      const history = await service.getHistory(input);
      // Schema now uses pgEnum and typed jsonb - no manual casting needed
      return history.map((run) => ({
        id: run.id,
        configurationId: run.configurationId,
        systemId: run.systemId,
        status: run.status,
        result: run.result ?? {},
        timestamp: run.timestamp,
      }));
    }),

    getSystemHealthStatus: os.getSystemHealthStatus.handler(
      async ({ input }) => {
        return service.getSystemHealthStatus(input.systemId);
      }
    ),
  });
};

export type HealthCheckRouter = ReturnType<typeof createHealthCheckRouter>;
