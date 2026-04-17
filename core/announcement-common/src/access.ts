import { access } from "@checkstack/common";

/**
 * Access rules for the Announcement plugin.
 * Announcements don't use instance-level access (no teams/resource filtering).
 * Only a single "manage" rule is needed — reading active announcements is public.
 */
export const announcementAccess = {
  /** Manage announcements — create, edit, and delete. Admin-only. */
  manage: access(
    "announcement",
    "manage",
    "Manage announcements — create, edit, and delete",
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const announcementAccessRules = [announcementAccess.manage];
