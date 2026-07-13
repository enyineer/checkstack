/**
 * The `logstream-maintenance` recurring jobs: silence detection (minutely),
 * minute->hourly rollup (hourly), and retention cleanup (daily). Follows the
 * healthcheck retention-job structure (single work queue, one consumer group,
 * `scheduleRecurring`).
 */

import type { SafeDatabase, Logger } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import { LogStreamConfigSchema } from "@checkstack/logstream-common";
import * as schema from "../schema";
import { logStreams } from "../schema";
import type { Storage } from "../storage";
import {
  rollupVariableBuckets,
  deleteExpiredVariableHourly,
} from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import { LOGSTREAM_MAINTENANCE_QUEUE } from "./constants";
import { runSilenceDetection } from "./silence";
import type { ResolveReferencedPatternIds } from "./pattern-references";
import {
  rollupSeverityBuckets,
  rollupPatternBuckets,
  deleteExpiredEvents,
  deleteExpiredHourly,
  deleteExpiredImportantEvents,
  deleteStalePatterns,
  computeRetentionCutoffs,
} from "./retention";

type Db = SafeDatabase<typeof schema>;

/** Which maintenance pass a job runs. */
type MaintenanceJob = "silence" | "rollup" | "cleanup";

interface MaintenancePayload {
  job: MaintenanceJob;
}

const SILENCE_INTERVAL_SECONDS = 60;
const ROLLUP_INTERVAL_SECONDS = 60 * 60;
const CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60;

/** Load every stream with its (defaulted) storage policy. */
async function loadStreamPolicies(db: Db) {
  const rows = await db
    .select({ id: logStreams.id, config: logStreams.config })
    .from(logStreams);
  return rows.map((row) => ({
    streamId: row.id,
    config: LogStreamConfigSchema.parse(row.config ?? {}),
  }));
}

/** Hourly: fold minute buckets past their retention into hourly buckets. */
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
      await rollupSeverityBuckets({ db, streamId, minuteCutoff });
      await rollupPatternBuckets({ db, streamId, minuteCutoff });
      await rollupVariableBuckets({ db, streamId, minuteCutoff });
    } catch (error) {
      logger.error(
        `logstream rollup failed for stream ${streamId}: ${String(error)}`,
      );
    }
  }
}

/** Daily: delete expired raw events, hourly buckets, events, stale patterns. */
export async function runCleanupPass({
  db,
  logger,
  getReferencedPatternIds,
  now = new Date(),
}: {
  db: Db;
  logger: Logger;
  /**
   * Resolve the pattern ids a stream's health checks reference, so a quiet but
   * still-referenced pattern is spared. When the resolver THROWS for a stream,
   * the stale-pattern delete for that stream is SKIPPED this run (never crash,
   * and never risk deleting a pattern we could not prove is unreferenced); the
   * other cleanup steps still run. Omitted => no referenced protection (only
   * user-origin patterns are spared).
   */
  getReferencedPatternIds?: ResolveReferencedPatternIds;
  now?: Date;
}): Promise<void> {
  for (const { streamId, config } of await loadStreamPolicies(db)) {
    const cutoffs = computeRetentionCutoffs({ config, now });
    try {
      await deleteExpiredEvents({ db, streamId, cutoff: cutoffs.rawCutoff });
      await deleteExpiredHourly({
        db,
        streamId,
        hourlyCutoff: cutoffs.hourlyCutoff,
      });
      await deleteExpiredVariableHourly({
        db,
        streamId,
        hourlyCutoff: cutoffs.hourlyCutoff,
      });
      await deleteExpiredImportantEvents({
        db,
        streamId,
        hourlyCutoff: cutoffs.hourlyCutoff,
      });

      // Resolve the referenced set BEFORE deleting; a resolver failure means we
      // cannot prove which patterns are safe to drop, so skip the stale-pattern
      // sweep for this stream this run (it retries next cleanup).
      let protectedPatternIds: readonly string[] | undefined = [];
      if (getReferencedPatternIds) {
        try {
          protectedPatternIds = await getReferencedPatternIds(streamId);
        } catch (error) {
          logger.warn(
            `logstream cleanup: could not resolve referenced patterns for stream ${streamId}, skipping stale-pattern delete this run: ${String(error)}`,
          );
          protectedPatternIds = undefined;
        }
      }
      if (protectedPatternIds !== undefined) {
        await deleteStalePatterns({
          db,
          streamId,
          hourlyCutoff: cutoffs.hourlyCutoff,
          protectedPatternIds,
        });
      }
    } catch (error) {
      logger.error(
        `logstream cleanup failed for stream ${streamId}: ${String(error)}`,
      );
    }
  }
}

/**
 * Register the maintenance consumer and schedule the three recurring passes.
 * Idempotent: `scheduleRecurring` with a stable jobId updates in place, so
 * every pod calling this converges to one schedule per job.
 */
export async function registerMaintenanceJobs({
  queueManager,
  db,
  storage,
  recorder,
  logger,
  getReferencedPatternIds,
}: {
  queueManager: QueueManager;
  db: Db;
  storage: Storage;
  recorder: ImportantEventRecorder;
  logger: Logger;
  /** Referenced-pattern resolver forwarded to the daily cleanup pass. */
  getReferencedPatternIds?: ResolveReferencedPatternIds;
}): Promise<void> {
  const queue = queueManager.getQueue<MaintenancePayload>(
    LOGSTREAM_MAINTENANCE_QUEUE,
  );

  await queue.consume(
    async (job) => {
      switch (job.data.job) {
        case "silence": {
          await runSilenceDetection({ db, storage, recorder, logger });
          break;
        }
        case "rollup": {
          await runRollupPass({ db, logger });
          break;
        }
        case "cleanup": {
          await runCleanupPass({ db, logger, getReferencedPatternIds });
          break;
        }
      }
    },
    { consumerGroup: "logstream-maintenance-worker" },
  );

  await queue.scheduleRecurring(
    { job: "silence" },
    {
      jobId: "logstream-silence-minutely",
      intervalSeconds: SILENCE_INTERVAL_SECONDS,
    },
  );
  await queue.scheduleRecurring(
    { job: "rollup" },
    { jobId: "logstream-rollup-hourly", intervalSeconds: ROLLUP_INTERVAL_SECONDS },
  );
  await queue.scheduleRecurring(
    { job: "cleanup" },
    {
      jobId: "logstream-cleanup-daily",
      intervalSeconds: CLEANUP_INTERVAL_SECONDS,
    },
  );

  logger.debug(
    "logstream maintenance jobs scheduled (silence 60s, rollup 1h, cleanup 24h)",
  );
}
