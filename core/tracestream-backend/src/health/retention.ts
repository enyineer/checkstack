/**
 * Tiered retention + rollup passes for trace streams, following the
 * logstream/metricstream precedent: forward-only, batched, and a minute->hourly
 * op-bucket rollup that folds counts atomically before the minute rows drop.
 * Every pass iterates streams and isolates per-stream failures; all state is in
 * the DB, so any pod may run any pass.
 */

import type { Logger } from "@checkstack/backend-api";
import type { Storage } from "../storage";
import { computeRetentionCutoffs } from "../storage";
import { SWEEP_BATCH } from "./constants";

/** Hourly: fold each stream's aged minute op buckets into hourly. */
export async function runRollupPass({
  storage,
  logger,
  now = new Date(),
}: {
  storage: Storage;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  for (const { streamId, config } of await storage.streams.listPolicies()) {
    const { minuteCutoff } = computeRetentionCutoffs({ config, now });
    try {
      await storage.opBuckets.rollupMinuteToHourly({ streamId, minuteCutoff });
    } catch (error) {
      logger.error(
        `tracestream rollup failed for stream ${streamId}: ${String(error)}`,
      );
    }
  }
}

/**
 * Hourly HOT SWEEP: drop the raw spans of UNRETAINED traces once they age past
 * `hotRetentionHours` (they were never selected for keeping), then delete
 * summaries past `summaryRetentionDays`. Summaries deliberately OUTLIVE the raw
 * spans - they are the lightweight searchable index kept for every trace.
 */
export async function runHotSweepPass({
  storage,
  logger,
  now = new Date(),
}: {
  storage: Storage;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  for (const { streamId, config } of await storage.streams.listPolicies()) {
    const { unretainedSpanCutoff, summaryCutoff } = computeRetentionCutoffs({
      config,
      now,
    });
    try {
      // Spans of unretained traces whose last span aged past the hot window.
      for (;;) {
        const traceIds = await storage.summaries.listUnretainedTracesBefore({
          streamId,
          cutoff: unretainedSpanCutoff,
          limit: SWEEP_BATCH,
        });
        if (traceIds.length === 0) break;
        await storage.spans.deleteSpansOfTraces({ streamId, traceIds });
        if (traceIds.length < SWEEP_BATCH) break;
      }
      await storage.summaries.deleteSummariesBefore({
        streamId,
        cutoff: summaryCutoff,
      });
    } catch (error) {
      logger.error(
        `tracestream hot sweep failed for stream ${streamId}: ${String(error)}`,
      );
    }
  }
}

/**
 * Daily CLEANUP: delete RETAINED spans past `retainedTraceRetentionDays` (by
 * now the unretained spans were hot-swept, so a plain start-time delete only
 * touches retained traces), hourly op buckets past `hourlyRetentionDays`, aged
 * important events, and stale service/operation catalog entries.
 */
export async function runCleanupPass({
  storage,
  logger,
  now = new Date(),
}: {
  storage: Storage;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  for (const { streamId, config } of await storage.streams.listPolicies()) {
    const cutoffs = computeRetentionCutoffs({ config, now });
    try {
      await storage.spans.deleteSpansBefore({
        streamId,
        cutoff: cutoffs.retainedSpanCutoff,
      });
      await storage.opBuckets.deleteHourlyBefore({
        streamId,
        cutoff: cutoffs.hourlyCutoff,
      });
      await storage.importantEvents.deleteBefore({
        streamId,
        cutoff: cutoffs.hourlyCutoff,
      });
      // Phase 3 will protect catalog entries a health check references; for now
      // an entry unseen since the hourly cutoff is dropped.
      await storage.serviceOps.deleteStale({
        streamId,
        cutoff: cutoffs.hourlyCutoff,
      });
    } catch (error) {
      logger.error(
        `tracestream cleanup failed for stream ${streamId}: ${String(error)}`,
      );
    }
  }
}
