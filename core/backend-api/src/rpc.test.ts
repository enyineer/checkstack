import { describe, expect, it, mock, beforeEach, type Mock } from "bun:test";
import { call, implement, ORPCError } from "@orpc/server";
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
    access: [access("resource", "read", "Test access", { pluginId: "test" })],
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
        { pluginId: "test" },
      ).read,
    ],
    instanceAccess: { listKey: "systems" },
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
        { pluginId: "test" },
      ).read,
    ],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ system: z.object({ id: z.string() }).nullable() })),

  // Bulk record endpoint with recordKey (like getBulkSystemHealthStatus)
  recordEndpoint: proc({
    userType: "public",
    operationType: "query",
    access: [
      access("bulk", "read", "Bulk read", {
        isPublic: true,
        pluginId: "test",
      }),
    ],
    instanceAccess: { recordKey: "statuses" },
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

  // Create endpoint with team-ownership (instanceAccess.create)
  createEndpoint: proc({
    userType: "authenticated",
    operationType: "mutation",
    access: [
      accessPair(
        "system",
        {
          read: { description: "View systems" },
          manage: { description: "Manage systems" },
        },
        { pluginId: "test" },
      ).manage,
    ],
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    .input(z.object({ name: z.string(), teamId: z.string().optional() }))
    .output(z.object({ id: z.string() })),

  // Create endpoint gated by MANAGE on a parent resource (e.g. incident for systems)
  createWithParentEndpoint: proc({
    userType: "authenticated",
    operationType: "mutation",
    access: [
      accessPair(
        "incident",
        {
          read: { description: "View" },
          manage: { description: "Manage" },
        },
        { pluginId: "test" },
      ).manage,
    ],
    instanceAccess: {
      create: {
        idField: "id",
        parent: { resourceType: "catalog.system", idParam: "systemIds" },
      },
    },
  })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(z.object({ id: z.string() })),

  // Bulk record endpoint sharing the same access rule as the single-resource
  // endpoint, but declaring `recordKey` scoping at the procedure level. Instance
  // config now lives ONLY on the procedure (rules never carry it), so a bulk and
  // a single endpoint can reuse one access rule with different scoping modes.
  bulkRecordWithOverride: proc({
    userType: "public",
    operationType: "query",
    access: [
      accessPair(
        "system",
        {
          read: { description: "View systems", isPublic: true },
          manage: { description: "Manage systems" },
        },
        { pluginId: "test" },
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

  // Parent-scoped single read: "incidents for a system" — gated by READ access
  // to the PARENT system (catalog.system), not by incident grants.
  parentScopeSingleEndpoint: proc({
    userType: "public",
    operationType: "query",
    access: [access("incident", "read", "View incidents", { pluginId: "test" })],
    instanceAccess: {
      parentScope: {
        resourceType: "catalog.system",
        action: "read",
        idParam: "systemId",
      },
    },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ incidents: z.array(z.object({ id: z.string() })) })),

  // Parent-scoped bulk read: Record<systemId, data>, keys filtered by parent
  // (catalog.system) read access.
  parentScopeRecordEndpoint: proc({
    userType: "public",
    operationType: "query",
    access: [access("incident", "read", "View incidents", { pluginId: "test" })],
    instanceAccess: {
      parentScope: { resourceType: "catalog.system", recordKey: "bySystem" },
    },
  })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({ bySystem: z.record(z.string(), z.array(z.string())) }),
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

  parentScopeSingleEndpoint: implement(
    testContracts.parentScopeSingleEndpoint,
  ).handler(() => ({ incidents: [{ id: "inc-1" }] })),

  parentScopeRecordEndpoint: implement(
    testContracts.parentScopeRecordEndpoint,
  ).handler(({ input }) => ({
    bySystem: Object.fromEntries(input.systemIds.map((id) => [id, ["inc"]])),
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
          check: () => Promise.resolve({ hasAccess: false }),
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

  // ---------------------------------------------------------------------------
  // Parent-scoped endpoints (parentScope) — "see X for system S iff you see S"
  // ---------------------------------------------------------------------------

  describe("parent-scoped endpoints (parentScope)", () => {
    it("allows a single parent-scoped read when the caller has global parent access", async () => {
      // default mockContext user holds "*" → global access to catalog.system
      const procedure = implement(testContracts.parentScopeSingleEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ incidents: [{ id: "inc-1" }] }));

      const result = await call(
        procedure,
        { systemId: "sys-1" },
        { context: mockContext },
      );
      expect(result.incidents).toHaveLength(1);
    });

    it("denies when the caller cannot access the parent system", async () => {
      const ctx = {
        ...mockContext,
        user: { type: "user" as const, id: "u1", accessRules: [] },
        auth: {
          ...mockContext.auth,
          check: () => Promise.resolve({ hasAccess: false }),
        },
      };
      const procedure = implement(testContracts.parentScopeSingleEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ incidents: [] }));

      expect(
        call(procedure, { systemId: "sys-x" }, { context: ctx }),
      ).rejects.toThrow("Access denied to catalog.system:sys-x");
    });

    it("allows a team-scoped caller via a grant on the parent system", async () => {
      const ctx = {
        ...mockContext,
        user: { type: "user" as const, id: "u1", accessRules: [] },
        auth: {
          ...mockContext.auth,
          check: () => Promise.resolve({ hasAccess: true }),
        },
      };
      const procedure = implement(testContracts.parentScopeSingleEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ incidents: [{ id: "inc-1" }] }));

      const result = await call(
        procedure,
        { systemId: "sys-1" },
        { context: ctx },
      );
      expect(result.incidents).toHaveLength(1);
    });

    it("anonymous: allowed with global parent access, denied without", async () => {
      const procedure = implement(testContracts.parentScopeSingleEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(() => ({ incidents: [{ id: "inc-1" }] }));

      const allow = {
        ...mockContext,
        user: undefined,
        auth: {
          ...mockContext.auth,
          getAnonymousAccessRules: () =>
            Promise.resolve(["catalog.system.read"]),
        },
      };
      const deny = {
        ...mockContext,
        user: undefined,
        auth: {
          ...mockContext.auth,
          getAnonymousAccessRules: () => Promise.resolve([]),
        },
      };

      await expect(
        call(procedure, { systemId: "sys-1" }, { context: allow }),
      ).resolves.toBeDefined();
      await expect(
        call(procedure, { systemId: "sys-1" }, { context: deny }),
      ).rejects.toThrow();
    });

    it("filters bulk record keys by parent (system) access", async () => {
      const ctx = {
        ...mockContext,
        user: { type: "user" as const, id: "u1", accessRules: [] },
        auth: {
          ...mockContext.auth,
          // only sys-1 is accessible
          listAccessibleObjectIds: () => Promise.resolve(["sys-1"]),
          hasAnyTypeGrant: () => Promise.resolve({ hasGrant: true }),
        },
      };
      const procedure = implement(testContracts.parentScopeRecordEndpoint)
        .$context<RpcContext>()
        .use(autoAuthMiddleware)
        .handler(({ input }) => ({
          bySystem: Object.fromEntries(input.systemIds.map((id) => [id, ["inc"]])),
        }));

      const result = await call(
        procedure,
        { systemIds: ["sys-1", "sys-2"] },
        { context: ctx },
      );
      expect(Object.keys(result.bySystem)).toEqual(["sys-1"]);
    });
  });
});

// =============================================================================
// G11: MEANINGFUL ERRORS vs SILENT EMPTY (regression anchor)
// =============================================================================
//
// Today the list/record post-filter strips inaccessible items and returns an
// empty array/record with HTTP 200. A caller that is *categorically*
// unauthorized (no global access rule AND no qualifying team grant) is
// therefore indistinguishable from a caller that is legitimately scoped to an
// empty set. This is the bug behind the reported repro: an API-key
// (application) principal whose scope lacks `catalog.system.read` calls
// `getSystems` and receives `{ systems: [] }` at 200 instead of a 403 with a
// useful body.
//
// The fix must:
//   - 403 (FORBIDDEN) with a structured body when the caller is categorically
//     unauthorized (no global rule AND no qualifying grant for the type), and
//   - keep returning 200 (possibly empty) when the caller is legitimately
//     scoped (has global access, OR is in a team that holds a grant for the
//     type), and
//   - NEVER 403 anonymous callers on `userType: "public"` endpoints (status
//     pages must keep rendering an empty list rather than erroring).
//
// `categoricallyUnauthorized` is a property of caller + resourceType, NOT of
// the result count. The middleware learns it from an extended
// `auth.listAccessibleObjectIds` signal (added during implementation). Until
// then, the first test below FAILS — it is the red anchor for the G11 fix.
describe("G11: categorically-unauthorized list calls must 403, not silent empty", () => {
  let mockContext: RpcContext;

  beforeEach(() => {
    mockContext = createMockRpcContext();
  });

  it("FAILING ANCHOR: an application/API-key with no global access and no team grants gets 403, not an empty 200", async () => {
    const contextNoAccessNoGrants = {
      ...mockContext,
      // API-key principal whose scope lacks the required `system.read` rule.
      user: {
        type: "application" as const,
        id: "app-1",
        name: "ci-key",
        accessRules: [],
      },
      auth: {
        ...mockContext.auth,
        // No global rule + no qualifying team grant => categorically
        // unauthorized: the empty filter result must become a 403, not a 200.
        listAccessibleObjectIds: () => Promise.resolve([] as string[]),
        hasAnyTypeGrant: () => Promise.resolve({ hasGrant: false }),
      },
    };

    const procedure = implement(testContracts.publicListEndpoint)
      .$context<RpcContext>()
      .use(autoAuthMiddleware)
      .handler(() => ({
        systems: [
          { id: "system-1", name: "System 1" },
          { id: "system-2", name: "System 2" },
        ],
      }));

    // DESIRED: a meaningful 403, NOT a silent `{ systems: [] }` at 200.
    // CURRENT behavior returns `{ systems: [] }` => this rejects-assertion
    // fails today, anchoring the fix.
    expect(
      call(procedure, undefined, { context: contextNoAccessNoGrants }),
    ).rejects.toThrow(/forbidden|not authorized|access/i);
  });

  it("GUARD: keeps returning 200 with the accessible subset when the caller is legitimately scoped (partial access)", async () => {
    const contextPartialScope = {
      ...mockContext,
      user: {
        type: "application" as const,
        id: "app-1",
        name: "scoped-key",
        accessRules: [],
      },
      auth: {
        ...mockContext.auth,
        // Non-empty subset => the caller demonstrably has access to something,
        // so this is legitimate partial scope, never a 403.
        listAccessibleObjectIds: () => Promise.resolve(["system-1"]),
      },
    };

    const procedure = implement(testContracts.publicListEndpoint)
      .$context<RpcContext>()
      .use(autoAuthMiddleware)
      .handler(() => ({
        systems: [
          { id: "system-1", name: "System 1" },
          { id: "system-2", name: "System 2" },
        ],
      }));

    const result = await call(procedure, undefined, {
      context: contextPartialScope,
    });

    expect(result.systems).toEqual([{ id: "system-1", name: "System 1" }]);
  });

  it("GUARD: never 403s anonymous callers on public list endpoints (status pages keep rendering an empty list)", async () => {
    const contextAnonymousNoAccess = {
      ...mockContext,
      user: undefined,
      auth: {
        ...mockContext.auth,
        getAnonymousAccessRules: () => Promise.resolve([] as string[]),
      },
    };

    const procedure = implement(testContracts.publicListEndpoint)
      .$context<RpcContext>()
      .use(autoAuthMiddleware)
      .handler(() => ({
        systems: [{ id: "system-1", name: "System 1" }],
      }));

    const result = await call(procedure, undefined, {
      context: contextAnonymousNoAccess,
    });

    expect(result.systems).toEqual([]);
  });
});

// =============================================================================
// CREATE-MODE TEAM OWNERSHIP (instanceAccess.create)
// =============================================================================

describe("create-mode team ownership", () => {
  let mockContext: RpcContext;

  beforeEach(() => {
    mockContext = createMockRpcContext();
  });

  const buildCreate = () =>
    implement(testContracts.createEndpoint)
      .$context<RpcContext>()
      .use(autoAuthMiddleware)
      .handler(() => ({ id: "new-1" }));

  it("authorizes the create via auth and writes the owning-team grant for the created id", async () => {
    const setOwner = mock(() => Promise.resolve());
    const ctx = {
      ...mockContext,
      // A team member without global manage.
      user: { type: "user" as const, id: "u1", accessRules: [] },
      auth: {
        ...mockContext.auth,
        authorizeCreate: () =>
          Promise.resolve({ ownerTeamId: "team-1", isPrivate: true }),
        setOwner,
      },
    };

    const result = await call(
      buildCreate(),
      { name: "x", teamId: "team-1" },
      { context: ctx },
    );

    expect(result).toEqual({ id: "new-1" });
    expect(setOwner).toHaveBeenCalledWith({
      objectType: "test-plugin.system",
      objectId: "new-1",
      teamId: "team-1",
      isPrivate: true,
    });
  });

  it("writes no owner grant when the create resolves to a global resource (ownerTeamId null)", async () => {
    const setOwner = mock(() => Promise.resolve());
    const ctx = {
      ...mockContext,
      // Global-manage admin.
      user: { type: "user" as const, id: "admin", accessRules: ["*"] },
      auth: {
        ...mockContext.auth,
        authorizeCreate: () =>
          Promise.resolve({ ownerTeamId: null, isPrivate: false }),
        setOwner,
      },
    };

    const result = await call(buildCreate(), { name: "x" }, { context: ctx });

    expect(result).toEqual({ id: "new-1" });
    expect(setOwner).not.toHaveBeenCalled();
  });

  it("parent-gated: a caller who can manage the referenced systems may create (no per-type capability needed)", async () => {
    let handlerRan = false;
    const procedure = implement(testContracts.createWithParentEndpoint)
      .$context<RpcContext>()
      .use(autoAuthMiddleware)
      .handler(() => {
        handlerRan = true;
        return { id: "inc-1" };
      });

    const ctx = {
      ...mockContext,
      // No global manage and no create-capability for the type.
      user: { type: "user" as const, id: "u1", accessRules: [] },
      auth: {
        ...mockContext.auth,
        // Caller CAN manage the referenced system.
        check: () => Promise.resolve({ hasAccess: true }),
        // Without the parent gate this would reject; assert the gate is what authorizes.
        authorizeCreate: (p: { alreadyAuthorized?: boolean }) =>
          p.alreadyAuthorized
            ? Promise.resolve({ ownerTeamId: null, isPrivate: false })
            : Promise.reject(
                new ORPCError("FORBIDDEN", { message: "no capability" }),
              ),
      },
    };

    const result = await call(
      procedure,
      { systemIds: ["sys-1"] },
      { context: ctx },
    );
    expect(result).toEqual({ id: "inc-1" });
    expect(handlerRan).toBe(true);
  });

  it("parent-gated: a caller who cannot manage the referenced systems is rejected", async () => {
    let handlerRan = false;
    const procedure = implement(testContracts.createWithParentEndpoint)
      .$context<RpcContext>()
      .use(autoAuthMiddleware)
      .handler(() => {
        handlerRan = true;
        return { id: "inc-1" };
      });

    const ctx = {
      ...mockContext,
      user: { type: "user" as const, id: "u1", accessRules: [] },
      auth: {
        ...mockContext.auth,
        // Caller CANNOT manage the referenced system => parent gate fails.
        check: () => Promise.resolve({ hasAccess: false }),
        authorizeCreate: (p: { alreadyAuthorized?: boolean }) =>
          p.alreadyAuthorized
            ? Promise.resolve({ ownerTeamId: null, isPrivate: false })
            : Promise.reject(
                new ORPCError("FORBIDDEN", { message: "no capability" }),
              ),
      },
    };

    await expect(
      call(procedure, { systemIds: ["sys-1"] }, { context: ctx }),
    ).rejects.toThrow();
    expect(handlerRan).toBe(false);
  });

  it("rejects the create (and never runs the handler) when authorization is denied", async () => {
    let handlerRan = false;
    const procedure = implement(testContracts.createEndpoint)
      .$context<RpcContext>()
      .use(autoAuthMiddleware)
      .handler(() => {
        handlerRan = true;
        return { id: "new-1" };
      });

    const ctx = {
      ...mockContext,
      user: { type: "user" as const, id: "u1", accessRules: [] },
      auth: {
        ...mockContext.auth,
        authorizeCreate: () =>
          Promise.reject(new ORPCError("FORBIDDEN", { message: "denied" })),
      },
    };

    await expect(
      call(procedure, { name: "x" }, { context: ctx }),
    ).rejects.toThrow();
    expect(handlerRan).toBe(false);
  });
});
