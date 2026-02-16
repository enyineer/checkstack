import { describe, it, expect, mock } from "bun:test";
import { createAuthRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call, ORPCError } from "@orpc/server";
import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";

/** Type alias for the database type used in auth router */
type AuthDatabase = SafeDatabase<typeof schema>;

describe("Team Access Control", () => {
  // Mock regular user with ONLY read access to teams
  // NOT a manager of any team
  const mockReadUser = {
    type: "user" as const,
    id: "read-user",
    accessRules: ["test-plugin.teams.read"],
    roles: ["users"],
    teamIds: [],
  };

  // Mock regular user who is a manager of team-1
  const mockManagerUser = {
    type: "user" as const,
    id: "manager-user",
    accessRules: ["test-plugin.teams.read"], // Only read access globally
    roles: ["users"],
    teamIds: ["team-1"],
  };

  /**
   * Creates a chainable mock for database query operations.
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
    return mockDb as unknown as AuthDatabase;
  }

  const mockRegistry = {
    getStrategies: () => [],
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

  describe("Unauthorized Access (Read-Only User)", () => {
    it("should PREVENT user with only read access from updating a team", async () => {
      const mockDb = createMockDb();

      (mockDb.update as ReturnType<typeof mock>).mockImplementationOnce(() => ({
        set: mock(() => ({
          where: mock(() => Promise.resolve()),
        })),
      }));

      // Mock finding manager - return EMPTY so user is NOT a manager
      (mockDb.select as ReturnType<typeof mock>).mockImplementation(() => ({
          from: mock(() => ({
              where: mock(() => ({
                limit: mock(() => createChain([])) // User is not a manager
              }))
          }))
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry
      );

      const context = createMockRpcContext({ user: mockReadUser });

      // This call SHOULD fail with Forbidden
      try {
          await call(
            router.updateTeam,
            { id: "team-1", name: "Hacked Team Name" },
            { context }
          );
          throw new Error("Should have thrown FORBIDDEN");
      } catch (e: any) {
          if (e.message === "Should have thrown FORBIDDEN") {
              throw e;
          }
      }

      // Expect NO update to have occurred
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("should PREVENT user with only read access from adding user to team", async () => {
      const mockDb = createMockDb();

      // Mock finding manager - return EMPTY so user is NOT a manager
      (mockDb.select as ReturnType<typeof mock>).mockImplementation(() => ({
          from: mock(() => ({
              where: mock(() => ({
                limit: mock(() => createChain([])) // User is not a manager
              }))
          }))
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry
      );

      const context = createMockRpcContext({ user: mockReadUser });

      try {
          await call(
            router.addUserToTeam,
            { teamId: "team-1", userId: "new-user" },
            { context }
          );
          throw new Error("Should have thrown FORBIDDEN");
      } catch (e: any) {
          if (e.message === "Should have thrown FORBIDDEN") throw e;
      }

      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe("Authorized Access (Team Manager)", () => {
    it("should ALLOW team manager to update their own team", async () => {
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

      // Mock finding manager - return user as manager
      (mockDb.select as ReturnType<typeof mock>).mockImplementation(() => ({
          from: mock(() => ({
              where: mock(() => ({
                limit: mock(() => createChain([{ teamId: "team-1", userId: "manager-user" }]))
              }))
          }))
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry
      );

      const context = createMockRpcContext({ user: mockManagerUser });

      await call(
        router.updateTeam,
        { id: "team-1", name: "Updated Name" },
        { context }
      );

      expect(mockDb.update).toHaveBeenCalled();
      expect(updatedData?.name).toBe("Updated Name");
    });

    it("should ALLOW team manager to add user to their own team", async () => {
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

      // Mock finding manager - return user as manager
      (mockDb.select as ReturnType<typeof mock>).mockImplementation(() => ({
          from: mock(() => ({
              where: mock(() => ({
                limit: mock(() => createChain([{ teamId: "team-1", userId: "manager-user" }]))
              }))
          }))
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry
      );

      const context = createMockRpcContext({ user: mockManagerUser });

      await call(
        router.addUserToTeam,
        { teamId: "team-1", userId: "new-user" },
        { context }
      );

      expect(mockDb.insert).toHaveBeenCalled();
      expect(insertedData?.userId).toBe("new-user");
    });

    it("should ALLOW team manager to remove user from their own team", async () => {
      const mockDb = createMockDb();

      // Mock finding manager - return user as manager
      (mockDb.select as ReturnType<typeof mock>).mockImplementation(() => ({
          from: mock(() => ({
              where: mock(() => ({
                limit: mock(() => createChain([{ teamId: "team-1", userId: "manager-user" }]))
              }))
          }))
      }));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry
      );

      const context = createMockRpcContext({ user: mockManagerUser });

      await call(
        router.removeUserFromTeam,
        { teamId: "team-1", userId: "old-user" },
        { context }
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
