import { describe, it, expect, mock } from "bun:test";
import { createAuthRouter, type AuthRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call, ORPCError } from "@orpc/server";
import { z } from "zod";
import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";

type AuthDatabase = SafeDatabase<typeof schema>;

describe("Teams Security Vulnerability", () => {
  // Mock regular user with ONLY read access
  const mockRegularUser = {
    type: "user" as const,
    id: "regular-user",
    accessRules: ["test-plugin.teams.read"], // Only read access
    roles: ["users"],
    teamIds: ["team-beta"],
  };

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

  it("FIXED: updateTeam prevents user with only read access from updating team", async () => {
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

    // Mock manager check: User is NOT a manager
    (mockDb.select as ReturnType<typeof mock>).mockImplementation((() => ({
        from: mock(() => createChain([])), // No results for teamManager check
    })));


    const router = createAuthRouter(
      mockDb,
      mockRegistry,
      async () => {},
      mockConfigService,
      mockAccessRuleRegistry
    );

    const context = createMockRpcContext({ user: mockRegularUser });

    try {
      await call(
        router.updateTeam,
        { id: "team-alpha", name: "Hacked Team Name" },
        { context }
      );
    } catch (e) {
      if (e instanceof ORPCError && e.code === "FORBIDDEN") {
        return; // Success: Access denied
      }
      throw e;
    }

    throw new Error("Security check failed: User with read-only access updated the team!");
  });

  it("FIXED: addUserToTeam prevents user with only read access from adding users", async () => {
      const mockDb = createMockDb();

      // Mock manager check: User is NOT a manager
      (mockDb.select as ReturnType<typeof mock>).mockImplementation((() => ({
          from: mock(() => createChain([])),
      })));

      const router = createAuthRouter(
        mockDb,
        mockRegistry,
        async () => {},
        mockConfigService,
        mockAccessRuleRegistry
      );

      const context = createMockRpcContext({ user: mockRegularUser });

      try {
        await call(
            router.addUserToTeam,
            { teamId: "team-alpha", userId: "new-user" },
            { context }
        );
      } catch (e) {
        if (e instanceof ORPCError && e.code === "FORBIDDEN") {
            return; // Success: Access denied
        }
        throw e;
      }

      throw new Error("Security check failed: User with read-only access added a user!");
  });
});
