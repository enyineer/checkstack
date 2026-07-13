import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import { ImportantEventTypeSchema } from "./schemas";

/**
 * Broadcast (debounced, >=2s per stream) when a stream flush commits new
 * datapoints. The frontend overview/metrics pages auto-invalidate the
 * `[[metricstream]]` query cache from this so an open viewer refreshes. The
 * `resourceKey` scopes invalidation to the ingesting stream (v2 signal
 * mechanism): a viewer on stream A's detail page must not refetch when stream B
 * ingests. The list page opts its resource-agnostic summaries back into
 * whole-plugin refresh with `meta: { signalScope: "plugin" }`.
 */
export const METRICSTREAM_ACTIVITY = createSignal({
  pluginMetadata,
  event: "activity",
  payloadSchema: z.object({
    streamId: z.string(),
    /** Approximate datapoints committed since the last broadcast (per pod). */
    datapointsDelta: z.number(),
  }),
  resourceKey: (payload) => payload.streamId,
});

/**
 * Broadcast when the recorder writes an important event (series-cap overflow,
 * scrape failing, silence, silence-recovered). Drives the viewer's
 * important-events timeline and any live badges.
 */
export const METRICSTREAM_IMPORTANT_EVENT = createSignal({
  pluginMetadata,
  event: "important_event",
  payloadSchema: z.object({
    streamId: z.string(),
    type: ImportantEventTypeSchema,
    title: z.string(),
  }),
  // Same per-stream scoping as METRICSTREAM_ACTIVITY.
  resourceKey: (payload) => payload.streamId,
});
