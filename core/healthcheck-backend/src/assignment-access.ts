import { qualifyAccessRuleId } from "@checkstack/common";
import type { AuthUser, AuthService } from "@checkstack/backend-api";
import {
  healthCheckAccess,
  healthCheckResourceTypes,
  pluginMetadata,
} from "@checkstack/healthcheck-common";
import { catalogResourceTypes } from "@checkstack/catalog-common";

/**
 * Authorization for the configuration-centric assignment reads
 * (`getConfigurationAssignments`, and the relaxed `getConfiguration`). Their
 * contract `access` is deliberately empty - the rule is an OR across TWO grant
 * planes (a team grant on the CONFIGURATION, or read access to an assigned
 * SYSTEM) that the middleware's instanceAccess modes cannot express - so THIS
 * module is the authorization for them. Sibling of `history-access.ts`, which
 * does the same for the run-history procs at manage level.
 */

const QUALIFIED_READ_RULE = qualifyAccessRuleId(
  pluginMetadata,
  healthCheckAccess.configuration.read,
);
const QUALIFIED_MANAGE_RULE = qualifyAccessRuleId(
  pluginMetadata,
  healthCheckAccess.configuration.manage,
);

/**
 * The parent (catalog.system) global rules. Follows the middleware's
 * parentScope convention: authorizing via a parent consults the parent's own
 * grants AND its global `{resourceType}.{action}` rule. Manage implies read.
 */
const QUALIFIED_SYSTEM_READ_RULE = `${catalogResourceTypes.system}.read`;
const QUALIFIED_SYSTEM_MANAGE_RULE = `${catalogResourceTypes.system}.manage`;

/** A user/application principal (the only kinds that can hold team grants). */
type GrantHolder = AuthUser & { type: "user" | "application" };

const isGrantHolder = (user: AuthUser): user is GrantHolder =>
  user.type === "user" || user.type === "application";

/**
 * Does the caller hold UNRESTRICTED configuration read access? True for
 * wildcard admins, global `configuration.read` OR `configuration.manage`
 * holders (manage implies read), and trusted services (same stance as the
 * middleware).
 */
export function hasGlobalConfigurationRead(
  user: AuthUser | undefined,
): boolean {
  if (!user) return false;
  if (user.type === "service") return true;
  const rules = user.accessRules ?? [];
  return (
    rules.includes("*") ||
    rules.includes(QUALIFIED_READ_RULE) ||
    rules.includes(QUALIFIED_MANAGE_RULE)
  );
}

/** The outcome of authorizing the assignment-row read for the caller. */
export type AssignmentRowScope =
  /** Global read (or wildcard/service/config grant): every row is visible. */
  | { kind: "all" }
  /**
   * System-scoped caller: restrict rows to the systems their teams may READ
   * (a system's team sees which checks run on their system).
   */
  | { kind: "scoped"; systemIds: string[] }
  /** No global rule and no grant of either kind: the read is forbidden. */
  | { kind: "forbidden" };

/**
 * Pure decision half of the row authorization: given the caller, whether they
 * hold a team grant on the configuration, and the system ids their teams may
 * read, decide the row scope. Split from the S2S lookups so the branching is
 * unit-testable without an auth service.
 */
export function resolveAssignmentRowScope({
  user,
  hasConfigurationGrant,
  readableSystemIds,
}: {
  user: AuthUser | undefined;
  hasConfigurationGrant: boolean;
  readableSystemIds: string[];
}): AssignmentRowScope {
  if (!user) return { kind: "forbidden" };
  if (hasGlobalConfigurationRead(user)) return { kind: "all" };
  if (hasConfigurationGrant) return { kind: "all" };
  if (readableSystemIds.length === 0) return { kind: "forbidden" };
  return { kind: "scoped", systemIds: readableSystemIds };
}

/**
 * Does the caller's team hold a READ grant on the configuration itself?
 * FAILS CLOSED: an S2S error yields `false`, i.e. narrower access, never
 * wider.
 */
export async function hasConfigurationReadGrant({
  auth,
  user,
  configurationId,
}: {
  auth: AuthService;
  user: AuthUser;
  configurationId: string;
}): Promise<boolean> {
  if (!isGrantHolder(user)) return false;
  try {
    const result = await auth.check({
      userId: user.id,
      userType: user.type,
      objectType: healthCheckResourceTypes.configuration,
      objectId: configurationId,
      action: "read",
      hasGlobalAccess: false,
    });
    return result.hasAccess;
  } catch {
    // SECURITY: fail closed - an auth outage must not widen access.
    return false;
  }
}

/**
 * Resolve which of `allSystemIds` the caller may READ - via a team grant on
 * the system, or via the global `catalog.system.read`/`.manage` rule (the
 * parentScope convention). FAILS CLOSED on S2S errors.
 */
export async function listReadableSystemIds({
  auth,
  user,
  allSystemIds,
}: {
  auth: AuthService;
  user: AuthUser;
  allSystemIds: string[];
}): Promise<string[]> {
  if (!isGrantHolder(user)) return [];
  if (allSystemIds.length === 0) return [];
  const rules = user.accessRules ?? [];
  if (
    rules.includes(QUALIFIED_SYSTEM_READ_RULE) ||
    rules.includes(QUALIFIED_SYSTEM_MANAGE_RULE)
  ) {
    return allSystemIds;
  }
  try {
    return await auth.listAccessibleObjectIds({
      userId: user.id,
      userType: user.type,
      objectType: catalogResourceTypes.system,
      objectIds: allSystemIds,
      action: "read",
      hasGlobalAccess: false,
    });
  } catch {
    // SECURITY: fail closed - an auth outage must not widen access.
    return [];
  }
}

/**
 * Per-object check for the relaxed single-configuration read: the caller may
 * read the configuration iff they hold global configuration read, a team READ
 * grant on the configuration, or READ access to at least one system the
 * configuration is assigned to (a system's team may inspect the checks that
 * run on their system - the same exposure `getSystemConfigurations` already
 * allows). `getAssignedSystemIds` is lazy so the assignment lookup only runs
 * when the cheaper checks did not already decide. FAILS CLOSED on S2S errors.
 */
export async function canReadConfigurationScope({
  auth,
  user,
  configurationId,
  getAssignedSystemIds,
}: {
  auth: AuthService;
  user: AuthUser | undefined;
  configurationId: string;
  getAssignedSystemIds: () => Promise<string[]>;
}): Promise<boolean> {
  if (!user) return false;
  if (hasGlobalConfigurationRead(user)) return true;
  if (!isGrantHolder(user)) return false;

  if (await hasConfigurationReadGrant({ auth, user, configurationId })) {
    return true;
  }

  try {
    const assignedSystemIds = await getAssignedSystemIds();
    const readable = await listReadableSystemIds({
      auth,
      user,
      allSystemIds: assignedSystemIds,
    });
    return readable.length > 0;
  } catch {
    // SECURITY: fail closed - an auth outage must not widen access.
    return false;
  }
}
