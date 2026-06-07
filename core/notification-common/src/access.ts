import { access } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

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
    "Configure notification settings and send broadcasts",
    {
      pluginId: pluginMetadata.pluginId,
    }
  ),
  /**
   * Send transactional notifications and notify subscribers. Granted to
   * service-account identities (e.g. an automation's `runAs`) so they can
   * call `sendTransactional` / `notifyForSubscription` without the broad
   * `admin` capability. Trusted backend services bypass access checks and do
   * not need this rule.
   */
  send: access(
    "notification.send",
    "manage",
    "Send transactional notifications and notify subscribers",
    {
      pluginId: pluginMetadata.pluginId,
    }
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const notificationAccessRules = [
  notificationAccess.admin,
  notificationAccess.send,
];
