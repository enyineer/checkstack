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
 */
export function createPermission(
  resource: string,
  action: PermissionAction,
  description?: string
): ResourcePermission {
  return {
    id: `${resource}.${action}`,
    resource,
    action,
    description,
  };
}
