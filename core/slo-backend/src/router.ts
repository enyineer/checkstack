import { implement, ORPCError } from "@orpc/server";
import {
  sloContract,
  SLO_STATUS_CHANGED,
} from "@checkstack/slo-common";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
  type RpcClient,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import { CatalogApi } from "@checkstack/catalog-common";
import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";
import type { SloCache } from "./cache";

export function createRouter({
  service,
  engine,
  signalService,
  rpcClient,
  cache,
}: {
  service: SloService;
  engine: SloEngine;
  signalService: SignalService;
  rpcClient: RpcClient;
  cache: SloCache;
}) {
  const os = implement(sloContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  // Self-heal a missed recovery before reporting status. Closing a downtime
  // window relies on a transient health-recovery edge (`onEntityChanged`), and
  // that edge is never emitted when the offending check is fixed, paused,
  // deleted, or unassigned (those only invalidate the read cache) — and can be
  // lost even on a plain edit if the single change delivery fails. The result
  // is an orphaned open window that lingers until the once-daily reconcile.
  // `computeStatus` already ignores such rows for the budget, but the row still
  // shows as "ongoing" in the events list, so reconcile against live health on
  // the user-facing read. Cheap no-op when there are no open events.
  const computeStatusFresh = async (
    objective: Parameters<typeof engine.computeStatus>[0]["objective"],
  ): ReturnType<typeof engine.computeStatus> => {
    await engine.reconcileOrphanedDowntime({ objective });
    return engine.computeStatus({ objective });
  };

  return os.router({
    // =========================================================================
    // OBJECTIVES
    // =========================================================================

    listObjectives: os.listObjectives.handler(async () =>
      cache.wrapList(async () => {
        const objectives = await service.listObjectives();
        const results = await Promise.all(
          objectives.map(async (objective) => ({
            objective,
            status: await computeStatusFresh(objective),
          })),
        );
        return { objectives: results };
      }),
    ),

    getObjective: os.getObjective.handler(async ({ input }) =>
      cache.wrapObjective(input.id, async () => {
        const objective = await service.getObjective({ id: input.id });
        if (!objective) {
           
          return null;
        }
        const status = await computeStatusFresh(objective);
        return { objective, status };
      }),
    ),

    getObjectivesForSystem: os.getObjectivesForSystem.handler(
      async ({ input }) =>
        cache.wrapSystem(input.systemId, async () => {
          const objectives = await service.getObjectivesForSystem({
            systemId: input.systemId,
          });
          return Promise.all(
            objectives.map(async (objective) => ({
              objective,
              status: await computeStatusFresh(objective),
            })),
          );
        }),
    ),

    getBulkObjectivesForSystems: os.getBulkObjectivesForSystems.handler(
      async ({ input }) => {
        // Per-entity caching: see ./cache.ts for the invalidation contract.
        const systems: Record<
          string,
          Array<{
            objective: Awaited<ReturnType<typeof service.getObjective>> & {};
            status: Awaited<ReturnType<typeof engine.computeStatus>>;
          }>
        > = {};

        await Promise.all(
          input.systemIds.map(async (systemId) => {
            systems[systemId] = await cache.wrapSystem(systemId, async () => {
              const objectives = await service.getObjectivesForSystem({
                systemId,
              });
              return Promise.all(
                objectives.map(async (objective) => ({
                  objective,
                  status: await computeStatusFresh(objective),
                })),
              );
            });
          }),
        );

        return { systems };
      },
    ),

    createObjective: os.createObjective.handler(
      async ({ input, context }) => {
        // The objective (+ its streak row) is committed atomically here. Once it
        // returns, the write is durable and the create has SUCCEEDED - the
        // post-commit steps below are best-effort enrichment/notification and
        // must never turn a committed create into a client-visible error.
        const objective = await service.createObjective({ input });

        // Mutation invariant: db.write → cache.invalidate (await) → signals.emit.
        // cache.invalidate* and signalService.* are already non-throwing by
        // platform contract; reconcile/computeStatus are guarded here so a
        // transient health-read failure can't fail the (already committed) create.
        try {
          // Reconcile initial state: if system is already down, open an initial
          // downtime event immediately.
          await engine.reconcileObjective({ objective });
          const status = await engine.computeStatus({ objective });
          await cache.invalidateForMutation({
            objectiveId: objective.id,
            systemId: objective.systemId,
          });
          await signalService.broadcast(SLO_STATUS_CHANGED, {
            systemId: objective.systemId,
            objectiveId: objective.id,
            budgetRemainingPercent: status.errorBudgetRemainingPercent,
            isBreaching: status.isBreaching,
          });
        } catch (error) {
          context.logger.warn(
            `createObjective: objective ${objective.id} committed, but post-create reconcile/notify failed`,
            { error },
          );
        }

        return objective;
      },
    ),

    updateObjective: os.updateObjective.handler(async ({ input }) => {
      const objective = await service.updateObjective({ input });
      if (!objective) {
        throw new ORPCError("NOT_FOUND", {
          message: "SLO objective not found",
        });
      }

      // Reconcile: if system is currently down but no event exists
      await engine.reconcileObjective({ objective });

      const status = await engine.computeStatus({ objective });
      await cache.invalidateForMutation({
        objectiveId: objective.id,
        systemId: objective.systemId,
      });
      await signalService.broadcast(SLO_STATUS_CHANGED, {
        systemId: objective.systemId,
        objectiveId: objective.id,
        budgetRemainingPercent: status.errorBudgetRemainingPercent,
        isBreaching: status.isBreaching,
      });

      return objective;
    }),

    deleteObjective: os.deleteObjective.handler(async ({ input }) => {
      // Look up the objective first so we can target the per-system cache
      // entry; otherwise we'd have no way to know which system to drop.
      const existing = await service.getObjective({ id: input.id });
      const success = await service.deleteObjective({ id: input.id });
      if (success && existing) {
        await cache.invalidateForMutation({
          objectiveId: existing.id,
          systemId: existing.systemId,
        });
      }
      return { success };
    }),

    // =========================================================================
    // DOWNTIME EVENTS & SNAPSHOTS
    // =========================================================================

    getDowntimeEvents: os.getDowntimeEvents.handler(async ({ input }) => {
      // Self-heal a missed recovery before listing: an orphaned open window
      // (system long since healthy, but the recovery edge was never delivered)
      // would otherwise render as "ongoing" here forever — the exact mismatch
      // where status reads 100% but the list still shows a live downtime.
      const objective = await service.getObjective({ id: input.objectiveId });
      if (objective) {
        await engine.reconcileOrphanedDowntime({ objective });
      }
      const events = await service.getRecentDowntimeEvents({
        objectiveId: input.objectiveId,
        limit: input.limit ?? 50,
      });
      return { events };
    }),

    getDailySnapshots: os.getDailySnapshots.handler(async ({ input }) => {
      const snapshots = await service.getDailySnapshots({
        objectiveId: input.objectiveId,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      return { snapshots };
    }),

    // =========================================================================
    // STREAKS & ACHIEVEMENTS
    // =========================================================================

    getStreaks: os.getStreaks.handler(async () => {
      const streaks = await service.getAllStreaks();
      return { streaks };
    }),

    getAchievements: os.getAchievements.handler(async ({ input }) => {
      const achievements = await service.getAchievements({
        systemId: input.systemId,
      });
      return { achievements };
    }),

    getRecentMilestones: os.getRecentMilestones.handler(async ({ input }) => {
      const achievements = await service.getRecentMilestones({
        limit: input.limit ?? 20,
      });

      // Collect unique system IDs for batch lookup
      const uniqueSystemIds = [...new Set(achievements.map((a) => a.systemId))];
      const systemNameMap = new Map<string, string>();

      // Resolve system names via catalog RPC
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      await Promise.all(
        uniqueSystemIds.map(async (systemId) => {
          try {
            const system = await catalogClient.getSystem({ systemId });
            if (system?.name) {
              systemNameMap.set(systemId, system.name);
            }
          } catch {
            // Silently skip — system may have been deleted
          }
        }),
      );

      return {
        milestones: achievements.map((a) => ({
          systemId: a.systemId,
          systemName: systemNameMap.get(a.systemId),
          achievement: a.achievement,
          unlockedAt: a.unlockedAt,
        })),
      };
    }),
  });
}
