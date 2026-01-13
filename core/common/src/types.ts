// =============================================================================
// RPC PROCEDURE METADATA
// =============================================================================

/**
 * Configuration for resource-level access control.
 * Used to enforce fine-grained permissions based on team grants.
 */
export interface ResourceAccessConfig {
  /**
   * The resource type identifier (e.g., "system", "healthcheck").
   * Will be auto-prefixed with pluginId in middleware (e.g., "catalog.system").
   */
  resourceType: string;

  /**
   * Parameter name in request input to extract resource ID from.
   * Uses dot notation for nested params (e.g., "params.id").
   * Required for single-resource access checks.
   */
  idParam?: string;

  /**
   * Filter mode for list endpoints.
   * - "single": Check access to a single resource (default)
   * - "list": Post-filter result array based on team access
   */
  filterMode?: "single" | "list";

  /**
   * Key in response object containing the array to filter.
   * Required when filterMode is "list".
   * Example: "systems" for response { systems: [...] }
   */
  outputKey?: string;
}

/**
 * Creates a ResourceAccessConfig for single-resource access checks.
 *
 * @param resourceType - The resource type (auto-prefixed with pluginId)
 * @param idParam - Parameter path in input to extract resource ID from
 */
export function createResourceAccess(
  resourceType: string,
  idParam: string
): ResourceAccessConfig {
  return { resourceType, idParam, filterMode: "single" };
}

/**
 * Creates a ResourceAccessConfig for list filtering.
 *
 * @param resourceType - The resource type (auto-prefixed with pluginId)
 * @param outputKey - Key in response object containing the array to filter
 */
export function createResourceAccessList(
  resourceType: string,
  outputKey: string
): ResourceAccessConfig {
  return { resourceType, filterMode: "list", outputKey };
}

/**
 * Qualifies a resource type with the plugin namespace.
 * @param pluginId - The plugin identifier
 * @param resourceType - The unqualified resource type
 * @returns Qualified resource type (e.g., "catalog.system")
 */
export function qualifyResourceType(
  pluginId: string,
  resourceType: string
): string {
  // If already qualified (contains a dot), return as-is
  if (resourceType.includes(".")) return resourceType;
  return `${pluginId}.${resourceType}`;
}

/**
 * Metadata interface for RPC procedures.
 * Used by contracts to define auth requirements and by backend middleware to enforce them.
 *
 * @example
 * const contract = {
 *   getItems: baseContractBuilder
 *     .meta({
 *       userType: "user",
 *       permissions: [permissions.myPluginRead.id]
 *     })
 *     .output(z.array(ItemSchema)),
 * };
 */
export interface ProcedureMetadata {
  /**
   * Which type of caller can access this endpoint.
   * - "anonymous": No authentication required, no permission checks (fully public)
   * - "public": Anyone can attempt, but permissions are checked (uses anonymous role for guests)
   * - "user": Only real users (frontend authenticated)
   * - "service": Only services (backend-to-backend)
   * - "authenticated": Either users or services, but must be authenticated (default)
   */
  userType?: "anonymous" | "public" | "user" | "service" | "authenticated";

  /**
   * Permissions required to access this endpoint.
   * Only enforced for real users - services are trusted.
   * For "public" userType, permissions are checked against the anonymous role if not authenticated.
   * User must have at least one of the listed permissions, or "*" (wildcard).
   */
  permissions?: string[];

  /**
   * Resource-level access control configurations.
   * When specified, middleware checks team-based grants for the resources.
   */
  resourceAccess?: ResourceAccessConfig[];
}
