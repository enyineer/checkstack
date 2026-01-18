import { describe, expect, it, mock, beforeEach, type Mock } from "bun:test";
import { call, implement } from "@orpc/server";
import { z } from "zod";
import { autoAuthMiddleware, RpcContext } from "./rpc";
import { createMockRpcContext } from "./test-utils";
import { access, accessPair, proc } from "@checkstack/common";

// =============================================================================
// TEST CONTRACT DEFINITIONS
// =============================================================================

/**
 * Test contracts for different access patterns.
 * All use proc() helper with required operationType.
 */
const testContracts = {
  // Anonymous endpoint - no auth required
  anonymousEndpoint: proc({
    userType: "anonymous",
    operationType: "query",
    access: [],
  }).output(z.object({ message: z.string() })),

  // Public endpoint with global access rules only (no instance access)
  publicGlobalEndpoint: proc({
    userType: "public",
    operationType: "query",
    access: [access("resource", "read", "Test access")],
  }).output(z.object({ message: z.string() })),

  // Public endpoint with list filtering
  publicListEndpoint: proc({
    userType: "public",
    operationType: "query",
    access: [
      accessPair(
        "system",
        {
          read: { description: "View systems", isPublic: true },
          manage: { description: "Manage systems" },
        },
        { listKey: "systems" },
      ).read,
    ],
  }).output(
    z.object({
      systems: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),

  // Authenticated endpoint
  authenticatedEndpoint: proc({
    userType: "authenticated",
    operationType: "query",
    access: [],
  }).output(z.object({ message: z.string() })),

  // User-only endpoint
  userOnlyEndpoint: proc({
    userType: "user",
    operationType: "query",
    access: [],
  }).output(z.object({ message: z.string() })),

  // Service-only endpoint
  serviceOnlyEndpoint: proc({
    userType: "service",
    operationType: "query",
    access: [],
  }).output(z.object({ message: z.string() })),

  // Single resource endpoint with idParam
  singleResourceEndpoint: proc({
    userType: "public",
    operationType: "query",
    access: [
      accessPair(
        "system",
        {
          read: { description: "View systems", isPublic: true },
          manage: { description: "Manage systems" },
        },
        { idParam: "systemId" },
      ).read,
    ],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ system: z.object({ id: z.string() }).nullable() })),

  // Bulk record endpoint with recordKey (like getBulkSystemHealthStatus)
  recordEndpoint: proc({
    userType: "public",
    operationType: "query",
    access: [
      access("bulk", "read", "Bulk read", {
        recordKey: "statuses",
        isPublic: true,
      }),
    ],
  })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        statuses: z.record(z.string(), z.object({ status: z.string() })),
      }),
    ),

  // Mutation endpoint
  mutationEndpoint: proc({
    userType: "authenticated",
    operationType: "mutation",
    access: [],
  })
    .input(z.object({ name: z.string() }))
    .output(z.object({ id: z.string() })),

  // Bulk record endpoint using instanceAccess OVERRIDE at contract level
  // This tests the pattern where bulk endpoints share the same access rule
  // as single endpoints but use recordKey instead of idParam
  bulkRecordWithOverride: proc({
    userType: "public",
    operationType: "query",
    // Uses same access rule as singleResourceEndpoint (has idParam)
    // but overrides instanceAccess to use recordKey
    access: [
      accessPair(
        "system",
        {
          read: { description: "View systems", isPublic: true },
          manage: { description: "Manage systems" },
        },
        { idParam: "systemId" },
      ).read,
    ],
    instanceAccess: { recordKey: "statuses" },
  })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        statuses: z.record(z.string(), z.object({ status: z.string() })),
      }),
    ),
};

// =============================================================================
// TEST IMPLEMENTATIONS
// =============================================================================

const testImplementations = {
  anonymousEndpoint: implement(testContracts.anonymousEndpoint).handler(() => ({
    message: "Hello from anonymous",
  })),

  publicGlobalEndpoint: implement(testContracts.publicGlobalEndpoint).handler(
    () => ({
      message: "Hello from public global",
    }),
  ),

  publicListEndpoint: implement(testContracts.publicListEndpoint).handler(
    () => ({
      systems: [
        { id: "system-1", name: "System 1" },
        { id: "system-2", name: "System 2" },
        { id: "system-3", name: "System 3" },
      ],
    }),
  ),

  authenticatedEndpoint: implement(testContracts.authenticatedEndpoint).handler(
    () => ({
      message: "Hello from authenticated",
    }),
  ),

  userOnlyEndpoint: implement(testContracts.userOnlyEndpoint).handler(() => ({
    message: "Hello from user",
  })),

  serviceOnlyEndpoint: implement(testContracts.serviceOnlyEndpoint).handler(
    () => ({
      message: "Hello from service",
    }),
  ),

  singleResourceEndpoint: implement(
    testContracts.singleResourceEndpoint,
  ).handler(({ input }) => ({
    system: { id: input.systemId },
  })),

  recordEndpoint: implement(testContracts.recordEndpoint).handler(
    ({ input }) => ({
      statuses: Object.fromEntries(
        input.systemIds.map((id) => [id, { status: "ok" }]),
      ),
    }),
  ),

  mutationEndpoint: implement(testContracts.mutationEndpoint).handler(() => ({
    id: "new-id",
  })),

  bulkRecordWithOverride: implement(
    testContracts.bulkRecordWithOverride,
  ).handler(({ input }) => ({
    statuses: Object.fromEntries(
      input.systemIds.map((id) => [id, { status: "ok" }]),
    ),
  })),
};

// =============================================================================
// TESTS
// =============================================================================

describe("autoAuthMiddleware", () => {
  let mockContext: RpcContext;

  beforeEach(() => {
    mockContext = createMockRpcContext();
  });

  // ---------------------------------------------------------------------------
  // Anonymous Access
  // ---------------------------------------------------------------------------

  describe("anonymous endpoints", () => {
    it("should allow anonymous access without auth", async () => {
      const procedure = implement(testContracts.anonymousEndpoint)
        .$context<RpcContext>()
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      const result = await call(procedure, undefined, {
        context: { ...mockContext, user: undefined },
      });

      expect(result).toEqual({ message: "success" });
    });
  });

  // ---------------------------------------------------------------------------
  // Public Access
  // ---------------------------------------------------------------------------

  describe("public endpoints", () => {
    it("should allow authenticated users with proper access", async () => {
      const procedure = implement(testContracts.publicGlobalEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      const result = await call(procedure, undefined, { context: mockContext });

      expect(result).toEqual({ message: "success" });
    });

    it("should deny authenticated users without proper access", async () => {
      // Set user with no access rules to simulate denied access
      const contextWithNoAccess = {
        ...mockContext,
        user: { type: "user" as const, id: "user-1", accessRules: [] },
      };

      const procedure = implement(testContracts.publicGlobalEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      expect(
        call(procedure, undefined, { context: contextWithNoAccess }),
      ).rejects.toThrow();
    });

    it("should allow anonymous users for public endpoints with correct access", async () => {
      // Mock anonymous access rules to include the required access
      const contextWithAnonymousAccess = {
        ...mockContext,
        user: undefined,
        auth: {
          ...mockContext.auth,
          getAnonymousAccessRules: () =>
            Promise.resolve(["test-plugin.resource.read"]),
        },
      };

      const procedure = implement(testContracts.publicGlobalEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      const result = await call(procedure, undefined, {
        context: contextWithAnonymousAccess,
      });

      expect(result).toEqual({ message: "success" });
    });
  });

  // ---------------------------------------------------------------------------
  // Authenticated Access
  // ---------------------------------------------------------------------------

  describe("authenticated endpoints", () => {
    it("should allow authenticated users", async () => {
      const procedure = implement(testContracts.authenticatedEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      const result = await call(procedure, undefined, { context: mockContext });

      expect(result).toEqual({ message: "success" });
    });

    it("should deny anonymous users", async () => {
      const procedure = implement(testContracts.authenticatedEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      expect(
        call(procedure, undefined, {
          context: { ...mockContext, user: undefined },
        }),
      ).rejects.toThrow("Authentication required");
    });
  });

  // ---------------------------------------------------------------------------
  // User-only Access
  // ---------------------------------------------------------------------------

  describe("user-only endpoints", () => {
    it("should allow frontend users", async () => {
      const procedure = implement(testContracts.userOnlyEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      const result = await call(procedure, undefined, { context: mockContext });

      expect(result).toEqual({ message: "success" });
    });

    it("should deny services", async () => {
      const procedure = implement(testContracts.userOnlyEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      expect(
        call(procedure, undefined, {
          context: {
            ...mockContext,
            user: { type: "service" as const, pluginId: "test-service" },
          },
        }),
      ).rejects.toThrow("This endpoint is for users only");
    });
  });

  // ---------------------------------------------------------------------------
  // Service-only Access
  // ---------------------------------------------------------------------------

  describe("service-only endpoints", () => {
    it("should allow services", async () => {
      const procedure = implement(testContracts.serviceOnlyEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      const result = await call(procedure, undefined, {
        context: {
          ...mockContext,
          user: { type: "service" as const, pluginId: "test-service" },
        },
      });

      expect(result).toEqual({ message: "success" });
    });

    it("should deny frontend users", async () => {
      const procedure = implement(testContracts.serviceOnlyEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ message: "success" }));

      expect(
        call(procedure, undefined, { context: mockContext }),
      ).rejects.toThrow("This endpoint is for services only");
    });
  });

  // ---------------------------------------------------------------------------
  // Instance-level Access (idParam)
  // ---------------------------------------------------------------------------

  describe("single resource endpoints with idParam", () => {
    it("should check instance-level access with idParam", async () => {
      const procedure = implement(testContracts.singleResourceEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(({ input }) => ({ system: { id: input.systemId } }));

      const result = await call(
        procedure,
        { systemId: "test-123" },
        { context: mockContext },
      );

      expect(result).toEqual({ system: { id: "test-123" } });
    });

    it("should deny access when instance check fails", async () => {
      // Set user with no access rules AND mock auth to deny team access
      const contextWithNoAccess = {
        ...mockContext,
        user: { type: "user" as const, id: "user-1", accessRules: [] },
        auth: {
          ...mockContext.auth,
          checkResourceTeamAccess: () => Promise.resolve({ hasAccess: false }),
        },
      };

      const procedure = implement(testContracts.singleResourceEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(({ input }) => ({ system: { id: input.systemId } }));

      expect(
        call(
          procedure,
          { systemId: "forbidden-id" },
          { context: contextWithNoAccess },
        ),
      ).rejects.toThrow();
    });

    // Regression tests for anonymous user access to single resources (issue: 403 for public endpoints)
    it("should allow anonymous users with global access to single resource endpoints", async () => {
      // Mock anonymous access rules to include the required access
      const contextWithAnonymousAccess = {
        ...mockContext,
        user: undefined,
        auth: {
          ...mockContext.auth,
          getAnonymousAccessRules: () =>
            Promise.resolve(["test-plugin.system.read"]),
        },
      };

      const procedure = implement(testContracts.singleResourceEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(({ input }) => ({ system: { id: input.systemId } }));

      const result = await call(
        procedure,
        { systemId: "system-123" },
        { context: contextWithAnonymousAccess },
      );

      expect(result).toEqual({ system: { id: "system-123" } });
    });

    it("should deny anonymous users without global access to single resource endpoints", async () => {
      // Mock anonymous access rules to NOT include the required access
      const contextWithoutAnonymousAccess = {
        ...mockContext,
        user: undefined,
        auth: {
          ...mockContext.auth,
          getAnonymousAccessRules: () => Promise.resolve([]),
        },
      };

      const procedure = implement(testContracts.singleResourceEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(({ input }) => ({ system: { id: input.systemId } }));

      expect(
        call(
          procedure,
          { systemId: "system-123" },
          { context: contextWithoutAnonymousAccess },
        ),
      ).rejects.toThrow("Authentication required to access");
    });
  });

  // ---------------------------------------------------------------------------
  // List Filtering (listKey)
  // ---------------------------------------------------------------------------

  describe("list endpoints with listKey", () => {
    it("should check global access for list endpoints", async () => {
      const procedure = implement(testContracts.publicListEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({
          systems: [
            { id: "1", name: "System 1" },
            { id: "2", name: "System 2" },
          ],
        }));

      const result = await call(procedure, undefined, { context: mockContext });

      expect(result.systems).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Record Filtering (recordKey)
  // ---------------------------------------------------------------------------

  describe("record endpoints with recordKey", () => {
    it("should check global access for record endpoints", async () => {
      const procedure = implement(testContracts.recordEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(({ input }) => ({
          statuses: Object.fromEntries(
            input.systemIds.map((id) => [id, { status: "ok" }]),
          ),
        }));

      const result = await call(
        procedure,
        { systemIds: ["sys-1", "sys-2"] },
        { context: mockContext },
      );

      expect(Object.keys(result.statuses)).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Contract-level instanceAccess Override
  // ---------------------------------------------------------------------------

  describe("instanceAccess override at contract level", () => {
    it("should use contract-level instanceAccess instead of access rule instanceAccess", async () => {
      // This test verifies that bulk endpoints can share the same access rule
      // as single endpoints, using instanceAccess override at contract level
      const contextWithAnonymousAccess = {
        ...mockContext,
        user: undefined,
        auth: {
          ...mockContext.auth,
          getAnonymousAccessRules: () =>
            Promise.resolve(["test-plugin.system.read"]),
        },
      };

      const procedure = implement(testContracts.bulkRecordWithOverride)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(({ input }) => ({
          statuses: Object.fromEntries(
            input.systemIds.map((id) => [id, { status: "ok" }]),
          ),
        }));

      // Should use recordKey filtering (from contract override),
      // not idParam check (from access rule)
      const result = await call(
        procedure,
        { systemIds: ["sys-1", "sys-2"] },
        { context: contextWithAnonymousAccess },
      );

      expect(Object.keys(result.statuses)).toHaveLength(2);
    });

    it("should deny anonymous users without access on override endpoints", async () => {
      const contextWithoutAccess = {
        ...mockContext,
        user: undefined,
        auth: {
          ...mockContext.auth,
          getAnonymousAccessRules: () => Promise.resolve([]),
        },
      };

      const procedure = implement(testContracts.bulkRecordWithOverride)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(({ input }) => ({
          statuses: Object.fromEntries(
            input.systemIds.map((id) => [id, { status: "ok" }]),
          ),
        }));

      // Without access, should return empty record (filtered out)
      const result = await call(
        procedure,
        { systemIds: ["sys-1", "sys-2"] },
        { context: contextWithoutAccess },
      );

      expect(Object.keys(result.statuses)).toHaveLength(0);
    });
  });
});
