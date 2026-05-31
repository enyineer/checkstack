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
  entityExtensionPoint,
  type EntityHandle,
} from "@checkstack/automation-backend";
import {
  HEALTH_ENTITY_KIND,
  HealthEntityStateSchema,
  deriveHealthTriggerEvents,
  type HealthEntityState,
} from "./health-entity";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { secretResolverRef } from "@checkstack/secrets-backend";
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
import { CatalogApi } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { IncidentApi } from "@checkstack/incident-common";
import { GitOpsApi } from "@checkstack/gitops-common";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";
import { createHealthCheckCache } from "./cache";

// Store emitHook reference for use during Phase 2 init
let storedEmitHook: EmitHookFn | undefined;

// The reactive `health` entity handle (§10.3). Defined in register() via
// the entity extension point (buffered until automation-backend registers
// the impl); mutations only fire from init() onward once the store binds.
let healthEntity: EntityHandle<HealthEntityState> | undefined;

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

    // ─── Reactive `health` entity (§10.3) ──────────────────────────────
    // Define the entity + register the change → trigger-event deriver so
    // the existing `healthcheck.system.degraded` / `.healthy` /
    // `.health_changed` automations keep firing off the mirrored state.
    const entityPoint = env.getExtensionPoint(entityExtensionPoint);
    healthEntity = entityPoint.defineEntity<HealthEntityState>({
      kind: HEALTH_ENTITY_KIND,
      state: HealthEntityStateSchema,
      indexes: [{ name: "status", fields: ["status"] }],
    });
    entityPoint.registerChangeDeriver({
      kind: HEALTH_ENTITY_KIND,
      derive: deriveHealthTriggerEvents,
    });
    // Raw per-check samples + cursors are intentionally NON-reactive (§5):
    // a firehose of individual runs would melt the wake-index; the
    // aggregate is the entity.
    entityPoint.declareNonReactiveState({
      table: "health_check_runs",
      reason: "raw-sample",
      note: "High-frequency individual check executions. The per-system aggregate is the `health` entity; raw runs stay a numeric_state wake source only.",
    });

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
        secretResolver: secretResolverRef,
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
        secretResolver,
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
          getHealthEntity: () => healthEntity,
          cache,
          secretResolver,
        });

        // Setup retention job for tiered storage (daily aggregation)
        await setupRetentionJob({
          db: database,
          logger,
          queueManager,
        });

        // The hardcoded auto-incident open/close path was removed in
        // Phase 20 — auto-incident behaviour now ships as user-editable
        // default automations (sustained-unhealthy / flapping / cooldown
        // close). Flapping DETECTION still runs in the queue executor and
        // emits `healthcheck.flapping_detected` for those automations.

        const healthCheckRouter = createHealthCheckRouter({
          database: database as SafeDatabase<typeof schema>,
          registry: healthCheckRegistry,
          collectorRegistry,
          gitOpsClient,
          getEmitHook: () => storedEmitHook,
          cache,
          configService: config,
          catalogClient,
          maintenanceClient,
          logger,
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

        // (The auto-incident mapping-sync hook was removed in Phase 20
        // along with the hardcoded open/close path — the legacy
        // `health_check_auto_incidents` mapping table is no longer
        // written or read.)

        logger.debug("✅ Health Check Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { healthCheckHooks } from "./hooks";
