import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  aiToolProjectionExtensionPoint,
  deferredProjectionExecute,
  systemSignalsExtensionPoint,
  createSystemAccessResolver,
} from "@checkstack/ai-backend";
import {
  dependencyAccessRules,
  pluginMetadata,
  dependencyContract,
  dependencySystemSubscription,
  dependencyGroupSubscription,
} from "@checkstack/dependency-common";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
  automationTriggerExtensionPoint,
  entityExtensionPoint,
  type EntityHandle,
} from "@checkstack/automation-backend";
import { DependencyService } from "./services/dependency-service";
import { WarningEvaluationService } from "./services/warning-evaluation-service";
import type { SystemStatus } from "./services/warning-evaluation-service";
import { createRouter } from "./router";
import {
  createDependencyActions,
  dependencyArtifactType,
  dependencyTriggers,
} from "./automations";
import { dependencyHooks } from "./hooks";
import { CatalogApi } from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { IncidentApi } from "@checkstack/incident-common";
import { NotificationApi } from "@checkstack/notification-common";
import { CATALOG_SYSTEM_ENTITY_KIND } from "@checkstack/catalog-backend";
import {
  HEALTH_ENTITY_KIND,
  classifyHealthChange,
} from "@checkstack/healthcheck-backend";
import { evaluateAndNotifyDownstream } from "./notifications";
import {
  DEPENDENCY_EDGE_ENTITY_KIND,
  DependencyEdgeStateSchema,
  createDependencyEntityRead,
  dependencyChangeToPayload,
  deriveDependencyTriggerEvents,
  type DependencyEdgeState,
} from "./dependency-entity";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { registerDependencyGitOpsKinds } from "./dependency-gitops-kinds";
import { createDependencySystemSignalsContributor } from "./ai/system-signals-contributor";

// =============================================================================
// Plugin Definition
// =============================================================================

// Reactive `dependency-edge` entity handle (§10.5). Defined in register();
// mutated from the router/actions onward.
let dependencyEntity: EntityHandle<DependencyEdgeState> | undefined;

// The DependencyService is created in init() (it needs the resolved
// database), but the PLUGIN-BACKED entity `read` accessor must be supplied at
// `defineEntity` time in register(). This holder bridges the two: the `read`
// closure resolves the service lazily, and init() sets it before any mutation
// runs (the registry only mutates from init() onward).
let dependencyServiceRef: DependencyService | undefined;

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(dependencyAccessRules);
    env.registerSubscriptionSpecs([
      dependencySystemSubscription,
      dependencyGroupSubscription,
    ]);

    // ─── Automation Platform: triggers + artifact type ─────────────────
    const automationTriggers = env.getExtensionPoint(
      automationTriggerExtensionPoint,
    );
    for (const trigger of dependencyTriggers) {
      automationTriggers.registerTrigger(trigger, pluginMetadata);
    }
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(dependencyArtifactType, pluginMetadata);

    // ─── Reactive `dependency-edge` entity (§10.5) ─────────────────────
    // PLUGIN-BACKED (Model B): the `dependencies` table IS the current-state
    // storage. `read` routes straight to the service's batched authoritative
    // read — no framework `entity_state` row, so no `indexes` (those only
    // apply to store-backed kinds). The `read` closure resolves the service
    // set by init() (mutations only happen from init on).
    const entityPoint = env.getExtensionPoint(entityExtensionPoint);
    dependencyEntity = entityPoint.defineEntity<DependencyEdgeState>({
      kind: DEPENDENCY_EDGE_ENTITY_KIND,
      state: DependencyEdgeStateSchema,
      read: (ids) => {
        const svc = dependencyServiceRef;
        if (!svc) {
          throw new Error(
            "dependency entity read before init: service not yet resolved",
          );
        }
        return createDependencyEntityRead(svc)(ids);
      },
    });
    entityPoint.registerChangeDeriver({
      kind: DEPENDENCY_EDGE_ENTITY_KIND,
      derive: deriveDependencyTriggerEvents,
      toPayload: dependencyChangeToPayload,
    });
    const onEntityChanged = entityPoint.onEntityChanged;
    // The propagation cursor is internal bookkeeping (§5): derived
    // per-system state is reachable via the `health` entity, not this table.
    entityPoint.declareNonReactiveState({
      table: "dependency_derived_states",
      reason: "bookkeeping",
      note: "Propagation cursor for downstream impact evaluation. Derived per-system state is reachable via the health entity.",
    });

    // ─── GitOps Entity Kind Registration ─────────────────────────────
    let gitopsService: DependencyService | undefined;
    const kindRegistry = env.getExtensionPoint(entityKindExtensionPoint);
    registerDependencyGitOpsKinds({
      kindRegistry,
      getService: () => {
        if (!gitopsService)
          throw new Error("DependencyService not initialized");
        return gitopsService;
      },
    });

    // Expose this plugin's read-only AI projection (`dependency.list`) via
    // the AI projection extension point. ai-backend collects its routing in
    // afterPluginsReady and never imports dependency-common.
    env.getExtensionPoint(aiToolProjectionExtensionPoint).expose({
      procedure: dependencyContract.getAllDependencies,
      sourcePluginMetadata: pluginMetadata,
      procedureKey: "getAllDependencies",
      name: "dependency.list",
      description:
        "List all cross-system dependencies (the dependency graph). Read-only.",
      effect: "read",
      execute: deferredProjectionExecute,
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
      },
      init: async ({ logger, database, rpc, rpcClient, signalService }) => {
        logger.debug("🔧 Initializing Dependency Backend...");

        const catalogClient = rpcClient.forPlugin(CatalogApi);
        const healthCheckClient = rpcClient.forPlugin(HealthCheckApi);

        const service = new DependencyService(
          database as SafeDatabase<typeof schema>,
        );
        gitopsService = service;
        // Publish the service for the PLUGIN-BACKED entity `read` accessor
        // (defined in register()). Mutations only run from here onward.
        dependencyServiceRef = service;
        const warningService = new WarningEvaluationService();

        const router = createRouter({
          service,
          warningService,
          signalService,
          catalogClient,
          healthCheckClient,
          logger,
          getDependencyEntity: () => dependencyEntity,
        });
        rpc.registerRouter(router, dependencyContract);

        // Contribute this plugin's dependency warnings to the backend
        // `system.issues` aggregator. The contributor enforces its own
        // `dependency.read` access gate and reads globally from the shared
        // `dependencies` table, so the answer is identical on every pod.
        env.getExtensionPoint(systemSignalsExtensionPoint).contribute(
          createDependencySystemSignalsContributor({
            service,
            warningService,
            catalogClient,
            healthCheckClient,
            resolver: createSystemAccessResolver(rpcClient),
            logger,
          }),
        );

        logger.debug("✅ Dependency Backend initialized.");
      },
      afterPluginsReady: async ({
        database,
        rpcClient,
        logger,
        emitHook,
        signalService,
      }) => {
        // Bound callback that fires `dependency.impact_propagated`
        // when `evaluateAndNotifyDownstream` reports actual downstream
        // state transitions. Local so we don't pass the full
        // `emitHook` into helper modules that should only know about
        // the one hook they fire.
        const emitImpactPropagated = (event: {
          sourceSystemId: string;
          affectedSystems: Array<{
            systemId: string;
            previousState: string | null;
            newState: string | null;
          }>;
          timestamp: string;
        }) => emitHook(dependencyHooks.impactPropagated, event);
        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new DependencyService(typedDb);
        const warningService = new WarningEvaluationService();

        // Register automation actions now that `emitHook` is available.
        const automationActions = env.getExtensionPoint(
          automationActionExtensionPoint,
        );
        for (const action of createDependencyActions({
          service,
          emitHook,
          getDependencyEntity: () => dependencyEntity,
        })) {
          automationActions.registerAction(action, pluginMetadata);
        }

        const catalogClient = rpcClient.forPlugin(CatalogApi);
        const healthCheckClient = rpcClient.forPlugin(HealthCheckApi);
        const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
        const incidentClient = rpcClient.forPlugin(IncidentApi);
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        /**
         * Build system statuses for warning evaluation.
         * This mirrors the fetchSystemStatuses function in the router.
         */
        async function fetchSystemStatuses(
          systemIds: string[],
        ): Promise<Map<string, SystemStatus>> {
          const statuses = new Map<string, SystemStatus>();
          const { systems } = await catalogClient.getSystems();
          const systemMap = new Map(systems.map((s) => [s.id, s]));

          try {
            const { statuses: healthStatuses } =
              await healthCheckClient.getBulkSystemHealthStatus({ systemIds });

            for (const systemId of systemIds) {
              const system = systemMap.get(systemId);
              if (!system) continue;

              const healthStatus = healthStatuses[systemId];
              if (healthStatus) {
                let overallStatus: "operational" | "degraded" | "down" =
                  "operational";
                if (healthStatus.status === "unhealthy") {
                  overallStatus = "down";
                } else if (healthStatus.status === "degraded") {
                  overallStatus = "degraded";
                }

                statuses.set(systemId, {
                  systemId,
                  systemName: system.name,
                  status: overallStatus,
                  healthCheckStatuses: healthStatus.checkStatuses.map((cs) => ({
                    healthCheckId: cs.configurationId,
                    status: cs.status,
                  })),
                });
              } else {
                statuses.set(systemId, {
                  systemId,
                  systemName: system.name,
                  status: "operational",
                });
              }
            }
          } catch {
            for (const systemId of systemIds) {
              const system = systemMap.get(systemId);
              if (!system) continue;
              statuses.set(systemId, {
                systemId,
                systemName: system.name,
                status: "operational",
              });
            }
          }

          return statuses;
        }

        // Cross-plugin consumers now react to the reactive `catalog-system`
        // / `health` ENTITY changes via `onEntityChanged` instead of the
        // (being-removed) catalog/healthcheck hooks (§10.5). All keep
        // `work-queue` delivery: cleanup + downstream-propagation are
        // side-effecting writes that must run exactly once per cluster, not
        // per-instance (broadcast would re-run them N times).

        // Subscribe to catalog system deletion (tombstone) to clean up edges
        onEntityChanged({
          kind: CATALOG_SYSTEM_ENTITY_KIND,
          handler: async (change) => {
            if (change.next !== null) return; // tombstone only
            const systemId = change.id;
            logger.debug(
              `Cleaning up dependencies for deleted system: ${systemId}`,
            );
            await service.removeSystemDependencies(systemId);
          },
          delivery: {
            mode: "work-queue",
            workerGroup: "dependency-system-cleanup",
          },
        });

        // Upstream health DEGRADED → evaluate downstream dependents
        onEntityChanged({
          kind: HEALTH_ENTITY_KIND,
          handler: async (change) => {
            const { systemId, degraded, previousStatus, newStatus } =
              classifyHealthChange(change);
            if (!degraded) return;
            logger.debug(
              `Upstream ${systemId} degraded (${previousStatus} → ${newStatus}), evaluating downstream dependencies`,
            );
            await evaluateAndNotifyDownstream({
              changedSystemId: systemId,
              db: typedDb,
              dependencyService: service,
              warningService,
              fetchSystemStatuses,
              catalogClient,
              notificationClient,
              maintenanceClient,
              incidentClient,
              signalService,
              logger,
              emitImpactPropagated,
            });
          },
          delivery: {
            mode: "work-queue",
            workerGroup: "dependency-notification-evaluator",
          },
        });

        // Upstream health RECOVERED → evaluate downstream dependents
        onEntityChanged({
          kind: HEALTH_ENTITY_KIND,
          handler: async (change) => {
            const { systemId, recovered } = classifyHealthChange(change);
            if (!recovered) return;
            logger.debug(
              `Upstream ${systemId} recovered, evaluating downstream dependencies`,
            );
            await evaluateAndNotifyDownstream({
              changedSystemId: systemId,
              db: typedDb,
              dependencyService: service,
              warningService,
              fetchSystemStatuses,
              catalogClient,
              notificationClient,
              maintenanceClient,
              incidentClient,
              signalService,
              logger,
              emitImpactPropagated,
            });
          },
          delivery: {
            mode: "work-queue",
            workerGroup: "dependency-notification-recovery",
          },
        });

        logger.debug("✅ Dependency Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { dependencyHooks } from "./hooks";
