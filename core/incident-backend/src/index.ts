import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import { inArray, ilike } from "drizzle-orm";
import {
  aiToolExtensionPoint,
  aiToolProjectionExtensionPoint,
  systemSignalsExtensionPoint,
  createSystemAccessResolver,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
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
import { statusWidgetTypeExtensionPoint } from "@checkstack/status-page-backend";
import { registerIncidentStatusWidgets } from "./status-page-widget";
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
import { buildIncidentAiTools } from "./ai/register-ai-tools";
import { createIncidentSignalsContributor } from "./system-signals";

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

    // Status-page "Incidents" widget, owned by incident-backend (it owns
    // incidents + their public-safe projection). Buffered behind the
    // status-page extension point — status-page never depends on incident.
    registerIncidentStatusWidgets(
      env.getExtensionPoint(statusWidgetTypeExtensionPoint),
    );

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
        eventBus: coreServices.eventBus,
        cacheManager: coreServices.cacheManager,
        advisoryLock: coreServices.advisoryLock,
        resourceResolverRegistry: coreServices.resourceResolverRegistry,
      },
      init: async ({
        logger,
        database,
        rpc,
        rpcClient,
        signalService,
        eventBus,
        cacheManager,
        advisoryLock,
        resourceResolverRegistry,
      }) => {
        logger.debug("🔧 Initializing Incident Backend...");

        const catalogClient = rpcClient.forPlugin(CatalogApi);
        const authClient = rpcClient.forPlugin(AuthApi);
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new IncidentService(typedDb, advisoryLock);
        // Publish the service for the PLUGIN-BACKED entity `read` accessor
        // (defined in register()). Mutations only run from here onward.
        incidentServiceRef = service;

        // Resolve/search incidents by name for the Teams admin UI (team grants
        // are stored as opaque incident.incident:<id> rows). Lets the auth
        // backend render grants by name and power the grant picker.
        resourceResolverRegistry.register("incident.incident", {
          resolveNames: async (ids) => {
            if (ids.length === 0) return new Map();
            const rows = await typedDb
              .select({ id: schema.incidents.id, title: schema.incidents.title })
              .from(schema.incidents)
              .where(inArray(schema.incidents.id, ids));
            return new Map(rows.map((r) => [r.id, r.title]));
          },
          search: async (query, limit) => {
            const rows = await typedDb
              .select({ id: schema.incidents.id, title: schema.incidents.title })
              .from(schema.incidents)
              .where(ilike(schema.incidents.title, `%${query}%`))
              .limit(limit);
            return rows.map((r) => ({ id: r.id, name: r.title }));
          },
        });

        const cache = createIncidentCache({ cacheManager, logger });
        incidentCache = cache;
        const router = createRouter({
          service,
          signalService,
          eventBus,
          catalogClient,
          notificationClient,
          authClient,
          logger,
          cache,
          getIncidentEntity: () => incidentEntity,
        });
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
          eventBus,
        })) {
          automationActions.registerAction(action, pluginMetadata);
        }

        // Register this plugin's AI tools (create/update/delete/addUpdate/
        // resolve/addLink/removeLink) into the AI registry via the extension
        // point - owned here, not in ai-backend.
        const aiToolExt = env.getExtensionPoint(aiToolExtensionPoint);
        for (const tool of buildIncidentAiTools()) {
          aiToolExt.registerTool(tool, pluginMetadata);
        }

        // Expose this plugin's read-only AI projection (`incident.list`) via
        // the AI projection extension point. ai-backend collects its routing in
        // afterPluginsReady and never imports incident-common.
        const aiProjectionExt = env.getExtensionPoint(
          aiToolProjectionExtensionPoint,
        );
        aiProjectionExt.expose({
          procedure: incidentContract.listIncidents,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "listIncidents",
          name: "incident.list",
          description:
            "List incidents with optional status/system filters. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        // Expose a read-only projection of `getIncident` so the model can pull
        // one incident's full timeline (updates) + links to ground its actions.
        aiProjectionExt.expose({
          procedure: incidentContract.getIncident,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getIncident",
          name: "incident.get",
          description:
            "Get one incident with its full timeline (updates) and links. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        // Contribute incident problem state to the `system.issues` AI tool.
        // Mirrors the frontend `SystemSignalsSlot` filler: returns one signal
        // per OPEN incident for EVERY system globally (keyed by systemId),
        // using the SAME shared deriver so frontend and backend agree. The
        // per-source access gate + global read live in the contributor factory.
        const signalsExt = env.getExtensionPoint(systemSignalsExtensionPoint);
        signalsExt.contribute(
          createIncidentSignalsContributor({
            service,
            resolver: createSystemAccessResolver(rpcClient),
          }),
        );

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
      afterPluginsReady: async ({
        database,
        logger,
        rpcClient,
        advisoryLock,
      }) => {
        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new IncidentService(typedDb, advisoryLock);
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
