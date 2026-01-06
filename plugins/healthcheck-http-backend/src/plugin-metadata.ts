import { definePluginMetadata } from "@checkmate-monitor/common";

/**
 * Plugin metadata for the HTTP Health Check backend.
 * This is the single source of truth for the plugin ID.
 */
export const pluginMetadata = definePluginMetadata({
  pluginId: "healthcheck-http",
});
