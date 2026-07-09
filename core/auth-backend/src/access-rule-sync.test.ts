import { describe, it, expect } from "bun:test";
import type { SafeDatabase } from "@checkstack/backend-api";
import { syncAccessRulesToDb } from "./access-rule-sync";
import type { AuthCache } from "./auth-cache";
import * as schema from "./schema";

/**
 * These lock in the SHARED-cache invalidation the fullSync path must perform when
 * a default-rule change actually mutates a non-admin role's grants (a later
 * pod's boot / a redeploy runs fullSync against a cache the cluster already
 * warmed). The DB is a sequential mock driven by the function's deterministic
 * query order; we assert only on the invalidation calls, not the SQL.
 */

/** Records which invalidation methods the sync calls. */
function makeRecordingAuthCache() {
  const calls: string[] = [];
  const authCache: AuthCache = {
    resolveUserRoles: ({ loadRoles }) => loadRoles(),
    resolveRoleAccessRules: ({ nonAdminRoleIds, loadMisses }) =>
      nonAdminRoleIds.length === 0
        ? Promise.resolve(new Map())
        : loadMisses(nonAdminRoleIds),
    invalidateUserRoles: async () => {
      calls.push("invalidateUserRoles");
    },
    invalidateRoleAccessRules: async () => {
      calls.push("invalidateRoleAccessRules");
    },
    invalidateAnonymousAccessRules: async () => {
      calls.push("invalidateAnonymousAccessRules");
    },
  };
  return { authCache, calls };
}

/**
 * A chainable mock DB whose SELECTs resolve, in call order, from `selectResults`;
 * inserts/updates/deletes are no-op awaitables (and `.onConflictDoNothing()` is
 * supported). The function's query order for a fullSync of a single public rule:
 *   1. accessRule existence  2. admin roleAccessRule  3. all accessRule (orphans)
 *   4. disabledPublicDefaultAccessRule  5. anonymous roleAccessRule
 * (the authenticated-defaults sync issues no SELECT when there are no isDefault
 * rules, so it is absent from this order.)
 */
function createSeqMockDb(selectResults: unknown[][]): SafeDatabase<typeof schema> {
  let i = 0;
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    // eslint-disable-next-line unicorn/no-thenable
    chain.then = (resolve: (value: unknown) => void) =>
      resolve(selectResults[i++] ?? []);
    return chain;
  };
  const db: Record<string, unknown> = {
    select: () => makeSelectChain(),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
        // eslint-disable-next-line unicorn/no-thenable
        then: (resolve: (value: unknown) => void) => resolve(undefined),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  };
  return db as unknown as SafeDatabase<typeof schema>;
}

const silentLogger = { debug: () => {} };

describe("syncAccessRulesToDb fullSync cache invalidation", () => {
  it("invalidates the anonymous entry when a new public default is granted", async () => {
    // New rule (not in DB), admin lacks it, no orphans, not yet on anonymous.
    const db = createSeqMockDb([
      [], // 1. accessRule existence -> new
      [], // 2. admin roleAccessRule -> lacks it
      [{ id: "pub.read" }], // 3. all accessRule -> no orphans
      [], // 4. disabledPublicDefaultAccessRule
      [], // 5. anonymous roleAccessRule -> lacks it (will insert -> changed)
    ]);
    const { authCache, calls } = makeRecordingAuthCache();

    await syncAccessRulesToDb({
      database: db,
      logger: silentLogger,
      accessRules: [{ id: "pub.read", isPublic: true }],
      fullSync: true,
      authCache,
    });

    // Anonymous grant changed -> anon evicted. users unchanged + no orphans ->
    // role-rules NOT evicted.
    expect(calls).toEqual(["invalidateAnonymousAccessRules"]);
  });

  it("evicts nothing on an idempotent fullSync (everything already granted)", async () => {
    const db = createSeqMockDb([
      [{ id: "pub.read" }], // 1. accessRule exists -> update path
      [{ accessRuleId: "pub.read" }], // 2. admin already has it
      [{ id: "pub.read" }], // 3. all accessRule -> no orphans
      [], // 4. disabledPublicDefaultAccessRule
      [{ accessRuleId: "pub.read" }], // 5. anonymous already has it -> no change
    ]);
    const { authCache, calls } = makeRecordingAuthCache();

    await syncAccessRulesToDb({
      database: db,
      logger: silentLogger,
      accessRules: [{ id: "pub.read", isPublic: true }],
      fullSync: true,
      authCache,
    });

    expect(calls).toEqual([]);
  });

  it("does not throw when no authCache is provided", async () => {
    const db = createSeqMockDb([[], [], [{ id: "pub.read" }], [], []]);
    await syncAccessRulesToDb({
      database: db,
      logger: silentLogger,
      accessRules: [{ id: "pub.read", isPublic: true }],
      fullSync: true,
    });
    // No assertion needed: reaching here without throwing is the check.
    expect(true).toBe(true);
  });
});
