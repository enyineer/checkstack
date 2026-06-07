import { access, accessPair } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the GitOps plugin.
 */
export const gitopsAccess = {
  /** Provider management (add/edit/remove Git providers). */
  provider: accessPair(
    "provider",
    {
      read: {
        description: "View GitOps providers and sync status",
        isDefault: true,
      },
      manage: {
        description: "Add, edit, and remove GitOps providers",
      },
    },
    {
      pluginId: pluginMetadata.pluginId,
    },
  ),

  /** Secret management for ${{ secrets.NAME }} template values. */
  secret: accessPair(
    "secret",
    {
      read: {
        description: "View secret names (not values)",
        isDefault: true,
      },
      manage: {
        description: "Create, rotate, and delete secrets",
      },
    },
    {
      pluginId: pluginMetadata.pluginId,
    },
  ),

  /** Kind registry browsing. */
  kinds: {
    read: access("kinds", "read", "View entity kind definitions and schemas", {
      pluginId: pluginMetadata.pluginId,
      isDefault: true,
    }),
  },
};

/**
 * All access rules for registration with the plugin system.
 */
export const gitopsAccessRules = [
  gitopsAccess.provider.read,
  gitopsAccess.provider.manage,
  gitopsAccess.secret.read,
  gitopsAccess.secret.manage,
  gitopsAccess.kinds.read,
];

