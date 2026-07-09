import { definePluginMetadata } from "@checkstack/common";

/**
 * Plugin metadata for the Notification Webhook backend.
 * This is the single source of truth for the plugin ID.
 */
export const pluginMetadata = definePluginMetadata({
  pluginId: "notification-webhook",
});
