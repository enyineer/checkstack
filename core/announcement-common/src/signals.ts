import { z } from "zod";
import { createSignal } from "@checkstack/signal-common";

/**
 * Broadcast when an announcement is created, updated, or deleted.
 * Frontend components listening to this signal should refetch active announcements.
 */
export const ANNOUNCEMENT_UPDATED = createSignal(
  "announcement.updated",
  z.object({
    announcementId: z.string(),
    action: z.enum(["created", "updated", "deleted"]),
  }),
);
