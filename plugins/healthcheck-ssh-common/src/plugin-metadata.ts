import { definePluginMetadata } from "@checkstack/common";

/**
 * Plugin metadata for the SSH Health Check.
 * Shared between backend and collectors that support SSH transport.
 */
export const pluginMetadata = definePluginMetadata({
  pluginId: "healthcheck-ssh",
});
