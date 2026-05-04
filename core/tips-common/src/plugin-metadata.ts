import { definePluginMetadata } from "@checkstack/common";

/**
 * Plugin metadata for the tips plugin.
 * Powers the per-user dismissable tip infrastructure used by all frontends.
 */
export const pluginMetadata = definePluginMetadata({
  pluginId: "tips",
});
