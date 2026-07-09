import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import { z } from "zod";
import {
  aiToolProjectionExtensionPoint,
  deferredProjectionExecute,
  systemSignalsExtensionPoint,
  createSystemAccessResolver,
} from "@checkstack/ai-backend";
import {
  sloAccessRules,
  sloAccess,
  pluginMetadata,
  sloContract,
  sloRoutes,
  AchievementTypeSchema,
} from "@checkstack/slo-common";
import {
  createBackendPlugin,
  coreServices,
  createHook,
} from "@checkstack/backend-api";
import { inArray, ilike } from "drizzle-orm";
import {
  automationTriggerExtensionPoint,
  entityExtensionPoint,
  type EntityHandle,
} from "@checkstack/automation-backend";
import { SloService } from "./service";
import { SloEngine } from "./slo-engine";
import { createRouter } from "./router";
import { createSloCache } from "./cache";
import { DependencyApi } from "@checkstack/dependency-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import {
  IncidentApi,
  INCIDENT_LIFECYCLE_CHANGED_HOOK_ID,
  type IncidentLifecycleChangedPayload,
} from "@checkstack/incident-common";
import {
  CATALOG_SYSTEM_ENTITY_KIND,
} from "@checkstack/catalog-backend";
import {
  HEALTH_ENTITY_KIND,
  classifyHealthChange,
} from "@checkstack/healthcheck-backend";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";
import { sloHooks } from "./hooks";
import {
  SLO_ENTITY_KIND,
  SloEntityStateSchema,
  createSloEntityRead,
  deriveSloTriggerEvents,
  type SloEntityState,
} from "./slo-entity";
import { setupDailySnapshotJob } from "./streak-calculator";
import { setupWeeklyDigestJob } from "./weekly-digest";
import { evaluateAchievements } from "./achievement-evaluator";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { registerSloGitOpsKinds } from "./slo-gitops-kinds";
import { createSloSignalsContributor } from "./signals-contributor";

// =============================================================================
// Integration Event Payload Schemas
// =============================================================================

// NOTE: The `budget.warning` / `.critical` / `.exhausted` and
// `streak.broken` trigger payload schemas were removed (§9.2). Those four
// thresholds are now authored as reactive `numeric_state` conditions over
// the `slo` entity's `budgetRemainingPercent` / `currentStreak`, not as
// pre-baked event triggers. The hooks they fronted were never emitted by
// the engine (inert), so removing the trigger registrations is behavior-
// preserving.

const sloAchievementUnlockedPayloadSchema = z.object({
  systemId: z.string(),
  achievement: AchievementTypeSchema,
});

const sloWeeklyDigestPayloadSchema = z.object({
  totalObjectives: z.number(),
  breachingCount: z.number(),
  atRiskCount: z.number(),
  healthyCount: z.number(),
  topPerformers: z.array(
    z.object({
      systemName: z.string(),
      availability: z.number(),
      streakDays: z.number(),
    }),
  ),
  worstPerformers: z.array(
    z.object({
      systemName: z.string(),
      availability: z.number(),
      budgetRemainingPercent: z.number(),
    }),
  ),
});

// Distributed hook fired by incident-backend on EVERY incident lifecycle change
// (create/update/resolve/delete, incl. override added/changed/cleared). The id +
// payload contract live in the incident-common LEAF, so subscribing here needs
// no dependency on incident-backend. Consumed with `work-queue` delivery so the
// downtime reconcile runs exactly once per cluster (like the health handlers).
const incidentLifecycleChangedHook = createHook<IncidentLifecycleChangedPayload>(
  INCIDENT_LIFECYCLE_CHANGED_HOOK_ID,
);

// =============================================================================
// Plugin Definition
// =============================================================================

// Reactive `slo` entity handle (§10.7). Defined in register() via the
// entity extension point; mutated from the daily snapshot job onward.
let sloEntity: EntityHandle<SloEntityState> | undefined;

// The SLO service + engine are created in afterPluginsReady (they need the
// resolved database + RPC clients), but the PLUGIN-BACKED + COMPUTED entity
// `read` accessor must be supplied at `defineEntity` time in register(). These
// holders bridge the two: the `read` closure resolves them lazily, and
// afterPluginsReady sets them before any mutation runs (the daily job — the
// only mutation site — runs from afterPluginsReady onward).
let sloEntityServiceRef: SloService | undefined;
let sloEntityEngineRef: SloEngine | undefined;

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(sloAccessRules);

    // Register hooks as automation triggers
    const automationTriggers = env.getExtensionPoint(
      automationTriggerExtensionPoint,
    );

    // ─── Reactive `slo` entity (§10.7, §9.2) ───────────────────────────
    // The SLO budget IS the entity. The former `budget.warning/.critical/
    // .exhausted` + `streak.broken` triggers are removed — those thresholds
    // are now authored as `numeric_state` conditions over
    // `state.slo.<objectiveId>.budgetRemainingPercent` / `currentStreak`.
    // The deriver fires no legacy events; it exists so `slo` is a known
    // reactive kind (scope + wake resolution).
    //
    // PLUGIN-BACKED + COMPUTED (Model B): there is NO framework `entity_state`
    // row. `read` assembles each objective's view by reading `slo_streaks` +
    // `slo_objectives` and COMPUTING `budgetRemainingPercent` via the engine
    // (see `createSloEntityRead`). No `indexes` — those only apply to
    // store-backed kinds, and a plugin-backed kind keeps its state in its own
    // tables. The `read` closure resolves the service + engine set by
    // afterPluginsReady (the daily job is the only mutation site).
    const entityPoint = env.getExtensionPoint(entityExtensionPoint);
    sloEntity = entityPoint.defineEntity<SloEntityState>({
      kind: SLO_ENTITY_KIND,
      state: SloEntityStateSchema,
      read: (ids) => {
        const service = sloEntityServiceRef;
        const engine = sloEntityEngineRef;
        if (!service || !engine) {
          throw new Error(
            "slo entity read before init: service/engine not yet resolved",
          );
        }
        return createSloEntityRead({ service, engine })(ids);
      },
    });
    entityPoint.registerChangeDeriver({
      kind: SLO_ENTITY_KIND,
      derive: deriveSloTriggerEvents,
    });
    // Event-sourced history is NOT the live entity (§5): downtime events +
    // daily snapshots are append-only records, the budget/streak is the
    // reactive entity.
    entityPoint.declareNonReactiveState({
      table: "slo_downtime_events",
      reason: "bookkeeping",
      note: "Append-only downtime history. The live budget/streak is the `slo` entity.",
    });
    entityPoint.declareNonReactiveState({
      table: "slo_daily_snapshots",
      reason: "bookkeeping",
      note: "Append-only daily trend snapshots. The live budget/streak is the `slo` entity.",
    });

    automationTriggers.registerTrigger(
      {
        id: "achievement.unlocked",
        displayName: "SLO Achievement Unlocked",
        description:
          "Fired when a system unlocks a new reliability achievement",
        category: "SLO",
        payloadSchema: sloAchievementUnlockedPayloadSchema,
        hook: sloHooks.sloAchievementUnlocked,
        contextKey: (p) => p.systemId,
      },
      pluginMetadata,
    );

    automationTriggers.registerTrigger(
      {
        id: "weekly.digest",
        displayName: "SLO Weekly Digest",
        description:
          "Weekly summary of SLO performance across all systems (Monday 09:00 UTC)",
        category: "SLO",
        payloadSchema: sloWeeklyDigestPayloadSchema,
        hook: sloHooks.sloWeeklyDigest,
      },
      pluginMetadata,
    );

    // System-signals contributor for the `system.issues` AI tool. Registered
    // (contribute) synchronously in init with the resolved service + engine;
    // ai-backend reads the live contributor array at the tool's execute time.
    const systemSignalsExt = env.getExtensionPoint(systemSignalsExtensionPoint);

    // Shared references across init/afterPluginsReady (maintenance-backend pattern)
    let sharedEngine: SloEngine;
    let gitopsService: SloService | undefined;
    // Reactive `slo` entity handle (§10.7), defined just above in register().
    const onEntityChanged = entityPoint.onEntityChanged;

    // ─── GitOps Entity Kind Registration ─────────────────────────────
    const kindRegistry = env.getExtensionPoint(entityKindExtensionPoint);
    registerSloGitOpsKinds({
      kindRegistry,
      getService: () => {
        if (!gitopsService) throw new Error("SloService not initialized");
        return gitopsService;
      },
    });

    // Expose this plugin's read-only AI projection (`slo.listObjectives`) via
    // the AI projection extension point. ai-backend collects its routing in
    // afterPluginsReady and never imports slo-common.
    env.getExtensionPoint(aiToolProjectionExtensionPoint).expose({
      procedure: sloContract.listObjectives,
      sourcePluginMetadata: pluginMetadata,
      procedureKey: "listObjectives",
      name: "slo.listObjectives",
      description:
        "List service-level objectives with their current status and error " +
        "budget, including which are breaching or at risk. Use this when asked " +
        "what is breaching or what's wrong. Read-only.",
      effect: "read",
      execute: deferredProjectionExecute,
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        signalService: coreServices.signalService,
        rpcClient: coreServices.rpcClient,
        queueManager: coreServices.queueManager,
        cacheManager: coreServices.cacheManager,
        eventBus: coreServices.eventBus,
        advisoryLock: coreServices.advisoryLock,
        resourceResolverRegistry: coreServices.resourceResolverRegistry,
      },
      init: async ({
        logger,
        database,
        rpc,
        signalService,
        rpcClient,
        cacheManager,
        advisoryLock,
        resourceResolverRegistry,
      }) => {
        logger.debug("🔧 Initializing SLO Backend...");

        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new SloService(typedDb);
        gitopsService = service;
        const engine = new SloEngine({
          service,
          signalService,
          logger,
          advisoryLock,
        });

        // Store for afterPluginsReady
        sharedEngine = engine;

        const cache = createSloCache({ cacheManager, logger });
        const router = createRouter({
          service,
          engine,
          signalService,
          rpcClient,
          cache,
        });
        rpc.registerRouter(router, sloContract);

        // Resolve/search SLO objectives by name for the Teams admin UI (team
        // grants are stored as opaque slo.slo:<objectiveId> rows). The
        // objectives table has no human label column, so the owning system id
        // is used as the display name.
        resourceResolverRegistry.register("slo.slo", {
          resolveNames: async (ids) => {
            if (ids.length === 0) return new Map();
            const rows = await typedDb
              .select({
                id: schema.sloObjectives.id,
                name: schema.sloObjectives.systemId,
              })
              .from(schema.sloObjectives)
              .where(inArray(schema.sloObjectives.id, ids));
            return new Map(rows.map((r) => [r.id, r.name]));
          },
          search: async (query, limit) => {
            const rows = await typedDb
              .select({
                id: schema.sloObjectives.id,
                name: schema.sloObjectives.systemId,
              })
              .from(schema.sloObjectives)
              .where(ilike(schema.sloObjectives.systemId, `%${query}%`))
              .limit(limit);
            return rows;
          },
        });

        // Contribute breaching/degraded/at-risk SLOs to the `system.issues` AI
        // tool. `read` enforces this source's read access on the originating
        // principal, queries every objective globally from `slo_objectives`, and
        // derives signals via the same shared deriver the frontend filler uses.
        systemSignalsExt.contribute(
          createSloSignalsContributor({
            service,
            engine,
            resolver: createSystemAccessResolver(rpcClient),
          }),
        );

        // Register command palette entries
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "create-slo",
              title: "Create SLO",
              subtitle: "Define a new Service Level Objective",
              iconName: "Target",
              route: resolveRoute(sloRoutes.routes.config) + "?action=create",
              requiredAccessRules: [sloAccess.slo.manage],
            },
            {
              id: "manage-slos",
              title: "Manage SLOs",
              subtitle: "View and configure Service Level Objectives",
              iconName: "Target",
              shortcuts: ["meta+shift+l", "ctrl+shift+l"],
              route: resolveRoute(sloRoutes.routes.overview),
            },
          ],
        });

        logger.debug("✅ SLO Backend initialized.");
      },

      afterPluginsReady: async ({
        database,
        logger,
        emitHook,
        rpcClient,
        signalService,
        queueManager,
        eventBus,
        advisoryLock,
      }) => {
        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new SloService(typedDb);
        const engine = new SloEngine({
          service,
          signalService,
          logger,
          advisoryLock,
        });
        // Publish the service + engine for the PLUGIN-BACKED + COMPUTED entity
        // `read` accessor (defined in register()). The daily snapshot job — the
        // only `slo` mutation site — runs from here onward, so the refs are set
        // before any `read`/`mutate` can fire.
        sloEntityServiceRef = service;
        sloEntityEngineRef = engine;

        const dependencyClient = rpcClient.forPlugin(DependencyApi);
        const healthCheckClient = rpcClient.forPlugin(HealthCheckApi);
        const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
        const incidentClient = rpcClient.forPlugin(IncidentApi);

        /**
         * Resolve a system's planned maintenance windows for SLO error-budget
         * exclusion (opt-in per objective via `excludeMaintenanceWindows`). The
         * SLO budget window is TRAILING, so this queries by TIME-RANGE OVERLAP
         * over `[from, to]` and INCLUDES already-completed windows (the RPC
         * excludes only `cancelled`). Using the active-only bulk RPC here would
         * miss "last night's planned maintenance" the moment it completes and
         * make consumed budget jump non-monotonically. The engine subtracts the
         * portion of downtime overlapping each returned window. Set on BOTH
         * engine instances so the read path (router) and the daily snapshot /
         * recovery path agree. Fails open (empty list) if the RPC is
         * unavailable, so an SLO read never breaks.
         */
        const maintenanceWindowsResolver = async ({
          systemId,
          from,
          to,
        }: {
          systemId: string;
          from: Date;
          to: Date;
        }) => {
          try {
            const { maintenances } =
              await maintenanceClient.getMaintenanceWindowsForRange({
                systemIds: [systemId],
                from,
                to,
              });
            return (maintenances[systemId] ?? []).map((m) => ({
              startAt: m.startAt,
              endAt: m.endAt,
              status: m.status,
            }));
          } catch (error) {
            logger.warn(
              `SLO: failed to resolve maintenance windows for system ${systemId}`,
              { error },
            );
            return [];
          }
        };
        sharedEngine.setMaintenanceWindowsResolver(maintenanceWindowsResolver);
        engine.setMaintenanceWindowsResolver(maintenanceWindowsResolver);

        /**
         * EFFECTIVE system health: the healthcheck `getSystemHealthStatus` RPC
         * folds active incident overrides (worst-wins), so an incident-forced
         * unhealthy/degraded status counts as "down" here. This is what makes the
         * open/close decisions incident-aware WITHOUT a second data source: an
         * incident-only open event reads as ongoing, checks-recovery does not
         * close while an incident is still active, and incident-resolve does not
         * close while checks are still down. Set on BOTH engine instances so the
         * router (sharedEngine) reconcile/reads AND the event-driven engine
         * (handleSystemDown/Up + the incident channel) agree. Fails open
         * (healthy) so an SLO read/close never breaks on a transient RPC error.
         */
        const getEffectiveSystemHealth = async (systemId: string) => {
          try {
            const status = await healthCheckClient.getSystemHealthStatus({
              systemId,
            });
            logger.debug(
              `SLO reconcile: System ${systemId} health status = ${status.status}`,
            );
            return { isHealthy: status.status === "healthy" };
          } catch (error) {
            logger.warn(
              `SLO reconcile: Failed to get health status for system ${systemId}`,
              { error },
            );
            // Default to healthy if we can't determine status
            return { isHealthy: true };
          }
        };
        sharedEngine.setHealthStatusCallback(getEffectiveSystemHealth);
        engine.setHealthStatusCallback(getEffectiveSystemHealth);

        /**
         * Incident-override LABELING resolver: reports whether an incident
         * currently forces a health override onto a system
         * (`IncidentApi.getActiveHealthOverrides`). Used ONLY to label a new
         * downtime event's `source` (the open/close DECISIONS use effective
         * health above). Fails open to "not active" — a labeling default, never a
         * close decision. Set on both engines (router reconcileObjective + the
         * event-driven incident channel).
         */
        const isIncidentOverrideActive = async ({
          systemId,
        }: {
          systemId: string;
        }) => {
          try {
            const { overrides } = await incidentClient.getActiveHealthOverrides({
              systemIds: [systemId],
            });
            return { active: (overrides[systemId]?.length ?? 0) > 0 };
          } catch (error) {
            logger.warn(
              `SLO: failed to read incident overrides for system ${systemId}`,
              { error },
            );
            return { active: false };
          }
        };
        sharedEngine.setIncidentOverrideResolver(isIncidentOverrideActive);
        engine.setIncidentOverrideResolver(isIncidentOverrideActive);

        /**
         * Resolve a system's ACTUAL recovery time for missed-recovery
         * reconciliation: the earliest healthy run on/after `since` from the
         * healthcheck run history. This lets the engine CLOSE an orphaned
         * downtime window at the true recovery instant (preserving the genuine
         * downtime) instead of deleting it. Returns null when no healthy run is
         * found (e.g. history pruned) — the caller then falls back to deleting
         * the unprovable window. Set on BOTH engines: the router self-heals on
         * read, and the daily streak job self-heals in the background — the
         * latter runs on `engine`, which now also has the health callback, so
         * without this resolver its orphan reconcile would DELETE recoverable
         * downtime instead of closing it at the true recovery time.
         */
        const resolveRecoveryTime = async ({
          systemId,
          since,
        }: {
          systemId: string;
          since: Date;
        }) => {
          try {
            const { runs } = await healthCheckClient.getHistory({
              systemId,
              startDate: since,
              statusFilter: ["healthy"],
              limit: 1,
              sortOrder: "asc",
            });
            const first = runs[0];
            return first ? new Date(first.timestamp) : null;
          } catch (error) {
            logger.warn(
              `SLO reconcile: failed to resolve recovery time for system ${systemId}`,
              { error },
            );
            return null;
          }
        };
        sharedEngine.setRecoveryTimeResolver(resolveRecoveryTime);
        engine.setRecoveryTimeResolver(resolveRecoveryTime);

        /**
         * Helper: check upstream health status via RPC loopback.
         * Injected as a callback into the engine for testability.
         */
        const getUpstreamHealthStatus = async ({
          upstreamSystemId,
        }: {
          upstreamSystemId: string;
        }) => {
          try {
            const healthStatus = await healthCheckClient.getSystemHealthStatus({
              systemId: upstreamSystemId,
            });
            return {
              isHealthy: healthStatus.status === "healthy",
              systemName: upstreamSystemId,
            };
          } catch {
            // Fail-open: if we can't check upstream, assume healthy
            return { isHealthy: true, systemName: upstreamSystemId };
          }
        };

        /**
         * Helper: get downstream dependents of a system.
         */
        const getDownstreamSystemIds = async (
          systemId: string,
        ): Promise<string[]> => {
          try {
            const result = await dependencyClient.getDependencies({
              systemId,
              direction: "downstream",
            });
            return result.dependencies.map((d) => d.sourceSystemId);
          } catch {
            return [];
          }
        };

        // Cross-plugin consumers now react to the reactive `health` /
        // `catalog-system` ENTITY changes via `onEntityChanged` instead of
        // the (being-removed) directional hooks (§10.7). `classifyHealthChange`
        // reproduces the exact degraded/recovered transition predicate the
        // old `systemDegraded` / `systemHealthy` hooks fired on. Each
        // consumer keeps `work-queue` delivery with its original
        // `workerGroup`: these are side-effecting writes (open/close downtime,
        // achievements, cleanup) that must run exactly once per cluster — not
        // per-instance — so broadcast would double-apply them.

        // =====================================================================
        // Perspective 1: System goes DOWN — open downtime events
        // =====================================================================
        onEntityChanged({
          kind: HEALTH_ENTITY_KIND,
          handler: async (change) => {
            const { systemId, degraded, previousStatus, newStatus } =
              classifyHealthChange(change);
            if (!degraded) return;
            logger.debug(
              `SLO: System ${systemId} degraded (${previousStatus} → ${newStatus})`,
            );
            await engine.handleSystemDown({
              systemId,
              getUpstreamHealthStatus,
            });
          },
          delivery: { mode: "work-queue", workerGroup: "slo-system-down" },
        });

        // =====================================================================
        // Perspective 1: System goes UP — close downtime events
        // =====================================================================
        onEntityChanged({
          kind: HEALTH_ENTITY_KIND,
          handler: async (change) => {
            const { systemId, recovered } = classifyHealthChange(change);
            if (!recovered) return;
            logger.debug(`SLO: System ${systemId} recovered`);
            await engine.handleSystemUp({ systemId });

            // Also handle Perspective 2 (as upstream)
            const downstreamIds = await getDownstreamSystemIds(systemId);
            if (downstreamIds.length > 0) {
              await engine.handleUpstreamUp({
                upstreamSystemId: systemId,
                downstreamSystemIds: downstreamIds,
                getUpstreamHealthStatus,
              });
            }

            // Evaluate achievements on recovery (rapid_recovery, clean_sheet, etc.)
            await evaluateAchievements({
              systemId,
              service,
              engine,
              logger,
            });
          },
          delivery: { mode: "work-queue", workerGroup: "slo-system-up" },
        });

        // =====================================================================
        // Perspective 2: Upstream degraded — split downstream "self" events
        // We re-use the degraded transition, checking downstream systems
        // =====================================================================
        onEntityChanged({
          kind: HEALTH_ENTITY_KIND,
          handler: async (change) => {
            const { systemId, degraded } = classifyHealthChange(change);
            if (!degraded) return;
            const downstreamIds = await getDownstreamSystemIds(systemId);
            if (downstreamIds.length > 0) {
              await engine.handleUpstreamDown({
                upstreamSystemId: systemId,
                upstreamSystemName: systemId,
                downstreamSystemIds: downstreamIds,
              });
            }
          },
          delivery: { mode: "work-queue", workerGroup: "slo-upstream-down" },
        });

        // =====================================================================
        // Subscribe to catalog system deletion (tombstone) for cleanup
        // =====================================================================
        onEntityChanged({
          kind: CATALOG_SYSTEM_ENTITY_KIND,
          handler: async (change) => {
            // Only react to a tombstone (delete), not create/update.
            if (change.next !== null) return;
            const systemId = change.id;
            logger.debug(
              `Cleaning up SLO data for deleted system: ${systemId}`,
            );
            await service.deleteObjectivesForSystem({ systemId });
            await service.deleteAchievementsForSystem({ systemId });
          },
          delivery: { mode: "work-queue", workerGroup: "slo-system-cleanup" },
        });

        // =====================================================================
        // Incident lifecycle: open/close incident-forced downtime
        // =====================================================================
        // An active incident health override forces a system unhealthy/degraded
        // but does NOT change the checks-only `health` entity, so the health
        // handlers above never observe it. Subscribe to the incident lifecycle
        // hook — which fires on create/update/resolve/delete INCLUDING
        // override-only edits (the reactive `incident` entity change would miss
        // those) — and reconcile each affected system's downtime against
        // effective health: open an incident-sourced event while forced down,
        // close it once resolved/deleted/cleared AND checks are healthy.
        // `work-queue` delivery = exactly-once per cluster, matching the health
        // handlers (a broadcast would double-apply the write).
        await eventBus.subscribe(
          pluginMetadata.pluginId,
          incidentLifecycleChangedHook,
          async ({ systemIds }) => {
            for (const systemId of systemIds) {
              await engine.reconcileIncidentDowntime({ systemId });
            }
          },
          { mode: "work-queue", workerGroup: "slo-incident-downtime" },
        );

        // =====================================================================
        // Daily snapshot + streak calculation cron job
        // =====================================================================
        await setupDailySnapshotJob({
          service,
          engine,
          logger,
          queueManager,
          getSloEntity: () => sloEntity,
        });

        // =====================================================================
        // Weekly digest cron job
        // =====================================================================
        await setupWeeklyDigestJob({
          service,
          engine,
          logger,
          queueManager,
          emitHook,
        });

        logger.debug("✅ SLO Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { sloHooks } from "./hooks";
