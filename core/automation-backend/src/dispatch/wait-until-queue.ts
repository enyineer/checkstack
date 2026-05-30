/**
 * Queue consumer that drives `wait_until` condition re-checks.
 *
 * `executeWaitUntil` persists a `kind: "until"` wait lock and enqueues a
 * first `automation-wait-until` job with `startDelay = poll_seconds`. On
 * each tick this consumer delegates to `checkWaitUntil`, which:
 *
 *   - resumes the run when the condition is true (or timed-out-continue),
 *   - fails the run on timeout when `continue_on_timeout` is false,
 *   - otherwise reports "still-waiting", and we re-enqueue the next tick.
 *
 * The stalled sweeper also re-ticks `until` locks as a backstop, so a lost
 * job self-heals. Both paths are idempotent (the lock is deleted before
 * resuming, and `resumeRun` takes the per-run advisory lock).
 */
import type { Logger } from "@checkstack/backend-api";

import type { AutomationStore } from "../automation-store";
import {
  checkWaitUntil,
  WAIT_UNTIL_QUEUE_NAME,
  type WaitUntilCheckJob,
} from "./engine";
import type { DispatchDeps } from "./types";

export interface WaitUntilQueueConsumerArgs {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  logger: Logger;
}

export interface WaitUntilQueueConsumer {
  stop: () => Promise<void>;
}

export async function startWaitUntilQueueConsumer(
  args: WaitUntilQueueConsumerArgs,
): Promise<WaitUntilQueueConsumer> {
  const queue = args.deps.queueManager.getQueue<WaitUntilCheckJob>(
    WAIT_UNTIL_QUEUE_NAME,
  );

  await queue.consume(
    async (job) => {
      const { runId, waitLockId } = job.data;
      const lock = await args.deps.runStore.loadWaitLock(waitLockId);
      if (!lock || lock.kind !== "until") {
        args.logger.debug(
          `wait-until-queue: lock ${waitLockId} gone (resumed / cancelled)`,
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
          "automation deleted while run was suspended on wait_until",
        );
        await args.deps.runStateStore.clear(runId);
        return;
      }

      const outcome = await checkWaitUntil(args.deps, {
        runId,
        waitLockId,
        automation: {
          id: automation.id,
          name: automation.name,
          status: automation.status,
          definition: automation.definition,
        },
      });

      // Still false and not timed out → schedule the next re-check.
      if (outcome === "still-waiting") {
        const pollSeconds = lock.waitConfig?.pollSeconds ?? 30;
        await queue.enqueue(
          { runId, waitLockId },
          {
            startDelay: pollSeconds,
            jobId: `${runId}:${waitLockId}:${Date.now()}`,
          },
        );
      }
    },
    { consumerGroup: "automation-wait-until-check", maxRetries: 3 },
  );

  return {
    stop: async () => {
      await queue.stop();
    },
  };
}
