import type { SafeDatabase, Logger } from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import {
  LOGSTREAM_IMPORTANT_EVENT,
  type ImportantEvent,
  type RecordImportantEventInput,
} from "@checkstack/logstream-common";
import type { ScopedQueryRunner } from "@checkstack/backend-api";
import * as schema from "../schema";
import { logImportantEvents } from "../schema";

type Runner = ScopedQueryRunner<typeof schema>;

/**
 * Records viewer-timeline important events (new pattern, spike, silence, ...)
 * and broadcasts the {@link LOGSTREAM_IMPORTANT_EVENT} signal so open viewers
 * refresh. Used by both the ingest pipeline (new_pattern / spike) and the
 * health/silence maintenance job (silence / silence_recovered / threshold).
 */
export interface ImportantEventRecorder {
  /**
   * Persist one important event and broadcast its signal. Pass `runner` to
   * compose the insert into an existing flush transaction; the broadcast always
   * happens after the write returns.
   */
  record(
    input: RecordImportantEventInput,
    options?: { runner?: Runner },
  ): Promise<ImportantEvent>;
}

export function createImportantEventRecorder({
  db,
  signalService,
  logger,
}: {
  db: SafeDatabase<typeof schema>;
  signalService: SignalService;
  logger: Logger;
}): ImportantEventRecorder {
  return {
    async record(input, options) {
      const runner = options?.runner ?? db;
      const id = crypto.randomUUID();
      const createdAt = new Date();
      await runner.insert(logImportantEvents).values({
        id,
        streamId: input.streamId,
        ts: input.ts,
        type: input.type,
        severityNumber: input.severityNumber ?? null,
        patternId: input.patternId ?? null,
        title: input.title,
        detail: input.detail ?? null,
        createdAt,
      });

      const event: ImportantEvent = {
        id,
        streamId: input.streamId,
        ts: input.ts,
        type: input.type,
        severityNumber: input.severityNumber ?? null,
        patternId: input.patternId ?? null,
        title: input.title,
        detail: input.detail ?? null,
        createdAt,
      };

      try {
        await signalService.broadcast(LOGSTREAM_IMPORTANT_EVENT, {
          streamId: input.streamId,
          type: input.type,
          title: input.title,
          patternId: input.patternId,
        });
      } catch (error) {
        // A broadcast failure must never fail the write path.
        logger.warn(
          `logstream: failed to broadcast important event: ${String(error)}`,
        );
      }

      return event;
    },
  };
}
