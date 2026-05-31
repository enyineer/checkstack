import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  maintenanceAccessRules,
  maintenanceAccess,
  pluginMetadata,
  maintenanceContract,
  maintenanceRoutes,
  MaintenanceApi,
  maintenanceSystemSubscription,
  maintenanceGroupSubscription,
} from "@checkstack/maintenance-common";

import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
  entityExtensionPoint,
  type EntityHandle,
} from "@checkstack/automation-backend";
import {
  NotificationApi,
  specToRegistration,
} from "@checkstack/notification-common";
import { MaintenanceService } from "./service";
import { createRouter } from "./router";
import { CatalogApi } from "@checkstack/catalog-common";
import { AuthApi } from "@checkstack/auth-common";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute, type InferClient } from "@checkstack/common";
import { createMaintenanceCache } from "./cache";
import {
  createMaintenanceActions,
  maintenanceArtifactType,
} from "./automations";
import {
  MAINTENANCE_ENTITY_KIND,
  createMaintenanceEntityRead,
  deriveMaintenanceEvents,
  maintenanceEntityStateSchema,
  type MaintenanceEntityState,
} from "./entity";

// Queue and job constants
const STATUS_TRANSITION_QUEUE = "maintenance-status-transitions";
const STATUS_TRANSITION_JOB_ID = "maintenance-status-transition-check";
const WORKER_GROUP = "maintenance-status-worker";

// =============================================================================
// Plugin Definition
// =============================================================================

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(maintenanceAccessRules);
    env.registerSubscriptionSpecs([
      maintenanceSystemSubscription,
      maintenanceGroupSubscription,
    ]);

    // ─── Automation Platform: entity + artifact type ───────────────────
    // Buffered behind the extension point until automation-backend's
    // register() runs. Actions are wired in afterPluginsReady so the entity
    // handle is available on the service — see below.
    //
    // Reactive entity (reactive automation engine §10.2): the
    // `maintenance.created` / `maintenance.updated` trigger events are now
    // DERIVED from `maintenance` entity changes (no hook-backed triggers).
    //
    // PLUGIN-BACKED (Model B): the `maintenances` + `maintenance_systems`
    // tables ARE the current-state storage. `read` routes straight to the
    // service's batched authoritative read — no framework `entity_state` row,
    // so no `indexes` (those only apply to store-backed kinds). The `read`
    // closure resolves the service set by init() (mutations only happen from
    // init onward).
    const entity = env.getExtensionPoint(entityExtensionPoint);

    // The maintenance service is created in init() (it needs the resolved
    // database), but the PLUGIN-BACKED entity `read` accessor must be supplied
    // at `defineEntity` time in register(). This holder bridges the two: the
    // `read` closure resolves the service lazily, and init() sets it before
    // any mutation runs (the registry only mutates from init() onward).
    let maintenanceServiceRef: MaintenanceService | undefined;

    const maintenanceEntityHandle: EntityHandle<MaintenanceEntityState> =
      entity.defineEntity<MaintenanceEntityState>({
        kind: MAINTENANCE_ENTITY_KIND,
        state: maintenanceEntityStateSchema,
        read: (ids) => {
          const svc = maintenanceServiceRef;
          if (!svc) {
            throw new Error(
              "maintenance entity read before init: service not yet resolved",
            );
          }
          return createMaintenanceEntityRead(svc)(ids);
        },
      });
    entity.registerChangeDeriver({
      kind: MAINTENANCE_ENTITY_KIND,
      derive: deriveMaintenanceEvents,
    });
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(maintenanceArtifactType, pluginMetadata);

    // Store service reference for afterPluginsReady
    let maintenanceService: MaintenanceService;
    // Store clients for afterPluginsReady
    let catalogClient: InferClient<typeof CatalogApi>;
    let maintenanceClient: InferClient<typeof MaintenanceApi>;
    let notificationClient: InferClient<typeof NotificationApi>;

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
        queueManager: coreServices.queueManager,
        cacheManager: coreServices.cacheManager,
      },
      init: async ({
        logger,
        database,
        rpc,
        rpcClient,
        signalService,
        cacheManager,
      }) => {
        logger.debug("🔧 Initializing Maintenance Backend...");

        catalogClient = rpcClient.forPlugin(CatalogApi);
        maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
        notificationClient = rpcClient.forPlugin(NotificationApi);
        const authClient = rpcClient.forPlugin(AuthApi);

        maintenanceService = new MaintenanceService(
          database as SafeDatabase<typeof schema>,
        );
        // Publish the service for the PLUGIN-BACKED entity `read` accessor
        // (defined in register()). Mutations only run from here onward.
        maintenanceServiceRef = maintenanceService;
        const cache = createMaintenanceCache({ cacheManager, logger });
        const router = createRouter(
          maintenanceService,
          signalService,
          catalogClient,
          notificationClient,
          authClient,
          logger,
          cache,
          maintenanceEntityHandle,
        );
        rpc.registerRouter(router, maintenanceContract);

        // Register "Create Maintenance" command in the command palette
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "create",
              title: "Create Maintenance",
              subtitle: "Schedule a maintenance window",
              iconName: "Wrench",
              route:
                resolveRoute(maintenanceRoutes.routes.config) +
                "?action=create",
              requiredAccessRules: [maintenanceAccess.maintenance.manage],
            },
            {
              id: "manage",
              title: "Manage Maintenance",
              subtitle: "Manage maintenance windows",
              iconName: "Wrench",
              shortcuts: ["meta+shift+m", "ctrl+shift+m"],
              route: resolveRoute(maintenanceRoutes.routes.config),
              requiredAccessRules: [maintenanceAccess.maintenance.manage],
            },
          ],
        });

        logger.debug("✅ Maintenance Backend initialized.");
      },
      afterPluginsReady: async ({ queueManager, logger }) => {
        // Register automation actions. Mutation actions mirror window state
        // through the `maintenance` entity handle (created in init) rather
        // than emitting the removed hooks.
        const automationActions = env.getExtensionPoint(
          automationActionExtensionPoint,
        );
        for (const action of createMaintenanceActions({
          service: maintenanceService,
          entityHandle: maintenanceEntityHandle,
        })) {
          automationActions.registerAction(action, pluginMetadata);
        }

        // Notification subscription specs. Per-resource group lifecycle
        // is platform-managed by notification-backend — maintenance just
        // declares the specs.
        await Promise.all([
          notificationClient.registerSubscriptionSpec(
            specToRegistration(maintenanceSystemSubscription),
          ),
          notificationClient.registerSubscriptionSpec(
            specToRegistration(maintenanceGroupSubscription),
          ),
        ]);

        // Schedule the recurring status transition check job
        const queue = queueManager.getQueue<Record<string, never>>(
          STATUS_TRANSITION_QUEUE,
        );

        // Subscribe to process status transition check jobs
        await queue.consume(
          async () => {
            logger.debug("⏰ Checking maintenance status transitions...");

            // Get maintenances that need to start
            const toStart = await maintenanceService.getMaintenancesToStart();
            for (const maintenance of toStart) {
              try {
                // Call addUpdate via RPC - this handles hooks, signals, and notifications
                await maintenanceClient.addUpdate({
                  maintenanceId: maintenance.id,
                  message: "Maintenance started automatically",
                  statusChange: "in_progress",
                });
                logger.info(
                  `Maintenance "${maintenance.title}" transitioned to in_progress`,
                );
              } catch (error) {
                logger.error(
                  `Failed to transition maintenance ${maintenance.id}:`,
                  error,
                );
              }
            }

            // Get maintenances that need to complete
            const toComplete =
              await maintenanceService.getMaintenancesToComplete();
            for (const maintenance of toComplete) {
              try {
                // Call addUpdate via RPC - this handles hooks, signals, and notifications
                await maintenanceClient.addUpdate({
                  maintenanceId: maintenance.id,
                  message: "Maintenance completed automatically",
                  statusChange: "completed",
                });
                logger.info(
                  `Maintenance "${maintenance.title}" transitioned to completed`,
                );
              } catch (error) {
                logger.error(
                  `Failed to transition maintenance ${maintenance.id}:`,
                  error,
                );
              }
            }

            if (toStart.length > 0 || toComplete.length > 0) {
              logger.debug(
                `Status transitions: ${toStart.length} started, ${toComplete.length} completed`,
              );
            }
          },
          {
            consumerGroup: WORKER_GROUP,
            maxRetries: 0, // Status checks should not retry
          },
        );

        // Schedule to run every minute at second 0 (cron-based for precise timing)
        await queue.scheduleRecurring(
          {}, // Empty payload - the job just triggers a check
          {
            jobId: STATUS_TRANSITION_JOB_ID,
            cronPattern: "* * * * *", // Every minute at :00 seconds
          },
        );

        logger.debug("✅ Maintenance status transition job scheduled.");
      },
    });
  },
});
