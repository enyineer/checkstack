import { describe, it, expect, mock } from "bun:test";
import { enrichUser } from "./user";
import { User } from "better-auth/types";

// Mock Drizzle DB
const createMockDb = (data: {
  roles?: unknown[];
  permissions?: unknown[];
  teams?: unknown[];
}) => {
  const mockDb: unknown = {
    select: mock(() => mockDb),
    from: mock(() => mockDb),
    innerJoin: mock(() => mockDb),
    where: mock(() => mockDb),
  };

  // Track call count for sequential responses
  // Call order in enrichUser: 1=roles, 2+=permissions per role, final=teams
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
      // Permission calls for each non-admin role
      return resolve(data.permissions || []);
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

  it("should enrich user with admin role and wildcard permission", async () => {
    const mockDb = createMockDb({
      roles: [{ roleId: "admin" }],
      teams: [{ teamId: "team-1" }],
    });

    const result = await enrichUser(
      baseUser,
      mockDb as Parameters<typeof enrichUser>[1]
    );

    expect(result.roles).toContain("admin");
    expect(result.permissions).toContain("*");
    expect(result.teamIds).toEqual(["team-1"]);
  });

  it("should enrich user with custom roles and permissions", async () => {
    const mockDb = createMockDb({
      roles: [{ roleId: "editor" }],
      permissions: [{ permissionId: "blog.edit" }],
      teams: [],
    });

    const result = await enrichUser(
      baseUser,
      mockDb as Parameters<typeof enrichUser>[1]
    );

    expect(result.roles).toContain("editor");
    expect(result.permissions).toContain("blog.edit");
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
    expect(result.permissions).toEqual([]);
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
