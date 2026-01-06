import type { PluginMetadata } from "./plugin-metadata";

/**
 * Supported actions for permissions.
 */
export type PermissionAction = "read" | "manage";

/**
 * Represents a permission that can be assigned to roles.
 */
export interface Permission {
  /** Permission identifier (e.g., "catalog.read") */
  id: string;
  /** Human-readable description of what this permission allows */
  description?: string;
  /** Whether this permission is assigned to the default "users" role (authenticated users) */
  isAuthenticatedDefault?: boolean;
  /** Whether this permission is assigned to the "anonymous" role (public access) */
  isPublicDefault?: boolean;
}

/**
 * Represents a permission tied to a specific resource and action.
 */
export interface ResourcePermission extends Permission {
  /** The resource this permission applies to */
  resource: string;
  /** The action allowed on the resource */
  action: PermissionAction;
}

/**
 * Helper to create a standardized resource permission.
 *
 * @param resource The resource name (e.g., "catalog", "healthcheck")
 * @param action The action (e.g., "read", "manage")
 * @param description Optional human-readable description
 * @param options Additional options like isAuthenticatedDefault and isPublicDefault
 */
export function createPermission(
  resource: string,
  action: PermissionAction,
  description?: string,
  options?: { isAuthenticatedDefault?: boolean; isPublicDefault?: boolean }
): ResourcePermission {
  return {
    id: `${resource}.${action}`,
    resource,
    action,
    description,
    isAuthenticatedDefault: options?.isAuthenticatedDefault,
    isPublicDefault: options?.isPublicDefault,
  };
}

/**
 * Creates a fully-qualified permission ID by prefixing the permission's ID with the plugin ID.
 *
 * This is the canonical way to construct namespaced permission IDs for authorization checks.
 * The function ensures consistent formatting across all permission-related operations.
 *
 * @param pluginMetadata - The plugin metadata containing the pluginId
 * @param permission - The permission object containing the local permission ID
 * @returns The fully-qualified permission ID (e.g., "catalog.catalog.read")
 *
 * @example
 * ```typescript
 * import { qualifyPermissionId } from "@checkmate-monitor/common";
 * import { pluginMetadata } from "./plugin-metadata";
 * import { permissions } from "./permissions";
 *
 * const qualifiedId = qualifyPermissionId(pluginMetadata, permissions.catalogRead);
 * // Returns: "catalog.catalog.read"
 * ```
 */
export function qualifyPermissionId(
  pluginMetadata: Pick<PluginMetadata, "pluginId">,
  permission: Pick<Permission, "id">
): string {
  return `${pluginMetadata.pluginId}.${permission.id}`;
}
