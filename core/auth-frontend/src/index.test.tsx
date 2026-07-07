import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { AuthAccessApi } from "./lib/AuthAccessApi";
import {
  resourceType,
  type AccessRule,
  type InstanceAccessConfig,
  type ProcedureWithMeta,
} from "@checkstack/common";
import { useAccessRules } from "./hooks/useAccessRules";
import * as realUseAccessRules from "./hooks/useAccessRules";
import * as realFrontendApi from "@checkstack/frontend-api";

// Snapshot the real hook module before mocking; restore it in afterAll so the
// stub does not leak into later auth-frontend suites (mock.module is
// process-global and mock.restore() does not undo it).
const realUseAccessRulesModule = { ...realUseAccessRules };
const realFrontendApiModule = { ...realFrontendApi };

// Mock the useAccessRules hook
mock.module("./hooks/useAccessRules", () => ({
  useAccessRules: mock(),
}));

// Controllable results for the auth RPC client used by the create/resource
// capability hooks. Each test sets these before invoking the hook.
let canCreateQueryResult: {
  data?: { allowed: boolean };
  isLoading: boolean;
} = { data: undefined, isLoading: false };
let accessibleQueryResult: {
  data?: { accessibleIds: string[] };
  isLoading: boolean;
} = { data: undefined, isLoading: false };
let manageableTypesQueryResult: {
  data?: { types: string[] };
  isLoading: boolean;
} = { data: undefined, isLoading: false };

// The `enabled` option each capability hook last passed to its query — lets
// tests assert an authenticated-only RPC would NOT be fired (e.g. for
// anonymous callers, where it could only 401).
let lastCanCreateQueryEnabled: boolean | undefined;
let lastAccessibleQueryEnabled: boolean | undefined;
let lastManageableTypesQueryEnabled: boolean | undefined;

// Override only `usePluginClient` so `useProcedureAccess` / `useResourceAccess`
// read from controllable query stubs; everything else stays real.
mock.module("@checkstack/frontend-api", () => ({
  ...realFrontendApiModule,
  usePluginClient: () => ({
    canCreate: {
      useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
        lastCanCreateQueryEnabled = options?.enabled;
        return canCreateQueryResult;
      },
    },
    listMyAccessibleResources: {
      useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
        lastAccessibleQueryEnabled = options?.enabled;
        return accessibleQueryResult;
      },
    },
    myManageableTypes: {
      useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
        lastManageableTypesQueryEnabled = options?.enabled;
        return manageableTypesQueryResult;
      },
    },
  }),
}));

afterAll(() => {
  mock.module("./hooks/useAccessRules", () => realUseAccessRulesModule);
  mock.module("@checkstack/frontend-api", () => realFrontendApiModule);
});

// Test access rule objects
const testReadAccess: AccessRule = {
  id: "test.read",
  resource: "test",
  level: "read",
  description: "Test read access",
  pluginId: "test",
};

const testManageAccess: AccessRule = {
  id: "test.manage",
  resource: "test",
  level: "manage",
  description: "Test manage access",
  pluginId: "test",
};

const otherAccess: AccessRule = {
  id: "other.read",
  resource: "other",
  level: "read",
  description: "Other read access",
  pluginId: "other",
};

// Typed resource-type constants for the capability hooks (no raw strings).
const TEST_TYPE = resourceType({ pluginId: "test" }, "test");
const CATALOG_SYSTEM_TYPE = resourceType({ pluginId: "catalog" }, "system");

/**
 * Build a contract-procedure stand-in gated on `testManageAccess` with the given
 * `instanceAccess`, so `useProcedureAccess` derives the gate from it exactly as
 * it would from a real contract procedure.
 */
function proc(instanceAccess: InstanceAccessConfig): ProcedureWithMeta {
  return {
    "~orpc": {
      meta: {
        userType: "authenticated",
        operationType: "mutation",
        access: [testManageAccess],
        instanceAccess,
      },
    },
  };
}

describe("AuthAccessApi", () => {
  let accessApi: AuthAccessApi;

  beforeEach(() => {
    accessApi = new AuthAccessApi();
  });

  it("should return true if user has the access rule", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["test.test.read"],
      loading: false,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });

  it("should return false if user is missing the access rule", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["other.other.read"],
      loading: false,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: false,
    });
  });

  it("should return false if no session data (no access rules)", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: [],
      loading: false,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: false,
    });
  });

  it("should return false if no user access rules (empty array)", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: [],
      loading: false,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: false,
    });
  });

  it("should return true if user has the wildcard access rule", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["*"],
      loading: false,
    });

    expect(accessApi.useAccess(otherAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });

  it("should return true if user has manage access for a manage check", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["test.test.manage"],
      loading: false,
    });

    expect(accessApi.useAccess(testManageAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });

  it("should return loading state if access rules are loading", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: [],
      loading: true,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: true,
      allowed: false,
    });
  });

  it("should return true if user has manage access for a read check", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["test.test.manage"],
      loading: false,
    });

    // User has test.manage, which implies test.read
    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });

  describe("useProcedureAccess (create gate)", () => {
    // A create procedure with no parent gate, and one gated on a parent system.
    const createProc = proc({ create: { teamIdParam: "teamId", idField: "id" } });
    const createForSystemProc = proc({
      create: {
        teamIdParam: "teamId",
        idField: "id",
        parent: { resourceType: "catalog.system", idParam: "systemId" },
      },
    });

    beforeEach(() => {
      canCreateQueryResult = { data: undefined, isLoading: false };
    });

    it("allows via the global rule without consulting the team query", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: ["test.test.manage"],
        loading: false,
      });
      // Team query would say no — global must still win.
      canCreateQueryResult = { data: { allowed: false }, isLoading: false };

      expect(accessApi.useProcedureAccess(createProc)).toEqual({
        loading: false,
        allowed: true,
      });
    });

    it("allows a global PARENT manager for a parent-gated create", () => {
      // No global create rule and no team grant — but global manage on the
      // PARENT type (catalog.system) must offer the create affordance, matching
      // the backend's parent-gated create.
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: ["catalog.system.manage"],
        loading: false,
        isAuthenticated: true,
      });
      canCreateQueryResult = { data: { allowed: false }, isLoading: false };

      expect(accessApi.useProcedureAccess(createForSystemProc)).toEqual({
        loading: false,
        allowed: true,
      });
    });

    it("allows via a team grant when the global rule is absent", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: true,
      });
      canCreateQueryResult = { data: { allowed: true }, isLoading: false };

      expect(accessApi.useProcedureAccess(createForSystemProc)).toEqual({
        loading: false,
        allowed: true,
      });
    });

    it("denies when neither the global rule nor a team grant applies", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: true,
      });
      canCreateQueryResult = { data: { allowed: false }, isLoading: false };

      expect(accessApi.useProcedureAccess(createProc)).toEqual({
        loading: false,
        allowed: false,
      });
    });

    it("reports loading while the global rule is still resolving", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: true,
      });

      expect(accessApi.useProcedureAccess(createProc)).toEqual({
        loading: true,
        allowed: false,
      });
    });
  });

  describe("useCanAccessType", () => {
    beforeEach(() => {
      manageableTypesQueryResult = { data: undefined, isLoading: false };
    });

    it("allows via the global rule regardless of the team set", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: ["test.test.manage"],
        loading: false,
      });
      manageableTypesQueryResult = { data: { types: [] }, isLoading: false };

      expect(
        accessApi.useCanAccessType({
          accessRule: testManageAccess,
          objectType: TEST_TYPE,
        }),
      ).toEqual({ loading: false, allowed: true });
    });

    it("allows when the team set contains the objectType", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: true,
      });
      manageableTypesQueryResult = {
        data: { types: [TEST_TYPE] },
        isLoading: false,
      };

      expect(
        accessApi.useCanAccessType({
          accessRule: testManageAccess,
          objectType: TEST_TYPE,
        }),
      ).toEqual({ loading: false, allowed: true });
    });

    it("allows via the parentType (managing the parent unlocks the surface)", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: true,
      });
      manageableTypesQueryResult = {
        data: { types: [CATALOG_SYSTEM_TYPE] },
        isLoading: false,
      };

      expect(
        accessApi.useCanAccessType({
          accessRule: testManageAccess,
          objectType: TEST_TYPE,
          parentType: CATALOG_SYSTEM_TYPE,
        }),
      ).toEqual({ loading: false, allowed: true });
    });

    it("denies when neither the global rule nor the team set applies", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: true,
      });
      manageableTypesQueryResult = {
        data: { types: ["some.other"] },
        isLoading: false,
      };

      expect(
        accessApi.useCanAccessType({
          accessRule: testManageAccess,
          objectType: TEST_TYPE,
          parentType: CATALOG_SYSTEM_TYPE,
        }),
      ).toEqual({ loading: false, allowed: false });
    });
  });

  describe("useSurfaceAccess (derived from the contract procedure)", () => {
    // A no-instance utility/list procedure gated on the manage rule: its
    // `typeScoped` mode resolves the surface objectType (test.test) straight
    // from the access rule, so the surface gate needs no hand-passed type.
    const surfaceProc = proc({ typeScoped: {} });

    beforeEach(() => {
      manageableTypesQueryResult = { data: undefined, isLoading: false };
    });

    it("allows via the global rule (surface objectType derived from the proc)", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: ["test.test.manage"],
        loading: false,
      });
      manageableTypesQueryResult = { data: { types: [] }, isLoading: false };

      expect(accessApi.useSurfaceAccess(surfaceProc)).toEqual({
        loading: false,
        allowed: true,
      });
    });

    it("allows when the team set contains the derived objectType", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: true,
      });
      manageableTypesQueryResult = {
        data: { types: [TEST_TYPE] },
        isLoading: false,
      };

      expect(accessApi.useSurfaceAccess(surfaceProc)).toEqual({
        loading: false,
        allowed: true,
      });
    });

    it("denies when neither the global rule nor the team set grants the type", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: true,
      });
      manageableTypesQueryResult = {
        data: { types: ["some.other"] },
        isLoading: false,
      };

      expect(accessApi.useSurfaceAccess(surfaceProc)).toEqual({
        loading: false,
        allowed: false,
      });
    });
  });

  describe("useResourceAccess", () => {
    beforeEach(() => {
      accessibleQueryResult = { data: undefined, isLoading: false };
    });

    it("grants every id when the user holds the global rule", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: ["test.test.manage"],
        loading: false,
      });

      const { hasGlobal, canAccess } = accessApi.useResourceAccess({
        accessRule: testManageAccess,
        objectType: TEST_TYPE,
        resourceIds: ["a", "b"],
      });
      expect(hasGlobal).toBe(true);
      expect(canAccess("a")).toBe(true);
      expect(canAccess("z")).toBe(true);
    });

    it("grants only the team-accessible subset when the global rule is absent", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: true,
      });
      accessibleQueryResult = {
        data: { accessibleIds: ["a"] },
        isLoading: false,
      };

      const { hasGlobal, canAccess } = accessApi.useResourceAccess({
        accessRule: testManageAccess,
        objectType: TEST_TYPE,
        resourceIds: ["a", "b"],
      });
      expect(hasGlobal).toBe(false);
      expect(canAccess("a")).toBe(true);
      expect(canAccess("b")).toBe(false);
    });

    it("fails closed (no access) while the global rule is resolving", () => {
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: true,
      });

      const { loading, canAccess } = accessApi.useResourceAccess({
        accessRule: testManageAccess,
        objectType: TEST_TYPE,
        resourceIds: ["a"],
      });
      expect(loading).toBe(true);
      expect(canAccess("a")).toBe(false);
    });
  });

  // Anonymous callers must NEVER fire the authenticated-only capability RPCs
  // (canCreate / myManageableTypes / listMyAccessibleResources): a guest holds
  // no team grants, so the call can only fail with 401 "Authentication
  // required" and spam the backend log. Regression guard for that 401 noise.
  describe("anonymous callers keep authenticated-only RPCs disabled", () => {
    beforeEach(() => {
      canCreateQueryResult = { data: undefined, isLoading: false };
      accessibleQueryResult = { data: undefined, isLoading: false };
      manageableTypesQueryResult = { data: undefined, isLoading: false };
      lastCanCreateQueryEnabled = undefined;
      lastAccessibleQueryEnabled = undefined;
      lastManageableTypesQueryEnabled = undefined;
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: false,
      });
    });

    it("useProcedureAccess (create) leaves the canCreate query disabled and denies", () => {
      const result = accessApi.useProcedureAccess(
        proc({ create: { teamIdParam: "teamId", idField: "id" } }),
      );

      expect(lastCanCreateQueryEnabled).toBe(false);
      expect(result).toEqual({ loading: false, allowed: false });
    });

    it("useCanAccessType leaves the myManageableTypes query disabled and denies", () => {
      const result = accessApi.useCanAccessType({
        accessRule: testManageAccess,
        objectType: TEST_TYPE,
      });

      expect(lastManageableTypesQueryEnabled).toBe(false);
      expect(result).toEqual({ loading: false, allowed: false });
    });

    it("useRouteAccess with a manageCapability leaves the query disabled and denies", () => {
      const result = accessApi.useRouteAccess({
        accessRule: testManageAccess,
        manageCapability: { objectType: TEST_TYPE },
      });

      expect(lastManageableTypesQueryEnabled).toBe(false);
      expect(result).toEqual({ loading: false, allowed: false });
    });

    it("useResourceAccess leaves the listMyAccessibleResources query disabled and fails closed", () => {
      const { loading, hasGlobal, canAccess } = accessApi.useResourceAccess({
        accessRule: testManageAccess,
        objectType: TEST_TYPE,
        resourceIds: ["a"],
      });

      expect(lastAccessibleQueryEnabled).toBe(false);
      expect(loading).toBe(false);
      expect(hasGlobal).toBe(false);
      expect(canAccess("a")).toBe(false);
    });
  });

  // The counterpart guard: an AUTHENTICATED caller without the global rule
  // must still consult the team-derived RPCs, or team-scoped users lose their
  // capability-gated surfaces entirely.
  describe("authenticated team-scoped callers still fetch the capability RPCs", () => {
    beforeEach(() => {
      canCreateQueryResult = { data: undefined, isLoading: false };
      accessibleQueryResult = { data: undefined, isLoading: false };
      manageableTypesQueryResult = { data: undefined, isLoading: false };
      lastCanCreateQueryEnabled = undefined;
      lastAccessibleQueryEnabled = undefined;
      lastManageableTypesQueryEnabled = undefined;
      (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
        accessRules: [],
        loading: false,
        isAuthenticated: true,
      });
    });

    it("useProcedureAccess (create) enables the canCreate query", () => {
      accessApi.useProcedureAccess(
        proc({ create: { teamIdParam: "teamId", idField: "id" } }),
      );

      expect(lastCanCreateQueryEnabled).toBe(true);
    });

    it("useCanAccessType enables the myManageableTypes query", () => {
      accessApi.useCanAccessType({
        accessRule: testManageAccess,
        objectType: TEST_TYPE,
      });

      expect(lastManageableTypesQueryEnabled).toBe(true);
    });

    it("useRouteAccess with a manageCapability enables the query", () => {
      accessApi.useRouteAccess({
        accessRule: testManageAccess,
        manageCapability: { objectType: TEST_TYPE },
      });

      expect(lastManageableTypesQueryEnabled).toBe(true);
    });

    it("useResourceAccess enables the listMyAccessibleResources query", () => {
      accessApi.useResourceAccess({
        accessRule: testManageAccess,
        objectType: TEST_TYPE,
        resourceIds: ["a"],
      });

      expect(lastAccessibleQueryEnabled).toBe(true);
    });
  });
});
