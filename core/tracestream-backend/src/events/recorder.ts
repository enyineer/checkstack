import type { Logger } from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import {
  TRACESTREAM_IMPORTANT_EVENT,
  type ImportantEvent,
  type RecordImportantEventInput,
} from "@checkstack/tracestream-common";
import type { ImportantEventStore } from "../storage";

/**
 * Records viewer-timeline important events (silence, silence-recovered,
 * rate-limited, span/service/operation-cap overflow) and broadcasts the
 * {@link TRACESTREAM_IMPORTANT_EVENT} signal so open viewers refresh. Used by
 * the ingest path (cap overflow / rate-limit) and the maintenance job
 * (silence). Mirrors metricstream's recorder, but the persistence goes through
 * the {@link ImportantEventStore} port instead of a bare insert.
 */
export interface ImportantEventRecorder {
  record(input: RecordImportantEventInput): Promise<ImportantEvent>;
}

export function createImportantEventRecorder({
  store,
  signalService,
  logger,
}: {
  store: ImportantEventStore;
  signalService: SignalService;
  logger: Logger;
}): ImportantEventRecorder {
  return {
    async record(input) {
      const event = await store.insert(input);
      try {
        await signalService.broadcast(TRACESTREAM_IMPORTANT_EVENT, {
          streamId: input.streamId,
          type: input.type,
          title: input.title,
        });
      } catch (error) {
        // A broadcast failure must never fail the write path.
        logger.warn(
          `tracestream: failed to broadcast important event: ${String(error)}`,
        );
      }
      return event;
    },
  };
}
