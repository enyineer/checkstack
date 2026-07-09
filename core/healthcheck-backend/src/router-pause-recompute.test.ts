import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createHealthCheckRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import { createStubHealthCheckCache } from "./cache-test-stub";

/**
 * Router-level tests for the pause/resume handlers' rollup-health recompute
 * wiring. Pausing a configuration can flip the system's aggregate (e.g.
 * degraded → healthy when the sole failing check is paused); the router
 * MUST recompute the rollup `health` entity for every affected system so
 * that transition reaches the SLO engine and closes any open downtime
 * event. Resuming intentionally does NOT recompute — the next run drives
 * any degraded transition (see the resume handler comment for rationale).
 */

const passthroughCache = createStubHealthCheckCache();

const mockUser = {
  type: "user" as const,
  id: "test-user",
  accessRules: ["*"],
  roles: ["admin"],
};

const CONFIG_ID = "cfg-1";

/**
 * Mock db supporting the two query shapes the pause/resume handlers use:
 *  - `update().set().where()` for the paused flag flip
 *  - `select({systemId}).from(systemHealthChecks).where()` for
 *    `getSystemIdsForConfiguration`
 *
 * `systemIdsForConfig` is the configurable return for the SELECT query,
 * letting each test script the affected-system set.
 */
function createMockDb(systemIdsForConfig: string[]) {
  const selectResult = Promise.resolve(
    systemIdsForConfig.map((systemId) => ({ systemId })),
  );
  const whereMock = mock(() => selectResult);
  const fromResult = Object.assign(Promise.resolve([]), {
    where: whereMock,
  });
  const updateWhereMock = mock(() => Promise.resolve());
  const updateSetMock = mock(() => ({ where: updateWhereMock }));
  return {
    select: mock(() => ({ from: mock(() => fromResult) })),
    update: mock(() => ({ set: updateSetMock })),
    insert: mock(() => ({
      values: mock(() => ({
        onConflictDoUpdate: mock(() => Promise.resolve()),
        onConflictDoNothing: mock(() => Promise.resolve()),
        returning: mock(() => Promise.resolve([])),
      })),
    })),
    delete: mock(() => ({ where: mock(() => Promise.resolve()) })),
    execute: mock(() => Promise.resolve()),
  };
}

function buildRouter(
  systemIdsForConfig: string[],
  recomputeCalls: string[],
) {
  const recomputeSystemRollupHealth = (systemId: string) => {
    recomputeCalls.push(systemId);
    return Promise.resolve();
  };
  return {
    router: createHealthCheckRouter({
      database: createMockDb(systemIdsForConfig) as never,
      registry: { getStrategy: mock(() => undefined) } as never,
      collectorRegistry: { getCollector: mock(() => undefined) } as never,
      gitOpsClient: {
        getProvenance: mock(() => Promise.resolve(null)),
      } as never,
      signalService: {
        broadcast: mock(() => Promise.resolve()),
      } as never,
      getEmitHook: () => undefined,
      cache: passthroughCache,
      configService: {
        get: mock(async () => undefined),
        set: mock(async () => {}),
      } as never,
      catalogClient: { getSystem: mock(async () => null) } as never,
      maintenanceClient: {
        hasActiveMaintenance: mock(async () => ({ active: false })),
      } as never,
      logger: {
        debug: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
      } as never,
      recomputeSystemRollupHealth,
    }),
  };
}

describe("pauseConfiguration - rollup recompute wiring", () => {
  it("recomputes the rollup health entity for every affected system", async () => {
    const systemIds = ["sys-1", "sys-2", "sys-3"];
    const recomputeCalls: string[] = [];
    const { router } = buildRouter(systemIds, recomputeCalls);
    const context = createMockRpcContext({ user: mockUser });

    await call(router.pauseConfiguration, { id: CONFIG_ID }, { context });

    expect(recomputeCalls).toHaveLength(3);
    expect(recomputeCalls.sort()).toEqual(["sys-1", "sys-2", "sys-3"]);
  });

  it("still succeeds when no systems are assigned (no recompute calls)", async () => {
    const recomputeCalls: string[] = [];
    const { router } = buildRouter([], recomputeCalls);
    const context = createMockRpcContext({ user: mockUser });

    await call(router.pauseConfiguration, { id: CONFIG_ID }, { context });

    expect(recomputeCalls).toHaveLength(0);
  });
});

describe("resumeConfiguration - no recompute", () => {
  it("does NOT recompute the rollup on resume (lazy: next run drives transition)", async () => {
    const systemIds = ["sys-1", "sys-2"];
    const recomputeCalls: string[] = [];
    const { router } = buildRouter(systemIds, recomputeCalls);
    const context = createMockRpcContext({ user: mockUser });

    await call(router.resumeConfiguration, { id: CONFIG_ID }, { context });

    expect(recomputeCalls).toHaveLength(0);
  });
});