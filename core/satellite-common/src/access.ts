import { accessPair } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Satellite plugin.
 */
export const satelliteAccess = {
  /**
   * Satellite management access with read and manage levels.
   * Read allows viewing satellite list and status.
   * Manage allows creating, deleting, and managing satellites.
   */
  satellite: accessPair(
    "satellite",
    {
      read: {
        description: "View satellite list and status",
      },
      manage: {
        description:
          "Manage satellites - create, delete, and configure satellite nodes",
      },
    },
    {
      pluginId: pluginMetadata.pluginId,
    },
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const satelliteAccessRules = [
  satelliteAccess.satellite.read,
  satelliteAccess.satellite.manage,
];
