import { definePluginMetadata } from "@checkstack/common";

/**
 * Plugin metadata for the infrastructure plugin.
 * This is the single source of truth for the plugin ID.
 */
export const pluginMetadata = definePluginMetadata({
  pluginId: "infrastructure",
});
