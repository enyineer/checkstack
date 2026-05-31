import { definePluginMetadata } from "@checkstack/common";

/**
 * Plugin metadata for the Secrets platform. Exported from common so both
 * backend and frontend reference the same `pluginId`.
 */
export const pluginMetadata = definePluginMetadata({
  pluginId: "secrets",
});
