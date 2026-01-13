import { access } from "@checkstack/common";

/**
 * Access rules for the Notification plugin.
 */
export const notificationAccess = {
  /**
   * Configure notification settings and send broadcasts.
   */
  admin: access(
    "notification",
    "manage",
    "Configure notification settings and send broadcasts"
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const notificationAccessRules = [notificationAccess.admin];
