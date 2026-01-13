import { access } from "@checkstack/common";

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
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const apiDocsAccessRules = [apiDocsAccess.view];
