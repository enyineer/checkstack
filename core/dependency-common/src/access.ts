import { access, accessPair } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Dependency plugin.
 */
export const dependencyAccess = {
  /**
   * Dependency access with both read and manage levels.
   *
   * Read is public by default so unauthenticated visitors can still see the
   * dependency *warning* badges/alerts/signals on the catalog and dashboard.
   * It does NOT grant the full topology map - that is gated separately by
   * `dependencyAccess.map` (below).
   */
  dependency: accessPair(
    "dependency",
    {
      read: {
        description: "View dependency warnings on systems and the dashboard",
        isDefault: true,
        isPublic: true,
      },
      manage: {
        description:
          "Manage system dependencies - create, edit, and delete dependency relationships",
      },
    },
    {
      pluginId: pluginMetadata.pluginId,
    },
  ),

  /**
   * Access to the dependency map (the full system-topology graph) - its nav
   * entry, page, and full-graph/canvas endpoints.
   *
   * Authenticated-only BY CONSTRUCTION: the map exposes the entire system
   * topology, so anonymous visitors never get it. No map proc is `public`
   * (see `getAllDependencies` / the node-position procs), which keeps this
   * rule out of the anonymous-usable set - the role editor and auth-backend
   * refuse to grant it to the anonymous role. Authenticated users get it by
   * default (`isDefault`). Per-system dependency warnings stay on the public
   * `dependency.read` rule, so withholding the map does not hide warning
   * badges.
   */
  map: access("map", "read", "View the dependency map (full system topology)", {
    isDefault: true,
    pluginId: pluginMetadata.pluginId,
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const dependencyAccessRules = [
  dependencyAccess.dependency.read,
  dependencyAccess.dependency.manage,
  dependencyAccess.map,
];
