import { User } from "better-auth/types";
import { SafeDatabase } from "@checkstack/backend-api";
import { eq, inArray } from "drizzle-orm";
import type { RealUser } from "@checkstack/backend-api";
import * as schema from "../schema";

/**
 * Enriches a better-auth User with roles, access rules, and team memberships from the database.
 * Returns a RealUser type for use in the RPC context.
 */
export const enrichUser = async (
  user: User,
  db: SafeDatabase<typeof schema>
): Promise<RealUser> => {
  // 1. Get Roles
  const userRoles = await db
    .select({
      roleName: schema.role.name,
      roleId: schema.role.id,
    })
    .from(schema.userRole)
    .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
    .where(eq(schema.userRole.userId, user.id));

  const roles = userRoles.map((r) => r.roleId);
  const accessRulesSet = new Set<string>();

  // 2. Get access rules for each role
  for (const roleId of roles) {
    if (roleId === "admin") {
      accessRulesSet.add("*");
      continue;
    }

    const roleAccessRules = await db
      .select({
        accessRuleId: schema.accessRule.id,
      })
      .from(schema.roleAccessRule)
      .innerJoin(
        schema.accessRule,
        eq(schema.accessRule.id, schema.roleAccessRule.accessRuleId)
      )
      .where(eq(schema.roleAccessRule.roleId, roleId));

    for (const p of roleAccessRules) {
      accessRulesSet.add(p.accessRuleId);
    }
  }

  // 3. Get Team memberships
  const userTeams = await db
    .select({ teamId: schema.userTeam.teamId })
    .from(schema.userTeam)
    .where(eq(schema.userTeam.userId, user.id));
  const teamIds = userTeams.map((t) => t.teamId);

  return {
    // Spread user first to preserve additional properties
    ...user,
    // Override with required RealUser fields
    type: "user",
    id: user.id,
    email: user.email,
    name: user.name,
    roles,
    accessRules: [...accessRulesSet],
    teamIds,
  };
};

/**
 * The fields of an `ApplicationUser` resolved from the database.
 */
export interface ApplicationPrincipalEnrichment {
  id: string;
  name: string;
  roles: string[];
  accessRules: string[];
  teamIds: string[];
}

/**
 * Resolve an application's CURRENT roles, access rules, and team memberships
 * into the fields of an `ApplicationUser`.
 *
 * Shared by the API-key (`ck_`) authentication branch and the app-principal
 * token verify path (automation `runAs` service accounts), so both resolve
 * identically and LIVE - the principal is never frozen into a token. Mirrors
 * {@link enrichUser}'s admin -> `*` expansion. Returns `undefined` when the
 * application does not exist.
 */
export const enrichApplicationPrincipal = async (
  applicationId: string,
  db: SafeDatabase<typeof schema>,
): Promise<ApplicationPrincipalEnrichment | undefined> => {
  const apps = await db
    .select()
    .from(schema.application)
    .where(eq(schema.application.id, applicationId))
    .limit(1);
  const app = apps[0];
  if (!app) return undefined;

  const appRoles = await db
    .select({ roleId: schema.applicationRole.roleId })
    .from(schema.applicationRole)
    .where(eq(schema.applicationRole.applicationId, applicationId));
  const roleIds = appRoles.map((r) => r.roleId);

  const accessRulesSet = new Set<string>();
  if (roleIds.includes("admin")) accessRulesSet.add("*");
  const nonAdminRoleIds = roleIds.filter((r) => r !== "admin");
  if (nonAdminRoleIds.length > 0) {
    const rolePerms = await db
      .select({ accessRuleId: schema.roleAccessRule.accessRuleId })
      .from(schema.roleAccessRule)
      .where(inArray(schema.roleAccessRule.roleId, nonAdminRoleIds));
    for (const rp of rolePerms) accessRulesSet.add(rp.accessRuleId);
  }

  const appTeams = await db
    .select({ teamId: schema.applicationTeam.teamId })
    .from(schema.applicationTeam)
    .where(eq(schema.applicationTeam.applicationId, applicationId));

  return {
    id: app.id,
    name: app.name,
    roles: roleIds,
    accessRules: [...accessRulesSet],
    teamIds: appTeams.map((t) => t.teamId),
  };
};

/**
 * Resolve the effective access rules for EVERY application in a fixed number of
 * queries (two), regardless of how many applications exist.
 *
 * `enrichApplicationPrincipal` resolves a single application with 3-4 queries;
 * calling it once per application (the old `getBindableApplications` loop) is
 * `O(apps)` round-trips and showed up as broad slowness on the shared database
 * once the bind-authority check started resolving every app on every call (the
 * AI propose / service-account flow hits this on each chat turn). This batches
 * the role joins instead: one query for all application->role links, one for
 * the access rules of the involved roles. Teams are intentionally NOT resolved
 * here — bind authority and the picker only need access rules.
 *
 * Returns a map of `applicationId -> effective access rule ids` (`*` for any app
 * holding the built-in `admin` role, mirroring {@link enrichApplicationPrincipal}).
 * Applications with no roles are present with an empty array.
 */
export const resolveAllApplicationAccessRules = async (
  db: SafeDatabase<typeof schema>,
): Promise<Map<string, string[]>> => {
  const appRoleLinks = await db
    .select({
      applicationId: schema.applicationRole.applicationId,
      roleId: schema.applicationRole.roleId,
    })
    .from(schema.applicationRole);

  const nonAdminRoleIds = [
    ...new Set(
      appRoleLinks.map((l) => l.roleId).filter((roleId) => roleId !== "admin"),
    ),
  ];

  const rulesByRole = new Map<string, string[]>();
  if (nonAdminRoleIds.length > 0) {
    const rolePerms = await db
      .select({
        roleId: schema.roleAccessRule.roleId,
        accessRuleId: schema.roleAccessRule.accessRuleId,
      })
      .from(schema.roleAccessRule)
      .where(inArray(schema.roleAccessRule.roleId, nonAdminRoleIds));
    for (const rp of rolePerms) {
      const existing = rulesByRole.get(rp.roleId);
      if (existing) existing.push(rp.accessRuleId);
      else rulesByRole.set(rp.roleId, [rp.accessRuleId]);
    }
  }

  const rulesByApp = new Map<string, Set<string>>();
  for (const link of appRoleLinks) {
    let set = rulesByApp.get(link.applicationId);
    if (!set) {
      set = new Set<string>();
      rulesByApp.set(link.applicationId, set);
    }
    if (link.roleId === "admin") {
      set.add("*");
      continue;
    }
    for (const rule of rulesByRole.get(link.roleId) ?? []) set.add(rule);
  }

  return new Map(
    [...rulesByApp].map(([appId, set]) => [appId, [...set]] as const),
  );
};
