import { describe, it, expect, mock } from "bun:test";
import {
  createAuthRouter,
  ADMIN_ROLE_ID,
  USERS_ROLE_ID,
  ANONYMOUS_ROLE_ID,
  APPLICATIONS_ROLE_ID,
} from "./router";
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
    mockAccessRuleRegistry,
    () => undefined,
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
        createChain([{ id: "1", email: "user1@test.com", name: "User 1" }]),
      ),
    }));
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ userId: "1", roleId: "admin" }])),
    }));

    const result = await call(router.getUsers, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].roles).toContain("admin");
  });

  it("deleteUser prevents deleting users with admin role", async () => {
    const context = createMockRpcContext({ user: mockUser });

    // Mock user has admin role
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ roleId: ADMIN_ROLE_ID }])),
    }));

    await expect(
      call(router.deleteUser, "admin-user-id", { context }),
    ).rejects.toThrow("admin role");
  });

  it("deleteUser cascades to delete related records", async () => {
    const context = createMockRpcContext({ user: mockUser });
    const userId = "user-to-delete";

    // Mock user has no admin role
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ roleId: USERS_ROLE_ID }])),
    }));

    // Track which tables had delete called on them
    const deletedTables: unknown[] = [];
    const mockTx: unknown = {
      delete: mock((table: unknown) => {
        deletedTables.push(table); // Track table
        return {
          where: mock(() => Promise.resolve()),
        };
      }),
    };

    mockDb.transaction.mockImplementationOnce((cb: (tx: unknown) => unknown) =>
      cb(mockTx),
    );

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
        createChain([{ roleId: "admin", accessRuleId: "users.manage" }]),
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
      { context },
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
        { context },
      ),
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
      { context },
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
      { context },
    );
    expect(result.success).toBe(true);
    expect(mockConfigService.set).toHaveBeenCalledWith(
      "platform.registration",
      expect.anything(),
      1,
      { allowRegistration: false },
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
      { context },
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
      { context },
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
      { context },
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
      { context },
    );

    expect(result.created).toBe(false);
    expect(result.userId).toBe("existing-user-id");
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("createSession calls the internal auth bridge", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    // Setup environment variables for the bridge call
    process.env.BASE_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = "test-secret";

    const mockResponse = { sessionId: "session-123" };
    const mockHandler = mock(async (_req: Request) => {
      const headers = new Headers();
      headers.append("Set-Cookie", "better-auth.session_token=test-token; Path=/; HttpOnly; Max-Age=604800");
      headers.append("Set-Cookie", "better-auth.session_data=test-data; Path=/; HttpOnly; Max-Age=300");
      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers,
      });
    });

    // We need to use a router instance that has access to our mock handler
    const testRouter = createAuthRouter(
      mockDb,
      mockRegistry,
      async () => {},
      mockConfigService,
      mockAccessRuleRegistry,
      () => ({ handler: mockHandler }),
    );

    const result = await call(
      testRouter.createSession,
      {
        userId: "user-123",
      },
      { context },
    );

    expect(result.sessionId).toBe("session-123");
    expect(result.setCookies).toBeArrayOfSize(2);
    expect(result.setCookies[0]).toContain("better-auth.session_token=test-token");
    expect(result.setCookies[1]).toContain("better-auth.session_data=test-data");
    expect(mockHandler).toHaveBeenCalled();

    // Verify the virtual request headers
    const lastCall = mockHandler.mock.calls[0][0] as unknown as Request;
    expect(lastCall.headers.get("Host")).toBe("localhost:3000");
    expect(lastCall.url).toBe("http://localhost:3000/api/auth/internal/trusted-login");

    // Cleanup environment variables
    delete process.env.BASE_URL;
    delete process.env.BETTER_AUTH_SECRET;
  });

  it("upsertExternalUser syncs roles when syncRoles provided for new user", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    // Mock user not found (empty result)
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    // Mock registration allowed
    mockConfigService.get.mockResolvedValueOnce({ allowRegistration: true });

    // Mock valid roles lookup
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([{ id: USERS_ROLE_ID }, { id: "custom-role" }]),
      ),
    }));

    // Mock current roles lookup (empty for new user)
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    const result = await call(
      router.upsertExternalUser,
      {
        email: "saml-user@example.com",
        name: "SAML User",
        providerId: "saml",
        accountId: "samluser",
        password: "hashed-password",
        syncRoles: [USERS_ROLE_ID, "custom-role", "invalid-role"],
      },
      { context },
    );

    expect(result.created).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("upsertExternalUser additively syncs roles for existing user", async () => {
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

    // Mock valid roles lookup
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "new-role" }])),
    }));

    // Mock current roles lookup (user already has existing role)
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ roleId: USERS_ROLE_ID }])),
    }));

    const result = await call(
      router.upsertExternalUser,
      {
        email: "existing@example.com",
        name: "Existing User",
        providerId: "ldap",
        accountId: "existinguser",
        password: "hashed-password",
        autoUpdateUser: true,
        syncRoles: ["new-role"],
      },
      { context },
    );

    expect(result.created).toBe(false);
    expect(result.userId).toBe("existing-user-id");
    // New role should be added (insert called)
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("upsertExternalUser ignores invalid role IDs silently", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    // Mock user not found (empty result)
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    // Mock registration allowed
    mockConfigService.get.mockResolvedValueOnce({ allowRegistration: true });

    // Mock valid roles lookup - none of the provided roles are valid
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])), // No valid roles
    }));

    const result = await call(
      router.upsertExternalUser,
      {
        email: "user@example.com",
        name: "User",
        providerId: "saml",
        accountId: "user123",
        password: "hashed-password",
        syncRoles: ["invalid-role-1", "invalid-role-2"],
      },
      { context },
    );

    // Should still succeed even with all invalid roles
    expect(result.created).toBe(true);
    expect(result.userId).toBeDefined();
  });

  it("upsertExternalUser does not sync roles when syncRoles not provided", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    // Mock user not found (empty result)
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    // Mock registration allowed
    mockConfigService.get.mockResolvedValueOnce({ allowRegistration: true });

    // Reset insert mock to track calls
    const insertMock = mock(() => ({
      values: mock(() => createChain()),
    }));
    mockDb.insert = insertMock;

    const result = await call(
      router.upsertExternalUser,
      {
        email: "user@example.com",
        name: "User",
        providerId: "saml",
        accountId: "user123",
        password: "hashed-password",
        // No syncRoles provided
      },
      { context },
    );

    expect(result.created).toBe(true);
    // Transaction should be called for user creation, but no role sync
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("upsertExternalUser removes managed roles when user leaves directory groups", async () => {
    const context = createMockRpcContext({ user: mockServiceUser });

    // Mock existing user found
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "existing-user-id" }])),
    }));

    // Mock update chain (for autoUpdateUser)
    mockDb.update = mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
    }));

    // Note: When syncRoles is empty [], we skip the valid roles query
    // So next select is the current roles lookup

    // Mock current roles lookup - user has managed role that should be removed
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([
          { roleId: "managed-role-1" }, // Should be removed - managed but not in syncRoles
          { roleId: "manual-role" }, // Should be preserved - not in managedRoleIds
        ]),
      ),
    }));

    // Mock delete
    mockDb.delete = mock(() => ({
      where: mock(() => Promise.resolve()),
    }));

    const result = await call(
      router.upsertExternalUser,
      {
        email: "user@example.com",
        name: "User",
        providerId: "ldap",
        accountId: "user123",
        password: "hashed-password",
        autoUpdateUser: true,
        syncRoles: [], // User no longer has any groups
        managedRoleIds: ["managed-role-1", "managed-role-2"], // Roles controlled by directory
      },
      { context },
    );

    expect(result.created).toBe(false);
    // Delete should be called to remove the managed role
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("upsertExternalUser preserves unmanaged roles during sync", async () => {
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

    // Mock valid sync roles lookup
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "new-managed-role" }])),
    }));

    // Mock current roles - user has both managed and unmanaged roles
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([
          { roleId: "old-managed-role" }, // Should be removed - managed but not in syncRoles
          { roleId: "admin-role" }, // Should be preserved - manually assigned, not managed
        ]),
      ),
    }));

    // Mock delete
    const deleteMock = mock(() => ({
      where: mock(() => Promise.resolve()),
    }));
    mockDb.delete = deleteMock;

    const result = await call(
      router.upsertExternalUser,
      {
        email: "user@example.com",
        name: "User",
        providerId: "ldap",
        accountId: "user123",
        password: "hashed-password",
        autoUpdateUser: true,
        syncRoles: ["new-managed-role"],
        managedRoleIds: ["old-managed-role", "new-managed-role"], // Only these are managed
      },
      { context },
    );

    expect(result.created).toBe(false);
    // Insert should be called to add new role
    expect(mockDb.insert).toHaveBeenCalled();
    // Delete should be called to remove old-managed-role (but NOT admin-role)
    expect(deleteMock).toHaveBeenCalled();
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
      { context },
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
        { context },
      ),
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
        { context },
      ),
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
        { context },
      ),
    ).rejects.toThrow("not enabled");
  });

  // ==========================================================================
  // ONBOARDING ENDPOINT TESTS
  // ==========================================================================

  it("getOnboardingStatus returns needsOnboarding true when no users exist", async () => {
    const context = createMockRpcContext({ user: undefined });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    const result = await call(router.getOnboardingStatus, undefined, {
      context,
    });
    expect(result.needsOnboarding).toBe(true);
  });

  it("getOnboardingStatus returns needsOnboarding false when users exist", async () => {
    const context = createMockRpcContext({ user: undefined });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "existing-user" }])),
    }));

    const result = await call(router.getOnboardingStatus, undefined, {
      context,
    });
    expect(result.needsOnboarding).toBe(false);
  });

  it("completeOnboarding creates first admin user", async () => {
    const context = createMockRpcContext({ user: undefined });

    // No existing users
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    const result = await call(
      router.completeOnboarding,
      {
        name: "Admin User",
        email: "admin@example.com",
        password: "ValidPass123",
      },
      { context },
    );

    expect(result.success).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("completeOnboarding rejects when users already exist", async () => {
    const context = createMockRpcContext({ user: undefined });

    // Existing user
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "existing-user" }])),
    }));

    expect(
      call(
        router.completeOnboarding,
        {
          name: "Admin User",
          email: "admin@example.com",
          password: "ValidPass123",
        },
        { context },
      ),
    ).rejects.toThrow("already been completed");
  });

  it("completeOnboarding rejects weak password", async () => {
    const context = createMockRpcContext({ user: undefined });

    // No existing users
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    expect(
      call(
        router.completeOnboarding,
        {
          name: "Admin User",
          email: "admin@example.com",
          password: "weak",
        },
        { context },
      ),
    ).rejects.toThrow();
  });

  // ==========================================================================
  // USER PROFILE ENDPOINT TESTS
  // ==========================================================================

  it("getCurrentUserProfile returns profile with credential account flag", async () => {
    const context = createMockRpcContext({ user: mockUser });

    // Mock user data
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([
          { id: "test-user", name: "Test", email: "test@test.com" },
        ]),
      ),
    }));
    // Mock credential account check
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ providerId: "credential" }])),
    }));

    const result = await call(router.getCurrentUserProfile, undefined, {
      context,
    });
    expect(result.id).toBe("test-user");
    expect(result.hasCredentialAccount).toBe(true);
  });

  it("getCurrentUserProfile returns false for OAuth-only users", async () => {
    const context = createMockRpcContext({ user: mockUser });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([
          { id: "test-user", name: "Test", email: "test@test.com" },
        ]),
      ),
    }));
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])), // No credential account
    }));

    const result = await call(router.getCurrentUserProfile, undefined, {
      context,
    });
    expect(result.hasCredentialAccount).toBe(false);
  });

  it("updateCurrentUser updates name for any user", async () => {
    const context = createMockRpcContext({ user: mockUser });

    mockDb.update = mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
    }));

    await call(router.updateCurrentUser, { name: "New Name" }, { context });

    expect(mockDb.update).toHaveBeenCalled();
  });

  it("updateCurrentUser allows email update for credential users", async () => {
    const context = createMockRpcContext({ user: mockUser });

    // Has credential account
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ providerId: "credential" }])),
    }));
    // No duplicate email
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    mockDb.update = mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
    }));

    await call(
      router.updateCurrentUser,
      { email: "new@example.com" },
      { context },
    );

    expect(mockDb.update).toHaveBeenCalled();
  });

  it("updateCurrentUser rejects email update for OAuth users", async () => {
    const context = createMockRpcContext({ user: mockUser });

    // No credential account
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])),
    }));

    expect(
      call(router.updateCurrentUser, { email: "new@example.com" }, { context }),
    ).rejects.toThrow("credential-based accounts");
  });

  // ==========================================================================
  // ROLE CRUD ENDPOINT TESTS
  // ==========================================================================

  it("createRole creates role with access rules", async () => {
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(
      router.createRole,
      {
        name: "Custom Role",
        description: "A custom role",
        accessRules: ["auth-backend.users.read"],
      },
      { context },
    );

    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("deleteRole prevents deleting system roles", async () => {
    // Use a user without admin role to properly test system role protection
    const nonAdminUser = {
      type: "user" as const,
      id: "non-admin-user",
      accessRules: ["*"],
      roles: ["users"],
    } as ReturnType<typeof createMockRpcContext>["user"];
    const context = createMockRpcContext({ user: nonAdminUser });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: ADMIN_ROLE_ID, isSystem: true }])),
    }));

    expect(call(router.deleteRole, ADMIN_ROLE_ID, { context })).rejects.toThrow(
      "system role",
    );
  });

  it("deleteRole prevents deleting own roles", async () => {
    const userWithRole = {
      ...mockUser,
      roles: ["custom-role"],
    };
    const context = createMockRpcContext({ user: userWithRole });

    expect(call(router.deleteRole, "custom-role", { context })).rejects.toThrow(
      "currently have",
    );
  });

  it("getAccessRules returns registry access rules", async () => {
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(router.getAccessRules, undefined, { context });
    expect(
      result.some((r: { id: string }) => r.id === "auth-backend.users.read"),
    ).toBe(true);
  });

  it("updateUserRoles prevents assigning anonymous role", async () => {
    const context = createMockRpcContext({ user: mockUser });

    expect(
      call(
        router.updateUserRoles,
        { userId: "other-user", roles: [ANONYMOUS_ROLE_ID] },
        { context },
      ),
    ).rejects.toThrow("anonymous");
  });

  // ==========================================================================
  // APPLICATION MANAGEMENT ENDPOINT TESTS
  // ==========================================================================

  it("getApplications returns applications with roles", async () => {
    const context = createMockRpcContext({ user: mockUser });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([
          {
            id: "app-1",
            name: "Test App",
            description: "Test description",
            createdById: "user-1",
            createdAt: new Date(),
            lastUsedAt: null,
          },
        ]),
      ),
    }));
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([{ applicationId: "app-1", roleId: APPLICATIONS_ROLE_ID }]),
      ),
    }));

    const result = await call(router.getApplications, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].roles).toContain(APPLICATIONS_ROLE_ID);
  });

  it("createApplication creates application with secret", async () => {
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(
      router.createApplication,
      { name: "New App", description: "Test application" },
      { context },
    );

    expect(result.application.name).toBe("New App");
    expect(result.secret).toMatch(/^ck_/); // Secret has proper prefix
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("deleteApplication handles not found", async () => {
    const context = createMockRpcContext({ user: mockUser });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([])), // No application found
    }));

    await expect(
      call(router.deleteApplication, "non-existent-id", { context }),
    ).rejects.toThrow("not found");
  });

  it("regenerateApplicationSecret returns new secret", async () => {
    const context = createMockRpcContext({ user: mockUser });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "app-1" }])),
    }));

    mockDb.update = mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
    }));

    const result = await call(router.regenerateApplicationSecret, "app-1", {
      context,
    });

    expect(result.secret).toMatch(/^ck_app-1_/);
    expect(mockDb.update).toHaveBeenCalled();
  });

  // ==========================================================================
  // PUBLIC ENDPOINT TESTS
  // ==========================================================================

  it("getEnabledStrategies returns only enabled strategies", async () => {
    const context = createMockRpcContext({ user: undefined });

    // Mock credential enabled (default)
    mockConfigService.get.mockResolvedValueOnce(undefined); // Uses default

    const result = await call(router.getEnabledStrategies, undefined, {
      context,
    });

    // Should contain the credential strategy
    expect(result.some((s: { id: string }) => s.id === "credential")).toBe(
      true,
    );
  });
});
