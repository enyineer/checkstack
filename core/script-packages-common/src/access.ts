import { access } from "@checkstack/common";

/**
 * Access rules for the script-packages plugin.
 *
 * Installing npm packages is an install-time RCE / supply-chain vector
 * (postinstall scripts, transitive deps), so management gets its own
 * dedicated, grantable permission (`script-packages.manage`) rather than
 * riding a general role. The read-only editor / runtime endpoints
 * (`getInstallState`, `getManifest`, `downloadBlob`, and the cacheable
 * package-type-closure HTTP route) are gated by the existing
 * script-authoring access so editors and reconcilers can use them; we
 * model that as `script-packages.read`.
 */
export const scriptPackagesAccess = {
  /**
   * Read-only access for editor IntelliSense + runtime reconcilers:
   * desired manifest, install state, blob download, package `.d.ts`.
   */
  read: access(
    "script-packages",
    "read",
    "Read installed script packages, manifest, and types",
  ),

  /**
   * Management access: edit the allowlist, registry config, storage
   * backend, trigger installs / migrations. Dedicated grantable
   * permission because installing packages can execute code at install
   * time.
   */
  manage: access(
    "script-packages",
    "manage",
    "Manage script packages (allowlist, registry, storage, installs)",
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const scriptPackagesAccessRules = [
  scriptPackagesAccess.read,
  scriptPackagesAccess.manage,
];
