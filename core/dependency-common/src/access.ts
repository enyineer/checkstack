import { accessPair } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Dependency plugin.
 */
export const dependencyAccess = {
  /**
   * Dependency access with both read and manage levels.
   * Read is public by default so all users can see dependency warnings.
   */
  dependency: accessPair(
    "dependency",
    {
      read: {
        description: "View system dependencies and dependency warnings",
        isDefault: true,
        isPublic: true,
      },
      manage: {
        description:
          "Manage system dependencies - create, edit, and delete dependency relationships",
      },
    },
    {
      idParam: "systemId",
      pluginId: pluginMetadata.pluginId,
    },
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const dependencyAccessRules = [
  dependencyAccess.dependency.read,
  dependencyAccess.dependency.manage,
];
