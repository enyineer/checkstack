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
  aiToolExtensionPoint,
  aiToolProjectionExtensionPoint,
  deferredProjectionExecute,
  systemSignalsExtensionPoint,
} from "@checkstack/ai-backend";
import { buildMaintenanceAiTools } from "./ai/register-ai-tools";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
  automationTriggerExtensionPoint,
  entityExtensionPoint,
  type EntityHandle,
} from "@checkstack/automation-backend";
import {
  NotificationApi,
  specToRegistration,
} from "@checkstack/notification-common";
import { MaintenanceService } from "./service";
import { createMaintenanceSignalsContributor } from "./system-signals";
import { createRouter } from "./router";
import { CatalogApi } from "@checkstack/catalog-common";
import { AuthApi } from "@checkstack/auth-common";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute, type InferClient } from "@checkstack/common";
import { createMaintenanceCache } from "./cache";
import {
  createMaintenanceActions,
  maintenanceArtifactType,
  maintenanceTriggers,
} from "./automations";
import {
  MAINTENANCE_ENTITY_KIND,
  createMaintenanceEntityRead,
  deriveMaintenanceEvents,
  maintenanceChangeToPayload,
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
    // DERIVED from `maintenance` entity changes. The triggers stay registered
    // (ENTITY-DRIVEN, no hook) so they remain in the editor's trigger catalog +
    // payload-introspectable; a `toPayload` mapper makes the runtime
    // `trigger.payload` match their `payloadSchema` (mirroring incident /
    // catalog / dependency / healthcheck).
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
      toPayload: maintenanceChangeToPayload,
    });
    const automationTriggers = env.getExtensionPoint(
      automationTriggerExtensionPoint,
    );
    for (const trigger of maintenanceTriggers) {
      automationTriggers.registerTrigger(trigger, pluginMetadata);
    }
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

        // Register this plugin's AI tools (create/update/delete/addUpdate/
        // close/addLink/removeLink) into the AI registry via the extension
        // point - owned here, not in ai-backend.
        const aiToolExt = env.getExtensionPoint(aiToolExtensionPoint);
        for (const tool of buildMaintenanceAiTools()) {
          aiToolExt.registerTool(tool, pluginMetadata);
        }

        // Expose this plugin's OWN read-only AI projections of the existing
        // list/get queries via aiToolProjectionExtensionPoint - owned here,
        // not in ai-backend. The projected read tools are routed by the
        // transport (MCP / chat) AS the principal, so each procedure's own
        // contract access rules gate it; `deferredProjectionExecute` is the
        // fail-closed net if a transport ever forgot to route.
        const aiProjectionExt = env.getExtensionPoint(
          aiToolProjectionExtensionPoint,
        );
        aiProjectionExt.expose({
          procedure: maintenanceContract.listMaintenances,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "listMaintenances",
          name: "maintenance.list",
          description:
            "List planned maintenance windows with optional status/system filters. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });
        aiProjectionExt.expose({
          procedure: maintenanceContract.getMaintenance,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getMaintenance",
          name: "maintenance.get",
          description:
            "Get one maintenance window with its updates and links. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        // Contribute in-progress maintenance windows to the cross-plugin
        // `system.issues` aggregator (ai-backend). The contributor gates on
        // maintenance.read against the originating principal (per-source access
        // is THIS plugin's job), reads GLOBALLY from the shared maintenance
        // tables, and runs the SAME deriver the dashboard filler uses - see
        // createMaintenanceSignalsContributor.
        const signalsExt = env.getExtensionPoint(systemSignalsExtensionPoint);
        signalsExt.contribute(
          createMaintenanceSignalsContributor({ service: maintenanceService }),
        );

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
