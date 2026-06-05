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
