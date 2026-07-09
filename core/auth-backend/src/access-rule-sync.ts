import { eq } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import type { AuthCache } from "./auth-cache";
import {
  ADMIN_ROLE_ID,
  USERS_ROLE_ID,
  ANONYMOUS_ROLE_ID,
  APPLICATIONS_ROLE_ID,
} from "./role-ids";

/**
 * Idempotently create the built-in system roles (first boot only). Runs during
 * plugin init against a cold cache, so no invalidation is needed.
 */
export async function seedSystemRoles({
  database,
  logger,
}: {
  database: SafeDatabase<typeof schema>;
  logger: { debug: (msg: string) => void; info: (msg: string) => void };
}): Promise<void> {
  const systemRoles = [
    { id: ADMIN_ROLE_ID, name: "Administrators", description: undefined },
    {
      id: USERS_ROLE_ID,
      name: "Users",
      description: "Default role for all authenticated users",
    },
    {
      id: ANONYMOUS_ROLE_ID,
      name: "Anonymous Users",
      description: "Access rules for unauthenticated (anonymous) users",
    },
    {
      id: APPLICATIONS_ROLE_ID,
      name: "Applications",
      description: "Default role for external API applications",
    },
  ];

  logger.debug("🌱 Checking for initial roles...");
  for (const role of systemRoles) {
    const existing = await database
      .select()
      .from(schema.role)
      .where(eq(schema.role.id, role.id));
    if (existing.length > 0) continue;
    await database.insert(schema.role).values({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: true,
    });
    logger.info(`   -> Created '${role.id}' role.`);
  }
}

/**
 * Boot-time (and runtime-registration) seeding of the built-in roles and their
 * default access-rule grants.
 *
 * This module is the ONE sanctioned non-store writer of the `role` /
 * `role_access_rule` tables (see the `no-direct-role-membership-writes` lint
 * rule, which exempts this file):
 *
 * - `seedSystemRoles` creates the built-in roles idempotently (first boot only).
 * - `syncAccessRulesToDb` (fullSync) reconciles the default-rule grants on the
 *   `users` / `anonymous` roles. Its per-plugin hook path (`fullSync: false`)
 *   only ever grants rules to the ADMIN role, which is wildcard-expanded in
 *   `readEnrichedUser` and never read from the role cache.
 *
 * Cache invalidation: the FIRST pod's boot runs against a cold cache, but the
 * auth caches are now SHARED across pods (see `auth-cache.ts`), so a later pod's
 * boot - or a rolling deploy that changes the default-rule set - runs `fullSync`
 * against a cache the running pods already warmed. When a fullSync actually
 * changes a NON-admin role's grants (an orphan cleanup, or a new default granted
 * to `users` / `anonymous`), it must therefore evict the affected shared entries
 * or those pods keep the stale grant until the TTL. Pass `authCache` so it can;
 * the sync is idempotent, so an unchanged fullSync evicts nothing. The
 * admin-only per-plugin hook path needs no eviction (admin is uncached).
 *
 * RUNTIME mutations of these tables (role edits, user role changes) go through
 * `RoleMembershipStore`, which welds the write to its cache invalidation.
 */
export async function syncAccessRulesToDb({
  database,
  logger,
  accessRules,
  fullSync = false,
  authCache,
}: {
  database: SafeDatabase<typeof schema>;
  logger: { debug: (msg: string) => void };
  accessRules: {
    id: string;
    description?: string;
    isDefault?: boolean;
    isPublic?: boolean;
  }[];
  fullSync?: boolean;
  /**
   * Shared auth cache. Only used on the `fullSync` path to evict `role -> rules`
   * / anonymous entries when a default-rule change actually mutates a non-admin
   * role's grants. Optional so boot-time callers without a cache still work.
   */
  authCache?: AuthCache;
}) {
  logger.debug(`🔑 Syncing ${accessRules.length} access rules to database...`);

  for (const rule of accessRules) {
    // Map AccessRule fields to DB fields
    const dbRecord = {
      id: rule.id,
      description: rule.description,
      isAuthenticatedDefault: rule.isDefault,
      isPublicDefault: rule.isPublic,
    };
    const existing = await database
      .select()
      .from(schema.accessRule)
      .where(eq(schema.accessRule.id, rule.id));

    if (existing.length === 0) {
      await database.insert(schema.accessRule).values(dbRecord);
      logger.debug(`   -> Created access rule: ${rule.id}`);
    } else {
      await database
        .update(schema.accessRule)
        .set({ description: rule.description })
        .where(eq(schema.accessRule.id, rule.id));
    }
  }

  // Assign all access rules to admin role
  const adminRoleAccessRules = await database
    .select()
    .from(schema.roleAccessRule)
    .where(eq(schema.roleAccessRule.roleId, "admin"));

  for (const rule of accessRules) {
    const hasAccess = adminRoleAccessRules.some(
      (rp) => rp.accessRuleId === rule.id,
    );

    if (!hasAccess) {
      await database
        .insert(schema.roleAccessRule)
        .values({
          roleId: "admin",
          accessRuleId: rule.id,
        })
        .onConflictDoNothing();
      logger.debug(`   -> Assigned access rule ${rule.id} to admin role`);
    }
  }

  // Only perform orphan cleanup and default sync when doing a full sync
  // (i.e., when we have ALL access rules, not just one plugin's access rules from a hook)
  if (!fullSync) {
    return;
  }

  // Cleanup orphan access rules (no longer registered by any plugin)
  const registeredIds = new Set(accessRules.map((r) => r.id));
  const allDbAccessRules = await database.select().from(schema.accessRule);
  const orphanAccessRules = allDbAccessRules.filter(
    (p) => !registeredIds.has(p.id),
  );

  // An orphan cleanup removes `role_access_rule` rows across ALL roles for the
  // removed rule, so it may have dropped a grant from `users` / `anonymous` /
  // a custom role - conservatively treat any orphan removal as a non-admin
  // (and anonymous) grant change so the shared cache is evicted below.
  const orphansRemoved = orphanAccessRules.length > 0;

  if (orphansRemoved) {
    logger.debug(
      `🧹 Removing ${orphanAccessRules.length} orphan access rule(s)...`,
    );
    for (const orphan of orphanAccessRules) {
      // Delete role_access_rule entries first (FK doesn't cascade)
      await database
        .delete(schema.roleAccessRule)
        .where(eq(schema.roleAccessRule.accessRuleId, orphan.id));
      // Then delete the access rule itself
      await database
        .delete(schema.accessRule)
        .where(eq(schema.accessRule.id, orphan.id));
      logger.debug(`   -> Removed orphan access rule: ${orphan.id}`);
    }
  }

  // Sync authenticated default access rules to users role
  const usersGrantsChanged = await syncAuthenticatedDefaultAccessRulesToUsersRole(
    {
      database,
      logger,
      accessRules,
    },
  );

  // Sync public default access rules to anonymous role
  const anonGrantsChanged = await syncPublicDefaultAccessRulesToAnonymousRole({
    database,
    logger,
    accessRules,
  });

  // Evict the SHARED auth caches only for what actually changed: any orphan
  // removal or a new `users` grant busts `role -> rules`; any orphan removal or
  // a new `anonymous` grant busts the anonymous entry. An unchanged idempotent
  // fullSync (the common later-pod / redeploy case) evicts nothing.
  if (authCache) {
    if (orphansRemoved || usersGrantsChanged) {
      await authCache.invalidateRoleAccessRules();
    }
    if (orphansRemoved || anonGrantsChanged) {
      await authCache.invalidateAnonymousAccessRules();
    }
  }
}

/**
 * Sync authenticated default access rules (isAuthenticatedDefault=true) to the
 * "users" role. Respects admin-disabled defaults stored in
 * disabled_default_access_rule table. Returns whether any grant was added (so
 * the caller can evict the shared `role -> rules` cache).
 */
async function syncAuthenticatedDefaultAccessRulesToUsersRole({
  database,
  logger,
  accessRules,
}: {
  database: SafeDatabase<typeof schema>;
  logger: { debug: (msg: string) => void };
  accessRules: { id: string; isDefault?: boolean }[];
}): Promise<boolean> {
  // Debug: log all access rules with their isDefault status
  logger.debug(
    `[DEBUG] All access rules received (${accessRules.length} total):`,
  );
  for (const r of accessRules) {
    logger.debug(`   -> ${r.id}: isDefault=${r.isDefault}`);
  }

  const defaultRules = accessRules.filter((r) => r.isDefault);
  logger.debug(
    `👥 Found ${defaultRules.length} authenticated default access rules to sync to users role`,
  );
  if (defaultRules.length === 0) {
    logger.debug(
      `   -> No authenticated default access rules found, skipping sync`,
    );
    return false;
  }

  // Get already disabled defaults (admin has removed them)
  const disabledDefaults = await database
    .select()
    .from(schema.disabledDefaultAccessRule);
  const disabledIds = new Set(disabledDefaults.map((d) => d.accessRuleId));

  // Get current users role access rules
  const usersRoleAccessRules = await database
    .select()
    .from(schema.roleAccessRule)
    .where(eq(schema.roleAccessRule.roleId, "users"));

  let changed = false;
  for (const rule of defaultRules) {
    // Skip if admin has disabled this default
    if (disabledIds.has(rule.id)) {
      logger.debug(`   -> Skipping disabled authenticated default: ${rule.id}`);
      continue;
    }

    const hasAccess = usersRoleAccessRules.some(
      (rp) => rp.accessRuleId === rule.id,
    );

    if (!hasAccess) {
      await database.insert(schema.roleAccessRule).values({
        roleId: "users",
        accessRuleId: rule.id,
      });
      changed = true;
      logger.debug(
        `   -> Assigned authenticated default access rule ${rule.id} to users role`,
      );
    }
  }
  return changed;
}

/**
 * Sync public default access rules (isPublic=true) to the "anonymous" role.
 * Respects admin-disabled defaults stored in disabled_public_default_access_rule
 * table. Returns whether any grant was added (so the caller can evict the shared
 * anonymous-access-rules cache).
 */
async function syncPublicDefaultAccessRulesToAnonymousRole({
  database,
  logger,
  accessRules,
}: {
  database: SafeDatabase<typeof schema>;
  logger: { debug: (msg: string) => void };
  accessRules: { id: string; isPublic?: boolean }[];
}): Promise<boolean> {
  const publicDefaults = accessRules.filter((r) => r.isPublic);
  logger.debug(
    `🌐 Found ${publicDefaults.length} public default access rules to sync to anonymous role`,
  );
  if (publicDefaults.length === 0) {
    logger.debug(`   -> No public default access rules found, skipping sync`);
    return false;
  }

  // Get already disabled public defaults (admin has removed them)
  const disabledDefaults = await database
    .select()
    .from(schema.disabledPublicDefaultAccessRule);
  const disabledIds = new Set(disabledDefaults.map((d) => d.accessRuleId));

  // Get current anonymous role access rules
  const anonymousRoleAccessRules = await database
    .select()
    .from(schema.roleAccessRule)
    .where(eq(schema.roleAccessRule.roleId, "anonymous"));

  let changed = false;
  for (const rule of publicDefaults) {
    // Skip if admin has disabled this public default
    if (disabledIds.has(rule.id)) {
      logger.debug(`   -> Skipping disabled public default: ${rule.id}`);
      continue;
    }

    const hasAccess = anonymousRoleAccessRules.some(
      (rp) => rp.accessRuleId === rule.id,
    );

    if (!hasAccess) {
      await database.insert(schema.roleAccessRule).values({
        roleId: "anonymous",
        accessRuleId: rule.id,
      });
      changed = true;
      logger.debug(
        `   -> Assigned public default access rule ${rule.id} to anonymous role`,
      );
    }
  }
  return changed;
}
