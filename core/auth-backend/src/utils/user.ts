import { User } from "better-auth/types";
import { SafeDatabase } from "@checkstack/backend-api";
import { eq, inArray } from "drizzle-orm";
import type { RealUser, ScopedQueryRunner } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import * as schema from "../schema";

/**
 * Resolve a better-auth User's roles, access rules, and team memberships into a
 * `RealUser`, running every query on the supplied `runner`.
 *
 * `runner` is a {@link ScopedQueryRunner} — either the scoped database itself or
 * a `ScopedTransaction` handle. Callers that batch several reads under one
 * `SET LOCAL search_path` (the opaque-OAuth branch) pass their `tx`; the
 * standalone {@link enrichUser} wrapper passes a `tx` it opens itself. The reads
 * are pure DB work (roles -> access rules -> teams) so they are safe to run
 * inside a single transaction.
 *
 * The per-role access-rule fan-out is collapsed into ONE set-based `inArray`
 * query (mirroring `enrichApplicationPrincipal` / `resolveAllApplicationAccessRules`):
 * the rules are grouped per role in JS afterwards so the merged `accessRules`
 * preserve the same role-order insertion the old N+1 loop produced.
 */
export const readEnrichedUser = async (
  user: User,
  runner: ScopedQueryRunner<typeof schema>
): Promise<RealUser> => {
  // 1. Get Roles
  const userRoles = await runner
    .select({
      roleName: schema.role.name,
      roleId: schema.role.id,
    })
    .from(schema.userRole)
    .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
    .where(eq(schema.userRole.userId, user.id));

  const roles = userRoles.map((r) => r.roleId);

  // 2. Get access rules for all non-admin roles in ONE set-based query, then
  //    group per role in JS (the old loop issued one query per role: N+1).
  const nonAdminRoleIds = roles.filter((roleId) => roleId !== "admin");
  const rulesByRole = new Map<string, string[]>();
  if (nonAdminRoleIds.length > 0) {
    const roleAccessRules = await runner
      .select({
        roleId: schema.roleAccessRule.roleId,
        accessRuleId: schema.roleAccessRule.accessRuleId,
      })
      .from(schema.roleAccessRule)
      .innerJoin(
        schema.accessRule,
        eq(schema.accessRule.id, schema.roleAccessRule.accessRuleId)
      )
      .where(inArray(schema.roleAccessRule.roleId, nonAdminRoleIds));
    for (const p of roleAccessRules) {
      const existing = rulesByRole.get(p.roleId);
      if (existing) existing.push(p.accessRuleId);
      else rulesByRole.set(p.roleId, [p.accessRuleId]);
    }
  }

  // Merge in role order so `accessRules` matches the old per-role loop output.
  const accessRulesSet = new Set<string>();
  for (const roleId of roles) {
    if (roleId === "admin") {
      accessRulesSet.add("*");
      continue;
    }
    for (const rule of rulesByRole.get(roleId) ?? []) accessRulesSet.add(rule);
  }

  // 3. Get Team memberships
  const userTeams = await runner
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
 * Enriches a better-auth User with roles, access rules, and team memberships from the database.
 * Returns a RealUser type for use in the RPC context.
 *
 * Runs the three sequential reads inside a single `withScopedTransaction` so the
 * scoped-db proxy pays ONE `BEGIN`/`SET LOCAL search_path`/`COMMIT` for the whole
 * enrichment instead of one per query — this is the hottest authenticated path.
 */
export const enrichUser = async (
  user: User,
  db: SafeDatabase<typeof schema>
): Promise<RealUser> =>
  withScopedTransaction(db, (tx) => readEnrichedUser(user, tx));

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
): Promise<ApplicationPrincipalEnrichment | undefined> =>
  // The four reads are pure DB work, so batch them under a single
  // `SET LOCAL search_path` instead of paying the proxy's per-query cycle.
  withScopedTransaction(db, async (tx) => {
    const apps = await tx
      .select()
      .from(schema.application)
      .where(eq(schema.application.id, applicationId))
      .limit(1);
    const app = apps[0];
    if (!app) return;

    const appRoles = await tx
      .select({ roleId: schema.applicationRole.roleId })
      .from(schema.applicationRole)
      .where(eq(schema.applicationRole.applicationId, applicationId));
    const roleIds = appRoles.map((r) => r.roleId);

    const accessRulesSet = new Set<string>();
    if (roleIds.includes("admin")) accessRulesSet.add("*");
    const nonAdminRoleIds = roleIds.filter((r) => r !== "admin");
    if (nonAdminRoleIds.length > 0) {
      const rolePerms = await tx
        .select({ accessRuleId: schema.roleAccessRule.accessRuleId })
        .from(schema.roleAccessRule)
        .where(inArray(schema.roleAccessRule.roleId, nonAdminRoleIds));
      for (const rp of rolePerms) accessRulesSet.add(rp.accessRuleId);
    }

    const appTeams = await tx
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
  });

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
