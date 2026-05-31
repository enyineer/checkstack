import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import { z } from "zod";
import {
  sloAccessRules,
  sloAccess,
  pluginMetadata,
  sloContract,
  sloRoutes,
  AchievementTypeSchema,
} from "@checkstack/slo-common";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
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
  deriveSloTriggerEvents,
  type SloEntityState,
} from "./slo-entity";
import { setupDailySnapshotJob } from "./streak-calculator";
import { setupWeeklyDigestJob } from "./weekly-digest";
import { evaluateAchievements } from "./achievement-evaluator";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { registerSloGitOpsKinds } from "./slo-gitops-kinds";

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

// =============================================================================
// Plugin Definition
// =============================================================================

// Reactive `slo` entity handle (§10.7). Defined in register() via the
// entity extension point; mutated from the daily snapshot job onward.
let sloEntity: EntityHandle<SloEntityState> | undefined;

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
    const entityPoint = env.getExtensionPoint(entityExtensionPoint);
    sloEntity = entityPoint.defineEntity<SloEntityState>({
      kind: SLO_ENTITY_KIND,
      state: SloEntityStateSchema,
      indexes: [{ name: "system", fields: ["systemId"] }],
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

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        signalService: coreServices.signalService,
        rpcClient: coreServices.rpcClient,
        queueManager: coreServices.queueManager,
        cacheManager: coreServices.cacheManager,
      },
      init: async ({
        logger,
        database,
        rpc,
        signalService,
        rpcClient,
        cacheManager,
      }) => {
        logger.debug("🔧 Initializing SLO Backend...");

        const service = new SloService(database as SafeDatabase<typeof schema>);
        gitopsService = service;
        const engine = new SloEngine({
          service,
          signalService,
          logger,
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
      }) => {
        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new SloService(typedDb);
        const engine = new SloEngine({
          service,
          signalService,
          logger,
        });

        const dependencyClient = rpcClient.forPlugin(DependencyApi);
        const healthCheckClient = rpcClient.forPlugin(HealthCheckApi);

        /**
         * Set health status callback on the shared engine instance
         * (the one used by the router). This enables reconcileObjective
         * to check current system health when SLOs are created.
         */
        sharedEngine.setHealthStatusCallback(async (systemId) => {
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
        });

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
