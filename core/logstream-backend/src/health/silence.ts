/**
 * Silence detection. The interval evaluator already computes
 * `secondsSinceLastLog` each tick, so ASSERTIONS decide health for absence.
 * This job's ONLY job is to record the viewer-timeline `silence` /
 * `silence_recovered` important events, deduped via the activity row's
 * `silenceEventAt` marker so a stream never emits duplicate silence events.
 */

import type { SafeDatabase, Logger } from "@checkstack/backend-api";
import * as schema from "../schema";
import { logStreamActivity } from "../schema";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";

type Db = SafeDatabase<typeof schema>;

/** A stream is "silent" after this long with no received lines. */
export const SILENCE_THRESHOLD_MS = 15 * 60 * 1000;

export type SilenceAction = "emit_silence" | "emit_recovered" | "none";

/**
 * Decide, from an activity row, whether to emit a silence event, a recovery, or
 * nothing. Pure. A never-received stream (`lastReceivedAt === null`) is "never
 * active", not silent - it produces no event.
 */
export function classifySilence({
  lastReceivedAt,
  silenceEventAt,
  now,
  thresholdMs = SILENCE_THRESHOLD_MS,
}: {
  lastReceivedAt: Date | null;
  silenceEventAt: Date | null;
  now: Date;
  thresholdMs?: number;
}): SilenceAction {
  if (lastReceivedAt === null) return "none";
  const silent = now.getTime() - lastReceivedAt.getTime() >= thresholdMs;
  if (silent && silenceEventAt === null) return "emit_silence";
  if (!silent && silenceEventAt !== null) return "emit_recovered";
  return "none";
}

/**
 * Scan every stream's activity row and emit / clear silence events. One stream
 * failing does not abort the others.
 */
export async function runSilenceDetection({
  db,
  storage,
  recorder,
  logger,
  now = new Date(),
}: {
  db: Db;
  storage: Storage;
  recorder: ImportantEventRecorder;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  const rows = await db
    .select({
      streamId: logStreamActivity.streamId,
      lastReceivedAt: logStreamActivity.lastReceivedAt,
      silenceEventAt: logStreamActivity.silenceEventAt,
    })
    .from(logStreamActivity);

  for (const row of rows) {
    const action = classifySilence({
      lastReceivedAt: row.lastReceivedAt,
      silenceEventAt: row.silenceEventAt,
      now,
    });
    if (action === "none") continue;

    try {
      if (action === "emit_silence") {
        await recorder.record({
          streamId: row.streamId,
          ts: now,
          type: "silence",
          title: "Stream went silent",
          detail: {
            lastReceivedAt: row.lastReceivedAt?.toISOString() ?? null,
          },
        });
        await storage.setSilenceMarker({
          runner: db,
          streamId: row.streamId,
          silenceEventAt: now,
        });
      } else {
        await recorder.record({
          streamId: row.streamId,
          ts: now,
          type: "silence_recovered",
          title: "Stream resumed",
          detail: {
            lastReceivedAt: row.lastReceivedAt?.toISOString() ?? null,
          },
        });
        await storage.setSilenceMarker({
          runner: db,
          streamId: row.streamId,
          silenceEventAt: null,
        });
      }
    } catch (error) {
      logger.warn(
        `logstream silence detection failed for stream ${row.streamId}: ${String(error)}`,
      );
    }
  }
}
