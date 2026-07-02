import { qualifyAccessRuleId } from "@checkstack/common";
import type { AuthUser, AuthService } from "@checkstack/backend-api";
import {
  healthCheckAccess,
  healthCheckResourceTypes,
  pluginMetadata,
} from "@checkstack/healthcheck-common";
import { catalogResourceTypes } from "@checkstack/catalog-common";

/**
 * The qualified global rule that unlocks the UNFILTERED run-history feed.
 * Kept in lock-step with the history procs' contract docs: their `access` is
 * deliberately empty (the OR below is not expressible declaratively), so THIS
 * module is the authorization for them.
 */
const QUALIFIED_MANAGE_RULE = qualifyAccessRuleId(
  pluginMetadata,
  healthCheckAccess.configuration.manage,
);

/**
 * The parent (catalog.system) global manage rule. Follows the middleware's
 * parentScope convention: authorizing via a parent consults the parent's own
 * grants AND its global `{resourceType}.{action}` rule.
 */
const QUALIFIED_SYSTEM_MANAGE_RULE = `${catalogResourceTypes.system}.manage`;

/** A user/application principal (the only kinds that can hold team grants). */
type GrantHolder = AuthUser & { type: "user" | "application" };

const isGrantHolder = (user: AuthUser): user is GrantHolder =>
  user.type === "user" || user.type === "application";

/**
 * Does the caller hold UNRESTRICTED run-history access? True for wildcard
 * admins, global `healthcheck.healthcheck.manage` holders, and trusted
 * services (same stance as the middleware).
 */
export function hasGlobalHistoryAccess(user: AuthUser | undefined): boolean {
  if (!user) return false;
  if (user.type === "service") return true;
  const rules = user.accessRules ?? [];
  return rules.includes("*") || rules.includes(QUALIFIED_MANAGE_RULE);
}

/** The outcome of authorizing the run-history FEED for the current caller. */
export type HistoryScope =
  /** Global manage (or wildcard/service): the caller sees every run. */
  | { kind: "all" }
  /**
   * Team-scoped caller: restrict rows to runs of these configurations OR runs
   * belonging to these systems (a system's owning team sees ALL of its runs,
   * regardless of who owns the configuration).
   */
  | { kind: "scoped"; configurationIds: string[]; systemIds: string[] }
  /** No global rule and no team grant of either kind: the read is forbidden. */
  | { kind: "forbidden" };

/**
 * Pure decision half of the feed authorization: given the caller and their
 * team-accessible configuration/system ids, decide the feed scope. Split from
 * the S2S lookups so the branching is unit-testable without an auth service.
 */
export function resolveHistoryScope({
  user,
  accessibleConfigurationIds,
  accessibleSystemIds,
}: {
  user: AuthUser | undefined;
  accessibleConfigurationIds: string[];
  accessibleSystemIds: string[];
}): HistoryScope {
  if (!user) return { kind: "forbidden" };
  if (hasGlobalHistoryAccess(user)) return { kind: "all" };

  if (
    accessibleConfigurationIds.length === 0 &&
    accessibleSystemIds.length === 0
  ) {
    return { kind: "forbidden" };
  }
  return {
    kind: "scoped",
    configurationIds: accessibleConfigurationIds,
    systemIds: accessibleSystemIds,
  };
}

/**
 * Resolve which of `allConfigurationIds` the caller may MANAGE via team
 * grants on the CONFIGURATION itself. FAILS CLOSED: an S2S error yields an
 * empty set, i.e. narrower access, never wider.
 */
export async function listTeamManageableConfigurationIds({
  auth,
  user,
  allConfigurationIds,
}: {
  auth: AuthService;
  user: AuthUser;
  allConfigurationIds: string[];
}): Promise<string[]> {
  if (!isGrantHolder(user)) return [];
  if (allConfigurationIds.length === 0) return [];
  try {
    return await auth.listAccessibleObjectIds({
      userId: user.id,
      userType: user.type,
      objectType: healthCheckResourceTypes.configuration,
      objectIds: allConfigurationIds,
      action: "manage",
      hasGlobalAccess: false,
    });
  } catch {
    // SECURITY: fail closed - an auth outage must not widen the feed.
    return [];
  }
}

/**
 * Resolve which of `allSystemIds` the caller may MANAGE - via a team grant on
 * the system, or via the global `catalog.system.manage` rule (the parentScope
 * convention). A system's owning team sees every run of that system, even for
 * configurations owned elsewhere. FAILS CLOSED on S2S errors.
 */
export async function listManageableSystemIds({
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
  if (rules.includes(QUALIFIED_SYSTEM_MANAGE_RULE)) return allSystemIds;
  try {
    return await auth.listAccessibleObjectIds({
      userId: user.id,
      userType: user.type,
      objectType: catalogResourceTypes.system,
      objectIds: allSystemIds,
      action: "manage",
      hasGlobalAccess: false,
    });
  } catch {
    // SECURITY: fail closed - an auth outage must not widen the feed.
    return [];
  }
}

/**
 * Per-object check for the single-configuration history surfaces
 * (`getRunById`, `getDetailedAggregatedHistory`): the caller may read runs of
 * (`configurationId`, `systemId`) iff they hold global history access, a team
 * manage grant on the CONFIGURATION, or manage access to the SYSTEM (team
 * grant or global catalog rule). FAILS CLOSED on S2S errors.
 */
export async function canReadRunScope({
  auth,
  user,
  configurationId,
  systemId,
}: {
  auth: AuthService;
  user: AuthUser | undefined;
  configurationId: string;
  systemId: string;
}): Promise<boolean> {
  if (!user) return false;
  if (hasGlobalHistoryAccess(user)) return true;
  if (!isGrantHolder(user)) return false;

  const rules = user.accessRules ?? [];
  if (rules.includes(QUALIFIED_SYSTEM_MANAGE_RULE)) return true;

  try {
    const configCheck = await auth.check({
      userId: user.id,
      userType: user.type,
      objectType: healthCheckResourceTypes.configuration,
      objectId: configurationId,
      action: "manage",
      hasGlobalAccess: false,
    });
    if (configCheck.hasAccess) return true;

    const systemCheck = await auth.check({
      userId: user.id,
      userType: user.type,
      objectType: catalogResourceTypes.system,
      objectId: systemId,
      action: "manage",
      hasGlobalAccess: false,
    });
    return systemCheck.hasAccess;
  } catch {
    // SECURITY: fail closed - an auth outage must not widen access.
    return false;
  }
}
