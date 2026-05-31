/**
 * Queue consumer that fires `for:` dwell timers.
 *
 * `armDwell` persists a dwell row and enqueues an `automation-dwell` job
 * with the matching `startDelay`. When the scheduler fires the job, this
 * consumer:
 *
 *   1. Loads the dwell row; bails if it's gone (cancelled, re-armed under
 *      a different id, or already fired) — the row is the source of truth.
 *   2. Delegates to `fireDwell`, which re-confirms the matched state
 *      still holds, then starts the run via `startRunRespectingMode`.
 *
 * The stalled sweeper also catches expired dwell rows in case the queue
 * job is lost; both paths are idempotent via delete-on-fire.
 */
import type { Logger } from "@checkstack/backend-api";

import type { AutomationStore } from "../automation-store";
import { DWELL_QUEUE_NAME, fireDwell, type DwellFireJob } from "./dwell";
import { startRunRespectingMode } from "./trigger-subscriber";
import type { DispatchDeps } from "./types";

export interface DwellQueueConsumerArgs {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  logger: Logger;
}

export interface DwellQueueConsumer {
  stop: () => Promise<void>;
}

export async function startDwellQueueConsumer(
  args: DwellQueueConsumerArgs,
): Promise<DwellQueueConsumer> {
  const queue = args.deps.queueManager.getQueue<DwellFireJob>(
    DWELL_QUEUE_NAME,
  );

  await queue.consume(
    async (job) => {
      const { dwellId } = job.data;
      const dwell = await args.deps.dwellStore.load(dwellId);
      if (!dwell) {
        args.logger.debug(
          `dwell-queue: dwell ${dwellId} no longer exists (cancelled / re-armed / already fired)`,
        );
        return;
      }
      await fireDwell({
        deps: args.deps,
        automationStore: args.automationStore,
        dwell,
        startRun: startRunRespectingMode,
      });
    },
    { consumerGroup: "automation-dwell-fire", maxRetries: 3 },
  );

  return {
    stop: async () => {
      await queue.stop();
    },
  };
}
