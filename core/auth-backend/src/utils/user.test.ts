import { describe, it, expect, mock } from "bun:test";
import { enrichUser, resolveAllApplicationAccessRules } from "./user";
import { User } from "better-auth/types";

// Mock Drizzle DB.
//
// `enrichUser` now runs its reads inside `withScopedTransaction`, and the
// per-role N+1 loop is collapsed into ONE set-based `inArray` query, so the
// query sequence is fixed regardless of role count:
//   1. roles
//   2. access rules (single query — ONLY when there is >=1 non-admin role)
//   3. team memberships
// The `transaction` method invokes the callback with the mock itself so the
// same thenable drives the queries whether they run on `db` or the `tx` handle.
const createMockDb = (data: {
  roles?: unknown[];
  // Rows now carry `roleId` (grouped per role in JS) alongside `accessRuleId`.
  accessRules?: unknown[];
  teams?: unknown[];
}) => {
  const mockDb: unknown = {
    select: mock(() => mockDb),
    from: mock(() => mockDb),
    innerJoin: mock(() => mockDb),
    where: mock(() => mockDb),
    transaction: mock((fn: (tx: unknown) => unknown) => fn(mockDb)),
  };

  let callCount = 0;
  const hasNonAdminRole = (data.roles || []).some(
    (r) => (r as { roleId: string }).roleId !== "admin"
  );

  // eslint-disable-next-line unicorn/no-thenable
  (mockDb as { then: unknown }).then = (resolve: (arg0: unknown) => void) => {
    callCount++;
    if (callCount === 1) {
      // First query: roles.
      return resolve(data.roles || []);
    }
    if (callCount === 2 && hasNonAdminRole) {
      // Single set-based access-rule query (only when non-admin roles exist).
      return resolve(data.accessRules || []);
    }
    // Team memberships (final query).
    return resolve(data.teams || []);
  };

  return mockDb;
};

describe("enrichUser", () => {
  const baseUser: User = {
    id: "user-1",
    email: "test@example.com",
    emailVerified: true,
    name: "Test User",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("should enrich user with admin role and wildcard access", async () => {
    const mockDb = createMockDb({
      roles: [{ roleId: "admin" }],
      teams: [{ teamId: "team-1" }],
    });

    const result = await enrichUser(
      baseUser,
      mockDb as Parameters<typeof enrichUser>[1]
    );

    expect(result.roles).toContain("admin");
    expect(result.accessRules).toContain("*");
    expect(result.teamIds).toEqual(["team-1"]);
  });

  it("should enrich user with custom roles and access rules", async () => {
    const mockDb = createMockDb({
      roles: [{ roleId: "editor" }],
      accessRules: [{ roleId: "editor", accessRuleId: "blog.edit" }],
      teams: [],
    });

    const result = await enrichUser(
      baseUser,
      mockDb as Parameters<typeof enrichUser>[1]
    );

    expect(result.roles).toContain("editor");
    expect(result.accessRules).toContain("blog.edit");
    expect(result.teamIds).toEqual([]);
  });

  it("merges the access rules of a user's multiple roles (set-based, no N+1)", async () => {
    // Two non-admin roles, each contributing rules (one overlapping) — the
    // single `inArray` query returns every row; the merged result must be the
    // deduped union, exactly as the old per-role loop produced.
    const mockDb = createMockDb({
      roles: [{ roleId: "editor" }, { roleId: "reviewer" }],
      accessRules: [
        { roleId: "editor", accessRuleId: "blog.edit" },
        { roleId: "editor", accessRuleId: "blog.read" },
        { roleId: "reviewer", accessRuleId: "blog.read" },
        { roleId: "reviewer", accessRuleId: "blog.approve" },
      ],
      teams: [{ teamId: "team-1" }],
    });

    const result = await enrichUser(
      baseUser,
      mockDb as Parameters<typeof enrichUser>[1]
    );

    expect(result.roles).toEqual(["editor", "reviewer"]);
    // Deduped union of both roles' rules, in role-insertion order.
    expect(result.accessRules).toEqual(["blog.edit", "blog.read", "blog.approve"]);
    expect(result.teamIds).toEqual(["team-1"]);
  });

  it("wildcards admin while still merging a co-assigned custom role's rules", async () => {
    const mockDb = createMockDb({
      roles: [{ roleId: "admin" }, { roleId: "editor" }],
      accessRules: [{ roleId: "editor", accessRuleId: "blog.edit" }],
      teams: [],
    });

    const result = await enrichUser(
      baseUser,
      mockDb as Parameters<typeof enrichUser>[1]
    );

    expect(result.roles).toEqual(["admin", "editor"]);
    expect(result.accessRules).toEqual(["*", "blog.edit"]);
  });

  it("should handle user with no roles", async () => {
    const mockDb = createMockDb({
      roles: [],
      teams: [],
    });

    const result = await enrichUser(
      baseUser,
      mockDb as Parameters<typeof enrichUser>[1]
    );

    expect(result.roles).toEqual([]);
    expect(result.accessRules).toEqual([]);
    expect(result.teamIds).toEqual([]);
  });

  it("should include multiple team memberships", async () => {
    const mockDb = createMockDb({
      roles: [{ roleId: "admin" }],
      teams: [{ teamId: "team-1" }, { teamId: "team-2" }, { teamId: "team-3" }],
    });

    const result = await enrichUser(
      baseUser,
      mockDb as Parameters<typeof enrichUser>[1]
    );

    expect(result.teamIds).toHaveLength(3);
    expect(result.teamIds).toContain("team-1");
    expect(result.teamIds).toContain("team-2");
    expect(result.teamIds).toContain("team-3");
  });
});

/**
 * Mock DB that resolves successive `await`s with the supplied rows in order.
 * `resolveAllApplicationAccessRules` awaits at most two queries: the
 * application->role links, then (only when there are non-admin roles) the
 * access rules for those roles.
 */
const createSequentialMockDb = (responses: unknown[][]) => {
  const mockDb: unknown = {
    select: mock(() => mockDb),
    from: mock(() => mockDb),
    where: mock(() => mockDb),
  };
  let callCount = 0;
  // eslint-disable-next-line unicorn/no-thenable
  (mockDb as { then: unknown }).then = (resolve: (arg0: unknown) => void) => {
    const rows = responses[callCount] ?? [];
    callCount++;
    return resolve(rows);
  };
  return mockDb;
};

describe("resolveAllApplicationAccessRules", () => {
  type Db = Parameters<typeof resolveAllApplicationAccessRules>[0];

  it("expands the built-in admin role to a wildcard and skips the rule query", async () => {
    const mockDb = createSequentialMockDb([
      [{ applicationId: "app-admin", roleId: "admin" }],
    ]);

    const result = await resolveAllApplicationAccessRules(mockDb as Db);

    expect(result.get("app-admin")).toEqual(["*"]);
  });

  it("aggregates rules across an application's roles and unions duplicates", async () => {
    const mockDb = createSequentialMockDb([
      [
        { applicationId: "app-1", roleId: "editor" },
        { applicationId: "app-1", roleId: "reviewer" },
      ],
      [
        { roleId: "editor", accessRuleId: "blog.edit" },
        { roleId: "editor", accessRuleId: "blog.read" },
        { roleId: "reviewer", accessRuleId: "blog.read" },
      ],
    ]);

    const result = await resolveAllApplicationAccessRules(mockDb as Db);

    expect(result.get("app-1")?.sort()).toEqual(["blog.edit", "blog.read"]);
  });

  it("resolves multiple applications independently in a single pass", async () => {
    const mockDb = createSequentialMockDb([
      [
        { applicationId: "app-1", roleId: "editor" },
        { applicationId: "app-2", roleId: "admin" },
      ],
      [{ roleId: "editor", accessRuleId: "blog.edit" }],
    ]);

    const result = await resolveAllApplicationAccessRules(mockDb as Db);

    expect(result.get("app-1")).toEqual(["blog.edit"]);
    expect(result.get("app-2")).toEqual(["*"]);
  });

  it("returns an empty map when no application has any role", async () => {
    const mockDb = createSequentialMockDb([[]]);

    const result = await resolveAllApplicationAccessRules(mockDb as Db);

    expect(result.size).toBe(0);
  });
});
