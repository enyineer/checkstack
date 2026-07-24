import { describe, it, expect, mock } from "bun:test";
import { createAuthRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import { z } from "zod";
import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";

/** Type alias for the database type used in auth router */
type AuthDatabase = SafeDatabase<typeof schema>;

/**
 * Tests for Team and Resource-Level Access Control endpoints.
 *
 * The access layer is now a single relation-tuple store (Target B). Every
 * resource grant lives in `schema.relationTuple` as a row:
 *   { objectType, objectId, relation, subjectType, subjectId }
 * - a team grant:   subjectType "team",   relation "viewer" | "editor" | "owner"
 * - the privacy marker: subjectType "public" ("*"), relation "private". Its
 *   PRESENCE means the object is PRIVATE (global RBAC path closed); its ABSENCE
 *   is the default (globally readable / open).
 * - a create grant: subjectType "team", relation "creator", objectId "*"
 *
 * These tests cover:
 * - Team CRUD operations (getTeams, createTeam, updateTeam, deleteTeam)
 * - Team membership management (addUserToTeam, removeUserFromTeam)
 * - Team manager operations (addTeamManager, removeTeamManager)
 * - Relation reads/writes (listObjectRelations, writeRelation, removeRelation,
 *   setObjectPublic, listSubjectRelations)
 * - S2S engine endpoints (check, listAccessibleObjectIds, hasAnyTypeGrant,
 *   deleteObjectRelations, authorizeCreate, setOwner)
 * - Create-capability grants (setCreateGrant, listTeamCreateGrants)
 */
describe("Teams and Resource Access Control", () => {
  // Mock user with admin accesss
  const mockAdminUser = {
    type: "user" as const,
    id: "admin-user",
    accessRules: ["*"],
    roles: ["admin"],
    teamIds: ["team-alpha"],
  };

  // Mock non-admin user holding the GLOBAL `auth.teams.read` rule (qualified to
  // "auth.teams.read", which is what the handlers check). Such a user may READ
  // every team but holds no `teams.manage`, so directory search / team writes are
  // still denied unless they manage the specific team.
  const mockRegularUser = {
    type: "user" as const,
    id: "regular-user",
    accessRules: ["auth.teams.read"],
    roles: ["users"],
    teamIds: ["team-beta"],
  };

  // Mock team-scoped user with NO global rule at all - not a global reader, not a
  // global manager. Their visibility/management is decided purely by the teams
  // they are a member or manager of (ReBAC), which the mock DB supplies per test.
  const mockScopedUser = {
    type: "user" as const,
    id: "scoped-user",
    accessRules: [] as string[],
    roles: ["users"],
    teamIds: [] as string[],
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
   * Uses type assertion to satisfy SafeDatabase interface for testing.
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

  const mockAccessRuleRegistry = {
    getAccessRules: () => [
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
        mockAccessRuleRegistry,
        () => undefined
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
        mockAccessRuleRegistry,
        () => undefined
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

    it("returns teams for regular user with read-only access", async () => {
      const mockDb = createMockDb();

      // Mock teams query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              id: "team-alpha",
              name: "Alpha Team",
              description: "First team",
            },
            {
              id: "team-beta",
              name: "Beta Team",
              description: "Second team",
            },
          ])
        ),
      }));

      // Mock member counts query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { teamId: "team-alpha" },
            { teamId: "team-beta" },
            { teamId: "team-beta" },
          ])
        ),
      }));

      // Mock manager query (regular-user is not a manager of any team)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      // Use mockRegularUser who has only auth.teams.read access
      const context = createMockRpcContext({ user: mockRegularUser });
      const result = await call(router.getTeams, undefined, { context });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "team-alpha",
        name: "Alpha Team",
        description: "First team",
        memberCount: 1,
        isManager: false,
      });
      expect(result[1]).toEqual({
        id: "team-beta",
        name: "Beta Team",
        description: "Second team",
        memberCount: 2,
        isManager: false,
      });
    });

    it("shows correct manager status for regular user who is a team manager", async () => {
      const mockDb = createMockDb();

      // Mock teams query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              id: "team-beta",
              name: "Beta Team",
              description: "User's team",
            },
          ])
        ),
      }));

      // Mock member counts query
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-beta" }])),
      }));

      // Mock manager query (regular-user IS a manager of team-beta)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ teamId: "team-beta", userId: "regular-user" }])
        ),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockRegularUser });
      const result = await call(router.getTeams, undefined, { context });

      expect(result).toHaveLength(1);
      expect(result[0].isManager).toBe(true);
    });
  });

  // ==========================================================================
  // TEAM-SCOPED ACCESS (no global rule) — regression for the bug where a team
  // manager/member with only a per-team ReBAC grant was 403'd on getTeams /
  // listObjectRelations. These procedures are now `access: []` and scope in the
  // handler: a caller without global `auth.teams.read` sees ONLY the team(s)
  // they are a member or manager of; a caller who manages a team may write to it.
  // ==========================================================================
  describe("team-scoped access (no global teams.read)", () => {
    // getTeams issues, for a NON-global caller, five sequential selects:
    //   1 team, 2 userTeam(counts), 3 teamManager(isManager),
    //   4 userTeam(scope member), 5 teamManager(scope manager).
    const seedScopedGetTeams = ({
      teams,
      counts,
      isManagerOf,
      memberOf,
      managerOf,
    }: {
      teams: Array<{ id: string; name: string; description: string | null }>;
      counts: Array<{ teamId: string }>;
      isManagerOf: Array<{ teamId: string }>;
      memberOf: Array<{ teamId: string }>;
      managerOf: Array<{ teamId: string }>;
    }) => {
      const mockDb = createMockDb();
      const sel = mockDb.select as ReturnType<typeof mock>;
      sel.mockImplementationOnce(() => ({ from: mock(() => createChain(teams)) }));
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain(counts)),
      }));
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain(isManagerOf)),
      }));
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain(memberOf)),
      }));
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain(managerOf)),
      }));
      return mockDb;
    };

    const makeRouter = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

    it("getTeams: a scoped MANAGER sees only the team they manage", async () => {
      const mockDb = seedScopedGetTeams({
        teams: [
          { id: "team-alpha", name: "Alpha", description: null },
          { id: "team-beta", name: "Beta", description: null },
        ],
        counts: [{ teamId: "team-beta" }],
        isManagerOf: [{ teamId: "team-beta" }],
        memberOf: [], // manager need not be a member
        managerOf: [{ teamId: "team-beta" }],
      });

      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(makeRouter(mockDb).getTeams, undefined, {
        context,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "team-beta",
        name: "Beta",
        description: null,
        memberCount: 1,
        isManager: true,
      });
    });

    it("getTeams: a scoped MEMBER sees only their team, isManager=false", async () => {
      const mockDb = seedScopedGetTeams({
        teams: [
          { id: "team-alpha", name: "Alpha", description: null },
          { id: "team-beta", name: "Beta", description: null },
        ],
        counts: [{ teamId: "team-beta" }],
        isManagerOf: [],
        memberOf: [{ teamId: "team-beta" }],
        managerOf: [],
      });

      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(makeRouter(mockDb).getTeams, undefined, {
        context,
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("team-beta");
      expect(result[0].isManager).toBe(false);
    });

    it("getTeams: a scoped user with no teams sees an empty list (not a 403)", async () => {
      const mockDb = seedScopedGetTeams({
        teams: [
          { id: "team-alpha", name: "Alpha", description: null },
          { id: "team-beta", name: "Beta", description: null },
        ],
        counts: [],
        isManagerOf: [],
        memberOf: [],
        managerOf: [],
      });

      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(makeRouter(mockDb).getTeams, undefined, {
        context,
      });

      expect(result).toEqual([]);
    });

    it("getTeam: a scoped member can read their own team", async () => {
      const mockDb = createMockDb();
      const sel = mockDb.select as ReturnType<typeof mock>;
      // scopedTeamIdsFor: memberOf then managerOf
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      sel.mockImplementationOnce(() => ({ from: mock(() => createChain([])) }));
      // team, members, managers, users
      sel.mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ id: "team-1", name: "Platform", description: null }])
        ),
      }));
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain([{ userId: "user-1" }])),
      }));
      sel.mockImplementationOnce(() => ({ from: mock(() => createChain([])) }));
      sel.mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ id: "user-1", name: "Alice", email: "a@t.com" }])
        ),
      }));

      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(
        makeRouter(mockDb).getTeam,
        { teamId: "team-1" },
        { context }
      );

      expect(result).toBeDefined();
      expect(result?.name).toBe("Platform");
    });

    it("getTeam: a scoped non-member gets undefined (no existence leak)", async () => {
      const mockDb = createMockDb();
      const sel = mockDb.select as ReturnType<typeof mock>;
      // scopedTeamIdsFor: caller is in no team.
      sel.mockImplementationOnce(() => ({ from: mock(() => createChain([])) }));
      sel.mockImplementationOnce(() => ({ from: mock(() => createChain([])) }));

      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(
        makeRouter(mockDb).getTeam,
        { teamId: "team-1" },
        { context }
      );

      expect(result).toBeUndefined();
    });

    it("addUserToTeam: a manager of the team may add a member", async () => {
      const mockDb = createMockDb();
      // assertTeamManagementAccess: teamManager lookup returns a manager row.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ teamId: "team-1", userId: "scoped-user" }])
        ),
      }));

      const context = createMockRpcContext({ user: mockScopedUser });
      await call(
        makeRouter(mockDb).addUserToTeam,
        { teamId: "team-1", userId: "new-member" },
        { context }
      );

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("addUserToTeam: a non-manager scoped user is FORBIDDEN", async () => {
      const mockDb = createMockDb(); // teamManager lookup returns [] by default.

      const context = createMockRpcContext({ user: mockScopedUser });
      await expect(
        call(
          makeRouter(mockDb).addUserToTeam,
          { teamId: "team-1", userId: "new-member" },
          { context }
        )
      ).rejects.toThrow(/permission to manage this team/);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("addTeamManager: a non-manager scoped user is FORBIDDEN from promoting", async () => {
      const mockDb = createMockDb(); // teamManager lookup returns [] by default.

      const context = createMockRpcContext({ user: mockScopedUser });
      await expect(
        call(
          makeRouter(mockDb).addTeamManager,
          { teamId: "team-1", userId: "someone" },
          { context }
        )
      ).rejects.toThrow(/permission to manage this team/);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("listObjectRelations: a caller with no stake sees no team grants", async () => {
      const mockDb = createMockDb();
      const sel = mockDb.select as ReturnType<typeof mock>;
      // Object has a grant to team-1 (caller is NOT in team-1).
      sel.mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { relation: "editor", subjectType: "team", subjectId: "team-1" },
          ])
        ),
      }));
      // scopedTeamIdsFor: memberOf then managerOf — caller is in team-2 only.
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-2" }])),
      }));
      sel.mockImplementationOnce(() => ({ from: mock(() => createChain([])) }));

      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(
        makeRouter(mockDb).listObjectRelations,
        { objectType: "catalog.system", objectId: "sys-1" },
        { context }
      );

      // No stake => grants are hidden, but the call SUCCEEDS (no 403) and the
      // public flag is still returned.
      expect(result.teams).toEqual([]);
      expect(result.isPublic).toBe(true);
    });

    it("accessRules: reports isInAnyTeam=true for a member (no manager lookup)", async () => {
      const mockDb = createMockDb();
      // A user who is already a member short-circuits; no teamManager query runs.
      const context = createMockRpcContext({
        user: { ...mockScopedUser, teamIds: ["team-1"] },
      });
      const result = await call(makeRouter(mockDb).accessRules, undefined, {
        context,
      });
      expect(result.isInAnyTeam).toBe(true);
    });

    it("accessRules: reports isInAnyTeam=true for a manager-only user (via lookup)", async () => {
      const mockDb = createMockDb();
      // Member of no team, but a manager lookup finds a managed team.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(makeRouter(mockDb).accessRules, undefined, {
        context,
      });
      expect(result.isInAnyTeam).toBe(true);
    });

    it("accessRules: reports isInAnyTeam=false for a user in no team", async () => {
      const mockDb = createMockDb(); // teamManager lookup returns [] by default.
      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(makeRouter(mockDb).accessRules, undefined, {
        context,
      });
      expect(result.isInAnyTeam).toBe(false);
    });

    it("listObjectRelations: a caller WITH a stake sees the grants", async () => {
      const mockDb = createMockDb();
      const sel = mockDb.select as ReturnType<typeof mock>;
      // Object granted to team-2; caller is a member of team-2.
      sel.mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { relation: "viewer", subjectType: "team", subjectId: "team-2" },
          ])
        ),
      }));
      // scopedTeamIdsFor: memberOf then managerOf.
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-2" }])),
      }));
      sel.mockImplementationOnce(() => ({ from: mock(() => createChain([])) }));
      // team-name lookup.
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain([{ id: "team-2", name: "Beta" }])),
      }));

      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(
        makeRouter(mockDb).listObjectRelations,
        { objectType: "catalog.system", objectId: "sys-1" },
        { context }
      );

      expect(result.teams).toEqual([
        { teamId: "team-2", teamName: "Beta", relation: "viewer" },
      ]);
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
        mockAccessRuleRegistry,
        () => undefined
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
        mockAccessRuleRegistry,
        () => undefined
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
        mockAccessRuleRegistry,
        () => undefined
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
        mockAccessRuleRegistry,
        () => undefined
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
        mockAccessRuleRegistry,
        () => undefined
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
        mockAccessRuleRegistry,
        () => undefined
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
    it("deletes team and cascades to related tables (incl. relation tuples)", async () => {
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
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(router.deleteTeam, "team-1", { context });

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(deletedTables).toHaveLength(5);
      expect(deletedTables.includes(schema.userTeam)).toBe(true);
      expect(deletedTables.includes(schema.teamManager)).toBe(true);
      expect(deletedTables.includes(schema.applicationTeam)).toBe(true);
      // The relation-tuple store now backs every grant, so deleting a team must
      // clear its tuples (grants + create-capability) instead of the old
      // resource_team_access table.
      expect(deletedTables.includes(schema.relationTuple)).toBe(true);
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
        mockAccessRuleRegistry,
        () => undefined
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
        mockAccessRuleRegistry,
        () => undefined
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
        mockAccessRuleRegistry,
        () => undefined
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
        mockAccessRuleRegistry,
        () => undefined
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
  // OBJECT RELATION READ TESTS (listObjectRelations)
  // Replaces getResourceTeamAccess + getResourceAccessSettings — privacy is now
  // exposed as `isPublic` on the same read.
  // ==========================================================================

  describe("listObjectRelations", () => {
    it("returns empty teams and isPublic:true when no tuples exist", async () => {
      const mockDb = createMockDb();

      // relationTuple rows for the object: none.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.listObjectRelations,
        { objectType: "catalog.system", objectId: "sys-1" },
        { context }
      );

      expect(result).toEqual({ teams: [], isPublic: true });
    });

    it("returns team grants with names and isPublic:true when no private marker exists", async () => {
      const mockDb = createMockDb();

      // relationTuple rows for the object: two team grants, no private marker
      // => the object remains globally readable (isPublic:true).
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { relation: "editor", subjectType: "team", subjectId: "team-1" },
            { relation: "viewer", subjectType: "team", subjectId: "team-2" },
          ])
        ),
      }));

      // team-name lookup
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { id: "team-1", name: "Platform Team" },
            { id: "team-2", name: "API Team" },
          ])
        ),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.listObjectRelations,
        { objectType: "catalog.system", objectId: "sys-1" },
        { context }
      );

      expect(result.isPublic).toBe(true);
      expect(result.teams).toEqual([
        { teamId: "team-1", teamName: "Platform Team", relation: "editor" },
        { teamId: "team-2", teamName: "API Team", relation: "viewer" },
      ]);
    });

    it("reports isPublic:false (private) when the private marker is present", async () => {
      const mockDb = createMockDb();

      // team grant + the private marker => the object is private.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { relation: "owner", subjectType: "team", subjectId: "team-1" },
            { relation: "private", subjectType: "public", subjectId: "*" },
          ])
        ),
      }));
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ id: "team-1", name: "Owners" }])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.listObjectRelations,
        { objectType: "catalog.system", objectId: "sys-1" },
        { context }
      );

      expect(result.isPublic).toBe(false);
      expect(result.teams).toEqual([
        { teamId: "team-1", teamName: "Owners", relation: "owner" },
      ]);
    });
  });

  describe("writeRelation", () => {
    it("sets a team's relation on an object inside a transaction", async () => {
      const mockDb = createMockDb();

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.writeRelation,
        {
          objectType: "catalog.system",
          objectId: "sys-1",
          teamId: "team-1",
          relation: "viewer",
        },
        { context }
      );

      // setTeamRelation runs delete + insert in a transaction.
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("writes an editor (manage) relation", async () => {
      const mockDb = createMockDb();
      let insertedData: Record<string, unknown> | undefined;

      (mockDb.insert as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        values: mock((data: Record<string, unknown>) => {
          insertedData = data;
          return { onConflictDoNothing: mock(() => Promise.resolve()) };
        }),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.writeRelation,
        {
          objectType: "catalog.system",
          objectId: "sys-1",
          teamId: "team-1",
          relation: "editor",
        },
        { context }
      );

      expect(insertedData?.objectType).toBe("catalog.system");
      expect(insertedData?.objectId).toBe("sys-1");
      expect(insertedData?.subjectType).toBe("team");
      expect(insertedData?.subjectId).toBe("team-1");
      expect(insertedData?.relation).toBe("editor");
    });
  });

  describe("removeRelation", () => {
    it("removes a team's relations on an object", async () => {
      const mockDb = createMockDb();

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.removeRelation,
        {
          objectType: "catalog.system",
          objectId: "sys-1",
          teamId: "team-1",
        },
        { context }
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  describe("setObjectPublic", () => {
    it("deletes the private marker when isPublic=true (object becomes open)", async () => {
      const mockDb = createMockDb();

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.setObjectPublic,
        {
          objectType: "catalog.system",
          objectId: "sys-1",
          isPublic: true,
        },
        { context }
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("inserts the private marker when isPublic=false (object becomes private)", async () => {
      const mockDb = createMockDb();
      let insertedData: Record<string, unknown> | undefined;

      (mockDb.insert as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        values: mock((data: Record<string, unknown>) => {
          insertedData = data;
          return { onConflictDoNothing: mock(() => Promise.resolve()) };
        }),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.setObjectPublic,
        {
          objectType: "catalog.system",
          objectId: "sys-1",
          isPublic: false,
        },
        { context }
      );

      expect(mockDb.insert).toHaveBeenCalled();
      expect(insertedData?.subjectType).toBe("public");
      expect(insertedData?.subjectId).toBe("*");
      expect(insertedData?.relation).toBe("private");
    });
  });

  // ==========================================================================
  // TEAM-ACCESS DELEGATION AUTHZ (writeRelation / removeRelation /
  // setObjectPublic / canManageObjectAccess). A caller may edit an object's team
  // access only if they can MANAGE that object: a global teams.manage admin, the
  // object's own `<type>.manage` rule (on a non-private object), or membership of
  // a team with an editor/owner grant on it. A viewer-only team CANNOT elevate.
  // ==========================================================================
  describe("team-access delegation authz", () => {
    const makeRouter = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

    // For a NON-admin caller, canEditObjectAccess issues two selects:
    //   1. userTeam (the caller's membership), 2. the object's relation tuples.
    const seedAuthz = ({
      memberTeams,
      objectTuples,
    }: {
      memberTeams: Array<{ teamId: string }>;
      objectTuples: Array<{
        relation: string;
        subjectType: string;
        subjectId: string;
      }>;
    }) => {
      const mockDb = createMockDb();
      const sel = mockDb.select as ReturnType<typeof mock>;
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain(memberTeams)),
      }));
      sel.mockImplementationOnce(() => ({
        from: mock(() => createChain(objectTuples)),
      }));
      return mockDb;
    };

    const grant = (subjectId: string, relation: string) => ({
      relation,
      subjectType: "team",
      subjectId,
    });

    const writeInput = {
      objectType: "catalog.system",
      objectId: "sys-1",
      teamId: "team-2",
      relation: "editor" as const,
    };

    it("lets a MEMBER of a team that MANAGES the object grant access", async () => {
      // Caller is in team-1, which holds an editor (manage) grant on the object.
      const mockDb = seedAuthz({
        memberTeams: [{ teamId: "team-1" }],
        objectTuples: [grant("team-1", "editor")],
      });
      const context = createMockRpcContext({ user: mockScopedUser });
      await call(makeRouter(mockDb).writeRelation, writeInput, { context });
      expect(mockDb.transaction).toHaveBeenCalled(); // setTeamRelation ran
    });

    it("FORBIDS a member of a VIEWER-ONLY team (no privilege elevation)", async () => {
      // team-1 can only READ the object, so its members must not be able to grant
      // manage - to themselves or anyone else.
      const mockDb = seedAuthz({
        memberTeams: [{ teamId: "team-1" }],
        objectTuples: [grant("team-1", "viewer")],
      });
      const context = createMockRpcContext({ user: mockScopedUser });
      await expect(
        call(
          makeRouter(mockDb).writeRelation,
          { ...writeInput, teamId: "team-1" },
          { context }
        )
      ).rejects.toThrow(/manage access to this resource/);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("FORBIDS a caller with no grant and no global rule", async () => {
      const mockDb = seedAuthz({ memberTeams: [], objectTuples: [] });
      const context = createMockRpcContext({ user: mockScopedUser });
      await expect(
        call(makeRouter(mockDb).writeRelation, writeInput, { context })
      ).rejects.toThrow(/manage access to this resource/);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("lets a holder of the object's `<type>.manage` rule edit a PUBLIC object", async () => {
      // No grants + no private marker => public, so the resource-manage global
      // rule authorizes editing its team access.
      const mockDb = seedAuthz({ memberTeams: [], objectTuples: [] });
      const context = createMockRpcContext({
        user: { ...mockScopedUser, accessRules: ["catalog.system.manage"] },
      });
      await call(makeRouter(mockDb).writeRelation, writeInput, { context });
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it("still lets a global teams.manage admin edit (short-circuits per-object authz)", async () => {
      // `*` satisfies teams.manage; no authz selects are issued.
      const mockDb = createMockDb();
      const context = createMockRpcContext({ user: mockAdminUser });
      await call(makeRouter(mockDb).writeRelation, writeInput, { context });
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it("removeRelation enforces the same delegation authz", async () => {
      const mockDb = seedAuthz({ memberTeams: [], objectTuples: [] });
      const context = createMockRpcContext({ user: mockScopedUser });
      await expect(
        call(
          makeRouter(mockDb).removeRelation,
          { objectType: "catalog.system", objectId: "sys-1", teamId: "team-1" },
          { context }
        )
      ).rejects.toThrow(/manage access to this resource/);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("setObjectPublic enforces the same delegation authz", async () => {
      const mockDb = seedAuthz({ memberTeams: [], objectTuples: [] });
      const context = createMockRpcContext({ user: mockScopedUser });
      await expect(
        call(
          makeRouter(mockDb).setObjectPublic,
          { objectType: "catalog.system", objectId: "sys-1", isPublic: false },
          { context }
        )
      ).rejects.toThrow(/manage access to this resource/);
    });

    it("canManageObjectAccess returns true for a managing member", async () => {
      const mockDb = seedAuthz({
        memberTeams: [{ teamId: "team-1" }],
        objectTuples: [grant("team-1", "editor")],
      });
      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(
        makeRouter(mockDb).canManageObjectAccess,
        { objectType: "catalog.system", objectId: "sys-1" },
        { context }
      );
      expect(result.allowed).toBe(true);
    });

    it("canManageObjectAccess returns false for a viewer-only member", async () => {
      const mockDb = seedAuthz({
        memberTeams: [{ teamId: "team-1" }],
        objectTuples: [grant("team-1", "viewer")],
      });
      const context = createMockRpcContext({ user: mockScopedUser });
      const result = await call(
        makeRouter(mockDb).canManageObjectAccess,
        { objectType: "catalog.system", objectId: "sys-1" },
        { context }
      );
      expect(result.allowed).toBe(false);
    });
  });

  // ==========================================================================
  // RESOURCE-TYPE VALIDATION (Finding 6) — reject grants for unregistered types.
  // Validation now lives on writeRelation / setObjectPublic / setCreateGrant via
  // the unchanged assertKnownResourceType.
  // ==========================================================================

  describe("resource-type validation", () => {
    // A registry that exposes the resource-kind registry (the real platform
    // always does; the default test registry omits it, which intentionally
    // skips validation).
    const registryWithKinds = {
      ...mockAccessRuleRegistry,
      getResourceKinds: () => [
        {
          resourceType: "catalog.system",
          label: "System",
          pluginId: "catalog",
          createCapable: false,
        },
      ],
    };

    it("writeRelation rejects a grant for an unregistered resource type", async () => {
      const mockDb = createMockDb();
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        registryWithKinds,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await expect(
        call(
          router.writeRelation,
          {
            objectType: "bogus.phantom",
            objectId: "x",
            teamId: "team-1",
            relation: "viewer",
          },
          { context }
        )
      ).rejects.toThrow(/Unknown resource type/);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("writeRelation accepts a grant for a registered resource type", async () => {
      const mockDb = createMockDb();
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        registryWithKinds,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.writeRelation,
        {
          objectType: "catalog.system",
          objectId: "x",
          teamId: "team-1",
          relation: "viewer",
        },
        { context }
      );
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("setObjectPublic rejects an unregistered resource type", async () => {
      const mockDb = createMockDb();
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        registryWithKinds,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await expect(
        call(
          router.setObjectPublic,
          { objectType: "bogus.phantom", objectId: "x", isPublic: true },
          { context }
        )
      ).rejects.toThrow(/Unknown resource type/);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("setCreateGrant rejects an unregistered resource type", async () => {
      const mockDb = createMockDb();
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        registryWithKinds,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await expect(
        call(
          router.setCreateGrant,
          { objectType: "bogus.phantom", teamId: "team-1", allowed: true },
          { context }
        )
      ).rejects.toThrow(/Unknown resource type/);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("skips validation when the registry omits getResourceKinds", async () => {
      const mockDb = createMockDb();
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry, // no getResourceKinds
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      await call(
        router.writeRelation,
        {
          objectType: "anything.at.all",
          objectId: "x",
          teamId: "team-1",
          relation: "viewer",
        },
        { context }
      );
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // searchUsers AUTHORIZATION (Finding 5) — directory search is admin/manager-only
  // ==========================================================================

  describe("searchUsers authorization", () => {
    it("denies a plain member who manages no team", async () => {
      const mockDb = createMockDb(); // teamManager lookup returns []
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockRegularUser });
      await expect(
        call(router.searchUsers, { query: "ali" }, { context })
      ).rejects.toThrow(/managing at least one team/);
    });

    it("allows a global team-manager (admin)", async () => {
      const mockDb = createMockDb();
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.searchUsers,
        { query: "ali" },
        { context }
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it("allows a manager of at least one team", async () => {
      const mockDb = createMockDb();
      // First select() (teamManager lookup) returns a manager row; the
      // subsequent user-search select() returns no rows.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-beta" }])),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockRegularUser });
      const result = await call(
        router.searchUsers,
        { query: "ali" },
        { context }
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ==========================================================================
  // S2S ACCESS CHECK TESTS (check)
  // The handler resolves the caller's teams (first select on user/applicationTeam)
  // then reads the object's relation tuples (second select on relationTuple) and
  // delegates to the pure evaluateAccess. Each case below pins the same intent as
  // the old checkResourceTeamAccess, expressed over relation tuples.
  // ==========================================================================

  describe("check (S2S)", () => {
    // Helper: order of selects in the `check` handler is
    //   1. resolveUserTeamIds  -> user/applicationTeam rows ({ teamId })
    //   2. tupleStore.check    -> relationTuple rows for the object
    const mockCheck = ({
      teamRows,
      tupleRows,
    }: {
      teamRows: Array<{ teamId: string }>;
      tupleRows: Array<{
        relation: string;
        subjectType: string;
        subjectId: string;
      }>;
    }) => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain(teamRows)),
      }));
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain(tupleRows)),
      }));
      return mockDb;
    };

    const team = (subjectId: string, relation: string) => ({
      relation,
      subjectType: "team",
      subjectId,
    });
    const PRIVATE = {
      relation: "private",
      subjectType: "public",
      subjectId: "*",
    };

    const callCheck = (
      mockDb: AuthDatabase,
      input: {
        userId: string;
        userType: "user" | "application";
        action: "read" | "manage";
        hasGlobalAccess: boolean;
      }
    ) => {
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
      const context = createMockRpcContext({ user: mockServiceUser });
      return call(
        router.check,
        {
          ...input,
          objectType: "catalog.system",
          objectId: "sys-1",
        },
        { context }
      );
    };

    it("allows access when no grants exist and user has global access", async () => {
      const mockDb = mockCheck({ teamRows: [], tupleRows: [] });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: true,
      });
      expect(result.hasAccess).toBe(true);
    });

    it("denies access when no grants exist and user lacks global access", async () => {
      const mockDb = mockCheck({ teamRows: [], tupleRows: [] });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: false,
      });
      expect(result.hasAccess).toBe(false);
    });

    it("denies access to a private (private marker present) resource even with global access (no silent globalization)", async () => {
      // Grants exist and the private marker is present => private. The caller is
      // not in the granted team, so global access must NOT fall through.
      const mockDb = mockCheck({
        teamRows: [],
        tupleRows: [team("team-1", "editor"), PRIVATE],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: true,
      });
      expect(result.hasAccess).toBe(false);
    });

    it("denies a private resource with ZERO team grants to a global-access holder", async () => {
      // Private marker present, no team grants => the global path is closed and
      // there is no team grant to fall back on, so everyone is denied.
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-1" }],
        tupleRows: [PRIVATE],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: true,
      });
      expect(result.hasAccess).toBe(false);
    });

    it("allows access when user's team has a viewer (read) grant", async () => {
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-1" }],
        tupleRows: [team("team-1", "viewer")],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: false,
      });
      expect(result.hasAccess).toBe(true);
    });

    it("denies manage when user's team only has a viewer grant", async () => {
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-1" }],
        tupleRows: [team("team-1", "viewer")],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "manage",
        hasGlobalAccess: false,
      });
      expect(result.hasAccess).toBe(false);
    });

    it("allows access for a private resource when user is in the granted team", async () => {
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-1" }],
        tupleRows: [team("team-1", "viewer"), PRIVATE],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: true, // global access neither needed nor consulted here
      });
      expect(result.hasAccess).toBe(true);
    });

    it("denies access for a private resource when user is not in the granted team", async () => {
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-2" }],
        tupleRows: [team("team-1", "viewer"), PRIVATE],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: true,
      });
      expect(result.hasAccess).toBe(false);
    });

    it("allows manage access when user's team has an editor grant", async () => {
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-1" }],
        tupleRows: [team("team-1", "editor")],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "manage",
        hasGlobalAccess: false,
      });
      expect(result.hasAccess).toBe(true);
    });

    it("allows access via global access when grants exist and the resource is public", async () => {
      // No private marker => the object is open, so the global RBAC path is open
      // even though the caller is in none of the granted teams.
      const mockDb = mockCheck({
        teamRows: [],
        tupleRows: [team("team-1", "viewer")],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: true,
      });
      expect(result.hasAccess).toBe(true);
    });

    it("denies access when user is in no team and lacks global access", async () => {
      const mockDb = mockCheck({
        teamRows: [],
        tupleRows: [team("team-1", "viewer")],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: false,
      });
      expect(result.hasAccess).toBe(false);
    });

    it("allows access when user is in multiple teams and one has the grant", async () => {
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-1" }, { teamId: "team-2" }],
        tupleRows: [team("team-2", "viewer")],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: false,
      });
      expect(result.hasAccess).toBe(true);
    });

    it("allows manage when a private resource has grants from multiple teams and the user is in an editor team", async () => {
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-2" }],
        tupleRows: [
          team("team-1", "viewer"),
          team("team-2", "editor"),
          PRIVATE,
        ],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "manage",
        hasGlobalAccess: false,
      });
      expect(result.hasAccess).toBe(true);
    });

    it("allows access for an application principal with a team grant", async () => {
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-1" }],
        tupleRows: [team("team-1", "viewer")],
      });
      const result = await callCheck(mockDb, {
        userId: "app-1",
        userType: "application",
        action: "read",
        hasGlobalAccess: false,
      });
      expect(result.hasAccess).toBe(true);
    });

    it("denies access for an application principal not in the granted team (private)", async () => {
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-2" }],
        tupleRows: [team("team-1", "viewer"), PRIVATE],
      });
      const result = await callCheck(mockDb, {
        userId: "app-1",
        userType: "application",
        action: "read",
        hasGlobalAccess: true,
      });
      expect(result.hasAccess).toBe(false);
    });

    it("denies read when the user's team only holds a manage-level grant on a different team", async () => {
      // The granted team is team-1 (editor), but the caller is in team-2 with no
      // grant => denied on a private resource.
      const mockDb = mockCheck({
        teamRows: [{ teamId: "team-2" }],
        tupleRows: [team("team-1", "editor"), PRIVATE],
      });
      const result = await callCheck(mockDb, {
        userId: "user-1",
        userType: "user",
        action: "read",
        hasGlobalAccess: false,
      });
      expect(result.hasAccess).toBe(false);
    });
  });

  describe("listAccessibleObjectIds (S2S)", () => {
    // The handler returns [] immediately for empty objectIds; otherwise it
    // resolves the caller's teams (1st select) then reads tuples for the
    // candidate objects (2nd select).
    const team = (subjectId: string, relation: string) => ({
      relation,
      subjectType: "team",
      subjectId,
    });

    const callList = (
      mockDb: AuthDatabase,
      input: {
        userId: string;
        userType: "user" | "application";
        objectIds: string[];
        action: "read" | "manage";
        hasGlobalAccess: boolean;
      }
    ) => {
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
      const context = createMockRpcContext({ user: mockServiceUser });
      return call(
        router.listAccessibleObjectIds,
        { ...input, objectType: "catalog.system" },
        { context }
      );
    };

    it("returns empty array for empty input", async () => {
      const mockDb = createMockDb();
      const result = await callList(mockDb, {
        userId: "user-1",
        userType: "user",
        objectIds: [],
        action: "read",
        hasGlobalAccess: true,
      });
      expect(result).toEqual([]);
    });

    it("returns all candidates when no grants exist and user has global access", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      // tuples for the candidate objects: none
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      const result = await callList(mockDb, {
        userId: "user-1",
        userType: "user",
        objectIds: ["sys-1", "sys-2", "sys-3"],
        action: "read",
        hasGlobalAccess: true,
      });
      expect(result).toEqual(["sys-1", "sys-2", "sys-3"]);
    });

    it("filters candidates based on team grants (private objects)", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds: caller is in team-1 only.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      // tuples: sys-1 granted to team-1 (private), sys-2 granted to team-2
      // (private). sys-3 has no tuples. Privacy is the explicit private marker.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { objectId: "sys-1", ...team("team-1", "viewer") },
            {
              objectId: "sys-1",
              relation: "private",
              subjectType: "public",
              subjectId: "*",
            },
            { objectId: "sys-2", ...team("team-2", "viewer") },
            {
              objectId: "sys-2",
              relation: "private",
              subjectType: "public",
              subjectId: "*",
            },
          ])
        ),
      }));

      const result = await callList(mockDb, {
        userId: "user-1",
        userType: "user",
        objectIds: ["sys-1", "sys-2", "sys-3"],
        action: "read",
        hasGlobalAccess: true,
      });

      // sys-1: caller in team-1, granted.
      // sys-2: private + caller not in team-2, denied.
      // sys-3: no grants, allowed by global access.
      expect(result).toContain("sys-1");
      expect(result).not.toContain("sys-2");
      expect(result).toContain("sys-3");
    });

    it("returns no candidates when user lacks global access and has no grants", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      const result = await callList(mockDb, {
        userId: "user-1",
        userType: "user",
        objectIds: ["sys-1", "sys-2", "sys-3"],
        action: "read",
        hasGlobalAccess: false,
      });
      expect(result).toEqual([]);
    });

    it("filters the manage action based on editor/owner relations", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      // sys-1: team-1 editor (manage-capable). sys-2: team-1 viewer (read-only).
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { objectId: "sys-1", ...team("team-1", "editor") },
            { objectId: "sys-2", ...team("team-1", "viewer") },
          ])
        ),
      }));

      const result = await callList(mockDb, {
        userId: "user-1",
        userType: "user",
        objectIds: ["sys-1", "sys-2"],
        action: "manage",
        hasGlobalAccess: false,
      });

      expect(result).toContain("sys-1");
      expect(result).not.toContain("sys-2");
    });

    it("filters for application principals based on applicationTeam membership", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds for an application reads applicationTeam.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      // sys-1 private to team-1 (private marker); sys-2 has no tuples.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { objectId: "sys-1", ...team("team-1", "viewer") },
            {
              objectId: "sys-1",
              relation: "private",
              subjectType: "public",
              subjectId: "*",
            },
          ])
        ),
      }));

      const result = await callList(mockDb, {
        userId: "app-1",
        userType: "application",
        objectIds: ["sys-1", "sys-2"],
        action: "read",
        hasGlobalAccess: true,
      });

      // sys-1: application in team-1, granted.
      // sys-2: no grants, allowed by global access.
      expect(result).toContain("sys-1");
      expect(result).toContain("sys-2");
    });

    it("handles mixed private and public objects correctly", async () => {
      const mockDb = createMockDb();
      // caller is in team-2 (NOT team-1).
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-2" }])),
      }));
      // sys-1 private to team-1 (private marker); sys-2 granted to team-1 but
      // open (no private marker).
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { objectId: "sys-1", ...team("team-1", "viewer") },
            {
              objectId: "sys-1",
              relation: "private",
              subjectType: "public",
              subjectId: "*",
            },
            { objectId: "sys-2", ...team("team-1", "viewer") },
          ])
        ),
      }));

      const result = await callList(mockDb, {
        userId: "user-1",
        userType: "user",
        objectIds: ["sys-1", "sys-2"],
        action: "read",
        hasGlobalAccess: true,
      });

      // sys-1: private, caller not in team-1, denied.
      // sys-2: no private marker (open) + global access, allowed.
      expect(result).not.toContain("sys-1");
      expect(result).toContain("sys-2");
    });
  });

  describe("deleteObjectRelations (S2S)", () => {
    it("deletes all tuples for an object", async () => {
      const mockDb = createMockDb();

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockServiceUser });
      await call(
        router.deleteObjectRelations,
        {
          objectType: "catalog.system",
          objectId: "sys-1",
        },
        { context }
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  describe("hasAnyTypeGrant (S2S)", () => {
    const callHasGrant = (mockDb: AuthDatabase) => {
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
      const context = createMockRpcContext({ user: mockServiceUser });
      return call(
        router.hasAnyTypeGrant,
        {
          userId: "user-1",
          userType: "user" as const,
          objectType: "catalog.system",
          action: "read" as const,
        },
        { context }
      );
    };

    it("returns hasGrant:false when the caller belongs to no teams", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => no teams.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      const result = await callHasGrant(mockDb);

      expect(result).toEqual({ hasGrant: false });
    });

    it("returns hasGrant:false when the caller's teams hold no qualifying grant", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => one team.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      // store.hasAnyTypeGrant existence query => no rows.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));

      const result = await callHasGrant(mockDb);

      expect(result).toEqual({ hasGrant: false });
    });

    it("returns hasGrant:true when a qualifying tuple exists for one of the caller's teams", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => one team.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      // store.hasAnyTypeGrant existence query => a matching tuple row.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ objectId: "sys-1" }])),
      }));

      const result = await callHasGrant(mockDb);

      expect(result).toEqual({ hasGrant: true });
    });
  });

  describe("listSubjectRelations", () => {
    it("returns the concrete-object grants a team holds", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              objectType: "catalog.system",
              objectId: "sys-1",
              relation: "editor",
            },
            {
              objectType: "incident.incident",
              objectId: "inc-9",
              relation: "viewer",
            },
          ])
        ),
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

      const context = createMockRpcContext({ user: mockAdminUser });
      const result = await call(
        router.listSubjectRelations,
        { teamId: "team-1" },
        { context }
      );

      expect(result).toEqual({
        grants: [
          {
            objectType: "catalog.system",
            objectId: "sys-1",
            relation: "editor",
          },
          {
            objectType: "incident.incident",
            objectId: "inc-9",
            relation: "viewer",
          },
        ],
      });
    });
  });

  describe("authorizeCreate (S2S)", () => {
    const makeRouter = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
    const ctx = () => createMockRpcContext({ user: mockServiceUser });

    it("global manage + no requested team => global resource (ownerTeamId null)", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds (membership) — unused branch.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));
      const result = await call(
        makeRouter(mockDb).authorizeCreate,
        {
          userId: "u1",
          userType: "user",
          objectType: "healthcheck.configuration",
          hasGlobalManage: true,
        },
        { context: ctx() }
      );
      expect(result).toEqual({ ownerTeamId: null, isPrivate: false });
    });

    it("global manage + requested team that exists => owns for that team", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds (membership)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));
      // team-exists check
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ id: "team-1" }])),
      }));
      const result = await call(
        makeRouter(mockDb).authorizeCreate,
        {
          userId: "u1",
          userType: "user",
          objectType: "healthcheck.configuration",
          requestedTeamId: "team-1",
          hasGlobalManage: true,
        },
        { context: ctx() }
      );
      expect(result).toEqual({ ownerTeamId: "team-1", isPrivate: false });
    });

    it("member without global manage, exactly one eligible team => that team owns", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds (membership)
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      // creatorTeamIds => team-1 holds a creator tuple for the type.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ subjectId: "team-1" }])),
      }));
      const result = await call(
        makeRouter(mockDb).authorizeCreate,
        {
          userId: "u1",
          userType: "user",
          objectType: "healthcheck.configuration",
          hasGlobalManage: false,
        },
        { context: ctx() }
      );
      expect(result).toEqual({ ownerTeamId: "team-1", isPrivate: false });
    });

    it("member without global manage, no eligible team => FORBIDDEN", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])), // no creator tuples
      }));
      expect(
        call(
          makeRouter(mockDb).authorizeCreate,
          {
            userId: "u1",
            userType: "user",
            objectType: "healthcheck.configuration",
            hasGlobalManage: false,
          },
          { context: ctx() }
        )
      ).rejects.toThrow();
    });

    it("member without global manage, >1 eligible team and no choice => OWNER_TEAM_REQUIRED", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ teamId: "team-1" }, { teamId: "team-2" }])
        ),
      }));
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ subjectId: "team-1" }, { subjectId: "team-2" }])
        ),
      }));
      expect(
        call(
          makeRouter(mockDb).authorizeCreate,
          {
            userId: "u1",
            userType: "user",
            objectType: "healthcheck.configuration",
            hasGlobalManage: false,
          },
          { context: ctx() }
        )
      ).rejects.toThrow();
    });

    it("alreadyAuthorized (parent gate) + member team => owns without a creator grant", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => the caller is in team-1.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      const result = await call(
        makeRouter(mockDb).authorizeCreate,
        {
          userId: "u1",
          userType: "user",
          objectType: "incident.incident",
          requestedTeamId: "team-1",
          hasGlobalManage: false,
          alreadyAuthorized: true,
        },
        { context: ctx() }
      );
      // No creator-grant lookup needed; owner resolved straight from membership.
      expect(result).toEqual({ ownerTeamId: "team-1", isPrivate: false });
    });

    it("alreadyAuthorized + no requested team + caller in NO team => global (ownerTeamId null)", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => no teams (reached the gate via a global parent
      // rule, not membership) -> a team-less, globally-readable object is ok.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));
      const result = await call(
        makeRouter(mockDb).authorizeCreate,
        {
          userId: "u1",
          userType: "user",
          objectType: "incident.incident",
          hasGlobalManage: false,
          alreadyAuthorized: true,
        },
        { context: ctx() }
      );
      expect(result).toEqual({ ownerTeamId: null, isPrivate: false });
    });

    it("alreadyAuthorized + no requested team + caller in exactly ONE team => auto-owns via that team (stays editable)", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => one team. Without an explicit team the object
      // would be uneditable by the parent-gated creator, so it auto-owns.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      const result = await call(
        makeRouter(mockDb).authorizeCreate,
        {
          userId: "u1",
          userType: "user",
          objectType: "incident.incident",
          hasGlobalManage: false,
          alreadyAuthorized: true,
        },
        { context: ctx() }
      );
      expect(result).toEqual({ ownerTeamId: "team-1", isPrivate: false });
    });

    it("alreadyAuthorized + no requested team + caller in MULTIPLE teams => OWNER_TEAM_REQUIRED", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ teamId: "team-1" }, { teamId: "team-2" }])
        ),
      }));
      expect(
        call(
          makeRouter(mockDb).authorizeCreate,
          {
            userId: "u1",
            userType: "user",
            objectType: "incident.incident",
            hasGlobalManage: false,
            alreadyAuthorized: true,
          },
          { context: ctx() }
        )
      ).rejects.toThrow();
    });
  });

  describe("create-capability grants", () => {
    const router = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
    const ctx = () => createMockRpcContext({ user: mockAdminUser });

    it("setCreateGrant inserts a creator tuple when allowed=true", async () => {
      const mockDb = createMockDb();
      await call(
        router(mockDb).setCreateGrant,
        { objectType: "incident.incident", teamId: "team-1", allowed: true },
        { context: ctx() }
      );
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("setCreateGrant deletes the creator tuple when allowed=false", async () => {
      const mockDb = createMockDb();
      await call(
        router(mockDb).setCreateGrant,
        { objectType: "incident.incident", teamId: "team-1", allowed: false },
        { context: ctx() }
      );
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("listTeamCreateGrants returns the resource types a team may create", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { objectType: "incident.incident" },
            { objectType: "maintenance.maintenance" },
          ])
        ),
      }));
      const result = await call(
        router(mockDb).listTeamCreateGrants,
        { teamId: "team-1" },
        { context: ctx() }
      );
      expect(result).toEqual({
        resourceTypes: ["incident.incident", "maintenance.maintenance"],
      });
    });
  });

  describe("canCreate (authenticated, team-derived create capability)", () => {
    const makeRouter = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
    const ctx = () => createMockRpcContext({ user: mockRegularUser });

    it("returns allowed=false when the caller has no teams", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => no teams.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));
      const result = await call(
        makeRouter(mockDb).canCreate,
        { objectType: "incident.incident", parentType: "catalog.system" },
        { context: ctx() }
      );
      expect(result).toEqual({ allowed: false });
    });

    it("returns allowed=true when a team holds a creator grant on the type", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => one team.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-beta" }])),
      }));
      // creatorTeamIds => team-beta may create the type.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ subjectId: "team-beta" }])),
      }));
      const result = await call(
        makeRouter(mockDb).canCreate,
        { objectType: "incident.incident" },
        { context: ctx() }
      );
      expect(result).toEqual({ allowed: true });
    });

    it("returns allowed=true via the parent gate (manages a parent object) without a creator grant", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => one team.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-beta" }])),
      }));
      // creatorTeamIds => none.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));
      // hasAnyTypeGrant(parentType, manage) => a managed parent object exists.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ objectId: "sys-1" }])),
      }));
      const result = await call(
        makeRouter(mockDb).canCreate,
        { objectType: "incident.incident", parentType: "catalog.system" },
        { context: ctx() }
      );
      expect(result).toEqual({ allowed: true });
    });

    it("returns allowed=false with no creator grant and no managed parent", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-beta" }])),
      }));
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])), // no creator grant
      }));
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])), // no managed parent object
      }));
      const result = await call(
        makeRouter(mockDb).canCreate,
        { objectType: "incident.incident", parentType: "catalog.system" },
        { context: ctx() }
      );
      expect(result).toEqual({ allowed: false });
    });

    it("returns allowed=false with no creator grant and no parentType supplied", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-beta" }])),
      }));
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])), // no creator grant, and no parent gate
      }));
      const result = await call(
        makeRouter(mockDb).canCreate,
        { objectType: "slo.slo" },
        { context: ctx() }
      );
      expect(result).toEqual({ allowed: false });
    });
  });

  describe("listMyAccessibleResources (authenticated, per-resource subset)", () => {
    const makeRouter = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
    const ctx = () => createMockRpcContext({ user: mockRegularUser });

    it("returns an empty set when no resourceIds are given", async () => {
      const mockDb = createMockDb();
      const result = await call(
        makeRouter(mockDb).listMyAccessibleResources,
        { objectType: "catalog.system", resourceIds: [], action: "manage" },
        { context: ctx() }
      );
      expect(result).toEqual({ accessibleIds: [] });
    });

    it("returns an empty set when the caller has no teams", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => no teams.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));
      const result = await call(
        makeRouter(mockDb).listMyAccessibleResources,
        {
          objectType: "catalog.system",
          resourceIds: ["sys-a", "sys-b"],
          action: "manage",
        },
        { context: ctx() }
      );
      expect(result).toEqual({ accessibleIds: [] });
    });

    it("returns only the ids the caller's team manages", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => one team.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-beta" }])),
      }));
      // listAccessibleObjectIds tuple rows: team-beta is editor of sys-a only.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            {
              objectId: "sys-a",
              relation: "editor",
              subjectType: "team",
              subjectId: "team-beta",
            },
          ])
        ),
      }));
      const result = await call(
        makeRouter(mockDb).listMyAccessibleResources,
        {
          objectType: "catalog.system",
          resourceIds: ["sys-a", "sys-b"],
          action: "manage",
        },
        { context: ctx() }
      );
      expect(result).toEqual({ accessibleIds: ["sys-a"] });
    });
  });

  describe("myManageableTypes (authenticated, nav/route capability set)", () => {
    const makeRouter = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
    const ctx = () => createMockRpcContext({ user: mockRegularUser });

    it("returns an empty list when the caller has no teams", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => no teams.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([])),
      }));
      const result = await call(makeRouter(mockDb).myManageableTypes, {}, {
        context: ctx(),
      });
      expect(result).toEqual({ types: [] });
    });

    it("returns the distinct types the caller's teams can create/manage", async () => {
      const mockDb = createMockDb();
      // resolveUserTeamIds => one team.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-beta" }])),
      }));
      // manageableTypesForTeams => creator/editor/owner rows (with a duplicate).
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { objectType: "catalog.system" },
            { objectType: "catalog.system" },
            { objectType: "incident.incident" },
          ])
        ),
      }));
      const result = await call(makeRouter(mockDb).myManageableTypes, {}, {
        context: ctx(),
      });
      expect(result).toEqual({
        types: ["catalog.system", "incident.incident"],
      });
    });
  });

  describe("setOwner (S2S)", () => {
    it("writes the owner tuple and a private marker when private", async () => {
      const mockDb = createMockDb();
      const insertedRows: Record<string, unknown>[] = [];
      (mockDb.insert as ReturnType<typeof mock>).mockImplementation(() => ({
        values: mock((data: Record<string, unknown>) => {
          insertedRows.push(data);
          return { onConflictDoNothing: mock(() => Promise.resolve()) };
        }),
      }));
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
      await call(
        router.setOwner,
        {
          objectType: "healthcheck.configuration",
          objectId: "cfg-1",
          teamId: "team-1",
          isPrivate: true,
        },
        { context: createMockRpcContext({ user: mockServiceUser }) }
      );
      expect(mockDb.transaction).toHaveBeenCalled();
      // owner tuple + private marker => two inserts.
      expect(insertedRows).toHaveLength(2);
      expect(insertedRows[0]).toMatchObject({
        relation: "owner",
        subjectType: "team",
        subjectId: "team-1",
      });
      expect(insertedRows[1]).toMatchObject({
        relation: "private",
        subjectType: "public",
        subjectId: "*",
      });
    });

    it("writes only the owner tuple (no marker) when not private", async () => {
      const mockDb = createMockDb();
      const insertedRows: Record<string, unknown>[] = [];
      (mockDb.insert as ReturnType<typeof mock>).mockImplementation(() => ({
        values: mock((data: Record<string, unknown>) => {
          insertedRows.push(data);
          return { onConflictDoNothing: mock(() => Promise.resolve()) };
        }),
      }));
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
      await call(
        router.setOwner,
        {
          objectType: "healthcheck.configuration",
          objectId: "cfg-1",
          teamId: "team-1",
          isPrivate: false,
        },
        { context: createMockRpcContext({ user: mockServiceUser }) }
      );
      // Not private => owner tuple only, no private marker.
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0]).toMatchObject({
        relation: "owner",
        subjectType: "team",
        subjectId: "team-1",
      });
    });
  });

  describe("getMyTeams", () => {
    it("returns the calling user's teams", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ id: "team-1", name: "Platform" }])),
      }));
      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
      const result = await call(router.getMyTeams, undefined, {
        context: createMockRpcContext({
          user: { type: "user", id: "u1", accessRules: [] },
        }),
      });
      expect(result).toEqual({ teams: [{ id: "team-1", name: "Platform" }] });
    });
  });

  describe("getMyManagingTeams", () => {
    const makeRouter = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
    const ctx = () =>
      createMockRpcContext({
        user: { type: "user", id: "u1", accessRules: [] },
      });

    it("returns the caller's teams that manage all requested resources", async () => {
      const mockDb = createMockDb();
      // memberRows
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      // manage-relation tuples (editor|owner) on the requested objects.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ teamId: "team-1", objectId: "sys-1" }])
        ),
      }));
      const result = await call(
        makeRouter(mockDb).getMyManagingTeams,
        { resourceType: "catalog.system", resourceIds: ["sys-1"] },
        { context: ctx() }
      );
      expect(result).toEqual({ teamIds: ["team-1"] });
    });

    it("excludes a team that manages only some of the requested resources", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() => createChain([{ teamId: "team-1" }])),
      }));
      // team-1 manages sys-1 but not sys-2
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([{ teamId: "team-1", objectId: "sys-1" }])
        ),
      }));
      const result = await call(
        makeRouter(mockDb).getMyManagingTeams,
        { resourceType: "catalog.system", resourceIds: ["sys-1", "sys-2"] },
        { context: ctx() }
      );
      expect(result).toEqual({ teamIds: [] });
    });

    it("returns no teams for empty resourceIds", async () => {
      const mockDb = createMockDb();
      const result = await call(
        makeRouter(mockDb).getMyManagingTeams,
        { resourceType: "catalog.system", resourceIds: [] },
        { context: ctx() }
      );
      expect(result).toEqual({ teamIds: [] });
    });
  });

  describe("team-manager delegation (manage own team without global manage)", () => {
    const makeRouter = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );
    // A user with teams.read but NOT global teams.manage.
    const readerUser = {
      type: "user" as const,
      id: "reader",
      accessRules: ["test-plugin.teams.read"],
    };
    // A user with no team rules at all.
    const noAccessUser = {
      type: "user" as const,
      id: "nobody",
      accessRules: [],
    };

    const mockManagerLookup = (mockDb: AuthDatabase, isManager: boolean) => {
      // assertTeamManagementAccess selects the teamManager row first.
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain(
            isManager ? [{ teamId: "team-1", userId: "reader" }] : []
          )
        ),
      }));
    };

    it("a manager of the team may add a member (no global manage needed)", async () => {
      const mockDb = createMockDb();
      mockManagerLookup(mockDb, true);
      await call(
        makeRouter(mockDb).addUserToTeam,
        { teamId: "team-1", userId: "new-user" },
        { context: createMockRpcContext({ user: readerUser }) }
      );
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("a manager of the team may promote another manager", async () => {
      const mockDb = createMockDb();
      mockManagerLookup(mockDb, true);
      await call(
        makeRouter(mockDb).addTeamManager,
        { teamId: "team-1", userId: "new-manager" },
        { context: createMockRpcContext({ user: readerUser }) }
      );
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("a non-manager (with teams.read) may NOT add a member", async () => {
      const mockDb = createMockDb();
      mockManagerLookup(mockDb, false);
      await expect(
        call(
          makeRouter(mockDb).addUserToTeam,
          { teamId: "team-1", userId: "new-user" },
          { context: createMockRpcContext({ user: readerUser }) }
        )
      ).rejects.toThrow();
    });

    it("a user without teams.read is rejected by the contract gate", async () => {
      const mockDb = createMockDb();
      await expect(
        call(
          makeRouter(mockDb).addUserToTeam,
          { teamId: "team-1", userId: "new-user" },
          { context: createMockRpcContext({ user: noAccessUser }) }
        )
      ).rejects.toThrow();
    });
  });

  describe("searchUsers (team-manager directory lookup)", () => {
    const makeRouter = (mockDb: AuthDatabase) =>
      createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry,
        () => undefined
      );

    it("returns matching id/name/email rows", async () => {
      const mockDb = createMockDb();
      (mockDb.select as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        from: mock(() =>
          createChain([
            { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
          ])
        ),
      }));
      const result = await call(
        makeRouter(mockDb).searchUsers,
        { query: "ada" },
        { context: createMockRpcContext({ user: mockAdminUser }) }
      );
      expect(result).toEqual([
        { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
      ]);
    });

    it("returns nothing for a blank query (no directory dump)", async () => {
      const mockDb = createMockDb();
      const result = await call(
        makeRouter(mockDb).searchUsers,
        { query: "   " },
        { context: createMockRpcContext({ user: mockAdminUser }) }
      );
      expect(result).toEqual([]);
    });
  });
});
