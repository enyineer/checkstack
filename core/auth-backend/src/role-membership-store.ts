import { and, eq, inArray } from "drizzle-orm";
import type {
  SafeDatabase,
  ScopedQueryRunner,
} from "@checkstack/backend-api";
import * as schema from "./schema";
import { ANONYMOUS_ROLE_ID } from "./role-ids";
import type { AuthCache } from "./auth-cache";

/**
 * The single sanctioned writer of the three role-membership tables - `role`,
 * `role_access_rule`, and `user_role`.
 *
 * ## Why this exists (enforced-by-design cache invalidation)
 *
 * `readEnrichedUser` serves authorization from the shared auth caches of
 * `user -> roles` and `role -> access-rule ids` (see `auth-cache.ts`). Those
 * caches are correct across horizontally-scaled pods ONLY if every mutation of
 * the underlying tables evicts the affected entries. Scattering that duty across
 * handlers makes it easy for a future mutation site to forget - a silent
 * authorization-staleness bug.
 *
 * This store makes forgetting impossible: the DB write and its invalidation are
 * the SAME method. The {@link AuthCache} is a REQUIRED constructor argument, so a
 * caller cannot perform a write without also wiring the invalidation. The
 * `no-direct-role-membership-writes` lint rule forbids raw `.insert/.update/
 * .delete` on these tables anywhere else in `auth-backend`, so this store is the
 * only door.
 *
 * Cross-pod coherence comes from the SHARED cache backend: with a distributed
 * provider (Redis) an `invalidate` is a `delete` every pod sees immediately, so
 * no application-level broadcast is needed (the old `authHooks.*Invalidated` /
 * `coreHooks.anonymousAccessRulesInvalidated` hooks were removed). The cache TTL
 * is only a natural-refresh safety net.
 */
export class RoleMembershipStore {
  constructor(
    private readonly db: SafeDatabase<typeof schema>,
    private readonly authCache: AuthCache,
  ) {}

  /**
   * Create a role and its access-rule mappings in one transaction. No cache
   * invalidation: a brand-new role (fresh id) cannot be present in the
   * `role -> rules` cache yet.
   */
  async createRole({
    id,
    name,
    description,
    accessRuleIds,
  }: {
    id: string;
    name: string;
    description?: string;
    accessRuleIds: string[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.role).values({
        id,
        name,
        description: description || undefined,
        isSystem: false,
      });
      if (accessRuleIds.length > 0) {
        await tx.insert(schema.roleAccessRule).values(
          accessRuleIds.map((accessRuleId) => ({ roleId: id, accessRuleId })),
        );
      }
    });
  }

  /**
   * Update a role's name/description and, when `replaceAccessRuleIds` is
   * provided, REPLACE its access-rule set - all in one transaction. Pass
   * `replaceAccessRuleIds: undefined` to leave the rule set untouched (the
   * admin / caller's-own-role case), which also skips cache invalidation since
   * the mapping did not change. The role name is not cached, so a name-only
   * update invalidates nothing.
   */
  async updateRole({
    roleId,
    name,
    description,
    replaceAccessRuleIds,
  }: {
    roleId: string;
    name?: string;
    description?: string | null;
    replaceAccessRuleIds?: string[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (name !== undefined || description !== undefined) {
        const updates: { name?: string; description?: string | null } = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        await tx.update(schema.role).set(updates).where(eq(schema.role.id, roleId));
      }
      if (replaceAccessRuleIds !== undefined) {
        await tx
          .delete(schema.roleAccessRule)
          .where(eq(schema.roleAccessRule.roleId, roleId));
        if (replaceAccessRuleIds.length > 0) {
          await tx.insert(schema.roleAccessRule).values(
            replaceAccessRuleIds.map((accessRuleId) => ({ roleId, accessRuleId })),
          );
        }
      }
    });

    if (replaceAccessRuleIds !== undefined) {
      await this.authCache.invalidateRoleAccessRules(roleId);
      // Editing the anonymous role also changes what unauthenticated visitors
      // may do, which is cached separately (the anonymous-access-rules entry
      // `core/backend` reads through the shared cache).
      if (roleId === ANONYMOUS_ROLE_ID) {
        await this.authCache.invalidateAnonymousAccessRules();
      }
    }
  }

  /**
   * Delete a role: its access-rule mappings, its user memberships, and the role
   * row itself, in one transaction. Busts both caches - the role's
   * `role -> rules` entry, and the whole `user -> roles` cache (the cascade
   * changed the role set of every user that held it, which we do not enumerate).
   */
  async deleteRole({ roleId }: { roleId: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.roleAccessRule)
        .where(eq(schema.roleAccessRule.roleId, roleId));
      await tx.delete(schema.userRole).where(eq(schema.userRole.roleId, roleId));
      await tx.delete(schema.role).where(eq(schema.role.id, roleId));
    });

    await this.authCache.invalidateRoleAccessRules(roleId);
    await this.authCache.invalidateUserRoles();
  }

  /** Replace a user's entire role set in one transaction, then invalidate. */
  async setUserRoles({
    userId,
    roleIds,
  }: {
    userId: string;
    roleIds: string[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.userRole).where(eq(schema.userRole.userId, userId));
      if (roleIds.length > 0) {
        await tx.insert(schema.userRole).values(
          roleIds.map((roleId) => ({ userId, roleId })),
        );
      }
    });

    await this.authCache.invalidateUserRoles(userId);
  }

  /**
   * Reconcile a user's managed role memberships during a directory login: add
   * the given roles they lack, remove the given managed roles they should no
   * longer have. Invalidates only when something actually changed (this runs on
   * every external login). Returns whether a change occurred.
   */
  async syncUserRoles({
    userId,
    addRoleIds,
    removeRoleIds,
  }: {
    userId: string;
    addRoleIds: string[];
    removeRoleIds: string[];
  }): Promise<boolean> {
    if (addRoleIds.length === 0 && removeRoleIds.length === 0) return false;
    await this.db.transaction(async (tx) => {
      if (addRoleIds.length > 0) {
        await tx.insert(schema.userRole).values(
          addRoleIds.map((roleId) => ({ userId, roleId })),
        );
      }
      if (removeRoleIds.length > 0) {
        await tx
          .delete(schema.userRole)
          .where(
            and(
              eq(schema.userRole.userId, userId),
              inArray(schema.userRole.roleId, removeRoleIds),
            ),
          );
      }
    });

    await this.authCache.invalidateUserRoles(userId);
    return true;
  }

  /**
   * Grant a freshly-created user their initial roles, using the caller's
   * transaction/runner so it joins the user-creation transaction. NO cache
   * invalidation: the user is being created in this same operation and cannot be
   * present in the `user -> roles` cache yet.
   */
  async grantInitialRoles({
    runner,
    userId,
    roleIds,
  }: {
    runner: ScopedQueryRunner<typeof schema>;
    userId: string;
    roleIds: string[];
  }): Promise<void> {
    if (roleIds.length === 0) return;
    await runner.insert(schema.userRole).values(
      roleIds.map((roleId) => ({ userId, roleId })),
    );
  }

  /**
   * Delete all of a user's role memberships, using the caller's
   * transaction/runner so it joins the user-deletion transaction. No cache
   * invalidation: a deleted user can never authenticate, so a stale
   * `user -> roles` entry is never read and expires via the TTL.
   */
  async deleteUserMemberships({
    runner,
    userId,
  }: {
    runner: ScopedQueryRunner<typeof schema>;
    userId: string;
  }): Promise<void> {
    await runner
      .delete(schema.userRole)
      .where(eq(schema.userRole.userId, userId));
  }

  /**
   * Remove `role_access_rule` rows referencing the given access-rule ids (used
   * when a deregistered plugin's access rules are cleaned up). Busts the whole
   * `role -> rules` cache, since the removed rules may have spanned many roles -
   * AND the separate anonymous-access-rules entry, since the removed rules may
   * have been granted to the anonymous role (a deregistered plugin's `public`
   * rule). Without the anon eviction, unauthenticated callers would keep the
   * removed grant in `core/backend`'s cache until the TTL.
   */
  async removeAccessRuleMappings({
    accessRuleIds,
  }: {
    accessRuleIds: string[];
  }): Promise<void> {
    if (accessRuleIds.length === 0) return;
    await this.db
      .delete(schema.roleAccessRule)
      .where(inArray(schema.roleAccessRule.accessRuleId, accessRuleIds));

    await this.authCache.invalidateRoleAccessRules();
    await this.authCache.invalidateAnonymousAccessRules();
  }
}
