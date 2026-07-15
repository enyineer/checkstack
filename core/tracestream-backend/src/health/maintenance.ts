/**
 * The `tracestream-maintenance` recurring jobs: tail-sampling DECISION and
 * silence detection (minutely), op-bucket rollup + hot span sweep (hourly), and
 * full retention cleanup (daily). Single work queue, one consumer group, stable
 * recurring jobIds so every pod converges to ONE schedule per job (cluster-once).
 * All state lives in the DB, so whichever pod claims a job can run it.
 */

import type { Logger } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import { TRACESTREAM_MAINTENANCE_QUEUE } from "./constants";
import { runDecisionPass } from "./decision-job";
import { runRollupPass, runHotSweepPass, runCleanupPass } from "./retention";
import { runSilenceDetection } from "./silence";

type MaintenanceJob =
  | "decision"
  | "silence"
  | "rollup"
  | "hotsweep"
  | "cleanup";

interface MaintenancePayload {
  job: MaintenanceJob;
}

const DECISION_INTERVAL_SECONDS = 60;
const SILENCE_INTERVAL_SECONDS = 60;
const ROLLUP_INTERVAL_SECONDS = 60 * 60;
const HOTSWEEP_INTERVAL_SECONDS = 60 * 60;
const CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60;

export interface MaintenanceHandle {
  stop(): Promise<void>;
}

/**
 * Register the tracestream maintenance consumer and schedule the recurring
 * passes. Fire-and-forget scheduling: a transient queue hiccup can never fail
 * plugin init. Idempotent - `scheduleRecurring` with a stable jobId updates in
 * place, so every pod converges to one schedule per job.
 */
export function registerMaintenance({
  queueManager,
  storage,
  recorder,
  logger,
}: {
  queueManager: QueueManager;
  storage: Storage;
  recorder: ImportantEventRecorder;
  logger: Logger;
}): MaintenanceHandle {
  const queue = queueManager.getQueue<MaintenancePayload>(
    TRACESTREAM_MAINTENANCE_QUEUE,
  );

  void (async () => {
    try {
      await queue.consume(
        async (job) => {
          switch (job.data.job) {
            case "decision": {
              await runDecisionPass({ storage, logger });
              break;
            }
            case "silence": {
              await runSilenceDetection({ storage, recorder, logger });
              break;
            }
            case "rollup": {
              await runRollupPass({ storage, logger });
              break;
            }
            case "hotsweep": {
              await runHotSweepPass({ storage, logger });
              break;
            }
            case "cleanup": {
              await runCleanupPass({ storage, logger });
              break;
            }
          }
        },
        { consumerGroup: "tracestream-maintenance-worker" },
      );

      await queue.scheduleRecurring(
        { job: "decision" },
        {
          jobId: "tracestream-decision-minutely",
          intervalSeconds: DECISION_INTERVAL_SECONDS,
        },
      );
      await queue.scheduleRecurring(
        { job: "silence" },
        {
          jobId: "tracestream-silence-minutely",
          intervalSeconds: SILENCE_INTERVAL_SECONDS,
        },
      );
      await queue.scheduleRecurring(
        { job: "rollup" },
        {
          jobId: "tracestream-rollup-hourly",
          intervalSeconds: ROLLUP_INTERVAL_SECONDS,
        },
      );
      await queue.scheduleRecurring(
        { job: "hotsweep" },
        {
          jobId: "tracestream-hotsweep-hourly",
          intervalSeconds: HOTSWEEP_INTERVAL_SECONDS,
        },
      );
      await queue.scheduleRecurring(
        { job: "cleanup" },
        {
          jobId: "tracestream-cleanup-daily",
          intervalSeconds: CLEANUP_INTERVAL_SECONDS,
        },
      );

      logger.debug(
        "tracestream maintenance jobs scheduled (decision 60s, silence 60s, rollup 1h, hotsweep 1h, cleanup 24h)",
      );
    } catch (error) {
      logger.error(
        `tracestream: failed to schedule maintenance jobs: ${String(error)}`,
      );
    }
  })();

  return {
    async stop() {
      // Recurring jobs live on the shared queue and are idempotent; there is no
      // per-pod teardown. Present for the index.ts cleanup seam.
    },
  };
}
