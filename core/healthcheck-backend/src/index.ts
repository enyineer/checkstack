import {
  setupHealthCheckWorker,
  bootstrapHealthChecks,
} from "./queue-executor";
import * as schema from "./schema";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  permissionList,
  pluginMetadata,
  healthCheckContract,
  healthcheckRoutes,
  permissions,
} from "@checkmate-monitor/healthcheck-common";
import {
  createBackendPlugin,
  coreServices,
  type EmitHookFn,
} from "@checkmate-monitor/backend-api";
import { integrationEventExtensionPoint } from "@checkmate-monitor/integration-backend";
import { z } from "zod";
import { createHealthCheckRouter } from "./router";
import { HealthCheckService } from "./service";
import { catalogHooks } from "@checkmate-monitor/catalog-backend";
import { CatalogApi } from "@checkmate-monitor/catalog-common";
import { healthCheckHooks } from "./hooks";
import { registerSearchProvider } from "@checkmate-monitor/command-backend";
import { resolveRoute } from "@checkmate-monitor/common";

// =============================================================================
// Integration Event Payload Schemas
// =============================================================================

const systemDegradedPayloadSchema = z.object({
  systemId: z.string(),
  systemName: z.string().optional(),
  previousStatus: z.string(),
  newStatus: z.string(),
  healthyChecks: z.number(),
  totalChecks: z.number(),
  timestamp: z.string(),
});

const systemHealthyPayloadSchema = z.object({
  systemId: z.string(),
  systemName: z.string().optional(),
  previousStatus: z.string(),
  healthyChecks: z.number(),
  totalChecks: z.number(),
  timestamp: z.string(),
});

// Store emitHook reference for use during Phase 2 init
let storedEmitHook: EmitHookFn | undefined;

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerPermissions(permissionList);

    // Register hooks as integration events
    const integrationEvents = env.getExtensionPoint(
      integrationEventExtensionPoint
    );

    integrationEvents.registerEvent(
      {
        hook: healthCheckHooks.systemDegraded,
        displayName: "System Health Degraded",
        description:
          "Fired when a system's health status transitions from healthy to degraded/unhealthy",
        category: "Health",
        payloadSchema: systemDegradedPayloadSchema,
      },
      pluginMetadata
    );

    integrationEvents.registerEvent(
      {
        hook: healthCheckHooks.systemHealthy,
        displayName: "System Health Restored",
        description: "Fired when a system's health status recovers to healthy",
        category: "Health",
        payloadSchema: systemHealthyPayloadSchema,
      },
      pluginMetadata
    );

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        healthCheckRegistry: coreServices.healthCheckRegistry,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        queueManager: coreServices.queueManager,
        signalService: coreServices.signalService,
      },
      // Phase 2: Register router and setup worker
      init: async ({
        logger,
        database,
        healthCheckRegistry,
        rpc,
        rpcClient,
        queueManager,
        signalService,
      }) => {
        logger.debug("🏥 Initializing Health Check Backend...");

        // Create catalog client for notification delegation
        const catalogClient = rpcClient.forPlugin(CatalogApi);

        // Setup queue-based health check worker
        await setupHealthCheckWorker({
          db: database,
          registry: healthCheckRegistry,
          logger,
          queueManager,
          signalService,
          catalogClient,
          getEmitHook: () => storedEmitHook,
        });

        const healthCheckRouter = createHealthCheckRouter(
          database as NodePgDatabase<typeof schema>,
          healthCheckRegistry
        );
        rpc.registerRouter(healthCheckRouter, healthCheckContract);

        // Register command palette commands
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "create",
              title: "Create Health Check",
              subtitle: "Create a new health check configuration",
              iconName: "HeartPulse",
              route:
                resolveRoute(healthcheckRoutes.routes.config) +
                "?action=create",
              requiredPermissions: [permissions.healthCheckManage],
            },
            {
              id: "manage",
              title: "Manage Health Checks",
              subtitle: "Manage health check configurations",
              iconName: "HeartPulse",
              shortcuts: ["meta+shift+h", "ctrl+shift+h"],
              route: resolveRoute(healthcheckRoutes.routes.config),
              requiredPermissions: [permissions.healthCheckManage],
            },
          ],
        });

        logger.debug("✅ Health Check Backend initialized.");
      },
      afterPluginsReady: async ({
        database,
        queueManager,
        logger,
        onHook,
        emitHook,
        healthCheckRegistry,
      }) => {
        // Store emitHook for the queue worker (Closure-based Hook Getter pattern)
        storedEmitHook = emitHook;
        // Bootstrap all enabled health checks
        await bootstrapHealthChecks({
          db: database,
          queueManager,
          logger,
        });

        // Subscribe to catalog system deletion to clean up associations
        const service = new HealthCheckService(database, healthCheckRegistry);
        onHook(
          catalogHooks.systemDeleted,
          async (payload) => {
            logger.debug(
              `Cleaning up health check associations for deleted system: ${payload.systemId}`
            );
            await service.removeAllSystemAssociations(payload.systemId);
          },
          { mode: "work-queue", workerGroup: "system-cleanup" }
        );

        logger.debug("✅ Health Check Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { healthCheckHooks } from "./hooks";
