import { access, accessPair } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the GitOps plugin.
 */
export const gitopsAccess = {
  /**
   * Provider management (add/edit/remove Git providers). NOT a default:
   * regular users don't need the GitOps page (which gates on `read`);
   * grant `provider.read` explicitly to roles that should see it.
   */
  provider: accessPair(
    "provider",
    {
      read: {
        description: "View GitOps providers and sync status",
      },
      manage: {
        description: "Add, edit, and remove GitOps providers",
      },
    },
    {
      pluginId: pluginMetadata.pluginId,
    },
  ),

  /**
   * Secret management for ${{ secrets.NAME }} template values. NOT a default:
   * the secrets list lives on the GitOps page, which regular users don't see.
   */
  secret: accessPair(
    "secret",
    {
      read: {
        description: "View secret names (not values)",
      },
      manage: {
        description: "Create, rotate, and delete secrets",
      },
    },
    {
      pluginId: pluginMetadata.pluginId,
    },
  ),

  /**
   * Read-only provenance lookups (is this entity GitOps-managed, and from
   * where?). A DEFAULT rule, deliberately separate from `provider.read`: the
   * provenance-lock indicators in the catalog/dependency/health-check editors
   * need `getProvenance`/`listProvenance` for every editing user, while the
   * GitOps PAGE (providers, sync status, secrets) stays admin-granted.
   */
  provenance: {
    read: access(
      "provenance",
      "read",
      "View GitOps provenance (which entities are managed from Git)",
      {
        pluginId: pluginMetadata.pluginId,
        isDefault: true,
      },
    ),
  },

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
  gitopsAccess.provenance.read,
  gitopsAccess.kinds.read,
];

