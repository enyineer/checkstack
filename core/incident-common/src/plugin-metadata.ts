import { definePluginMetadata } from "@checkmate-monitor/common";

/**
 * Plugin metadata for the incident plugin.
 * Exported from the common package so both backend and frontend can reference it.
 */
export const pluginMetadata = definePluginMetadata({
  pluginId: "incident",
});
