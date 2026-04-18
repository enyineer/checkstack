import { accessPair } from "@checkstack/common";

/**
 * Access rules for the SLO plugin.
 */
export const sloAccess = {
  /**
   * SLO access with both read and manage levels.
   * Read is public by default (anyone can view SLO status).
   * Manage requires authentication (create, edit, delete SLOs).
   */
  slo: accessPair("slo", {
    read: {
      description: "View SLOs and error budgets",
      isDefault: true,
      isPublic: true,
    },
    manage: {
      description: "Create, edit, and delete SLOs",
    },
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const sloAccessRules = [sloAccess.slo.read, sloAccess.slo.manage];
