import type { ScopedQueryRunner } from "@checkstack/backend-api";
import { eq, sql } from "drizzle-orm";
import type { StreamActivity } from "@checkstack/logstream-common";
import * as schema from "../schema";
import { logStreamActivity } from "../schema";

type Runner = ScopedQueryRunner<typeof schema>;

/**
 * Update a stream's single activity row once per flush (NEVER per line):
 * advances `lastReceivedAt`/`lastFlushAt` and stores the latest rate estimate.
 * `silenceEventAt` is owned by the silence-detection job ({@link setSilenceMarker}).
 */
export async function touchStreamActivity({
  runner,
  streamId,
  receivedAt,
  flushAt,
  rateEstimate,
}: {
  runner: Runner;
  streamId: string;
  receivedAt: Date;
  flushAt: Date;
  rateEstimate: number;
}): Promise<void> {
  await runner
    .insert(logStreamActivity)
    .values({
      streamId,
      lastReceivedAt: receivedAt,
      lastFlushAt: flushAt,
      approxRatePerMinute: Math.round(rateEstimate),
    })
    .onConflictDoUpdate({
      target: [logStreamActivity.streamId],
      set: {
        lastReceivedAt: sql`greatest(${logStreamActivity.lastReceivedAt}, excluded.last_received_at)`,
        lastFlushAt: sql`excluded.last_flush_at`,
        approxRatePerMinute: sql`excluded.approx_rate_per_minute`,
      },
    });
}

/**
 * Set (or clear) the silence dedupe marker. The silence-detection job writes
 * the marker when it emits a `silence` event and clears it on recovery, so a
 * stream never emits duplicate silence events.
 */
export async function setSilenceMarker({
  runner,
  streamId,
  silenceEventAt,
}: {
  runner: Runner;
  streamId: string;
  silenceEventAt: Date | null;
}): Promise<void> {
  await runner
    .insert(logStreamActivity)
    .values({ streamId, silenceEventAt })
    .onConflictDoUpdate({
      target: [logStreamActivity.streamId],
      set: { silenceEventAt: sql`excluded.silence_event_at` },
    });
}

/**
 * Add a satellite's in-transit drop count to a stream's running total. Called by
 * the satellite telemetry handler once per stream from a forwarded batch's
 * per-group `droppedByGroup` (log lines the satellite dropped from its bounded
 * buffer during a disconnect / slow-consumer episode - they never reached core).
 * Upserts so a stream that has only ever received via a satellite still gets its
 * row. No-op for a non-positive count.
 */
export async function addInTransitDrops({
  runner,
  streamId,
  dropped,
}: {
  runner: Runner;
  streamId: string;
  dropped: number;
}): Promise<void> {
  if (!Number.isFinite(dropped) || dropped <= 0) return;
  await runner
    .insert(logStreamActivity)
    .values({ streamId, droppedInTransitCount: dropped })
    .onConflictDoUpdate({
      target: [logStreamActivity.streamId],
      set: {
        droppedInTransitCount: sql`${logStreamActivity.droppedInTransitCount} + excluded.dropped_in_transit_count`,
      },
    });
}

/** Read a stream's activity row, or null if it has never received a line. */
export async function readStreamActivity({
  runner,
  streamId,
}: {
  runner: Runner;
  streamId: string;
}): Promise<StreamActivity | null> {
  const [row] = await runner
    .select()
    .from(logStreamActivity)
    .where(eq(logStreamActivity.streamId, streamId))
    .limit(1);
  if (!row) return null;
  return {
    streamId: row.streamId,
    lastReceivedAt: row.lastReceivedAt,
    lastFlushAt: row.lastFlushAt,
    approxRatePerMinute: Number(row.approxRatePerMinute),
    silenceEventAt: row.silenceEventAt,
    droppedInTransitCount: Number(row.droppedInTransitCount),
  };
}
