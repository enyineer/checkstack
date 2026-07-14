import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Broadcast when a source instance is created, updated, deleted, or its
 * webhook secret rotated. Frontends showing a source list (a stream's Sources
 * tab) auto-invalidate the `[[telemetry]]` query cache; the `resourceKey`
 * scopes invalidation to the changed instance so unrelated editors don't
 * refetch. List queries opt back into whole-plugin refresh with
 * `meta: { signalScope: "plugin" }`.
 */
export const TELEMETRY_SOURCE_CHANGED = createSignal({
  pluginMetadata,
  event: "source_changed",
  payloadSchema: z.object({
    sourceId: z.string(),
  }),
  resourceKey: (payload) => payload.sourceId,
});
