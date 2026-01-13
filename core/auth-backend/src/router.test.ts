import { describe, it, expect, mock } from "bun:test";
import { createAuthRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import { z } from "zod";
import * as schema from "./schema";

// Mock better-auth
const mockAuth: any = {
  handler: mock(),
  api: {
    getSession: mock(),
  },
};

describe("Auth Router", () => {
  const mockUser = {
    type: "user" as const,
    id: "test-user",
    accessRules: ["*"],
    roles: ["admin"],
  } as any;

  const createChain = (data: any = []) => {
    const chain: any = {
      where: mock(() => chain),
      innerJoin: mock(() => chain),
      limit: mock(() => chain),
      offset: mock(() => chain),
      orderBy: mock(() => chain),
      onConflictDoUpdate: mock(() => Promise.resolve()),
      then: (resolve: any) => Promise.resolve(resolve(data)),
    };
    return chain;
  };

  const mockDb: any = {
    select: mock(() => ({
      from: mock(() => createChain([])),
    })),
    insert: mock(() => ({
      values: mock(() => createChain()),
    })),
    delete: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
    transaction: mock((cb: any) => cb(mockDb)), // Updated reference to mockDb
  };

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

  const mockConfigService: any = {
    get: mock(() => Promise.resolve(undefined)),
    getRedacted: mock(() => Promise.resolve({})),
    set: mock(() => Promise.resolve()),
    delete: mock(() => Promise.resolve()),
    list: mock(() => Promise.resolve([])),
  };

  const mockAccessRuleRegistry = {
    getAccessRules: () => [
      { id: "auth-backend.users.read", description: "List all users" },
      { id: "auth-backend.users.manage", description: "Delete users" },
      { id: "auth-backend.roles.read", description: "Read and list roles" },
    ],
  };

  const router = createAuthRouter(
    mockDb,
    mockRegistry,
    async () => {},
    mockConfigService,
    mockAccessRuleRegistry
  );

  it("getAccessRules returns current user access rules", async () => {
    const context = createMockRpcContext({ user: mockUser });
    const result = await call(router.accessRules, undefined, { context });
    expect(result.accessRules).toContain("*");
  });

  it("getUsers lists users with roles", async () => {
    const context = createMockRpcContext({ user: mockUser });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([{ id: "1", email: "user1@test.com", name: "User 1" }])
      ),
    }));
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ userId: "1", roleId: "admin" }])),
    }));

    const result = await call(router.getUsers, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].roles).toContain("admin");
  });

  it("deleteUser prevents deleting initial admin", async () => {
    const context = createMockRpcContext({ user: mockUser });
    expect(
      call(router.deleteUser, "initial-admin-id", { context })
    ).rejects.toThrow("Cannot delete initial admin");
  });

  it("deleteUser cascades to delete related records", async () => {
    const context = createMockRpcContext({ user: mockUser });
    const userId = "user-to-delete";

    // Track which tables had delete called on them
    const deletedTables: any[] = [];
    const mockTx: any = {
      delete: mock((table: any) => {
        deletedTables.push(table); // Track table
        return {
          where: mock(() => Promise.resolve()),
        };
      }),
    };

    mockDb.transaction.mockImplementationOnce((cb: any) => cb(mockTx));

    await call(router.deleteUser, userId, { context });

    // Verify transaction was used
    expect(mockDb.transaction).toHaveBeenCalled();

    // Verify all related tables were deleted in order
    expect(deletedTables).toHaveLength(4);
    expect(deletedTables.includes(schema.userRole)).toBe(true);
    expect(deletedTables.includes(schema.session)).toBe(true);
    expect(deletedTables.includes(schema.account)).toBe(true);
    expect(deletedTables.includes(schema.user)).toBe(true);
  });

  it("getRoles returns all roles with accesss", async () => {
    const context = createMockRpcContext({ user: mockUser });
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "admin", name: "Admin" }])),
    }));
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([{ roleId: "admin", accessRuleId: "users.manage" }])
      ),
    }));

    const result = await call(router.getRoles, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("admin");
    expect(result[0].accessRules).toContain("users.manage");
  });

  it("updateUserRoles updates user roles", async () => {
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(
      router.updateUserRoles,
      { userId: "other-user", roles: ["admin"] },
      { context }
    );
    // updateUserRoles returns void, so just check it completed
    expect(result).toBeUndefined();
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("updateUserRoles prevents updating own roles", async () => {
    const context = createMockRpcContext({ user: mockUser });

    expect(
      call(
        router.updateUserRoles,
        { userId: "test-user", roles: ["admin"] },
        { context }
      )
    ).rejects.toThrow("Cannot update your own roles");
  });

  it("getStrategies returns available strategies", async () => {
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(router.getStrategies, undefined, { context });
    expect(result.some((s: any) => s.id === "credential")).toBe(true);
  });

  it("updateStrategy updates strategy enabled status", async () => {
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(
      router.updateStrategy,
      { id: "credential", enabled: false },
      { context }
    );
    expect(result.success).toBe(true);
    expect(mockConfigService.set).toHaveBeenCalled();
  });

  it("getRegistrationStatus returns default true", async () => {
    const context = createMockRpcContext({ user: undefined }); // Public endpoint
    const result = await call(router.getRegistrationStatus, undefined, {
      context,
    });
    expect(result.allowRegistration).toBe(true);
  });

  it("setRegistrationStatus updates flag and requires access", async () => {
    const context = createMockRpcContext({ user: mockUser });
    const result = await call(
      router.setRegistrationStatus,
      { allowRegistration: false },
      { context }
    );
    expect(result.success).toBe(true);
    expect(mockConfigService.set).toHaveBeenCalledWith(
      "platform.registration",
      expect.anything(),
      1,
      { allowRegistration: false }
    );
  });

  // ==========================================================================
  // SERVICE-TO-SERVICE TESTS
  // ==========================================================================

  const mockServiceUser = {
    type: "service" as const,
    pluginId: "auth-ldap-backend",
  } as any;

  it("findUserByEmail returns user when found", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "user-123" }])),
    }));

    const result = await call(
      router.findUserByEmail,
      { email: "test@example.com" },
      { context }
    );
    expect(result).toEqual({ id: "user-123" });
  });

  it("findUserByEmail returns undefined when not found", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    const result = await call(
      router.findUserByEmail,
      { email: "nonexistent@example.com" },
      { context }
    );
    expect(result).toBeUndefined();
  });

  it("upsertExternalUser creates new user and account", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    // Mock user not found (empty result)
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    // Mock registration allowed
    mockConfigService.get.mockResolvedValueOnce({ allowRegistration: true });

    const result = await call(
      router.upsertExternalUser,
      {
        email: "ldap-user@example.com",
        name: "LDAP User",
        providerId: "ldap",
        accountId: "ldapuser",
        password: "hashed-password",
      },
      { context }
    );

    expect(result.created).toBe(true);
    expect(result.userId).toBeDefined();
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("upsertExternalUser updates existing user when autoUpdateUser is true", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    // Mock existing user found
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "existing-user-id" }])),
    }));

    // Mock update chain
    mockDb.update = mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
    }));

    const result = await call(
      router.upsertExternalUser,
      {
        email: "existing@example.com",
        name: "Updated Name",
        providerId: "ldap",
        accountId: "existinguser",
        password: "hashed-password",
        autoUpdateUser: true,
      },
      { context }
    );

    expect(result.created).toBe(false);
    expect(result.userId).toBe("existing-user-id");
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("createSession creates session record", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await call(
      router.createSession,
      {
        userId: "user-123",
        token: "session-token",
        expiresAt,
      },
      { context }
    );

    expect(result.sessionId).toBeDefined();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  // ==========================================================================
  // ADMIN USER CREATION TESTS
  // ==========================================================================

  it("createCredentialUser creates user with valid data", async () => {
    const context = createMockRpcContext({ user: mockUser });

    // Mock credential strategy enabled
    mockConfigService.get.mockResolvedValueOnce({ enabled: true });

    // Mock user not found (empty result for email check)
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    const result = await call(
      router.createCredentialUser,
      {
        email: "newuser@example.com",
        name: "New User",
        password: "ValidPass123",
      },
      { context }
    );

    expect(result.userId).toBeDefined();
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("createCredentialUser rejects weak password", async () => {
    const context = createMockRpcContext({ user: mockUser });

    // Weak password - no uppercase
    expect(
      call(
        router.createCredentialUser,
        {
          email: "test@example.com",
          name: "Test User",
          password: "weakpass1",
        },
        { context }
      )
    ).rejects.toThrow("uppercase");
  });

  it("createCredentialUser rejects duplicate email", async () => {
    const context = createMockRpcContext({ user: mockUser });

    // Mock credential strategy enabled
    mockConfigService.get.mockResolvedValueOnce({ enabled: true });

    // Mock user already exists
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "existing-user" }])),
    }));

    expect(
      call(
        router.createCredentialUser,
        {
          email: "existing@example.com",
          name: "Existing User",
          password: "ValidPass123",
        },
        { context }
      )
    ).rejects.toThrow("already exists");
  });

  it("createCredentialUser rejects when credential strategy disabled", async () => {
    const context = createMockRpcContext({ user: mockUser });

    // Mock credential strategy disabled
    mockConfigService.get.mockResolvedValueOnce({ enabled: false });

    expect(
      call(
        router.createCredentialUser,
        {
          email: "test@example.com",
          name: "Test User",
          password: "ValidPass123",
        },
        { context }
      )
    ).rejects.toThrow("not enabled");
  });
});
