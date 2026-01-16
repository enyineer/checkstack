// =============================================================================
// RPC PROCEDURE METADATA
// =============================================================================

import type { AccessRule } from "./access-utils";

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
 *       access: [myPluginAccess.items.read]
 *     })
 *     .output(z.array(ItemSchema)),
 * };
 */
export interface ProcedureMetadata {
  /**
   * Which type of caller can access this endpoint.
   * - "anonymous": No authentication required, no access checks (fully public)
   * - "public": Anyone can attempt, but access rules are checked (uses anonymous role for guests)
   * - "user": Only real users (frontend authenticated)
   * - "service": Only services (backend-to-backend)
   * - "authenticated": Either users or services, but must be authenticated (default)
   */
  userType: "anonymous" | "public" | "user" | "service" | "authenticated";

  /**
   * Operation type for TanStack Query integration.
   * - "query": Read-only operation, uses useQuery hook
   * - "mutation": Write operation, uses useMutation hook
   *
   * This is REQUIRED for all procedures to enable type-safe frontend hooks.
   */
  operationType: "query" | "mutation";

  /**
   * Unified access rules combining access rules and resource-level access control.
   * Each rule specifies the access rule ID, access level, and optional instance-level checks.
   *
   * User must satisfy ALL rules (AND logic).
   *
   * @example
   * ```typescript
   * access: [catalogAccess.systems.read]
   * access: [catalogAccess.systems.manage]
   * access: [catalogAccess.groups.manage, catalogAccess.systems.manage] // Both required
   * ```
   */
  access: AccessRule[];
}
