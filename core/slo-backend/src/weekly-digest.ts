import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";
import type { Logger, EmitHookFn } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import { sloHooks } from "./hooks";

const DIGEST_QUEUE = "slo-weekly-digest";
const DIGEST_JOB_ID = "slo-weekly-digest-run";
const WORKER_GROUP = "slo-digest-worker";

interface WeeklyDigestDeps {
  service: SloService;
  engine: SloEngine;
  logger: Logger;
  queueManager: QueueManager;
  emitHook: EmitHookFn;
}

/**
 * Setup the weekly SLO digest cron job.
 * Runs every Monday at 09:00 UTC — summarizes the previous week's SLO performance
 * and emits a hook that integration channels (Slack, Teams, etc.) can deliver.
 */
export async function setupWeeklyDigestJob(deps: WeeklyDigestDeps) {
  const { queueManager, logger, service, engine, emitHook } = deps;

  const queue =
    queueManager.getQueue<{ trigger: "scheduled" }>(DIGEST_QUEUE);

  // Register consumer
  await queue.consume(
    async () => {
      logger.info("[slo] Running weekly SLO digest...");
      await runWeeklyDigest({ service, engine, logger, emitHook });
      logger.info("[slo] Weekly SLO digest complete.");
    },
    { consumerGroup: WORKER_GROUP, maxRetries: 0 },
  );

  // Schedule: every Monday at 09:00 UTC
  await queue.scheduleRecurring(
    { trigger: "scheduled" },
    {
      jobId: DIGEST_JOB_ID,
      cronPattern: "0 9 * * 1", // Monday 09:00 UTC
    },
  );

  logger.debug("[slo] Weekly digest cron job registered (Monday 09:00 UTC)");
}

/**
 * Core logic for the weekly SLO digest.
 * Computes status for all objectives, categorizes them, and emits the digest hook.
 */
async function runWeeklyDigest(deps: {
  service: SloService;
  engine: SloEngine;
  logger: Logger;
  emitHook: EmitHookFn;
}) {
  const { service, engine, logger, emitHook } = deps;

  const objectives = await service.listObjectives();
  if (objectives.length === 0) {
    logger.info("[slo] No SLO objectives — skipping weekly digest.");
    return;
  }

  // Compute status for all objectives
  const statuses = await Promise.all(
    objectives.map(async (obj) => ({
      objective: obj,
      status: await engine.computeStatus({ objective: obj }),
    })),
  );

  // Categorize
  const breachingCount = statuses.filter(
    (s) => s.status.isBreaching,
  ).length;
  const atRiskCount = statuses.filter(
    (s) =>
      !s.status.isBreaching &&
      s.status.errorBudgetRemainingPercent <= 20,
  ).length;
  const healthyCount = statuses.filter(
    (s) =>
      !s.status.isBreaching &&
      s.status.errorBudgetRemainingPercent > 20,
  ).length;

  // Get streaks for top performers
  const streaks = await service.getAllStreaks();
  const streakMap = new Map(
    streaks.map((s) => [s.objectiveId, s.currentStreak]),
  );

  // Top 3 performers (highest availability)
  const topPerformers = statuses
    .filter((s) => s.status.currentAvailability !== null)
    .toSorted(
      (a, b) =>
        (b.status.currentAvailability ?? 0) -
        (a.status.currentAvailability ?? 0),
    )
    .slice(0, 3)
    .map((s) => ({
      systemName: s.status.systemId,
      availability: s.status.currentAvailability ?? 0,
      streakDays: streakMap.get(s.objective.id) ?? 0,
    }));

  // Bottom 3 performers (lowest budget remaining)
  const worstPerformers = statuses
    .toSorted(
      (a, b) =>
        a.status.errorBudgetRemainingPercent -
        b.status.errorBudgetRemainingPercent,
    )
    .slice(0, 3)
    .map((s) => ({
      systemName: s.status.systemId,
      availability: s.status.currentAvailability ?? 0,
      budgetRemainingPercent: s.status.errorBudgetRemainingPercent,
    }));

  await emitHook(sloHooks.sloWeeklyDigest, {
    totalObjectives: objectives.length,
    breachingCount,
    atRiskCount,
    healthyCount,
    topPerformers,
    worstPerformers,
  });

  logger.info(
    `[slo] Weekly digest emitted: ${objectives.length} objectives, ${breachingCount} breaching, ${atRiskCount} at risk, ${healthyCount} healthy`,
  );
}
