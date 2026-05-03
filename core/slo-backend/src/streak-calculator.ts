import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";
import type { Logger } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";

const SNAPSHOT_QUEUE = "slo-daily-snapshots";
const SNAPSHOT_JOB_ID = "slo-daily-snapshot-run";
const WORKER_GROUP = "slo-snapshot-worker";

interface StreakCalculatorDeps {
  service: SloService;
  engine: SloEngine;
  logger: Logger;
  queueManager: QueueManager;
}

/**
 * Sets up the daily SLO snapshot and streak calculation job.
 * Runs once per day at UTC midnight, persisting daily snapshots
 * and updating streak counters for all active objectives.
 */
export async function setupDailySnapshotJob(deps: StreakCalculatorDeps) {
  const { queueManager, logger, service, engine } = deps;

  const queue = queueManager.getQueue<{ trigger: "scheduled" }>(SNAPSHOT_QUEUE);

  // Register consumer
  await queue.consume(
    async () => {
      logger.info("Starting daily SLO snapshot job");
      await runDailySnapshotJob({ service, engine, logger });
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
}) {
  const { service, engine, logger } = deps;

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
    } catch (error) {
      logger.error(
        `Failed to process daily snapshot for objective ${objective.id}`,
        { error },
      );
    }
  }
}
