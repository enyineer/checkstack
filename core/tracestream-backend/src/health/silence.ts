/**
 * Silence detection. Records the viewer-timeline `silence` / `silence_recovered`
 * important events. Like metricstream, the CURRENT silence state is derived from
 * the stream's most recent silence/recovered marker event (the activity table
 * has no marker column), so a stream emits at most one `silence` before a
 * matching `silence_recovered`.
 */

import type { Logger } from "@checkstack/backend-api";
import type { ImportantEventType } from "@checkstack/tracestream-common";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import { SILENCE_THRESHOLD_MS } from "./constants";

export type SilenceAction = "emit_silence" | "emit_recovered" | "none";

/** The marker event types that drive silence dedup. */
const MARKER_TYPES: ImportantEventType[] = ["silence", "silence_recovered"];

/**
 * Decide, from a stream's last-received time + its last silence marker, whether
 * to emit a silence event, a recovery, or nothing. Pure. A never-received stream
 * (`lastReceivedAt === null`) is "never active", not silent. `lastMarker` is the
 * type of the stream's most recent silence/recovered event (`null` when none);
 * a `silence` marker means the stream is currently flagged silent.
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
 * Scan every stream's activity and emit / clear silence events. One stream
 * failing does not abort the others. Events go through the recorder so the live
 * TRACESTREAM_IMPORTANT_EVENT signal fires for open viewers.
 */
export async function runSilenceDetection({
  storage,
  recorder,
  logger,
  now = new Date(),
}: {
  storage: Storage;
  recorder: ImportantEventRecorder;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  const activity = await storage.activity.listActivity();
  if (activity.length === 0) return;

  const lastMarker = await storage.importantEvents.lastMarkerByStream({
    types: MARKER_TYPES,
  });

  for (const row of activity) {
    const action = classifySilence({
      lastReceivedAt: row.lastReceivedAt,
      lastMarker:
        (lastMarker.get(row.streamId) as ImportantEventType | undefined) ??
        null,
      now,
    });
    if (action === "none") continue;

    const type: ImportantEventType =
      action === "emit_silence" ? "silence" : "silence_recovered";
    const title =
      action === "emit_silence" ? "Stream went silent" : "Stream resumed";
    try {
      await recorder.record({
        streamId: row.streamId,
        ts: now,
        type,
        title,
        detail: { lastReceivedAt: row.lastReceivedAt?.toISOString() ?? null },
      });
    } catch (error) {
      logger.warn(
        `tracestream silence detection failed for stream ${row.streamId}: ${String(error)}`,
      );
    }
  }
}
