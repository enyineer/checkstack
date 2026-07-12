import { describe, it, expect, mock } from "bun:test";
import { createHealthCheckRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import type { RpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import { createStubHealthCheckCache } from "./cache-test-stub";

/**
 * Router-level tests for the HANDLER-side authorization of the
 * configuration-centric assignment reads (`getConfigurationAssignments`) and
 * the relaxed single-configuration read (`getConfiguration`). Their contract
 * `access` is deliberately empty (see assignment-access.ts), so these tests
 * are the regression guard that the router actually enforces the rule.
 */

const passthroughCache = createStubHealthCheckCache();

const CONFIG_ID = "12345678-1234-4234-8234-123456789012";

const CONFIG_ROW = {
  id: CONFIG_ID,
  name: "Payments API root",
  strategyId: "healthcheck-http.http",
  config: { url: "https://api.example.com/healthz" },
  collectors: null,
  intervalSeconds: 60,
  paused: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ASSIGNMENT_ROWS = [
  {
    systemId: "sys-1",
    enabled: true,
    stateThresholds: null,
    satelliteIds: null,
    environmentIds: null,
    includeLocal: true,
    notificationPolicy: null,
  },
  {
    systemId: "sys-2",
    enabled: false,
    stateThresholds: null,
    satelliteIds: ["sat-1"],
    environmentIds: [],
    includeLocal: false,
    notificationPolicy: null,
  },
];

/**
 * A DB serving the three selects these handlers issue, disambiguated by the
 * projected columns: `select()` (no projection) resolves the configuration
 * row; a projection containing `enabled` resolves the full assignment rows; a
 * projection of only `systemId` resolves the assigned-id list.
 */
function createReadOnlyDb() {
  return {
    select: (projection?: Record<string, unknown>) => ({
      from: () => {
        const rows =
          projection === undefined
            ? [CONFIG_ROW]
            : "enabled" in projection
              ? ASSIGNMENT_ROWS
              : ASSIGNMENT_ROWS.map((row) => ({ systemId: row.systemId }));
        return Object.assign(Promise.resolve(rows), {
          where: () => Promise.resolve(rows),
        });
      },
    }),
  };
}

function buildRouter() {
  return createHealthCheckRouter({
    database: createReadOnlyDb() as never,
    registry: { getStrategy: mock(() => undefined) } as never,
    collectorRegistry: { getCollector: mock(() => undefined) } as never,
    gitOpsClient: {
      getProvenance: mock(() => Promise.resolve(null)),
    } as never,
    getEmitHook: () => undefined,
    cache: passthroughCache,
    configService: {
      get: mock(async () => undefined),
      set: mock(async () => {}),
    } as never,
    catalogClient: {
      getSystems: mock(async () => ({
        systems: [
          { id: "sys-1", name: "Payments" },
          { id: "sys-2", name: "Checkout" },
        ],
      })),
    } as never,
    maintenanceClient: {
      hasActiveMaintenance: mock(async () => ({ active: false })),
    } as never,
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    } as never,
  });
}

const teamUser = {
  type: "user" as const,
  id: "team-user",
  accessRules: [] as string[],
};

/** An auth override where the caller holds the given grants and nothing else. */
function authOverride({
  configGrant,
  readableSystemIds,
}: {
  configGrant: boolean;
  readableSystemIds: string[];
}): Partial<RpcContext> {
  return {
    auth: {
      check: mock(async ({ objectType }: { objectType: string }) => ({
        hasAccess: objectType === "healthcheck.healthcheck" && configGrant,
      })),
      listAccessibleObjectIds: mock(
        async ({ objectIds }: { objectIds: string[] }) =>
          objectIds.filter((id) => readableSystemIds.includes(id)),
      ),
    } as unknown as RpcContext["auth"],
  };
}

describe("getConfigurationAssignments authorization", () => {
  it("global configuration.read sees every row with resolved system names", async () => {
    const router = buildRouter();
    const context = createMockRpcContext({
      user: {
        type: "user",
        id: "global-reader",
        accessRules: ["healthcheck.healthcheck.read"],
      },
    });

    const rows = await call(
      router.getConfigurationAssignments,
      { configId: CONFIG_ID },
      { context },
    );

    expect(rows.map((r) => r.systemName).toSorted()).toEqual([
      "Checkout",
      "Payments",
    ]);
    // null environmentIds (= all envs) must survive the trip untouched.
    expect(rows.find((r) => r.systemId === "sys-1")?.environmentIds).toBeNull();
    expect(rows.find((r) => r.systemId === "sys-2")?.environmentIds).toEqual(
      [],
    );
  });

  it("a team grant on the CONFIGURATION sees every row", async () => {
    const router = buildRouter();
    const context = createMockRpcContext({
      user: teamUser,
      ...authOverride({ configGrant: true, readableSystemIds: [] }),
    });

    const rows = await call(
      router.getConfigurationAssignments,
      { configId: CONFIG_ID },
      { context },
    );
    expect(rows).toHaveLength(2);
  });

  it("a system-only caller sees ONLY their systems' rows", async () => {
    const router = buildRouter();
    const context = createMockRpcContext({
      user: teamUser,
      ...authOverride({ configGrant: false, readableSystemIds: ["sys-2"] }),
    });

    const rows = await call(
      router.getConfigurationAssignments,
      { configId: CONFIG_ID },
      { context },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].systemId).toBe("sys-2");
    expect(rows[0].systemName).toBe("Checkout");
  });

  it("a caller with no grant of either kind is FORBIDDEN", async () => {
    const router = buildRouter();
    const context = createMockRpcContext({
      user: teamUser,
      ...authOverride({ configGrant: false, readableSystemIds: [] }),
    });

    await expect(
      call(
        router.getConfigurationAssignments,
        { configId: CONFIG_ID },
        { context },
      ),
    ).rejects.toThrow(/FORBIDDEN|read access/i);
  });
});

describe("getConfiguration relaxed authorization", () => {
  it("a team grant on the configuration reads it", async () => {
    const router = buildRouter();
    const context = createMockRpcContext({
      user: teamUser,
      ...authOverride({ configGrant: true, readableSystemIds: [] }),
    });

    const config = await call(
      router.getConfiguration,
      { id: CONFIG_ID },
      { context },
    );
    expect(config?.name).toBe("Payments API root");
  });

  it("a reader of an ASSIGNED system reads it", async () => {
    const router = buildRouter();
    const context = createMockRpcContext({
      user: teamUser,
      ...authOverride({ configGrant: false, readableSystemIds: ["sys-1"] }),
    });

    const config = await call(
      router.getConfiguration,
      { id: CONFIG_ID },
      { context },
    );
    expect(config?.name).toBe("Payments API root");
  });

  it("an unrelated caller gets the same `undefined` as a missing id (no existence leak)", async () => {
    const router = buildRouter();
    const context = createMockRpcContext({
      user: teamUser,
      ...authOverride({ configGrant: false, readableSystemIds: [] }),
    });

    const config = await call(
      router.getConfiguration,
      { id: CONFIG_ID },
      { context },
    );
    expect(config).toBeUndefined();
  });
});
