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
 * Dedicated, admin-only access for the GLOBAL script-sandbox policy settings.
 *
 * The global sandbox policy controls how EVERY user-authored script run is
 * confined cluster-wide (resource caps, filesystem confinement, network egress,
 * privilege drop). Loosening it - or disabling it - is a privileged,
 * security-critical operation distinct from managing the package allowlist, so
 * it gets its OWN grantable permission rather than riding `automationAccess.manage`
 * or `script-packages.manage`. Per the maintainer it is admin-only for BOTH read
 * and write: viewing the policy reveals the cluster's exact egress/filesystem
 * posture, so the read endpoint is gated by the same permission as the write.
 *
 * Modeled as a single `manage` level on a dedicated `script-sandbox` resource
 * (the `access` helper supports `read` | `manage`; one admin-only level is the
 * right shape here since read and write share the same gate).
 */
export const scriptSandboxAccess = {
  /**
   * View AND edit the global script-sandbox policy. Admin-only; not granted to
   * regular authenticated users by default.
   */
  manage: access(
    "script-sandbox",
    "manage",
    "View and edit the global script-sandbox policy (resource caps, filesystem, network egress, privilege)",
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const scriptPackagesAccessRules = [
  scriptPackagesAccess.read,
  scriptPackagesAccess.manage,
  scriptSandboxAccess.manage,
];
