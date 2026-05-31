/**
 * `wait_until` timeout-timer consumer (reactive automation engine §7).
 *
 * A reactive `wait_until` is event-driven: a relevant `ENTITY_CHANGED` wakes
 * it via Stage 1. The ONLY queue job a suspended wait holds is a single
 * timeout timer scheduled at `timeoutAt` (when a timeout is configured) —
 * NOT a poll loop. When that timer fires this consumer runs `checkWaitUntil`,
 * which re-evaluates the condition one last time and then applies the
 * continue/fail-on-timeout policy.
 *
 * Idempotent: `checkWaitUntil` deletes the lock before resuming and
 * `resumeRun` takes the per-run advisory lock, so a wake that already
 * resumed the run makes this a no-op (`loadWaitLock` finds nothing).
 * Mirrors the delay / dwell consumer wiring.
 */
import type { Logger } from "@checkstack/backend-api";

import type { AutomationStore } from "../automation-store";
import {
  checkWaitUntil,
  WAIT_TIMEOUT_QUEUE_NAME,
  type WaitTimeoutJob,
} from "./engine";
import type { DispatchDeps } from "./types";

export interface WaitTimeoutQueueConsumerArgs {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  logger: Logger;
}

export interface WaitTimeoutQueueConsumer {
  stop: () => Promise<void>;
}

export async function startWaitTimeoutQueueConsumer(
  args: WaitTimeoutQueueConsumerArgs,
): Promise<WaitTimeoutQueueConsumer> {
  const queue = args.deps.queueManager.getQueue<WaitTimeoutJob>(
    WAIT_TIMEOUT_QUEUE_NAME,
  );

  await queue.consume(
    async (job) => {
      const { runId, waitLockId } = job.data;
      const lock = await args.deps.runStore.loadWaitLock(waitLockId);
      if (!lock || lock.kind !== "until") {
        args.logger.debug(
          `wait-timeout: lock ${waitLockId} gone (woken / cancelled)`,
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

      await checkWaitUntil(args.deps, {
        runId,
        waitLockId,
        automation: {
          id: automation.id,
          name: automation.name,
          status: automation.status,
          definition: automation.definition,
        },
      });
    },
    { consumerGroup: "automation-wait-timeout", maxRetries: 3 },
  );

  return {
    stop: async () => {
      await queue.stop();
    },
  };
}
