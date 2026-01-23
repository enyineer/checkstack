import {
  setupHealthCheckWorker,
  bootstrapHealthChecks,
} from "./queue-executor";
import { setupRetentionJob } from "./retention-job";
import * as schema from "./schema";
import {
  healthCheckAccessRules,
  healthCheckAccess,
  pluginMetadata,
  healthCheckContract,
  healthcheckRoutes,
} from "@checkstack/healthcheck-common";
import {
  createBackendPlugin,
  coreServices,
  type EmitHookFn,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { integrationEventExtensionPoint } from "@checkstack/integration-backend";
import { z } from "zod";
import { createHealthCheckRouter } from "./router";
import { HealthCheckService } from "./service";
import { catalogHooks } from "@checkstack/catalog-backend";
import { CatalogApi } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { IncidentApi } from "@checkstack/incident-common";
import { healthCheckHooks } from "./hooks";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";

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
    env.registerAccessRules(healthCheckAccessRules);

    // Register hooks as integration events
    const integrationEvents = env.getExtensionPoint(
      integrationEventExtensionPoint,
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
      pluginMetadata,
    );

    integrationEvents.registerEvent(
      {
        hook: healthCheckHooks.systemHealthy,
        displayName: "System Health Restored",
        description: "Fired when a system's health status recovers to healthy",
        category: "Health",
        payloadSchema: systemHealthyPayloadSchema,
      },
      pluginMetadata,
    );

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        healthCheckRegistry: coreServices.healthCheckRegistry,
        collectorRegistry: coreServices.collectorRegistry,
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
        collectorRegistry,
        rpc,
        rpcClient,
        queueManager,
        signalService,
      }) => {
        logger.debug("🏥 Initializing Health Check Backend...");

        // Create catalog client for notification delegation
        const catalogClient = rpcClient.forPlugin(CatalogApi);

        // Create maintenance client for notification suppression checks
        const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);

        // Create incident client for notification suppression checks
        const incidentClient = rpcClient.forPlugin(IncidentApi);

        // Setup queue-based health check worker
        await setupHealthCheckWorker({
          db: database,
          registry: healthCheckRegistry,
          collectorRegistry,
          logger,
          queueManager,
          signalService,
          catalogClient,
          maintenanceClient,
          incidentClient,
          getEmitHook: () => storedEmitHook,
        });

        // Setup retention job for tiered storage (daily aggregation)
        await setupRetentionJob({
          db: database,
          logger,
          queueManager,
        });

        const healthCheckRouter = createHealthCheckRouter(
          database as SafeDatabase<typeof schema>,
          healthCheckRegistry,
          collectorRegistry,
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
              requiredAccessRules: [healthCheckAccess.configuration.manage],
            },
            {
              id: "manage",
              title: "Manage Health Checks",
              subtitle: "Manage health check configurations",
              iconName: "HeartPulse",
              shortcuts: ["meta+shift+h", "ctrl+shift+h"],
              route: resolveRoute(healthcheckRoutes.routes.config),
              requiredAccessRules: [healthCheckAccess.configuration.manage],
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
        collectorRegistry,
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
        const service = new HealthCheckService(
          database,
          healthCheckRegistry,
          collectorRegistry,
        );
        onHook(
          catalogHooks.systemDeleted,
          async (payload) => {
            logger.debug(
              `Cleaning up health check associations for deleted system: ${payload.systemId}`,
            );
            await service.removeAllSystemAssociations(payload.systemId);
          },
          { mode: "work-queue", workerGroup: "system-cleanup" },
        );

        logger.debug("✅ Health Check Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { healthCheckHooks } from "./hooks";
