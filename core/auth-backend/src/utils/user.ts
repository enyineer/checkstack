import { User } from "better-auth/types";
import { SafeDatabase } from "@checkstack/backend-api";
import { eq, inArray } from "drizzle-orm";
import type { RealUser, ScopedQueryRunner } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import * as schema from "../schema";
import type { AuthCache } from "../auth-cache";

/**
 * Resolve a better-auth User's roles, access rules, and team memberships into a
 * `RealUser`, running any needed DB queries on the supplied `runner`.
 *
 * `runner` is a {@link ScopedQueryRunner} — either the scoped database itself or
 * a `ScopedTransaction` handle. The opaque-OAuth branch passes its own `tx` (so
 * its other reads share one `SET LOCAL search_path`); the standalone
 * {@link enrichUser} wrapper passes the scoped `db` directly.
 *
 * The roles and role -> rules lookups are served CACHE-FIRST from `authCache`,
 * so on a cache hit they issue NO query and the `runner` is only touched for the
 * (always-uncached) team read. This is why {@link enrichUser} no longer wraps
 * the whole thing in a transaction: there is nothing to batch on the hot (hit)
 * path, and holding a transaction across the cache round-trip would check out a
 * DB connection the hit does not need. Only a cache MISS falls back to the DB.
 *
 * The per-role access-rule miss fan-out is collapsed into ONE set-based
 * `inArray` query (mirroring `enrichApplicationPrincipal` /
 * `resolveAllApplicationAccessRules`): the rules are grouped per role in JS
 * afterwards so the merged `accessRules` preserve the same role-order insertion
 * the old N+1 loop produced.
 */
export const readEnrichedUser = async ({
  user,
  runner,
  authCache,
}: {
  user: User;
  runner: ScopedQueryRunner<typeof schema>;
  authCache: AuthCache;
}): Promise<RealUser> => {
  // 1. Get the user's role ids, served cache-first (membership changes only on
  //    rare admin edits, but this join ran on EVERY authenticated request). The
  //    miss loader's join to `role` filters out orphaned `user_role` rows whose
  //    role was deleted. Invalidated on mutation via `RoleMembershipStore` on
  //    the shared cache (cluster-wide with a distributed backend).
  const roles = await authCache.resolveUserRoles({
    userId: user.id,
    loadRoles: async () => {
      const userRoles = await runner
        .select({ roleId: schema.role.id })
        .from(schema.userRole)
        .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
        .where(eq(schema.userRole.userId, user.id));
      return userRoles.map((r) => r.roleId);
    },
  });

  // 2. Get access rules for all non-admin roles, served cache-first keyed by
  //    role (the mapping changes only on rare admin edits, but this join ran on
  //    EVERY authenticated request). Only cache-miss roles hit the DB, in ONE
  //    set-based query grouped per role in JS (the old loop was N+1). Role
  //    membership itself (step 1) is still resolved live, so cache staleness is
  //    bounded to the role -> rules mapping, invalidated on mutation via
  //    `RoleMembershipStore`.
  const nonAdminRoleIds = roles.filter((roleId) => roleId !== "admin");
  const rulesByRole = await authCache.resolveRoleAccessRules({
    nonAdminRoleIds,
    loadMisses: async (missRoleIds) => {
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
        .where(inArray(schema.roleAccessRule.roleId, missRoleIds));
      const loaded = new Map<string, string[]>();
      for (const p of roleAccessRules) {
        const existing = loaded.get(p.roleId);
        if (existing) existing.push(p.accessRuleId);
        else loaded.set(p.roleId, [p.accessRuleId]);
      }
      return loaded;
    },
  });

  // Merge in role order so `accessRules` matches the old per-role loop output.
  const accessRulesSet = new Set<string>();
  for (const roleId of roles) {
    if (roleId === "admin") {
      accessRulesSet.add("*");
      continue;
    }
    for (const rule of rulesByRole.get(roleId) ?? []) accessRulesSet.add(rule);
  }

  // 3. Get Team memberships. Not cached — resolved live on every request as its
  //    own auto-scoped statement (on a cache hit for steps 1-2, this is the ONLY
  //    DB query the enrichment runs).
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
 * Enriches a better-auth User with roles, access rules, and team memberships.
 * Returns a RealUser type for use in the RPC context.
 *
 * Passes the scoped `db` directly as the runner (no wrapping transaction): the
 * roles and role -> rules lookups are served cache-first from `authCache`, so on
 * the hot (hit) path there is nothing to batch — only the team read touches the
 * DB, as a single auto-scoped statement. A cache MISS falls back to a DB load
 * for that one lookup. This keeps the Redis round-trips OFF the DB connection
 * pool, which the previous single-transaction wrapper could not do.
 */
export const enrichUser = async ({
  user,
  db,
  authCache,
}: {
  user: User;
  db: SafeDatabase<typeof schema>;
  authCache: AuthCache;
}): Promise<RealUser> => readEnrichedUser({ user, runner: db, authCache });

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
