import { definePluginMetadata } from "@checkstack/common";

/**
 * Plugin metadata for the dependency plugin.
 * Exported from the common package so both backend and frontend can reference it.
 */
export const pluginMetadata = definePluginMetadata({
  pluginId: "dependency",
});
