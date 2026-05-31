import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";
import type { Logger } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { EntityHandle } from "@checkstack/automation-backend";
import { mirrorSloEntity, type SloEntityState } from "./slo-entity";

const SNAPSHOT_QUEUE = "slo-daily-snapshots";
const SNAPSHOT_JOB_ID = "slo-daily-snapshot-run";
const WORKER_GROUP = "slo-snapshot-worker";

interface StreakCalculatorDeps {
  service: SloService;
  engine: SloEngine;
  logger: Logger;
  queueManager: QueueManager;
  /** Resolver for the reactive `slo` entity (§10.7). Undefined in tests. */
  getSloEntity?: () => EntityHandle<SloEntityState> | undefined;
}

/**
 * Sets up the daily SLO snapshot and streak calculation job.
 * Runs once per day at UTC midnight, persisting daily snapshots
 * and updating streak counters for all active objectives.
 */
export async function setupDailySnapshotJob(deps: StreakCalculatorDeps) {
  const { queueManager, logger, service, engine, getSloEntity } = deps;

  const queue = queueManager.getQueue<{ trigger: "scheduled" }>(SNAPSHOT_QUEUE);

  // Register consumer
  await queue.consume(
    async () => {
      logger.info("Starting daily SLO snapshot job");
      await runDailySnapshotJob({ service, engine, logger, getSloEntity });
      logger.info("Completed daily SLO snapshot job");
    },
    { consumerGroup: WORKER_GROUP, maxRetries: 0 },
  );

  // Schedule daily at midnight UTC (00:00)
  await queue.scheduleRecurring(
    { trigger: "scheduled" },
    {
      jobId: SNAPSHOT_JOB_ID,
      cronPattern: "0 0 * * *", // Daily at midnight UTC
    },
  );

  logger.debug("✅ SLO daily snapshot job scheduled (runs at 00:00 UTC)");
}

/**
 * Main daily snapshot and streak calculation logic.
 * For each objective:
 * 1. Compute current SLO status
 * 2. Persist a daily snapshot for trend charts
 * 3. Update streak counter (increment if meeting target, reset if breaching)
 */
export async function runDailySnapshotJob(deps: {
  service: SloService;
  engine: SloEngine;
  logger: Logger;
  getSloEntity?: () => EntityHandle<SloEntityState> | undefined;
}) {
  const { service, engine, logger, getSloEntity } = deps;

  const objectives = await service.listObjectives();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const objective of objectives) {
    try {
      const status = await engine.computeStatus({ objective });

      // 1. Persist daily snapshot
      const streak = await service.getStreak({
        objectiveId: objective.id,
      });
      await service.insertDailySnapshot({
        snapshot: {
          objectiveId: objective.id,
          date: today,
          availabilityPercent: status.currentAvailability ?? 100,
          budgetConsumedMinutes: status.errorBudgetConsumedMinutes,
          budgetRemainingPercent: status.errorBudgetRemainingPercent,

          burnRate: status.burnRate ?? null,
          streakDays: streak?.currentStreak ?? 0,
        },
      });

      // 2. Update streak: if currently meeting target, increment; else reset
      if (!status.isBreaching && !status.hasOpenDowntime) {
        await service.incrementStreak({ objectiveId: objective.id });
      } else if (status.isBreaching) {
        const currentStreak = streak?.currentStreak ?? 0;
        if (currentStreak > 0) {
          await service.resetStreak({ objectiveId: objective.id });
          logger.info(
            `SLO ${objective.id}: Streak broken at ${currentStreak} days`,
          );
        }
      }

      // 3. Mirror the recomputed budget + streak into the reactive `slo`
      //    entity (§10.7). Operators author budget/streak thresholds as
      //    `numeric_state` conditions over this state (§9.2). Re-read the
      //    streak so the mirror reflects the post-update counters.
      const freshStreak = await service.getStreak({ objectiveId: objective.id });
      await mirrorSloEntity({
        handle: getSloEntity?.(),
        objectiveId: objective.id,
        systemId: objective.systemId,
        target: objective.target,
        budgetRemainingPercent: status.errorBudgetRemainingPercent,
        currentStreak: freshStreak?.currentStreak ?? 0,
        bestStreak: freshStreak?.bestStreak ?? 0,
        onError: (error) =>
          logger.warn(
            `Failed to mirror slo entity for objective ${objective.id}`,
            { error },
          ),
      });
    } catch (error) {
      logger.error(
        `Failed to process daily snapshot for objective ${objective.id}`,
        { error },
      );
    }
  }
}
