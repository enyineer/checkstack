/**
 * The `metricstream-maintenance` recurring jobs: silence detection (minutely),
 * minute->hourly rollup (hourly), and retention cleanup (daily). Single work
 * queue, one consumer group, stable recurring jobIds so every pod converges to
 * ONE schedule per job (cluster-once).
 */

import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import { MetricStreamConfigSchema } from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricStreams } from "../schema";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import type { GetReferencedMetricNames } from "./metric-references";
import { METRICSTREAM_MAINTENANCE_QUEUE } from "./constants";
import {
  computeRetentionCutoffs,
  rollupStreamMinuteBuckets,
  deleteExpiredStreamHourly,
  deleteExpiredImportantEvents,
  expireSeries,
  cleanupNames,
} from "./retention";
import { runSilenceDetection } from "./silence";

type Db = SafeDatabase<typeof schema>;

/** Which maintenance pass a job runs. */
type MaintenanceJob = "silence" | "rollup" | "cleanup";

interface MaintenancePayload {
  job: MaintenanceJob;
}

const SILENCE_INTERVAL_SECONDS = 60;
const ROLLUP_INTERVAL_SECONDS = 60 * 60;
const CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60;

/** Handle returned by {@link registerMaintenance}. */
export interface MaintenanceHandle {
  /** Stop the maintenance scheduler (test cleanup / shutdown). */
  stop(): Promise<void>;
}

/** Load every stream with its (defaulted) storage policy. */
async function loadStreamPolicies(db: Db) {
  const rows = await db
    .select({ id: metricStreams.id, config: metricStreams.config })
    .from(metricStreams);
  return rows.map((row) => ({
    streamId: row.id,
    config: MetricStreamConfigSchema.parse(row.config ?? {}),
  }));
}

/** Hourly: fold each stream's minute buckets past its retention into hourly. */
export async function runRollupPass({
  db,
  logger,
  now = new Date(),
}: {
  db: Db;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  for (const { streamId, config } of await loadStreamPolicies(db)) {
    const { minuteCutoff } = computeRetentionCutoffs({ config, now });
    try {
      await rollupStreamMinuteBuckets({ db, streamId, minuteCutoff });
    } catch (error) {
      logger.error(
        `metricstream rollup failed for stream ${streamId}: ${String(error)}`,
      );
    }
  }
}

/**
 * Daily: delete expired hourly buckets + events, then sweep series/name registry
 * rows whose data has aged out and that no health check references.
 *
 * When the referenced-name resolver THROWS for a stream, the series/name sweep
 * for that stream is SKIPPED this run (never risk deleting a name we cannot
 * prove is unreferenced); the hourly + event deletes still run. It retries next
 * cleanup.
 */
export async function runCleanupPass({
  db,
  logger,
  getReferencedMetricNames,
  now = new Date(),
}: {
  db: Db;
  logger: Logger;
  getReferencedMetricNames: GetReferencedMetricNames;
  now?: Date;
}): Promise<void> {
  for (const { streamId, config } of await loadStreamPolicies(db)) {
    const cutoffs = computeRetentionCutoffs({ config, now });
    try {
      await deleteExpiredStreamHourly({
        db,
        streamId,
        hourlyCutoff: cutoffs.hourlyCutoff,
      });
      await deleteExpiredImportantEvents({
        db,
        streamId,
        hourlyCutoff: cutoffs.hourlyCutoff,
      });

      let referencedNames: Set<string> | undefined;
      try {
        referencedNames = await getReferencedMetricNames({ streamId });
      } catch (error) {
        logger.warn(
          `metricstream cleanup: could not resolve referenced metric names for stream ${streamId}, skipping series/name sweep this run: ${String(error)}`,
        );
        referencedNames = undefined;
      }
      if (referencedNames !== undefined) {
        await expireSeries({
          db,
          streamId,
          cutoff: cutoffs.hourlyCutoff,
          referencedNames,
        });
        await cleanupNames({ db, streamId, referencedNames });
      }
    } catch (error) {
      logger.error(
        `metricstream cleanup failed for stream ${streamId}: ${String(error)}`,
      );
    }
  }
}

/**
 * Register the metricstream maintenance consumer and schedule the three
 * recurring passes. Fire-and-forget scheduling: a transient queue hiccup can
 * never fail plugin init. Idempotent - `scheduleRecurring` with a stable jobId
 * updates in place, so every pod converges to one schedule per job.
 *
 * `recorder` is OPTIONAL: when provided, silence events fire the
 * METRICSTREAM_IMPORTANT_EVENT signal for live viewers; when absent, they are
 * inserted directly (the timeline still updates on the next poll). Wire
 * `recorder` in `index.ts` to enable the live signal.
 */
export function registerMaintenance({
  queueManager,
  db,
  logger,
  getReferencedMetricNames,
  recorder,
}: {
  queueManager: QueueManager;
  db: Db;
  storage: Storage;
  logger: Logger;
  getReferencedMetricNames: GetReferencedMetricNames;
  recorder?: ImportantEventRecorder;
}): MaintenanceHandle {
  const queue = queueManager.getQueue<MaintenancePayload>(
    METRICSTREAM_MAINTENANCE_QUEUE,
  );

  void (async () => {
    try {
      await queue.consume(
        async (job) => {
          switch (job.data.job) {
            case "silence": {
              await runSilenceDetection({ db, recorder, logger });
              break;
            }
            case "rollup": {
              await runRollupPass({ db, logger });
              break;
            }
            case "cleanup": {
              await runCleanupPass({ db, logger, getReferencedMetricNames });
              break;
            }
          }
        },
        { consumerGroup: "metricstream-maintenance-worker" },
      );

      await queue.scheduleRecurring(
        { job: "silence" },
        {
          jobId: "metricstream-silence-minutely",
          intervalSeconds: SILENCE_INTERVAL_SECONDS,
        },
      );
      await queue.scheduleRecurring(
        { job: "rollup" },
        {
          jobId: "metricstream-rollup-hourly",
          intervalSeconds: ROLLUP_INTERVAL_SECONDS,
        },
      );
      await queue.scheduleRecurring(
        { job: "cleanup" },
        {
          jobId: "metricstream-cleanup-daily",
          intervalSeconds: CLEANUP_INTERVAL_SECONDS,
        },
      );

      logger.debug(
        "metricstream maintenance jobs scheduled (silence 60s, rollup 1h, cleanup 24h)",
      );
    } catch (error) {
      logger.error(
        `metricstream: failed to schedule maintenance jobs: ${String(error)}`,
      );
    }
  })();

  return {
    async stop() {
      // The recurring jobs live on the shared queue and are idempotent; there is
      // no per-pod teardown to perform. Present for the index.ts cleanup seam.
    },
  };
}
