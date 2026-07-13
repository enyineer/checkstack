/**
 * Silence detection. The interval evaluator already computes
 * `secondsSinceLastSample` each tick, so ASSERTIONS decide health for absence.
 * This job's ONLY job is to record the viewer-timeline `silence` /
 * `silence_recovered` important events.
 *
 * Dedup marker: unlike logstream (which carries a `silenceEventAt` column on its
 * activity row), the metric-stream activity table has no marker column, so the
 * CURRENT silence state is derived from the stream's most recent
 * silence/silence_recovered important event. That last-marker read is the dedup
 * source - a stream emits at most one `silence` before a matching
 * `silence_recovered`.
 */

import type { SafeDatabase, Logger } from "@checkstack/backend-api";
import { desc, inArray } from "drizzle-orm";
import type { ImportantEventType } from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricStreamActivity, metricImportantEvents } from "../schema";
import type { ImportantEventRecorder } from "../events/recorder";

type Db = SafeDatabase<typeof schema>;

/** A stream is "silent" after this long with no received datapoints. */
export const SILENCE_THRESHOLD_MS = 15 * 60 * 1000;

export type SilenceAction = "emit_silence" | "emit_recovered" | "none";

/** The two marker event types that drive silence dedup. */
const MARKER_TYPES: ImportantEventType[] = ["silence", "silence_recovered"];

/**
 * Decide, from a stream's activity + its last silence marker, whether to emit a
 * silence event, a recovery, or nothing. Pure. A never-received stream
 * (`lastReceivedAt === null`) is "never active", not silent - no event. The
 * `lastMarker` is the type of the stream's most recent silence/recovered event
 * (`null` when it has none): a `silence` marker means the stream is currently
 * flagged silent.
 */
export function classifySilence({
  lastReceivedAt,
  lastMarker,
  now,
  thresholdMs = SILENCE_THRESHOLD_MS,
}: {
  lastReceivedAt: Date | null;
  lastMarker: ImportantEventType | null;
  now: Date;
  thresholdMs?: number;
}): SilenceAction {
  if (lastReceivedAt === null) return "none";
  const silent = now.getTime() - lastReceivedAt.getTime() >= thresholdMs;
  const flaggedSilent = lastMarker === "silence";
  if (silent && !flaggedSilent) return "emit_silence";
  if (!silent && flaggedSilent) return "emit_recovered";
  return "none";
}

/**
 * Scan every stream's activity row and emit / clear silence events. One stream
 * failing does not abort the others. When a `recorder` is provided the event is
 * written through it (so the METRICSTREAM_IMPORTANT_EVENT signal fires for open
 * viewers); otherwise it is inserted directly (the timeline still updates on the
 * next poll).
 */
export async function runSilenceDetection({
  db,
  recorder,
  logger,
  now = new Date(),
}: {
  db: Db;
  recorder?: ImportantEventRecorder;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  const activityRows = await db
    .select({
      streamId: metricStreamActivity.streamId,
      lastReceivedAt: metricStreamActivity.lastReceivedAt,
    })
    .from(metricStreamActivity);
  if (activityRows.length === 0) return;

  // Latest silence marker per stream in ONE query (DISTINCT ON).
  const markerRows = await db
    .selectDistinctOn([metricImportantEvents.streamId], {
      streamId: metricImportantEvents.streamId,
      type: metricImportantEvents.type,
    })
    .from(metricImportantEvents)
    .where(inArray(metricImportantEvents.type, MARKER_TYPES))
    .orderBy(metricImportantEvents.streamId, desc(metricImportantEvents.ts));
  const lastMarkerByStream = new Map(
    markerRows.map((r) => [r.streamId, r.type]),
  );

  for (const row of activityRows) {
    const action = classifySilence({
      lastReceivedAt: row.lastReceivedAt,
      lastMarker: lastMarkerByStream.get(row.streamId) ?? null,
      now,
    });
    if (action === "none") continue;

    const type: ImportantEventType =
      action === "emit_silence" ? "silence" : "silence_recovered";
    const title =
      action === "emit_silence" ? "Stream went silent" : "Stream resumed";
    const input = {
      streamId: row.streamId,
      ts: now,
      type,
      title,
      detail: { lastReceivedAt: row.lastReceivedAt?.toISOString() ?? null },
    };
    try {
      await (recorder
        ? recorder.record(input)
        : db
            .insert(metricImportantEvents)
            .values({ id: crypto.randomUUID(), createdAt: now, ...input }));
    } catch (error) {
      logger.warn(
        `metricstream silence detection failed for stream ${row.streamId}: ${String(error)}`,
      );
    }
  }
}
