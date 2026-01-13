import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createAuthRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import { z } from "zod";
import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** Type alias for the database type used in auth router */
type AuthDatabase = NodePgDatabase<typeof schema>;

/**
 * Tests for Team and Resource-Level Access Control endpoints.
 *
 * These tests cover:
 * - Team CRUD operations (getTeams, createTeam, updateTeam, deleteTeam)
 * - Team membership management (addUserToTeam, removeUserFromTeam)
 * - Team manager operations (addTeamManager, removeTeamManager)
 * - Resource access grants (getResourceTeamAccess, setResourceTeamAccess, removeResourceTeamAccess)
 * - S2S access checks (checkResourceTeamAccess, getAccessibleResourceIds)
 */
describe("Teams and Resource Access Control", () => {
  // Mock user with admin permissions
  const mockAdminUser = {
    type: "user" as const,
    id: "admin-user",
    permissions: ["*"],
    roles: ["admin"],
    teamIds: ["team-alpha"],
  };

  // Mock regular user with limited permissions
  const mockRegularUser = {
    type: "user" as const,
    id: "regular-user",
    permissions: ["auth.teams.read"],
    roles: ["users"],
    teamIds: ["team-beta"],
  };

  // Mock service user for S2S calls
  const mockServiceUser = {
    type: "service" as const,
    pluginId: "backend-api",
  };

  /**
   * Creates a chainable mock for database query operations.
   * Allows chaining .where().innerJoin().limit().offset().orderBy()
   */
  function createChain<T>(data: T[] = []): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      where: mock(() => chain),
      innerJoin: mock(() => chain),
      limit: mock(() => chain),
      offset: mock(() => chain),
      orderBy: mock(() => chain),
      onConflictDoUpdate: mock(() => Promise.resolve()),
      onConflictDoNothing: mock(() => Promise.resolve()),
      then: (resolve: (value: T[]) => void) => Promise.resolve(resolve(data)),
    };
    return chain;
  }

  /**
   * Creates a fresh mock database for each test.
   * Uses type assertion to satisfy NodePgDatabase interface for testing.
   */
  function createMockDb(): AuthDatabase {
    const mockDb = {
      select: mock(() => ({
        from: mock(() => createChain([])),
      })),
      insert: mock(() => ({
        values: mock(() => ({
          onConflictDoNothing: mock(() => Promise.resolve()),
          onConflictDoUpdate: mock(() => Promise.resolve()),
          then: (resolve: (value: unknown) => void) =>
            Promise.resolve(resolve(undefined)),
        })),
      })),
      update: mock(() => ({
        set: mock(() => ({
          where: mock(() => Promise.resolve()),
        })),
      })),
      delete: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
      transaction: mock((cb: (tx: typeof mockDb) => Promise<void>) =>
        cb(mockDb)
      ),
    };
    // Type assertion for mock database - only used in tests
    return mockDb as unknown as AuthDatabase;
  }

  const mockRegistry = {
    getStrategies: () => [
      {
        id: "credential",
        displayName: "Credentials",
        description: "Email and password authentication",
        configSchema: z.object({ enabled: z.boolean() }),
        configVersion: 1,
        migrations: [],
        requiresManualRegistration: true,
      },
    ],
  };

  const mockConfigService = {
    get: mock(() => Promise.resolve(undefined)),
    getRedacted: mock(() => Promise.resolve({})),
    set: mock(() => Promise.resolve()),
    delete: mock(() => Promise.resolve()),
    list: mock(() => Promise.resolve([])),
  };

  const mockPermissionRegistry = {
    getPermissions: () => [
      { id: "auth.teams.read", description: "View teams" },
      { id: "auth.teams.manage", description: "Manage teams" },
    ],
  };

  // ==========================================================================
  // TEAM CRUD TESTS
  // ==========================================================================

  describe("getTeams", () => {
    it("returns empty array when no teams exist", async () => {
      const mockDb = createMockDb();
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(router.getTeams, undefined, { context });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it("returns teams with member counts", async () => {
      const mockDb = createMockDb();

      // Mock teams query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              id: "team-1",
              name: "Platform Team",
              description: "Core platform team",
            },
            { id: "team-2", name: "API Team", description: null },
          ])
        ),
      }));

      // Mock member counts query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { teamId: "team-1" },
            { teamId: "team-1" },
            { teamId: "team-2" },
          ])
        ),
      }));

      // Mock manager query (user is manager of team-1)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ teamId: "team-1", userId: "admin-user" }])
        ),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(router.getTeams, undefined, { context });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "team-1",
        name: "Platform Team",
        description: "Core platform team",
        memberCount: 2,
        isManager: true,
      });
      expect(result[1]).toEqual({
        id: "team-2",
        name: "API Team",
        description: null,
        memberCount: 1,
        isManager: false,
      });
    });
  });

  describe("getTeam", () => {
    it("returns undefined for non-existent team", async () => {
      const mockDb = createMockDb();

      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.getTeam,
        { teamId: "non-existent" },
        { context }
      );

      expect(result).toBeUndefined();
    });

    it("returns team with members and managers", async () => {
      const mockDb = createMockDb();

      // Mock team query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              id: "team-1",
              name: "Platform Team",
              description: "Core team",
            },
          ])
        ),
      }));

      // Mock members query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ userId: "user-1" }, { userId: "user-2" }])
        ),
      }));

      // Mock managers query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ userId: "user-1" }])),
      }));

      // Mock users query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { id: "user-1", name: "Alice", email: "alice@test.com" },
            { id: "user-2", name: "Bob", email: "bob@test.com" },
          ])
        ),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.getTeam,
        { teamId: "team-1" },
        { context }
      );

      expect(result).toBeDefined();
      expect(result?.name).toBe("Platform Team");
      expect(result?.members).toHaveLength(2);
      expect(result?.managers).toHaveLength(1);
    });
  });

  describe("createTeam", () => {
    it("creates team with name and description", async () => {
      const mockDb = createMockDb();
      let insertedData: Record<string, unknown> | undefined;

      (mockDb.insert as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        values: mock((data: Record<string, unknown>) => {
          insertedData = data;
          return Promise.resolve();
        }),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.createTeam,
        { name: "New Team", description: "A new team" },
        { context }
      );

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(mockDb.insert).toHaveBeenCalled();
      expect(insertedData?.name).toBe("New Team");
      expect(insertedData?.description).toBe("A new team");
    });

    it("creates team with minimal data", async () => {
      const mockDb = createMockDb();

      (mockDb.insert as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        values: mock(() => Promise.resolve()),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.createTeam,
        { name: "Minimal Team" },
        { context }
      );

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });
  });

  describe("updateTeam", () => {
    it("updates team name", async () => {
      const mockDb = createMockDb();
      let updatedData: Record<string, unknown> | undefined;

      (mockDb.update as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        set: mock((data: Record<string, unknown>) => {
          updatedData = data;
          return {
            where: mock(() => Promise.resolve()),
          };
        }),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.updateTeam,
        { id: "team-1", name: "Updated Name" },
        { context }
      );

      expect(mockDb.update).toHaveBeenCalled();
      expect(updatedData?.name).toBe("Updated Name");
      expect(updatedData?.updatedAt).toBeInstanceOf(Date);
    });

    it("updates team description", async () => {
      const mockDb = createMockDb();
      let updatedData: Record<string, unknown> | undefined;

      (mockDb.update as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        set: mock((data: Record<string, unknown>) => {
          updatedData = data;
          return {
            where: mock(() => Promise.resolve()),
          };
        }),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.updateTeam,
        { id: "team-1", description: "New description" },
        { context }
      );

      expect(updatedData?.description).toBe("New description");
    });
  });

  describe("deleteTeam", () => {
    it("deletes team and cascades to related tables", async () => {
      const mockDb = createMockDb();
      const deletedTables: unknown[] = [];

      const mockTx = {
        delete: mock((table: unknown) => {
          deletedTables.push(table);
          return {
            where: mock(() => Promise.resolve()),
          };
        }),
      };

      (mockDb.transaction as ReturnType<typeof mock>).mockImplementationOnce(
        (cb: (tx: typeof mockTx) => Promise<void>) => cb(mockTx)
      );

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(router.deleteTeam, "team-1", { context });

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(deletedTables).toHaveLength(5);
      expect(deletedTables.includes(schema.userTeam)).toBe(true);
      expect(deletedTables.includes(schema.teamManager)).toBe(true);
      expect(deletedTables.includes(schema.applicationTeam)).toBe(true);
      expect(deletedTables.includes(schema.resourceTeamAccess)).toBe(true);
      expect(deletedTables.includes(schema.team)).toBe(true);
    });
  });

  // ==========================================================================
  // TEAM MEMBERSHIP TESTS
  // ==========================================================================

  describe("addUserToTeam", () => {
    it("adds user to team with conflict handling", async () => {
      const mockDb = createMockDb();
      let insertedData: Record<string, unknown> | undefined;

      (mockDb.insert as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        values: mock((data: Record<string, unknown>) => {
          insertedData = data;
          return {
            onConflictDoNothing: mock(() => Promise.resolve()),
          };
        }),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.addUserToTeam,
        { teamId: "team-1", userId: "user-1" },
        { context }
      );

      expect(mockDb.insert).toHaveBeenCalled();
      expect(insertedData?.teamId).toBe("team-1");
      expect(insertedData?.userId).toBe("user-1");
    });
  });

  describe("removeUserFromTeam", () => {
    it("removes user from team", async () => {
      const mockDb = createMockDb();

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.removeUserFromTeam,
        { teamId: "team-1", userId: "user-1" },
        { context }
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // TEAM MANAGER TESTS
  // ==========================================================================

  describe("addTeamManager", () => {
    it("grants manager privileges", async () => {
      const mockDb = createMockDb();
      let insertedData: Record<string, unknown> | undefined;

      (mockDb.insert as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        values: mock((data: Record<string, unknown>) => {
          insertedData = data;
          return {
            onConflictDoNothing: mock(() => Promise.resolve()),
          };
        }),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.addTeamManager,
        { teamId: "team-1", userId: "user-1" },
        { context }
      );

      expect(mockDb.insert).toHaveBeenCalled();
      expect(insertedData?.teamId).toBe("team-1");
      expect(insertedData?.userId).toBe("user-1");
    });
  });

  describe("removeTeamManager", () => {
    it("revokes manager privileges", async () => {
      const mockDb = createMockDb();

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.removeTeamManager,
        { teamId: "team-1", userId: "user-1" },
        { context }
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // RESOURCE ACCESS GRANT TESTS
  // ==========================================================================

  describe("getResourceTeamAccess", () => {
    it("returns empty array when no grants exist", async () => {
      const mockDb = createMockDb();

      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => ({
          innerJoin: mock(() => createChain([])),
        })),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.getResourceTeamAccess,
        { resourceType: "catalog.system", resourceId: "sys-1" },
        { context }
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it("returns grants with team names", async () => {
      const mockDb = createMockDb();

      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => ({
          innerJoin: mock(() =>
            createChain([
              {
                resource_team_access: {
                  teamId: "team-1",
                  canRead: true,
                  canManage: true,
                },
                team: { name: "Platform Team" },
              },
              {
                resource_team_access: {
                  teamId: "team-2",
                  canRead: true,
                  canManage: false,
                },
                team: { name: "API Team" },
              },
            ])
          ),
        })),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.getResourceTeamAccess,
        { resourceType: "catalog.system", resourceId: "sys-1" },
        { context }
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        teamId: "team-1",
        teamName: "Platform Team",
        canRead: true,
        canManage: true,
      });
      expect(result[1]).toEqual({
        teamId: "team-2",
        teamName: "API Team",
        canRead: true,
        canManage: false,
      });
    });
  });

  describe("setResourceTeamAccess", () => {
    it("creates new grant with default permissions", async () => {
      const mockDb = createMockDb();
      let insertedData: Record<string, unknown> | undefined;

      (mockDb.insert as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        values: mock((data: Record<string, unknown>) => {
          insertedData = data;
          return {
            onConflictDoUpdate: mock(() => Promise.resolve()),
          };
        }),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.setResourceTeamAccess,
        {
          resourceType: "catalog.system",
          resourceId: "sys-1",
          teamId: "team-1",
        },
        { context }
      );

      expect(mockDb.insert).toHaveBeenCalled();
      expect(insertedData?.resourceType).toBe("catalog.system");
      expect(insertedData?.resourceId).toBe("sys-1");
      expect(insertedData?.teamId).toBe("team-1");
      expect(insertedData?.canRead).toBe(true);
      expect(insertedData?.canManage).toBe(false);
    });

    it("creates grant with custom permissions", async () => {
      const mockDb = createMockDb();
      let insertedData: Record<string, unknown> | undefined;

      (mockDb.insert as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        values: mock((data: Record<string, unknown>) => {
          insertedData = data;
          return {
            onConflictDoUpdate: mock(() => Promise.resolve()),
          };
        }),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.setResourceTeamAccess,
        {
          resourceType: "catalog.system",
          resourceId: "sys-1",
          teamId: "team-1",
          canRead: true,
          canManage: true,
        },
        { context }
      );

      expect(insertedData?.canRead).toBe(true);
      expect(insertedData?.canManage).toBe(true);
    });
  });

  describe("removeResourceTeamAccess", () => {
    it("removes grant for specific team", async () => {
      const mockDb = createMockDb();

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.removeResourceTeamAccess,
        {
          resourceType: "catalog.system",
          resourceId: "sys-1",
          teamId: "team-1",
        },
        { context }
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // S2S ACCESS CHECK TESTS
  // ==========================================================================

  describe("checkResourceTeamAccess (S2S)", () => {
    it("allows access when no grants exist and user has global permission", async () => {
      const mockDb = createMockDb();

      // No grants exist
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      const result = await call(
        router.checkResourceTeamAccess,
        {
          userId: "user-1",
          userType: "user",
          resourceType: "catalog.system",
          resourceId: "sys-1",
          action: "read",
          hasGlobalPermission: true,
        },
        { context }
      );

      expect(result.hasAccess).toBe(true);
    });

    it("denies access when no grants exist and user lacks global permission", async () => {
      const mockDb = createMockDb();

      // No grants exist
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      const result = await call(
        router.checkResourceTeamAccess,
        {
          userId: "user-1",
          userType: "user",
          resourceType: "catalog.system",
          resourceId: "sys-1",
          action: "read",
          hasGlobalPermission: false,
        },
        { context }
      );

      expect(result.hasAccess).toBe(false);
    });

    it("allows access when user's team has grant with canRead", async () => {
      const mockDb = createMockDb();

      // Grant exists for team-1
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              teamId: "team-1",
              canRead: true,
              canManage: false,
            },
          ])
        ),
      }));

      // Settings query - returns empty (teamOnly = false by default)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      // User is member of team-1
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      const result = await call(
        router.checkResourceTeamAccess,
        {
          userId: "user-1",
          userType: "user",
          resourceType: "catalog.system",
          resourceId: "sys-1",
          action: "read",
          hasGlobalPermission: false,
        },
        { context }
      );

      expect(result.hasAccess).toBe(true);
    });

    it("denies access when user's team has grant but lacks canManage for manage action", async () => {
      const mockDb = createMockDb();

      // Grant exists for team-1 with only read permission
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              teamId: "team-1",
              canRead: true,
              canManage: false,
            },
          ])
        ),
      }));

      // Settings query - returns empty (teamOnly = false by default)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      // User is member of team-1
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      const result = await call(
        router.checkResourceTeamAccess,
        {
          userId: "user-1",
          userType: "user",
          resourceType: "catalog.system",
          resourceId: "sys-1",
          action: "manage",
          hasGlobalPermission: false,
        },
        { context }
      );

      expect(result.hasAccess).toBe(false);
    });

    it("allows access for teamOnly resource when user is in granted team", async () => {
      const mockDb = createMockDb();

      // Grant exists for team-1
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              teamId: "team-1",
              canRead: true,
              canManage: false,
            },
          ])
        ),
      }));

      // Settings query - returns teamOnly = true
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ teamOnly: true, resourceId: "sys-1" }])
        ),
      }));

      // User is member of team-1
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      const result = await call(
        router.checkResourceTeamAccess,
        {
          userId: "user-1",
          userType: "user",
          resourceType: "catalog.system",
          resourceId: "sys-1",
          action: "read",
          hasGlobalPermission: true, // Global permission doesn't help with teamOnly
        },
        { context }
      );

      expect(result.hasAccess).toBe(true);
    });

    it("denies access for teamOnly resource when user is not in granted team", async () => {
      const mockDb = createMockDb();

      // Grant exists for team-1
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              teamId: "team-1",
              canRead: true,
              canManage: false,
            },
          ])
        ),
      }));

      // Settings query - returns teamOnly = true
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ teamOnly: true, resourceId: "sys-1" }])
        ),
      }));

      // User is member of team-2 (not team-1)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-2" }])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      const result = await call(
        router.checkResourceTeamAccess,
        {
          userId: "user-1",
          userType: "user",
          resourceType: "catalog.system",
          resourceId: "sys-1",
          action: "read",
          hasGlobalPermission: true, // Global permission doesn't help with teamOnly
        },
        { context }
      );

      expect(result.hasAccess).toBe(false);
    });
  });

  describe("getAccessibleResourceIds (S2S)", () => {
    it("returns empty array for empty input", async () => {
      const mockDb = createMockDb();

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      const result = await call(
        router.getAccessibleResourceIds,
        {
          userId: "user-1",
          userType: "user",
          resourceType: "catalog.system",
          resourceIds: [],
          action: "read",
          hasGlobalPermission: true,
        },
        { context }
      );

      expect(result).toEqual([]);
    });

    it("returns all resources when no grants exist and user has global permission", async () => {
      const mockDb = createMockDb();

      // No grants exist
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      // User teams (not used when no grants)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      const result = await call(
        router.getAccessibleResourceIds,
        {
          userId: "user-1",
          userType: "user",
          resourceType: "catalog.system",
          resourceIds: ["sys-1", "sys-2", "sys-3"],
          action: "read",
          hasGlobalPermission: true,
        },
        { context }
      );

      expect(result).toEqual(["sys-1", "sys-2", "sys-3"]);
    });

    it("filters resources based on team grants", async () => {
      const mockDb = createMockDb();

      // Grants exist for sys-1 (team-1) and sys-2 (team-2)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              resourceId: "sys-1",
              teamId: "team-1",
              canRead: true,
              canManage: false,
            },
            {
              resourceId: "sys-2",
              teamId: "team-2",
              canRead: true,
              canManage: false,
            },
          ])
        ),
      }));

      // Settings query - both sys-1 and sys-2 are teamOnly
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { resourceId: "sys-1", teamOnly: true },
            { resourceId: "sys-2", teamOnly: true },
          ])
        ),
      }));

      // User is member of team-1 only
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      const result = await call(
        router.getAccessibleResourceIds,
        {
          userId: "user-1",
          userType: "user",
          resourceType: "catalog.system",
          resourceIds: ["sys-1", "sys-2", "sys-3"],
          action: "read",
          hasGlobalPermission: true,
        },
        { context }
      );

      // sys-1: user is in team-1, granted
      // sys-2: user is not in team-2, denied (teamOnly)
      // sys-3: no grants, allowed by global permission
      expect(result).toContain("sys-1");
      expect(result).not.toContain("sys-2");
      expect(result).toContain("sys-3");
    });
  });

  describe("deleteResourceGrants (S2S)", () => {
    it("deletes all grants for a resource", async () => {
      const mockDb = createMockDb();

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockPermissionRegistry
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      await call(
        router.deleteResourceGrants,
        {
          resourceType: "catalog.system",
          resourceId: "sys-1",
        },
        { context }
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
