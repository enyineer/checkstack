/**
 * Queue consumer that resumes runs suspended by `delay` actions.
 *
 * The dispatch engine's delay primitive persists a wait lock of
 * `kind: "delay"` and enqueues a `automation-delay` job with the
 * configured `startDelay`. When the scheduler fires the job, this
 * consumer:
 *
 *   1. Loads the wait lock; bails if it's been deleted (e.g. by the
 *      stalled sweeper or a cancelled run).
 *   2. Loads the run + its automation definition.
 *   3. Deletes the wait lock.
 *   4. Calls `resumeRun` — which takes the advisory lock so a
 *      concurrent sweeper / consumer can't double-fire.
 */
import type { Logger } from "@checkstack/backend-api";

import type { AutomationStore } from "../automation-store";
import {
  DELAY_QUEUE_NAME,
  resumeRun,
  type DelayResumeJob,
} from "./engine";
import type { DispatchDeps } from "./types";

export interface DelayQueueConsumerArgs {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  logger: Logger;
}

export interface DelayQueueConsumer {
  /** Stop consuming. */
  stop: () => Promise<void>;
}

export async function startDelayQueueConsumer(
  args: DelayQueueConsumerArgs,
): Promise<DelayQueueConsumer> {
  const queue = args.deps.queueManager.getQueue<DelayResumeJob>(
    DELAY_QUEUE_NAME,
  );

  await queue.consume(
    async (job) => {
      const { runId, waitLockId } = job.data;
      const lock = await args.deps.runStore.loadWaitLock(waitLockId);
      if (!lock) {
        args.logger.debug(
          `delay-queue: wait lock ${waitLockId} no longer exists (run cancelled or already resumed)`,
        );
        return;
      }
      const run = await args.deps.runStore.loadRun(runId);
      if (!run) {
        await args.deps.runStore.deleteWaitLock(waitLockId);
        return;
      }
      const automation = await args.automationStore.getById(run.automationId);
      if (!automation) {
        await args.deps.runStore.deleteWaitLock(waitLockId);
        await args.deps.runStore.updateRunStatus(
          runId,
          "failed",
          "automation deleted while run was suspended on delay",
        );
        await args.deps.runStateStore.clear(runId);
        return;
      }

      await args.deps.runStore.deleteWaitLock(waitLockId);
      await resumeRun(args.deps, {
        runId,
        automation: {
          id: automation.id,
          name: automation.name,
          status: automation.status,
          definition: automation.definition,
          runAs: automation.runAs ?? null,
        },
        waitedAtPath: lock.actionPath,
      });
    },
    { consumerGroup: "automation-delay-resume", maxRetries: 3 },
  );

  return {
    stop: async () => {
      await queue.stop();
    },
  };
}
