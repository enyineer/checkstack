import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import { z } from "zod";
import {
  sloAccessRules,
  sloAccess,
  pluginMetadata,
  sloContract,
  sloRoutes,
} from "@checkstack/slo-common";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { integrationEventExtensionPoint } from "@checkstack/integration-backend";
import { SloService } from "./service";
import { SloEngine } from "./slo-engine";
import { createRouter } from "./router";
import { createSloCache } from "./cache";
import { DependencyApi } from "@checkstack/dependency-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { catalogHooks } from "@checkstack/catalog-backend";
import { healthCheckHooks } from "@checkstack/healthcheck-backend";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";
import { sloHooks } from "./hooks";
import { setupDailySnapshotJob } from "./streak-calculator";
import { setupWeeklyDigestJob } from "./weekly-digest";
import { evaluateAchievements } from "./achievement-evaluator";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { registerSloGitOpsKinds } from "./slo-gitops-kinds";

// =============================================================================
// Integration Event Payload Schemas
// =============================================================================

const sloBudgetWarningPayloadSchema = z.object({
  systemId: z.string(),
  objectiveId: z.string(),
  target: z.number(),
  budgetRemainingPercent: z.number(),
});

const sloBudgetCriticalPayloadSchema = z.object({
  systemId: z.string(),
  objectiveId: z.string(),
  target: z.number(),
  budgetRemainingPercent: z.number(),
});

const sloBudgetExhaustedPayloadSchema = z.object({
  systemId: z.string(),
  objectiveId: z.string(),
  target: z.number(),
});

const sloStreakBrokenPayloadSchema = z.object({
  systemId: z.string(),
  objectiveId: z.string(),
  streak: z.number(),
  bestStreak: z.number(),
});

const sloAchievementUnlockedPayloadSchema = z.object({
  systemId: z.string(),
  achievement: z.string(),
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

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(sloAccessRules);

    // Register hooks as integration events
    const integrationEvents = env.getExtensionPoint(
      integrationEventExtensionPoint,
    );

    integrationEvents.registerEvent(
      {
        hook: sloHooks.sloBudgetWarning,
        displayName: "SLO Budget Warning",
        description:
          "Fired when an SLO error budget consumption exceeds the warning threshold",
        category: "SLO",
        payloadSchema: sloBudgetWarningPayloadSchema,
      },
      pluginMetadata,
    );

    integrationEvents.registerEvent(
      {
        hook: sloHooks.sloBudgetCritical,
        displayName: "SLO Budget Critical",
        description:
          "Fired when an SLO error budget consumption exceeds the critical threshold",
        category: "SLO",
        payloadSchema: sloBudgetCriticalPayloadSchema,
      },
      pluginMetadata,
    );

    integrationEvents.registerEvent(
      {
        hook: sloHooks.sloBudgetExhausted,
        displayName: "SLO Budget Exhausted",
        description: "Fired when an SLO error budget is fully consumed",
        category: "SLO",
        payloadSchema: sloBudgetExhaustedPayloadSchema,
      },
      pluginMetadata,
    );

    integrationEvents.registerEvent(
      {
        hook: sloHooks.sloStreakBroken,
        displayName: "SLO Streak Broken",
        description: "Fired when a reliability streak is broken",
        category: "SLO",
        payloadSchema: sloStreakBrokenPayloadSchema,
      },
      pluginMetadata,
    );

    integrationEvents.registerEvent(
      {
        hook: sloHooks.sloAchievementUnlocked,
        displayName: "SLO Achievement Unlocked",
        description:
          "Fired when a system unlocks a new reliability achievement",
        category: "SLO",
        payloadSchema: sloAchievementUnlockedPayloadSchema,
      },
      pluginMetadata,
    );

    integrationEvents.registerEvent(
      {
        hook: sloHooks.sloWeeklyDigest,
        displayName: "SLO Weekly Digest",
        description:
          "Weekly summary of SLO performance across all systems (Monday 09:00 UTC)",
        category: "SLO",
        payloadSchema: sloWeeklyDigestPayloadSchema,
      },
      pluginMetadata,
    );

    // Shared references across init/afterPluginsReady (maintenance-backend pattern)
    let sharedEngine: SloEngine;
    let gitopsService: SloService | undefined;

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
        onHook,
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

        // =====================================================================
        // Perspective 1: System goes DOWN — open downtime events
        // =====================================================================
        onHook(
          healthCheckHooks.systemDegraded,
          async (payload) => {
            logger.debug(
              `SLO: System ${payload.systemId} degraded (${payload.previousStatus} → ${payload.newStatus})`,
            );
            await engine.handleSystemDown({
              systemId: payload.systemId,
              getUpstreamHealthStatus,
            });
          },
          { mode: "work-queue", workerGroup: "slo-system-down" },
        );

        // =====================================================================
        // Perspective 1: System goes UP — close downtime events
        // =====================================================================
        onHook(
          healthCheckHooks.systemHealthy,
          async (payload) => {
            logger.debug(`SLO: System ${payload.systemId} recovered`);
            await engine.handleSystemUp({
              systemId: payload.systemId,
            });

            // Also handle Perspective 2 (as upstream)
            const downstreamIds = await getDownstreamSystemIds(
              payload.systemId,
            );
            if (downstreamIds.length > 0) {
              await engine.handleUpstreamUp({
                upstreamSystemId: payload.systemId,
                downstreamSystemIds: downstreamIds,
                getUpstreamHealthStatus,
              });
            }

            // Evaluate achievements on recovery (rapid_recovery, clean_sheet, etc.)
            await evaluateAchievements({
              systemId: payload.systemId,
              service,
              engine,
              logger,
            });
          },
          { mode: "work-queue", workerGroup: "slo-system-up" },
        );

        // =====================================================================
        // Perspective 2: Upstream degraded — split downstream "self" events
        // We re-use the systemDegraded hook, checking downstream systems
        // =====================================================================
        onHook(
          healthCheckHooks.systemDegraded,
          async (payload) => {
            const downstreamIds = await getDownstreamSystemIds(
              payload.systemId,
            );
            if (downstreamIds.length > 0) {
              await engine.handleUpstreamDown({
                upstreamSystemId: payload.systemId,
                upstreamSystemName: payload.systemName ?? payload.systemId,
                downstreamSystemIds: downstreamIds,
              });
            }
          },
          { mode: "work-queue", workerGroup: "slo-upstream-down" },
        );

        // =====================================================================
        // Subscribe to catalog system deletion for cleanup
        // =====================================================================
        onHook(
          catalogHooks.systemDeleted,
          async (payload) => {
            logger.debug(
              `Cleaning up SLO data for deleted system: ${payload.systemId}`,
            );
            await service.deleteObjectivesForSystem({
              systemId: payload.systemId,
            });
            await service.deleteAchievementsForSystem({
              systemId: payload.systemId,
            });
          },
          { mode: "work-queue", workerGroup: "slo-system-cleanup" },
        );

        // =====================================================================
        // Daily snapshot + streak calculation cron job
        // =====================================================================
        await setupDailySnapshotJob({
          service,
          engine,
          logger,
          queueManager,
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
