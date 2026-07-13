import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import { ImportantEventTypeSchema } from "./schemas";

/**
 * Broadcast (debounced, >=2s per stream) when a stream flush commits new lines.
 * The frontend explorer/overview auto-invalidates the `[[logstream]]` query
 * cache from this so an open viewer refreshes its newest page. Debouncing keeps
 * a high-volume stream from flooding the signal bus.
 */
export const LOGSTREAM_ACTIVITY = createSignal({
  pluginMetadata,
  event: "activity",
  payloadSchema: z.object({
    streamId: z.string(),
    /** Approximate lines committed since the last broadcast (per pod). */
    linesDelta: z.number(),
    /** Worst severity band seen in this flush window. */
    worstBand: z.string(),
  }),
  // Scope invalidation to the ingesting stream: a viewer on stream A's detail
  // page must not refetch when stream B ingests. The list page opts its
  // resource-agnostic summaries back in with `meta: { signalScope: "plugin" }`.
  resourceKey: (payload) => payload.streamId,
});

/**
 * Broadcast when the recorder writes an important event (new pattern, spike,
 * silence, silence-recovered, threshold). Drives the viewer's important-events
 * timeline and any live badges.
 */
export const LOGSTREAM_IMPORTANT_EVENT = createSignal({
  pluginMetadata,
  event: "important_event",
  payloadSchema: z.object({
    streamId: z.string(),
    type: ImportantEventTypeSchema,
    title: z.string(),
    patternId: z.string().optional(),
  }),
  // Same per-stream scoping as LOGSTREAM_ACTIVITY.
  resourceKey: (payload) => payload.streamId,
});
