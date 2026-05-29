import {
  setupHealthCheckWorker,
  bootstrapHealthChecks,
} from "./queue-executor";
import { setupRetentionJob } from "./retention-job";
import { setupAutoIncidentCloseJob } from "./auto-incident-close-job";
import * as schema from "./schema";
import {
  healthCheckAccessRules,
  healthCheckAccess,
  pluginMetadata,
  healthCheckContract,
  healthcheckRoutes,
  healthcheckSystemSubscription,
  healthcheckGroupSubscription,
} from "@checkstack/healthcheck-common";
import {
  NotificationApi,
  specToRegistration,
} from "@checkstack/notification-common";
import {
  createBackendPlugin,
  coreServices,
  type EmitHookFn,
  type SafeDatabase,
  type HealthCheckRegistry,
  type CollectorRegistry,
} from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
  automationTriggerExtensionPoint,
} from "@checkstack/automation-backend";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { createHealthCheckRouter } from "./router";
import { HealthCheckService } from "./service";
import {
  assignmentArtifactType,
  createHealthCheckActions,
  healthCheckTriggers,
} from "./automations";
import { registerHealthcheckGitOpsKinds, registerHealthcheckGitOpsDocumentation } from "./healthcheck-gitops-kinds";
import { catalogHooks } from "@checkstack/catalog-backend";
import { satelliteHooks } from "@checkstack/satellite-backend";
import { incidentHooks } from "@checkstack/incident-backend";
import { eq, and, isNull } from "drizzle-orm";
import { healthCheckAutoIncidents } from "./schema";
import { CatalogApi } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { IncidentApi } from "@checkstack/incident-common";
import { GitOpsApi } from "@checkstack/gitops-common";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";
import { createHealthCheckCache } from "./cache";

// Store emitHook reference for use during Phase 2 init
let storedEmitHook: EmitHookFn | undefined;

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(healthCheckAccessRules);
    env.registerSubscriptionSpecs([
      healthcheckSystemSubscription,
      healthcheckGroupSubscription,
    ]);

    // ─── Automation Platform: triggers + artifact type ─────────────────
    // Buffered behind the extension point until automation-backend's
    // register() runs. Actions are wired in afterPluginsReady where
    // `emitHook` becomes available.
    const automationTriggers = env.getExtensionPoint(
      automationTriggerExtensionPoint,
    );
    for (const trigger of healthCheckTriggers) {
      automationTriggers.registerTrigger(trigger, pluginMetadata);
    }
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(assignmentArtifactType, pluginMetadata);

    // ─── GitOps Entity Kind Registration ───────────────────────────────
    // Mutable refs — populated during init(), consumed by reconcile closures.
    let gitopsDb: SafeDatabase<typeof schema> | undefined;
    let gitopsHealthCheckRegistry: HealthCheckRegistry | undefined;
    let gitopsCollectorRegistry: CollectorRegistry | undefined;
    let gitopsQueueManager: QueueManager | undefined;
    let healthCheckCache:
      | ReturnType<typeof createHealthCheckCache>
      | undefined;

    const kindRegistry = env.getExtensionPoint(entityKindExtensionPoint);
    registerHealthcheckGitOpsKinds({
      kindRegistry,
      createService: () => {
        if (!gitopsDb) throw new Error("Healthcheck database not initialized");
        if (!gitopsHealthCheckRegistry)
          throw new Error("HealthCheckRegistry not initialized");
        if (!gitopsCollectorRegistry)
          throw new Error("CollectorRegistry not initialized");
        return new HealthCheckService(
          gitopsDb,
          gitopsHealthCheckRegistry,
          gitopsCollectorRegistry,
        );
      },
      getHealthCheckRegistry: () => {
        if (!gitopsHealthCheckRegistry)
          throw new Error("HealthCheckRegistry not initialized");
        return gitopsHealthCheckRegistry;
      },
      getCollectorRegistry: () => {
        if (!gitopsCollectorRegistry)
          throw new Error("CollectorRegistry not initialized");
        return gitopsCollectorRegistry;
      },
      getQueueManager: () => {
        if (!gitopsQueueManager)
          throw new Error("QueueManager not initialized");
        return gitopsQueueManager;
      },
    });

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
        cacheManager: coreServices.cacheManager,
        config: coreServices.config,
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
        cacheManager,
        config,
      }) => {
        logger.debug("🏥 Initializing Health Check Backend...");

        // Populate mutable refs for GitOps reconcile closures
        gitopsDb = database;
        gitopsHealthCheckRegistry = healthCheckRegistry;
        gitopsCollectorRegistry = collectorRegistry;
        gitopsQueueManager = queueManager;

        // Create catalog client for notification delegation
        const catalogClient = rpcClient.forPlugin(CatalogApi);

        // Create maintenance client for notification suppression checks
        const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);

        // Create incident client for notification suppression checks
        const incidentClient = rpcClient.forPlugin(IncidentApi);

        // Notification client for spec-bound dispatch
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        // Create gitops client for provenance lock checks
        const gitOpsClient = rpcClient.forPlugin(GitOpsApi);

        // Per-entity status cache shared between the router, queue executor,
        // and afterPluginsReady cleanup hooks. Mutations / new check results
        // invalidate by systemId BEFORE emitting signals so frontend
        // refetches see fresh data.
        const cache = createHealthCheckCache({ cacheManager, logger });
        healthCheckCache = cache;

        // Setup queue-based health check worker
        await setupHealthCheckWorker({
          notificationClient,
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
          cache,
        });

        // Setup retention job for tiered storage (daily aggregation)
        await setupRetentionJob({
          db: database,
          logger,
          queueManager,
        });

        // Setup auto-incident close worker (ticks every 60s, closes
        // auto-opened incidents whose systems have been steady-healthy
        // for the cooldown).
        await setupAutoIncidentCloseJob({
          db: database,
          logger,
          queueManager,
          incidentClient,
        });

        const healthCheckRouter = createHealthCheckRouter({
          database: database as SafeDatabase<typeof schema>,
          registry: healthCheckRegistry,
          collectorRegistry,
          gitOpsClient,
          getEmitHook: () => storedEmitHook,
          cache,
          configService: config,
        });
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
        rpcClient,
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

        // Notification subscription specs. Per-resource group lifecycle
        // is owned by notification-backend now — healthcheck just
        // declares the specs it dispatches under.
        const afterNotificationClient = rpcClient.forPlugin(NotificationApi);
        await Promise.all([
          afterNotificationClient.registerSubscriptionSpec(
            specToRegistration(healthcheckSystemSubscription),
          ),
          afterNotificationClient.registerSubscriptionSpec(
            specToRegistration(healthcheckGroupSubscription),
          ),
        ]);

        // Register GitOps documentation now that registries are populated
        registerHealthcheckGitOpsDocumentation({
          kindRegistry,
          healthCheckRegistry,
          collectorRegistry,
        });

        // Subscribe to catalog system deletion to clean up associations
        const service = new HealthCheckService(
          database,
          healthCheckRegistry,
          collectorRegistry,
        );

        // Register automation actions now that `emitHook` + `queueManager`
        // are both available.
        const automationActions = env.getExtensionPoint(
          automationActionExtensionPoint,
        );
        for (const action of createHealthCheckActions({
          service,
          queueManager,
          emitHook,
        })) {
          automationActions.registerAction(action, pluginMetadata);
        }

        onHook(
          catalogHooks.systemDeleted,
          async (payload) => {
            logger.debug(
              `Cleaning up health check associations for deleted system: ${payload.systemId}`,
            );
            await service.removeAllSystemAssociations(payload.systemId);
            await healthCheckCache?.invalidateSystem(payload.systemId);
          },
          { mode: "work-queue", workerGroup: "system-cleanup" },
        );

        // Subscribe to satellite deletion to scrub satellite IDs from associations
        onHook(
          satelliteHooks.satelliteRemoved,
          async (payload) => {
            logger.debug(
              `Scrubbing satellite ${payload.satelliteId} from health check associations`,
            );
            await service.scrubSatelliteFromAssociations(payload.satelliteId);
            // Satellite removal can change the includedness of many systems'
            // checks; invalidate everything since we don't know which.
            await healthCheckCache?.invalidateAllSystems();
          },
          { mode: "work-queue", workerGroup: "satellite-cleanup" },
        );

        // Sync our auto-incident mapping when an incident is resolved.
        // Without this, a manually-closed incident would still appear
        // "active" in our mapping, blocking the require-recovery rule
        // from re-evaluating fresh transitions.
        onHook(
          incidentHooks.incidentResolved,
          async ({ incidentId }) => {
            const updated = await database
              .update(healthCheckAutoIncidents)
              .set({ closedAt: new Date() })
              .where(
                and(
                  eq(healthCheckAutoIncidents.incidentId, incidentId),
                  isNull(healthCheckAutoIncidents.closedAt),
                ),
              )
              .returning({ id: healthCheckAutoIncidents.id });
            if (updated.length > 0) {
              logger.debug(
                `Marked auto-incident mapping closed for resolved incident ${incidentId}`,
              );
            }
          },
          { mode: "work-queue", workerGroup: "auto-incident-sync" },
        );

        logger.debug("✅ Health Check Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { healthCheckHooks } from "./hooks";
