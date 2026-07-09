import { describe, test, expect } from "bun:test";
import type { SafeDatabase } from "@checkstack/backend-api";
import { RoleMembershipStore } from "./role-membership-store";
import type { AuthCache } from "./auth-cache";
import * as schema from "./schema";

/**
 * The store is the single sanctioned writer of the role-membership tables and
 * welds each write to its shared-cache invalidation. These tests exercise that
 * orchestration against a mock DB and a recording {@link AuthCache}: they assert
 * WHICH invalidation methods fire (and with which key), so a future edit that
 * drops an invalidation is caught here.
 */

/**
 * A minimal chainable mock DB covering exactly the write shapes the store uses:
 * `insert(t).values(v)`, `delete(t).where(c)`, `update(t).set(v).where(c)`, and
 * `transaction(cb)` (runs `cb` against the same mock). Each terminal resolves to
 * a promise so the store's `await`s complete. We assert on cache effects, not
 * the SQL, so the queries need no real behaviour.
 */
function createMockDb(): SafeDatabase<typeof schema> {
  const db: Record<string, unknown> = {
    insert: () => ({ values: async () => undefined }),
    delete: () => ({ where: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  };
  return db as unknown as SafeDatabase<typeof schema>;
}

/** Records every invalidation call so tests can assert method + key. */
function makeRecordingAuthCache() {
  const calls: { method: string; arg?: string }[] = [];
  const authCache: AuthCache = {
    resolveUserRoles: ({ loadRoles }) => loadRoles(),
    resolveRoleAccessRules: ({ nonAdminRoleIds, loadMisses }) =>
      nonAdminRoleIds.length === 0
        ? Promise.resolve(new Map<string, string[]>())
        : loadMisses(nonAdminRoleIds),
    invalidateUserRoles: async (userId) => {
      calls.push({ method: "invalidateUserRoles", arg: userId });
    },
    invalidateRoleAccessRules: async (roleId) => {
      calls.push({ method: "invalidateRoleAccessRules", arg: roleId });
    },
    invalidateAnonymousAccessRules: async () => {
      calls.push({ method: "invalidateAnonymousAccessRules" });
    },
  };
  return { authCache, calls };
}

describe("createRole", () => {
  test("writes without any cache invalidation (a new role cannot be cached)", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.createRole({ id: "new-role", name: "New", accessRuleIds: ["a"] });
    expect(calls).toEqual([]);
  });
});

describe("updateRole", () => {
  test("replacing rules evicts that role", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.updateRole({ roleId: "editor", replaceAccessRuleIds: ["new"] });
    expect(calls).toEqual([
      { method: "invalidateRoleAccessRules", arg: "editor" },
    ]);
  });

  test("name-only update (undefined rules) invalidates nothing", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.updateRole({ roleId: "editor", name: "Renamed" });
    expect(calls).toEqual([]);
  });

  test("editing the anonymous role also evicts the anonymous-rules entry", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.updateRole({
      roleId: "anonymous",
      replaceAccessRuleIds: ["public.read"],
    });
    expect(calls.map((c) => c.method)).toEqual([
      "invalidateRoleAccessRules",
      "invalidateAnonymousAccessRules",
    ]);
  });
});

describe("deleteRole", () => {
  test("evicts the role and the whole user-roles cache", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.deleteRole({ roleId: "doomed" });
    expect(calls).toEqual([
      { method: "invalidateRoleAccessRules", arg: "doomed" },
      { method: "invalidateUserRoles", arg: undefined },
    ]);
  });
});

describe("setUserRoles", () => {
  test("evicts the user", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.setUserRoles({ userId: "u1", roleIds: ["editor"] });
    expect(calls).toEqual([{ method: "invalidateUserRoles", arg: "u1" }]);
  });
});

describe("syncUserRoles", () => {
  test("no changes → no write, no invalidation, returns false", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    const changed = await store.syncUserRoles({
      userId: "u1",
      addRoleIds: [],
      removeRoleIds: [],
    });
    expect(changed).toBe(false);
    expect(calls).toEqual([]);
  });

  test("a change evicts the user, returns true", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    const changed = await store.syncUserRoles({
      userId: "u1",
      addRoleIds: ["editor"],
      removeRoleIds: [],
    });
    expect(changed).toBe(true);
    expect(calls).toEqual([{ method: "invalidateUserRoles", arg: "u1" }]);
  });
});

describe("tx-participating helpers (new / deleted users) do not invalidate", () => {
  test("grantInitialRoles writes but never invalidates", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.grantInitialRoles({
      runner: createMockDb(),
      userId: "new-user",
      roleIds: ["users"],
    });
    expect(calls).toEqual([]);
  });

  test("deleteUserMemberships writes but never invalidates", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.deleteUserMemberships({ runner: createMockDb(), userId: "gone" });
    expect(calls).toEqual([]);
  });
});

describe("removeAccessRuleMappings", () => {
  test("busts the whole role-rules cache AND the anonymous entry when ids are given", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.removeAccessRuleMappings({ accessRuleIds: ["r"] });
    // A removed rule may have been granted to the anonymous role, so both the
    // role-rules cache and the anonymous entry must be evicted.
    expect(calls).toEqual([
      { method: "invalidateRoleAccessRules", arg: undefined },
      { method: "invalidateAnonymousAccessRules" },
    ]);
  });

  test("no ids → no write, no invalidation", async () => {
    const { authCache, calls } = makeRecordingAuthCache();
    const store = new RoleMembershipStore(createMockDb(), authCache);
    await store.removeAccessRuleMappings({ accessRuleIds: [] });
    expect(calls).toEqual([]);
  });
});
