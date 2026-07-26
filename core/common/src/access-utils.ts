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
   * Explicit opt-out of instance (team) scoping: this endpoint is INTENTIONALLY
   * gated only by its global access rule, with no per-resource team check.
   *
   * This exists so the boot validator can tell "the author forgot to scope a
   * team-scopable endpoint" (a fail-open hazard) from "the author deliberately
   * left it global". An endpoint whose access rule names a team-scopable resource
   * type MUST declare exactly one instanceAccess mode — `idParam`/`listKey`/
   * `recordKey`/`create` to scope it, or `global: true` to assert it is meant to
   * be unscoped. `global` is mutually exclusive with the other modes.
   */
  global?: boolean;

  /**
   * Scope this endpoint by access to a PARENT resource type (a cross-plugin,
   * single-hop delegation) instead of by grants on this endpoint's own resource
   * type. Use this for "for-system" reads: "you may see incidents/maintenances/
   * SLOs/health for system X iff you may see system X". The endpoint's own
   * `access` rule stays the feature-level global gate; `parentScope` adds the
   * per-resource decision against the parent (e.g. `catalog.system`).
   *
   * The parent's own grants and its global rule (`{resourceType}.{action}`) are
   * consulted via the same auth engine used for native scoping, so a team grant
   * on the parent system flows through. Exactly one of `idParam` / `recordKey`
   * is set (pre-check vs post-filter); `parentScope` is itself one top-level
   * mode (mutually exclusive with idParam/listKey/recordKey/create/global).
   */
  parentScope?: {
    /** Qualified parent resource type, e.g. "catalog.system". */
    resourceType: string;
    /** Required access level on the parent. Defaults to "read". */
    action?: "read" | "manage";
    /**
     * Single/multi pre-check: input path to the parent id, or an array of parent
     * ids (dot notation). The caller must have `action` access to ALL of them or
     * the call is denied (403).
     */
    idParam?: string;
    /**
     * Bulk post-filter: output key holding a `Record<parentId, data>`; keys the
     * caller cannot access are stripped (and a categorically-unauthorized caller
     * gets a 403 rather than a silently-empty record), exactly like `recordKey`
     * but evaluated against the parent type.
     */
    recordKey?: string;
  };

  /**
   * For single-resource endpoints: parameter path in request input to extract resource ID.
   * Uses dot notation for nested params (e.g., "params.systemId").
   */
  idParam?: string;

  /**
   * For bulk WRITE endpoints that act on an ARRAY of resource ids (mass delete /
   * mass resolve). Unlike `idParam` (a single pre-check that THROWS on the first
   * unauthorized id) and `listKey`/`recordKey` (post-filters that run AFTER the
   * handler has already mutated everything = fail-open for a write), this is a
   * PRE-handler partition: the middleware resolves the id array at
   * `input[idsParam]`, splits it into the caller's manageable subset (global rule
   * OR per-id team grant) and the denied remainder, and exposes both to the
   * handler via `context.bulkAccess[idsParam]` as
   * `{ authorizedIds, deniedIds }`. The handler MUST mutate only `authorizedIds`
   * and report `deniedIds` as forbidden, so an unauthorized id is never acted on
   * and the batch reports per-id partial success. Team-scoped callers (a grant,
   * no global rule) are NOT rejected up front — they simply receive only their
   * granted ids. Fails CLOSED: an S2S error yields an empty authorized subset.
   */
  bulkManage?: {
    /**
     * Input path (dot notation) to the array of resource ids to authorize.
     * The value may be a single string or a string array; it is resolved the
     * same way as `create.parent.idParam`.
     */
    idsParam: string;
  };

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

  /**
   * For CREATE endpoints: marks the procedure as creating a new resource of the
   * rule's resource type. The middleware then (1) authorizes the create via the
   * auth service — allowing a team member who holds a create-capability grant
   * (not just a global-manage holder) through, resolving the owning team or
   * throwing FORBIDDEN / OWNER_TEAM_REQUIRED — and (2) after the handler
   * succeeds, writes the owning-team grant for the newly-created resource id.
   *
   * Because creation has no pre-existing resource id, this is the only mode
   * that resolves its id from the RESPONSE (idField) rather than the request.
   */
  create?: {
    /**
     * Input path carrying the optional requested owning-team id. Default "teamId".
     */
    teamIdParam?: string;
    /**
     * Response path carrying the created resource's id (used to write the owner
     * grant). Default "id".
     */
    idField?: string;
    /**
     * Optional PARENT gate: authorize the create by MANAGE access on a parent
     * resource instead of (or in addition to) a per-type create-capability
     * grant. For example, an incident "for a system" can be created by anyone
     * who can manage that system. `resourceType` is the qualified parent type
     * (e.g. "catalog.system"); `idParam` is the input path to the parent id, or
     * an array of parent ids (the caller must be able to manage ALL of them).
     * When the parent check passes, the per-type create-capability is not
     * required; the result is still globally readable.
     */
    parent?: {
      resourceType: string;
      idParam: string;
    };
    /**
     * Optional SIBLING gate: authorize the create when the caller holds a
     * `creator` (create-capability) grant on ANY of these other qualified types,
     * in addition to this type's own creator grant. Type-scoped, NOT instance-
     * scoped: unlike `parent` (which needs a parent id in the payload and checks
     * MANAGE on that instance), this needs no id and checks only the type-level
     * `creator` capability. Use for sibling self-service, e.g. "a caller who may
     * create `catalog.system` may also create `catalog.group` / `catalog.environment`".
     * When a sibling capability matches, the per-type create-capability is not
     * required; the owning team is still resolved (teamIdParam / membership), and
     * the result is still globally readable.
     */
    alsoAcceptCreatorOf?: string[];
  };

  /**
   * Type-level capability gate for endpoints that have NO instance to scope on
   * but ARE a dependency of a team-scopable surface: catalogs, editor utilities,
   * "list the strategy/collector types" helpers. Authorizes the caller when they
   * hold the rule's GLOBAL access rule OR ANY team grant of the rule's resource
   * type - a `viewer`/`editor`/`owner` grant on any instance, OR a `creator`
   * (create-capability) grant so a team member who may CREATE the type can open
   * the authoring UI before they own a single instance.
   *
   * This is the correct mode for the "team manager needs a global-only utility
   * endpoint" case (see `.claude/rules/rlac.md`): `global: true` would fail-open
   * for global-rule holders yet 403 the team-scoped manager who legitimately
   * needs it. Mutually exclusive with all the other modes and with `global`.
   * `action` defaults to the access rule's own level (`read`/`manage`).
   */
  typeScoped?: {
    /** Required capability level. Defaults to the access rule's own level. */
    action?: "read" | "manage";
  };

  /**
   * Scope this endpoint by access to the object NAMED BY THE INPUT - both its
   * TYPE and its id come from the request body. Unlike `idParam` (whose resource
   * TYPE is fixed from the access rule's `resource`), this is for the rare
   * GENERIC-over-type endpoints that administer access on any resource type
   * (e.g. the relation-tuple writes `writeRelation` / `removeRelation` /
   * `setObjectPublic`).
   *
   * The endpoint's own `access` rule stays the GLOBAL admin OR-override (exactly
   * as `idParam` treats its rule's qualified id): a caller holding that rule (or
   * `*`) is allowed outright. Otherwise the per-object decision derives the
   * object's OWN global rule as `${objectType}.${action}` (the RLAC keying
   * convention already used by `create.parent`) and consults team grants via the
   * same auth engine (`auth.check`). Team-private objects are respected: the
   * global path is closed for them, so only a granted team (or the admin
   * override) qualifies. Fail-closed when the params do not resolve.
   *
   * Mutually exclusive with all other modes and with `global`.
   */
  objectRef?: {
    /** Input path to the object TYPE, e.g. "objectType". */
    typeParam: string;
    /** Input path to the object id, e.g. "objectId". */
    idParam: string;
    /** Required action on the referenced object. Defaults to "manage". */
    action?: "read" | "manage";
  };
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
   * The id of the plugin that OWNS this rule. REQUIRED: granted access-rule ids
   * are stored fully-qualified as `{pluginId}.{id}` (e.g. `incident.incident.read`)
   * so the same short id from two plugins never collides, and access checks ONLY
   * ever compare the qualified form. There is intentionally NO unqualified
   * fallback - matching a bare id would be a privilege-escalation flaw across
   * plugins. Set by the *-common access definitions via `pluginMetadata.pluginId`.
   */
  readonly pluginId: string;

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
  rule: Pick<AccessRule, "id">,
): string {
  return `${pluginMetadata.pluginId}.${rule.id}`;
}

/**
 * A plugin-qualified resource type id, e.g. `"catalog.system"` - the key under
 * which a resource's relation-tuple grants are stored, and the value the
 * team-capability APIs (`useProcedureAccess`, `useCanAccessType`,
 * `useResourceAccess`, a route's `manageCapability`) expect.
 *
 * Nominal on purpose: a plain string is NOT assignable here, so capability call
 * sites must reference an exported constant (built via {@link resourceType})
 * rather than hand-writing `"catalog.system"`, and a typo fails typecheck.
 */
export type ResourceType = string & { readonly __resourceType: unique symbol };

/**
 * Build a plugin-qualified {@link ResourceType} from the plugin's metadata and a
 * local type name, mirroring how {@link access} qualifies rule ids. Export the
 * result as a constant from your `*-common` package and use THAT at capability
 * call sites instead of a raw string.
 *
 * @example
 * ```typescript
 * import { resourceType } from "@checkstack/common";
 * import { pluginMetadata } from "./plugin-metadata";
 *
 * export const catalogResourceTypes = {
 *   system: resourceType(pluginMetadata, "system"), // "catalog.system"
 *   group: resourceType(pluginMetadata, "group"),   // "catalog.group"
 * };
 * ```
 */
export function resourceType(
  pluginMetadata: Pick<PluginMetadata, "pluginId">,
  localType: string,
): ResourceType {
  // The sole place a ResourceType is minted: the value is a plain
  // `${pluginId}.${localType}` string; the nominal brand is erased at runtime.
  return `${pluginMetadata.pluginId}.${localType}` as ResourceType;
}

/**
 * Pure predicate: does a set of granted access-rule ids satisfy a rule?
 *
 * This is the single source of truth for client-side access checks - the
 * `useAccess` API and the sidebar both delegate here so nav visibility always
 * matches page accessibility. A rule is satisfied by the wildcard `*`, an exact
 * id match, or (for `read` rules) a `manage` grant on the same resource.
 */
export function isAccessRuleSatisfied(
  grantedRuleIds: readonly string[],
  rule: Pick<AccessRule, "id" | "resource" | "level" | "pluginId">,
): boolean {
  if (grantedRuleIds.includes("*")) return true;
  // Granted ids are ALWAYS fully-qualified (`{pluginId}.{id}`). We match ONLY the
  // qualified form - never the bare id - so one plugin's grant can never satisfy
  // another plugin's identically-named rule (a cross-plugin escalation flaw).
  const qualify = (id: string): string => `${rule.pluginId}.${id}`;
  if (grantedRuleIds.includes(qualify(rule.id))) return true;
  if (rule.level === "read") {
    return grantedRuleIds.includes(qualify(`${rule.resource}.manage`));
  }
  return false;
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
  options: {
    /** Owning plugin id (REQUIRED) - rules are matched only as `{pluginId}.{id}`. */
    pluginId: string;
    isDefault?: boolean;
    isPublic?: boolean;
  },
): AccessRule {
  // Access rules NEVER carry instance config. Instance (team) scoping is
  // declared per-procedure via `proc({ instanceAccess })`, which is the single
  // source of truth. A rule-level default used to be allowed here, but a baked
  // `idParam` silently applied to every procedure that forgot its own override
  // (the "loaded gun" that masked the systemId-vs-object-id mis-scoping in
  // getSystems / getIncidentsForSystem). Scoping is now always explicit at the
  // call site, and the boot validator requires it for team-scopable types.
  return {
    id: `${resource}.${level}`,
    resource,
    level,
    description,
    pluginId: options.pluginId,
    isDefault: options.isDefault,
    isPublic: options.isPublic,
    instanceAccess: undefined,
  };
}

/**
 * Configuration for a single access level in an accessPair.
 */
export interface AccessLevelConfig {
  /**
   * Human-readable description of what this access level allows.
   */
  description: string;

  /**
   * Whether this access rule is granted by default to authenticated users ("users" role).
   */
  isDefault?: boolean;

  /**
   * Whether this access rule is granted to anonymous/public users ("anonymous" role).
   */
  isPublic?: boolean;
}

/**
 * Creates a read/manage pair for a resource.
 * Most resources need both access levels, so this reduces boilerplate.
 *
 * @param resource - The resource name (e.g., "system", "incident")
 * @param levels - Configuration for read and manage levels
 * @returns An object with `read` and `manage` AccessRule properties
 *
 * Instance (team) scoping is NOT configured here - it is declared per-procedure
 * via `proc({ instanceAccess })`. See `access()` for the rationale.
 *
 * @example
 * ```typescript
 * const incidentAccess = accessPair("incident", {
 *   read: { description: "View incidents", isDefault: true, isPublic: true },
 *   manage: { description: "Manage incidents - create, edit, resolve, delete" },
 * }, { pluginId: pluginMetadata.pluginId });
 *
 * // Usage in contract - scoping is explicit at the call site:
 * getIncident: proc({ access: [incidentAccess.incident.read], instanceAccess: { idParam: "id" } }),
 * ```
 */
export function accessPair(
  resource: string,
  levels: {
    read: AccessLevelConfig;
    manage: AccessLevelConfig;
  },
  options: {
    /** Owning plugin id (REQUIRED) - rules are matched only as `{pluginId}.{id}`. */
    pluginId: string;
  },
): { read: AccessRule; manage: AccessRule } {
  return {
    read: access(resource, "read", levels.read.description, {
      isDefault: levels.read.isDefault,
      isPublic: levels.read.isPublic,
      pluginId: options.pluginId,
    }),
    manage: access(resource, "manage", levels.manage.description, {
      isDefault: levels.manage.isDefault,
      isPublic: levels.manage.isPublic,
      pluginId: options.pluginId,
    }),
  };
}
