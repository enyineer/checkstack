import { accessPair } from "@checkstack/common";

/**
 * Access rules for the GitOps plugin.
 */
export const gitopsAccess = {
  /** Provider management (add/edit/remove Git providers). */
  provider: accessPair("provider", {
    read: {
      description: "View GitOps providers and sync status",
      isDefault: true,
    },
    manage: {
      description: "Add, edit, and remove GitOps providers",
    },
  }),

  /** Secret management for secretRef values. */
  secret: accessPair("secret", {
    read: {
      description: "View secret names (not values)",
      isDefault: true,
    },
    manage: {
      description: "Create, rotate, and delete secrets",
    },
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const gitopsAccessRules = [
  gitopsAccess.provider.read,
  gitopsAccess.provider.manage,
  gitopsAccess.secret.read,
  gitopsAccess.secret.manage,
];
