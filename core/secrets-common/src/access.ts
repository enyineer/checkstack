import { accessPair } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Secrets platform.
 *
 * `read` lets a user see secret NAMES + metadata (never values), e.g. for
 * the `${{ secrets.* }}` editor autocomplete. `manage` lets a user create,
 * rotate, and delete secrets and configure the active backend.
 */
export const secretsAccess = {
  secret: accessPair(
    "secret",
    {
      read: {
        description: "View secret names and metadata (never values)",
        isDefault: true,
      },
      manage: {
        description: "Create, rotate, delete secrets and configure backends",
      },
    },
    {
      pluginId: pluginMetadata.pluginId,
    },
  ),
};

/** All access rules for registration with the plugin system. */
export const secretsAccessRules = [
  secretsAccess.secret.read,
  secretsAccess.secret.manage,
];
