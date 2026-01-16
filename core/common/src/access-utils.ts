import type { PluginMetadata } from "./plugin-metadata";

// =============================================================================
// UNIFIED ACCESS CONTROL
// =============================================================================

/**
 * The two fundamental access levels.
 */
export type AccessLevel = "read" | "manage";

/**
 * Configuration for instance-level (team-based) access control.
 * Specifies how to extract resource IDs from requests or responses.
 */
export interface InstanceAccessConfig {
  /**
   * For single-resource endpoints: parameter path in request input to extract resource ID.
   * Uses dot notation for nested params (e.g., "params.systemId").
   */
  idParam?: string;

  /**
   * For list endpoints: key in response object containing the array to filter.
   * When set, post-filters results based on team grants.
   * Example: "systems" for response { systems: [...] }
   */
  listKey?: string;

  /**
   * For bulk record endpoints: key in response containing a Record<resourceId, data>.
   * When set, post-filters the record keys based on team grants.
   * Example: "statuses" for response { statuses: { [systemId]: {...} } }
   */
  recordKey?: string;
}

/**
 * An Access Rule defines WHO can do WHAT to WHICH resources.
 * This is the fundamental building block of the unified access control system.
 *
 * @example
 * ```typescript
 * // Simple access rule (no instance-level checks)
 * const teamsRead = access("teams", "read", "View teams");
 *
 * // With instance-level access (single resource)
 * const systemRead = access("system", "read", "View systems", {
 *   idParam: "systemId",
 * });
 *
 * // With instance-level access (list filtering)
 * const systemListRead = access("system", "read", "View systems", {
 *   listKey: "systems",
 * });
 * ```
 */
export interface AccessRule {
  /**
   * Unique identifier for this rule (e.g., "system.read").
   * Auto-generated from resource + level.
   * This is used as the access rule ID when checking user access rules.
   */
  readonly id: string;

  /**
   * The resource domain (e.g., "system", "healthcheck", "incident").
   * Combined with pluginId to create fully-qualified type for team access checks.
   */
  readonly resource: string;

  /**
   * The access level this rule grants: "read" or "manage".
   * Directly maps to canRead/canManage in team grants.
   */
  readonly level: AccessLevel;

  /**
   * Human-readable description of what this rule allows.
   */
  readonly description: string;

  /**
   * Whether this rule is granted by default to authenticated users ("users" role).
   */
  readonly isDefault?: boolean;

  /**
   * Whether this rule is granted to anonymous/public users ("anonymous" role).
   */
  readonly isPublic?: boolean;

  /**
   * Instance-level (team-based) access configuration.
   * If defined, the middleware will check team grants for specific resource instances.
   * If undefined, only global access is checked.
   */
  readonly instanceAccess?: InstanceAccessConfig;
}

/**
 * Creates a fully-qualified access rule ID by prefixing the rule's ID with the plugin ID.
 *
 * This is the canonical way to construct namespaced access rule IDs for authorization checks.
 * The function ensures consistent formatting across all access-related operations.
 *
 * @param pluginMetadata - The plugin metadata containing the pluginId
 * @param rule - The access rule object containing the local access rule ID
 * @returns The fully-qualified access rule ID (e.g., "catalog.system.read")
 *
 * @example
 * ```typescript
 * import { qualifyAccessRuleId } from "@checkstack/common";
 * import { pluginMetadata } from "./plugin-metadata";
 * import { catalogAccess } from "./access";
 *
 * const qualifiedId = qualifyAccessRuleId(pluginMetadata, catalogAccess.systems.read);
 * // Returns: "catalog.system.read"
 * ```
 */
export function qualifyAccessRuleId(
  pluginMetadata: Pick<PluginMetadata, "pluginId">,
  rule: Pick<AccessRule, "id">
): string {
  return `${pluginMetadata.pluginId}.${rule.id}`;
}

/**
 * Creates an access rule for a resource.
 *
 * @param resource - The resource name (e.g., "system", "incident")
 * @param level - The access level ("read" or "manage")
 * @param description - Human-readable description
 * @param options - Optional configuration for defaults and instance-level access
 * @returns An AccessRule object
 *
 * @example
 * ```typescript
 * // Simple access rule
 * const teamsRead = access("teams", "read", "View teams");
 *
 * // With defaults for public access
 * const statusRead = access("status", "read", "View status", {
 *   isDefault: true,
 *   isPublic: true,
 * });
 *
 * // With instance-level access
 * const systemRead = access("system", "read", "View systems", {
 *   idParam: "systemId",
 *   listKey: "systems",
 *   isDefault: true,
 *   isPublic: true,
 * });
 * ```
 */
export function access(
  resource: string,
  level: AccessLevel,
  description: string,
  options?: {
    idParam?: string;
    listKey?: string;
    recordKey?: string;
    isDefault?: boolean;
    isPublic?: boolean;
  }
): AccessRule {
  const hasInstanceAccess =
    options?.idParam || options?.listKey || options?.recordKey;

  return {
    id: `${resource}.${level}`,
    resource,
    level,
    description,
    isDefault: options?.isDefault,
    isPublic: options?.isPublic,
    instanceAccess: hasInstanceAccess
      ? {
          idParam: options?.idParam,
          listKey: options?.listKey,
          recordKey: options?.recordKey,
        }
      : undefined,
  };
}

/**
 * Creates a read/manage pair for a resource.
 * Most resources need both access levels, so this reduces boilerplate.
 *
 * @param resource - The resource name (e.g., "system", "incident")
 * @param descriptions - Descriptions for read and manage levels
 * @param options - Optional configuration for defaults and instance-level access
 * @returns An object with `read` and `manage` AccessRule properties
 *
 * @example
 * ```typescript
 * const systemAccess = accessPair("system", {
 *   read: "View systems",
 *   manage: "Create, update, and delete systems",
 * }, {
 *   idParam: "systemId",
 *   listKey: "systems",
 *   readIsDefault: true,
 *   readIsPublic: true,
 * });
 *
 * // Usage in contract:
 * getSystem: _base.meta({ access: [systemAccess.read] }),
 * updateSystem: _base.meta({ access: [systemAccess.manage] }),
 * ```
 */
export function accessPair(
  resource: string,
  descriptions: { read: string; manage: string },
  options?: {
    idParam?: string;
    listKey?: string;
    recordKey?: string;
    readIsDefault?: boolean;
    readIsPublic?: boolean;
  }
): { read: AccessRule; manage: AccessRule } {
  return {
    read: access(resource, "read", descriptions.read, {
      idParam: options?.idParam,
      listKey: options?.listKey,
      recordKey: options?.recordKey,
      isDefault: options?.readIsDefault,
      isPublic: options?.readIsPublic,
    }),
    manage: access(resource, "manage", descriptions.manage, {
      idParam: options?.idParam,
      // Note: manage doesn't typically use listKey (you don't "manage" a list in bulk)
      // but we include idParam for single-resource manage checks
    }),
  };
}
