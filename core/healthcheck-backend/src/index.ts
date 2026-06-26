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
  aiToolExtensionPoint,
  aiToolProjectionExtensionPoint,
  deferredProjectionExecute,
  systemSignalsExtensionPoint,
  createSystemAccessResolver,
} from "@checkstack/ai-backend";
import { buildHealthcheckAiTools } from "./ai/register-ai-tools";
import { createHealthcheckSignalsContributor } from "./ai/system-signals-contributor";
import { projectRunHistoryForModel } from "./ai-projections";
import { statusWidgetTypeExtensionPoint } from "@checkstack/status-page-backend";
import { registerHealthcheckStatusWidgets } from "./status-page/widgets";
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
  createHealthEntityRead,
  deriveHealthTriggerEvents,
  healthChangeToPayload,
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
import { CATALOG_SYSTEM_ENTITY_KIND } from "@checkstack/catalog-backend";
import { satelliteHooks } from "@checkstack/satellite-backend";
import { CatalogApi } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { IncidentApi } from "@checkstack/incident-common";
import { GitOpsApi } from "@checkstack/gitops-common";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";
import { createHealthCheckCache } from "./cache";
import { inArray, ilike } from "drizzle-orm";

// Store emitHook reference for use during Phase 2 init
let storedEmitHook: EmitHookFn | undefined;

// The reactive `health` entity handle (§10.3). Defined in register() via
// the entity extension point (buffered until automation-backend registers
// the impl); mutations only fire from init() onward once the read accessor
// has its db + service.
let healthEntity: EntityHandle<HealthEntityState> | undefined;

// PLUGIN-BACKED + COMPUTED kind: the `health` aggregate has no domain table and
// no framework `entity_state` row — its current state is COMPUTED on read from
// the durable `health_check_runs` (via `getSystemHealthStatus`). The db +
// service are only available in init(), but the entity `read` accessor must be
// supplied at `defineEntity` time in register(). These holders bridge the two;
// init() sets them before any mutation runs (the queue worker — the only
// mutation site — is set up in init() after these are bound).
let healthEntityService: HealthCheckService | undefined;

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(healthCheckAccessRules);
    env.registerSubscriptionSpecs([
      healthcheckSystemSubscription,
      healthcheckGroupSubscription,
    ]);

    // Status-page widgets owned by healthcheck (system health, uptime, banner,
    // group status). Buffered behind the extension point until status-page-backend
    // registers it — so the status-page platform never depends on healthcheck.
    registerHealthcheckStatusWidgets(
      env.getExtensionPoint(statusWidgetTypeExtensionPoint),
    );

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
    // PLUGIN-BACKED + COMPUTED kind (Model B): the per-system aggregate has no
    // domain table and NO framework `entity_state` row. `read` COMPUTES each
    // system's `{ status, healthyChecks, totalChecks }` on demand from the same
    // durable `health_check_runs` the rest of the plugin reads (via
    // `getSystemHealthStatus`), gated on the system having at least one ENABLED
    // check association — see `createHealthEntityRead`. A system with an enabled
    // check but no runs yet resolves to the default-`healthy` baseline so a
    // first-ever unhealthy run is a real `healthy → degraded` diff. The service
    // is resolved in init() and bridged via the holder. The change →
    // trigger-event deriver keeps the
    // existing `healthcheck.system.degraded` / `.healthy` / `.health_changed`
    // automations firing off the computed state.
    const entityPoint = env.getExtensionPoint(entityExtensionPoint);
    healthEntity = entityPoint.defineEntity<HealthEntityState>({
      kind: HEALTH_ENTITY_KIND,
      state: HealthEntityStateSchema,
      read: (ids) => {
        const service = healthEntityService;
        if (!service) {
          throw new Error(
            "health entity read before init: service not yet resolved",
          );
        }
        return createHealthEntityRead({ service })(ids);
      },
    });
    entityPoint.registerChangeDeriver({
      kind: HEALTH_ENTITY_KIND,
      derive: deriveHealthTriggerEvents,
      toPayload: healthChangeToPayload,
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
        advisoryLock: coreServices.advisoryLock,
        resourceResolverRegistry: coreServices.resourceResolverRegistry,
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
        advisoryLock,
        resourceResolverRegistry,
      }) => {
        logger.debug("🏥 Initializing Health Check Backend...");

        const typedDb = database as SafeDatabase<typeof schema>;

        // Resolve/search health-check configurations by name for the Teams admin
        // UI (team grants are stored as opaque healthcheck.configuration:<id>
        // rows). Lets the auth backend render grants by name and power the grant
        // picker without depending on healthcheck internals.
        resourceResolverRegistry.register("healthcheck.configuration", {
          resolveNames: async (ids) => {
            if (ids.length === 0) return new Map();
            const rows = await typedDb
              .select({
                id: schema.healthCheckConfigurations.id,
                name: schema.healthCheckConfigurations.name,
              })
              .from(schema.healthCheckConfigurations)
              .where(inArray(schema.healthCheckConfigurations.id, ids));
            return new Map(rows.map((r) => [r.id, r.name]));
          },
          search: async (query, limit) => {
            const rows = await typedDb
              .select({
                id: schema.healthCheckConfigurations.id,
                name: schema.healthCheckConfigurations.name,
              })
              .from(schema.healthCheckConfigurations)
              .where(ilike(schema.healthCheckConfigurations.name, `%${query}%`))
              .limit(limit);
            return rows;
          },
        });

        // Populate mutable refs for GitOps reconcile closures
        gitopsDb = database;
        gitopsHealthCheckRegistry = healthCheckRegistry;
        gitopsCollectorRegistry = collectorRegistry;
        gitopsQueueManager = queueManager;

        // Bind the COMPUTE-ON-READ accessor's db + service for the `health`
        // entity (defined in register()). From here onward the entity `read`
        // computes each system's aggregate from durable `health_check_runs`,
        // and the queue worker (set up just below — the only mutation site)
        // drives writes through `handle.mutate`.
        const service = new HealthCheckService(
          database,
          healthCheckRegistry,
          collectorRegistry,
        );
        healthEntityService = service;

        // Register this plugin's AI tools (propose/update/delete) into the AI
        // registry via the extension point - owned here, not in ai-backend.
        const aiToolExt = env.getExtensionPoint(aiToolExtensionPoint);
        for (const tool of buildHealthcheckAiTools()) {
          aiToolExt.registerTool(tool, pluginMetadata);
        }

        // Expose this plugin's OWN read-only AI projection of the existing
        // `getConfigurations` query via aiToolProjectionExtensionPoint - owned
        // here, not in ai-backend. The projected read tool is routed by the
        // transport (MCP / chat) AS the principal, so `getConfigurations`'
        // own contract access rules gate it; `deferredProjectionExecute` is
        // the fail-closed net if a transport ever forgot to route.
        env.getExtensionPoint(aiToolProjectionExtensionPoint).expose({
          procedure: healthCheckContract.getConfigurations,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getConfigurations",
          name: "healthcheck.status",
          description:
            "List systems' health checks and their current status, including " +
            "which are failing/unhealthy. Use this when asked what is down, " +
            "failing, or unhealthy. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        // The per-system ASSIGNMENT of checks: given a `systemId`, list the
        // health checks assigned to that system (id, name, strategy, interval,
        // collectors/assertions, paused state). This is the mapping
        // `healthcheck.status` lacks - `getConfigurations` lists every check
        // GLOBALLY with no system attribution, so from it alone the assistant
        // cannot tell WHICH check monitors a given system (it would have to
        // guess). The assistant resolves a system NAME to its id via
        // catalog.listSystems, then calls this to attribute a named/failing
        // check to the right system. Same system-scoped `configuration.read`
        // gate as the dashboard's per-system configuration view.
        env.getExtensionPoint(aiToolProjectionExtensionPoint).expose({
          procedure: healthCheckContract.getSystemConfigurations,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getSystemConfigurations",
          name: "healthcheck.listSystemChecks",
          description:
            "List the health checks ASSIGNED to a specific system, given its " +
            "`systemId` (resolve a system NAME to its id with " +
            "catalog.listSystems first). Returns each assigned check's id, " +
            "name, strategy, interval, collectors/assertions, and paused " +
            "state. Use this to answer 'which checks monitor system X' or to " +
            "attribute a specific or failing check to a system - " +
            "healthcheck.status lists ALL checks globally WITHOUT the " +
            "system mapping. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        // Historical run-by-run check results, filterable by system, time
        // window, and status. Complements `healthcheck.status` (which is only
        // CURRENT state): this is how the assistant answers "what issues did
        // system X have between T1 and T2" or "show the unhealthy runs in the
        // last hour". Gated by the public, default-on `healthcheck.status` VIEW
        // rule (the same one the dashboard's history view uses) - it returns the
        // public run shape with no sensitive `result` payload, so it needs no
        // special grant. (The detailed variant carrying `result` lives behind
        // `healthcheck.details` and is intentionally NOT projected.)
        env.getExtensionPoint(aiToolProjectionExtensionPoint).expose({
          procedure: healthCheckContract.getHistory,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getHistory",
          name: "healthcheck.runHistory",
          description:
            "List INDIVIDUAL historical health-check runs for a SMALL window or " +
            "a few specific failures. Filter by `systemId`, a `startDate`/" +
            "`endDate` window, and/or `statusFilter` (e.g. [\"unhealthy\"," +
            "\"degraded\"]); keep `limit` small (each run is a row). For a WIDE " +
            "window or 'how often / how much downtime / uptime over the last N " +
            "days' questions, use healthcheck.runStats instead — it returns " +
            "counts and latency stats without thousands of rows. Use " +
            "healthcheck.status for the current state. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
          // Lean shape for the model: drop the opaque ids it merely echoes and
          // keep time/status/latency/source, so a page of runs doesn't blow the
          // context window (and keep doing so on every verbatim history replay).
          projectResult: projectRunHistoryForModel,
        });

        // Aggregate run statistics over a window: counts by status, uptime %,
        // and latency stats, plus a small capped time series — the COMPACT way
        // to answer "how often / how much downtime / uptime over the last N
        // days" without pulling thousands of raw rows into the model's context.
        // Same public `healthcheck.status` gate as runHistory (no `result`
        // payload). Output is already small and bounded, so no projectResult.
        env.getExtensionPoint(aiToolProjectionExtensionPoint).expose({
          procedure: healthCheckContract.getRunStats,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getRunStats",
          name: "healthcheck.runStats",
          description:
            "Summarize health-check runs over a window: total and per-bucket " +
            "counts by status, uptime %, and latency stats (avg/min/max/p95). " +
            "PREFER THIS over healthcheck.runHistory for any 'how often / how " +
            "much downtime / uptime / latency trend over the last N hours or " +
            "days' question — it returns compact aggregates, not raw rows. " +
            "Filter by `systemId`, `configurationId`, `startDate`/`endDate`, " +
            "`statusFilter`; set `maxBuckets` for the time-series resolution " +
            "(default 24). Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        // Contribute this plugin's per-system health problems to the AI
        // `system.issues` aggregator. PER-SOURCE access is OUR job: gate on the
        // principal's `healthcheck.status` grant and return {} (never throw)
        // when not satisfied. The read derives from the durable
        // `health_check_runs` / `system_health_checks` tables (global, identical
        // on every pod) and reuses the SAME pure deriver as the dashboard
        // filler, so backend signals match the UI's source/tone/label/detail.
        env
          .getExtensionPoint(systemSignalsExtensionPoint)
          .contribute(
            createHealthcheckSignalsContributor({
              service,
              resolver: createSystemAccessResolver(rpcClient),
            }),
          );

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
          advisoryLock,
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

        // The hardcoded auto-incident open/close path was removed — auto-
        // incident behaviour is now built entirely by user automations
        // (e.g. `healthcheck.system_degraded` + `for:` → `incident.create`).
        // Flapping is detected by the automation engine's windowed-count gate
        // on the `system_health_changed` trigger — healthcheck emits only the
        // raw aggregated-health change (via the reactive `health` entity).

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
          signalService,
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

        // React to catalog system deletion (tombstone) via the reactive
        // `catalog-system` entity instead of the (removed) `system.deleted`
        // hook (§10.4). `work-queue` delivery preserved: association cleanup
        // must run once per cluster, not per-instance.
        entityPoint.onEntityChanged({
          kind: CATALOG_SYSTEM_ENTITY_KIND,
          handler: async (change) => {
            if (change.next !== null) return; // tombstone only
            const systemId = change.id;
            logger.debug(
              `Cleaning up health check associations for deleted system: ${systemId}`,
            );
            await service.removeAllSystemAssociations(systemId);
            await healthCheckCache?.invalidateSystem(systemId);
          },
          delivery: { mode: "work-queue", workerGroup: "system-cleanup" },
        });

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

        logger.debug("✅ Health Check Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { healthCheckHooks } from "./hooks";

// Re-export the reactive `health` entity surface so cross-plugin consumers
// (slo, dependency) can subscribe via onEntityChanged + classify changes
// without duplicating the kind id / transition predicate (§10.3).
export {
  HEALTH_ENTITY_KIND,
  classifyHealthChange,
  type HealthChangeClassification,
  type HealthEntityState,
} from "./health-entity";
