import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { announcementAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  AnnouncementSchema,
  CreateAnnouncementInputSchema,
  UpdateAnnouncementInputSchema,
} from "./schemas";

export const announcementContract = {
  // ---------------------------------------------------------------------------
  // Public endpoints
  // ---------------------------------------------------------------------------

  /**
   * Get currently active announcements.
   * Public endpoint — anyone can read active announcements.
   * If the caller is authenticated, dismissed announcements are excluded.
   */
  getActiveAnnouncements: proc({
    operationType: "query",
    userType: "public",
    access: [],
  })
    .input(
      z
        .object({
          /** If true, include dismissed announcements in the result. */
          includeDismissed: z.boolean().optional(),
        })
        .optional(),
    )
    .output(z.object({ announcements: z.array(AnnouncementSchema) })),

  // ---------------------------------------------------------------------------
  // Authenticated user endpoints
  // ---------------------------------------------------------------------------

  /**
   * Dismiss an announcement for the current user.
   * Records a server-side dismissal so the announcement won't appear again.
   */
  dismissAnnouncement: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(z.object({ announcementId: z.string() }))
    .output(z.void()),

  // ---------------------------------------------------------------------------
  // Admin endpoints
  // ---------------------------------------------------------------------------

  /** List all announcements regardless of active/temporal state (admin view). */
  listAllAnnouncements: proc({
    operationType: "query",
    userType: "authenticated",
    access: [announcementAccess.manage],
  }).output(z.object({ announcements: z.array(AnnouncementSchema) })),

  /** Create a new announcement. */
  createAnnouncement: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [announcementAccess.manage],
  })
    .input(CreateAnnouncementInputSchema)
    .output(AnnouncementSchema),

  /** Update an existing announcement. */
  updateAnnouncement: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [announcementAccess.manage],
  })
    .input(UpdateAnnouncementInputSchema)
    .output(AnnouncementSchema),

  /** Delete an announcement permanently. */
  deleteAnnouncement: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [announcementAccess.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),
};

// Export contract type
export type AnnouncementContract = typeof announcementContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(AnnouncementApi);
export const AnnouncementApi = createClientDefinition(
  announcementContract,
  pluginMetadata,
);
