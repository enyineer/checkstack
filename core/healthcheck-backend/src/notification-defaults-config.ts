/**
 * Versioned schema used by `ConfigService` to persist platform-wide
 * notification defaults. The shape is the runtime `NotificationPolicy`
 * itself — each field has a built-in compile-time default so an empty
 * stored value still parses to a valid policy.
 */
export { NotificationPolicySchema as notificationDefaultsConfigV1 } from "@checkstack/healthcheck-common";

export const NOTIFICATION_DEFAULTS_CONFIG_ID = "healthcheck.notification-defaults";
export const NOTIFICATION_DEFAULTS_CONFIG_VERSION = 1;
