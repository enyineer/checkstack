import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  incidentAccessRules,
  incidentAccess,
  pluginMetadata,
  incidentContract,
  incidentRoutes,
  incidentSystemSubscription,
  incidentGroupSubscription,
} from "@checkstack/incident-common";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
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
import { IncidentService } from "./service";
import { createRouter } from "./router";
import { CatalogApi } from "@checkstack/catalog-common";
import { AuthApi } from "@checkstack/auth-common";
import { CATALOG_SYSTEM_ENTITY_KIND } from "@checkstack/catalog-backend";
import {
  INCIDENT_ENTITY_KIND,
  IncidentEntityStateSchema,
  createIncidentEntityRead,
  deriveIncidentTriggerEvents,
  incidentChangeToPayload,
  type IncidentEntityState,
} from "./incident-entity";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";
import { createIncidentCache } from "./cache";
import {
  createIncidentActions,
  incidentArtifactType,
  incidentTriggers,
} from "./automations";

// =============================================================================
// Plugin Definition
// =============================================================================

// Reactive `incident` entity handle (§10.1). Defined in register(); mutated
// from the router onward.
let incidentEntity: EntityHandle<IncidentEntityState> | undefined;

// The incident service is created in init() (it needs the resolved database),
// but the PLUGIN-BACKED entity `read` accessor must be supplied at
// `defineEntity` time in register(). This holder bridges the two: the `read`
// closure resolves the service lazily, and init() sets it before any mutation
// runs (the registry only mutates from init() onward).
let incidentServiceRef: IncidentService | undefined;

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(incidentAccessRules);
    env.registerSubscriptionSpecs([
      incidentSystemSubscription,
      incidentGroupSubscription,
    ]);

    // Register triggers — buffered until the automation plugin's
    // `register()` runs and the extension point resolves. Triggers expose
    // `contextKey` so wait_for_trigger can match resume events back to the
    // originating incident.
    const automationTriggers = env.getExtensionPoint(
      automationTriggerExtensionPoint,
    );
    for (const trigger of incidentTriggers) {
      automationTriggers.registerTrigger(trigger, pluginMetadata);
    }

    // ─── Reactive `incident` entity (§10.1) ────────────────────────────
    // PLUGIN-BACKED (Model B): the `incidents` + `incident_systems` tables ARE
    // the current-state storage. `read` routes straight to the service's
    // batched authoritative read — no framework `entity_state` row, so no
    // `indexes` (those only apply to store-backed kinds). The `read` closure
    // resolves the service set by init() (mutations only happen from init on).
    const entityPoint = env.getExtensionPoint(entityExtensionPoint);
    incidentEntity = entityPoint.defineEntity<IncidentEntityState>({
      kind: INCIDENT_ENTITY_KIND,
      state: IncidentEntityStateSchema,
      read: (ids) => {
        const svc = incidentServiceRef;
        if (!svc) {
          throw new Error(
            "incident entity read before init: service not yet resolved",
          );
        }
        return createIncidentEntityRead(svc)(ids);
      },
    });
    entityPoint.registerChangeDeriver({
      kind: INCIDENT_ENTITY_KIND,
      derive: deriveIncidentTriggerEvents,
      toPayload: incidentChangeToPayload,
    });
    const onEntityChanged = entityPoint.onEntityChanged;

    // Register the `incident` artifact type so `incident.create` can
    // `produces` it and the close/update actions can `consumes` it.
    const automationArtifactTypes = env.getExtensionPoint(
      automationArtifactTypeExtensionPoint,
    );
    automationArtifactTypes.registerArtifactType(
      incidentArtifactType,
      pluginMetadata,
    );

    let incidentCache:
      | ReturnType<typeof createIncidentCache>
      | undefined;

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
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
        logger.debug("🔧 Initializing Incident Backend...");

        const catalogClient = rpcClient.forPlugin(CatalogApi);
        const authClient = rpcClient.forPlugin(AuthApi);
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        const service = new IncidentService(
          database as SafeDatabase<typeof schema>,
        );
        // Publish the service for the PLUGIN-BACKED entity `read` accessor
        // (defined in register()). Mutations only run from here onward.
        incidentServiceRef = service;
        const cache = createIncidentCache({ cacheManager, logger });
        incidentCache = cache;
        const router = createRouter(
          service,
          signalService,
          catalogClient,
          notificationClient,
          authClient,
          logger,
          cache,
          () => incidentEntity,
        );
        rpc.registerRouter(router, incidentContract);

        // Register incident actions with the Automation platform. We
        // capture the service in closure here (rather than via a
        // service ref + ctx.getService at execute time) because the
        // service has no per-request state — one instance for the life
        // of the plugin is correct.
        const automationActions = env.getExtensionPoint(
          automationActionExtensionPoint,
        );
        for (const action of createIncidentActions({
          service,
          getIncidentEntity: () => incidentEntity,
        })) {
          automationActions.registerAction(action, pluginMetadata);
        }

        // Register "Create Incident" command in the command palette
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "create",
              title: "Create Incident",
              subtitle: "Report a new incident affecting systems",
              iconName: "CircleAlert",
              route:
                resolveRoute(incidentRoutes.routes.config) + "?action=create",
              requiredAccessRules: [incidentAccess.incident.manage],
            },
            {
              id: "manage",
              title: "Manage Incidents",
              subtitle: "Manage incidents affecting systems",
              iconName: "CircleAlert",
              shortcuts: ["meta+shift+i", "ctrl+shift+i"],
              route: resolveRoute(incidentRoutes.routes.config),
              requiredAccessRules: [incidentAccess.incident.manage],
            },
          ],
        });

        logger.debug("✅ Incident Backend initialized.");
      },
      // Subscribe to catalog system deletion (clean up incident
      // associations) + register subscription specs. Per-system /
      // per-group notification group lifecycle is fully owned by
      // notification-backend now — incident never touches it.
      afterPluginsReady: async ({ database, logger, rpcClient }) => {
        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new IncidentService(typedDb);
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        await Promise.all([
          notificationClient.registerSubscriptionSpec(
            specToRegistration(incidentSystemSubscription),
          ),
          notificationClient.registerSubscriptionSpec(
            specToRegistration(incidentGroupSubscription),
          ),
        ]);

        // React to catalog system deletion (tombstone) via the reactive
        // `catalog-system` entity instead of the (being-removed)
        // `system.deleted` hook (§10.1). `work-queue` delivery preserved:
        // association cleanup is a side-effecting write that must run once
        // per cluster, not per-instance.
        onEntityChanged({
          kind: CATALOG_SYSTEM_ENTITY_KIND,
          handler: async (change) => {
            if (change.next !== null) return; // tombstone only
            const systemId = change.id;
            logger.debug(
              `Cleaning up incident associations for deleted system: ${systemId}`,
            );
            await service.removeSystemAssociations(systemId);
            await incidentCache?.invalidateSystem(systemId);
          },
          delivery: {
            mode: "work-queue",
            workerGroup: "incident-system-cleanup",
          },
        });

        logger.debug("✅ Incident Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { incidentHooks } from "./hooks";
