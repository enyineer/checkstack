import { definePluginMetadata } from "@checkstack/common";

/**
 * Plugin metadata for the script-packages plugin.
 * Exported from the common package so backend, frontend, and reconcilers
 * can reference the same id.
 */
export const pluginMetadata = definePluginMetadata({
  pluginId: "script-packages",
});
