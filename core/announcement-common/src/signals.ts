import { z } from "zod";
import { createSignal } from "@checkstack/signal-common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Broadcast when an announcement is created, updated, or deleted.
 * Frontend components listening to this signal should refetch active announcements.
 */
export const ANNOUNCEMENT_UPDATED = createSignal({
  pluginMetadata,
  event: "updated",
  payloadSchema: z.object({
    announcementId: z.string(),
    action: z.enum(["created", "updated", "deleted"]),
  }),
});
