import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import { ImportantEventTypeSchema } from "./schemas";

/**
 * Broadcast (debounced, >=2s per stream) when a stream commits newly assembled
 * spans. The frontend overview/search pages auto-invalidate the
 * `[[tracestream]]` query cache from this so an open viewer refreshes. The
 * `resourceKey` scopes invalidation to the ingesting stream (v2 signal
 * mechanism): a viewer on stream A's detail page must not refetch when stream B
 * ingests. The list page opts its resource-agnostic summaries back into
 * whole-plugin refresh with `meta: { signalScope: "plugin" }`.
 */
export const TRACESTREAM_ACTIVITY = createSignal({
  pluginMetadata,
  event: "activity",
  payloadSchema: z.object({
    streamId: z.string(),
    /** Approximate spans committed since the last broadcast (per pod). */
    spansDelta: z.number(),
  }),
  resourceKey: (payload) => payload.streamId,
});

/**
 * Broadcast when the recorder writes an important event (silence,
 * silence-recovered, rate-limited, span/service/operation-cap overflow). Drives
 * the viewer's important-events timeline and any live badges.
 */
export const TRACESTREAM_IMPORTANT_EVENT = createSignal({
  pluginMetadata,
  event: "important_event",
  payloadSchema: z.object({
    streamId: z.string(),
    type: ImportantEventTypeSchema,
    title: z.string(),
  }),
  // Same per-stream scoping as TRACESTREAM_ACTIVITY.
  resourceKey: (payload) => payload.streamId,
});
