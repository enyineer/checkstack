import type { SafeDatabase, Logger, ScopedQueryRunner } from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import {
  METRICSTREAM_IMPORTANT_EVENT,
  type ImportantEvent,
  type RecordImportantEventInput,
} from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricImportantEvents } from "../schema";

type Runner = ScopedQueryRunner<typeof schema>;

/**
 * Records viewer-timeline important events (series-cap overflow, scrape failing,
 * silence, silence-recovered) and broadcasts the
 * {@link METRICSTREAM_IMPORTANT_EVENT} signal so open viewers refresh. Used by
 * the ingest/scrape paths (series_cap / scrape_failing) and the maintenance job
 * (silence / silence_recovered).
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
      await runner.insert(metricImportantEvents).values({
        id,
        streamId: input.streamId,
        ts: input.ts,
        type: input.type,
        title: input.title,
        detail: input.detail ?? null,
        createdAt,
      });

      const event: ImportantEvent = {
        id,
        streamId: input.streamId,
        ts: input.ts,
        type: input.type,
        title: input.title,
        detail: input.detail ?? null,
        createdAt,
      };

      try {
        await signalService.broadcast(METRICSTREAM_IMPORTANT_EVENT, {
          streamId: input.streamId,
          type: input.type,
          title: input.title,
        });
      } catch (error) {
        // A broadcast failure must never fail the write path.
        logger.warn(
          `metricstream: failed to broadcast important event: ${String(error)}`,
        );
      }

      return event;
    },
  };
}
