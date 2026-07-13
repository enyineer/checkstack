import type { ScopedQueryRunner } from "@checkstack/backend-api";
import { eq, sql } from "drizzle-orm";
import type { StreamActivity } from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricStreamActivity } from "../schema";

type Runner = ScopedQueryRunner<typeof schema>;

/**
 * Update a stream's single activity row once per flush (NEVER per datapoint):
 * advances `lastReceivedAt`, stores the latest rate estimate, and ADDS the
 * flush's dropped-series / dropped-datapoint counts to the running totals.
 */
export async function touchStreamActivity({
  runner,
  streamId,
  receivedAt,
  rateEstimate,
  droppedSeries = 0,
  droppedDatapoints = 0,
}: {
  runner: Runner;
  streamId: string;
  receivedAt: Date;
  rateEstimate: number;
  droppedSeries?: number;
  droppedDatapoints?: number;
}): Promise<void> {
  await runner
    .insert(metricStreamActivity)
    .values({
      streamId,
      lastReceivedAt: receivedAt,
      approxDatapointsPerMinute: Math.round(rateEstimate),
      droppedSeriesCount: droppedSeries,
      droppedDatapointsCount: droppedDatapoints,
    })
    .onConflictDoUpdate({
      target: [metricStreamActivity.streamId],
      set: {
        lastReceivedAt: sql`greatest(${metricStreamActivity.lastReceivedAt}, excluded.last_received_at)`,
        approxDatapointsPerMinute: sql`excluded.approx_datapoints_per_minute`,
        droppedSeriesCount: sql`${metricStreamActivity.droppedSeriesCount} + excluded.dropped_series_count`,
        droppedDatapointsCount: sql`${metricStreamActivity.droppedDatapointsCount} + excluded.dropped_datapoints_count`,
      },
    });
}

/**
 * Add a satellite's in-transit drop count to a stream's running total. Called by
 * the satellite telemetry handlers once per stream from a forwarded batch's
 * per-group `droppedByGroup` (telemetry the satellite dropped from its bounded
 * buffer during a disconnect / slow-consumer episode - it never reached core).
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
    .insert(metricStreamActivity)
    .values({ streamId, droppedInTransitCount: dropped })
    .onConflictDoUpdate({
      target: [metricStreamActivity.streamId],
      set: {
        droppedInTransitCount: sql`${metricStreamActivity.droppedInTransitCount} + excluded.dropped_in_transit_count`,
      },
    });
}

/** Read a stream's activity row, or null if it has never received a datapoint. */
export async function readStreamActivity({
  runner,
  streamId,
}: {
  runner: Runner;
  streamId: string;
}): Promise<StreamActivity | null> {
  const [row] = await runner
    .select()
    .from(metricStreamActivity)
    .where(eq(metricStreamActivity.streamId, streamId))
    .limit(1);
  if (!row) return null;
  return {
    streamId: row.streamId,
    lastReceivedAt: row.lastReceivedAt,
    approxDatapointsPerMinute: Number(row.approxDatapointsPerMinute),
    droppedSeriesCount: Number(row.droppedSeriesCount),
    droppedDatapointsCount: Number(row.droppedDatapointsCount),
    droppedInTransitCount: Number(row.droppedInTransitCount),
  };
}
