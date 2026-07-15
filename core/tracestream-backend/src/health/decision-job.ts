/**
 * The tail-sampling DECISION pass. For each stream it pages the traces that have
 * SETTLED (undecided + no span within the completion grace) and writes the
 * retain/drop verdict from the pure {@link decideRetention} policy. Because the
 * policy is a deterministic function of the trace's own fields (error, duration,
 * a stable hash of the trace id) and the per-hour retained tally is read back
 * from the DB, a re-run reaches the SAME verdict for an already-decided trace
 * (it is no longer "undecided", so it is not even re-read) - the pass is safe to
 * retry and safe to run on any pod.
 */

import type { Logger } from "@checkstack/backend-api";
import type { TraceStreamConfig } from "@checkstack/tracestream-common";
import type { Storage } from "../storage";
import { decideRetention, floorToHour } from "../storage";
import { DECISION_BATCH } from "./constants";

/** Decide one stream's settled-but-undecided traces. */
export async function decideStream({
  storage,
  streamId,
  config,
  now,
  batchSize = DECISION_BATCH,
}: {
  storage: Storage;
  streamId: string;
  config: TraceStreamConfig;
  now: Date;
  batchSize?: number;
}): Promise<{ retained: number; dropped: number }> {
  const olderThan = new Date(
    now.getTime() - config.completionGraceSeconds * 1000,
  );
  const cap = config.sampling.maxRetainedTracesPerHour;
  let retained = 0;
  let dropped = 0;

  for (;;) {
    const candidates = await storage.summaries.listUndecidedReadyForDecision({
      streamId,
      olderThan,
      limit: batchSize,
    });
    if (candidates.length === 0) break;

    // Seed the per-hour budget from already-retained traces in the covered
    // hours (only needed when a ceiling is configured).
    const retainedByHour =
      cap === null
        ? undefined
        : await storage.summaries.countRetainedByHour({
            streamId,
            hourStarts: [
              ...new Set(candidates.map((c) => floorToHour(c.startTs).getTime())),
            ].map((ms) => new Date(ms)),
          });

    const verdicts = decideRetention({
      candidates,
      sampling: config.sampling,
      retainedByHour,
    });
    const keepIds = verdicts.filter((v) => v.retained).map((v) => v.traceId);
    const dropIds = verdicts.filter((v) => !v.retained).map((v) => v.traceId);

    await storage.summaries.markDecided({
      streamId,
      traceIds: keepIds,
      retained: true,
      decidedAt: now,
    });
    await storage.summaries.markDecided({
      streamId,
      traceIds: dropIds,
      retained: false,
      decidedAt: now,
    });
    retained += keepIds.length;
    dropped += dropIds.length;

    if (candidates.length < batchSize) break;
  }
  return { retained, dropped };
}

/** Run the decision pass across every stream. One stream's failure is isolated. */
export async function runDecisionPass({
  storage,
  logger,
  now = new Date(),
}: {
  storage: Storage;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  for (const { streamId, config } of await storage.streams.listPolicies()) {
    try {
      await decideStream({ storage, streamId, config, now });
    } catch (error) {
      logger.error(
        `tracestream decision failed for stream ${streamId}: ${String(error)}`,
      );
    }
  }
}
