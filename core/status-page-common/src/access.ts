import { access, accessPair } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Status Pages plugin.
 *
 * Two distinct surfaces with DIFFERENT trust models:
 *
 * - `page.read` / `page.manage` gate the AUTHENTICATED admin builder. Pages are
 *   team-scopable (RLAC): read is team-filtered, manage (create/edit/publish) is
 *   admin or a team with a create-capability grant. NOT public.
 * - `published.read` gates the PUBLIC, anonymous read of a *published* page. It
 *   is default-granted to the anonymous role so visitors can see published
 *   pages; an admin can revoke it from anonymous to switch OFF public status
 *   pages platform-wide without touching the builder. Per-page visibility
 *   (public vs authenticated-only) is enforced in the handler, on top of this.
 */
export const statusPageAccess = {
  page: accessPair(
    "page",
    {
      read: {
        description: "View status page configurations",
        isDefault: true,
      },
      manage: {
        description: "Create, edit, publish, and delete status pages",
      },
    },
    { pluginId: pluginMetadata.pluginId },
  ),
  published: access(
    "published",
    "read",
    "View published status pages (public)",
    {
      pluginId: pluginMetadata.pluginId,
      isDefault: true,
      isPublic: true,
    },
  ),
};

export const statusPageAccessRules = [
  statusPageAccess.page.read,
  statusPageAccess.page.manage,
  statusPageAccess.published,
];
