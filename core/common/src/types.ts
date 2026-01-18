// =============================================================================
// RPC PROCEDURE METADATA
// =============================================================================

import type { AccessRule, InstanceAccessConfig } from "./access-utils";

// =============================================================================
// EDITOR TYPES - Used for multi-type editor fields
// =============================================================================

/**
 * Available editor types for multi-type editor fields.
 * Used with x-editor-types to define which editor modes are available in DynamicForm.
 *
 * - "none": Field is disabled/empty
 * - "raw": Multi-line textarea (plain text)
 * - "json": CodeEditor with JSON syntax highlighting
 * - "yaml": CodeEditor with YAML syntax highlighting
 * - "xml": CodeEditor with XML syntax highlighting
 * - "markdown": CodeEditor with Markdown syntax highlighting
 * - "formdata": Key/value pair editor (URL-encoded)
 */
export type EditorType =
  | "none"
  | "raw"
  | "json"
  | "yaml"
  | "xml"
  | "markdown"
  | "formdata";

/**
 * Qualifies a resource type with the plugin namespace.
 * @param pluginId - The plugin identifier
 * @param resourceType - The unqualified resource type
 * @returns Qualified resource type (e.g., "catalog.system")
 */
export function qualifyResourceType(
  pluginId: string,
  resourceType: string,
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

  /**
   * Override the instance access configuration from the access rules.
   * Use this when a procedure needs different instance access handling than
   * what's defined on its access rules.
   *
   * This is useful for bulk endpoints that share the same permission as single endpoints
   * but use recordKey instead of idParam for filtering.
   *
   * @example
   * ```typescript
   * // Single endpoint using idParam from access rule
   * getIncidentsForSystem: proc({
   *   userType: "public",
   *   operationType: "query",
   *   access: [incidentAccess.incident.read], // has idParam: "systemId"
   * })
   *
   * // Bulk endpoint overriding to use recordKey
   * getBulkIncidentsForSystems: proc({
   *   userType: "public",
   *   operationType: "query",
   *   access: [incidentAccess.incident.read], // same access rule
   *   instanceAccess: { recordKey: "incidents" }, // override for bulk
   * })
   * ```
   */
  instanceAccess?: InstanceAccessConfig;
}
