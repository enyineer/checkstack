import { access } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the API Docs plugin.
 */
export const apiDocsAccess = {
  /**
   * View API documentation.
   * Enabled for authenticated users by default.
   */
  view: access("api-docs", "read", "View API Documentation", {
    isDefault: true,
    pluginId: pluginMetadata.pluginId,
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const apiDocsAccessRules = [apiDocsAccess.view];
