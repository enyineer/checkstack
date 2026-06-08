import { describe, it, expect, mock } from "bun:test";
import { enrichUser, resolveAllApplicationAccessRules } from "./user";
import { User } from "better-auth/types";

// Mock Drizzle DB
const createMockDb = (data: {
  roles?: unknown[];
  accessRules?: unknown[];
  teams?: unknown[];
}) => {
  const mockDb: unknown = {
    select: mock(() => mockDb),
    from: mock(() => mockDb),
    innerJoin: mock(() => mockDb),
    where: mock(() => mockDb),
  };

  // Track call count for sequential responses
  // Call order in enrichUser: 1=roles, 2+=access rules per role, final=teams
  let callCount = 0;
  const nonAdminRoles = (data.roles || []).filter(
    (r) => (r as { roleId: string }).roleId !== "admin"
  );

  // eslint-disable-next-line unicorn/no-thenable
  (mockDb as { then: unknown }).then = (resolve: (arg0: unknown) => void) => {
    callCount++;
    if (callCount === 1) {
      // First call: get roles
      return resolve(data.roles || []);
    }
    if (callCount <= 1 + nonAdminRoles.length && nonAdminRoles.length > 0) {
      // Access rule calls for each non-admin role
      return resolve(data.accessRules || []);
    }
    // Team memberships (final call)
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
      accessRules: [{ accessRuleId: "blog.edit" }],
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
